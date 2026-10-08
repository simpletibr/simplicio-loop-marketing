import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEvent, type DashboardEvent, type MarketingKind } from "../../lib/dashboard/events.ts";
import { EventStore } from "../../lib/dashboard/store.ts";
import { FUNNEL_STAGES, MINIMUM_MONTHS, REFERENCE_SALE_RATE_PCT, funnel } from "../../lib/dashboard/views/funnel.ts";
import { mapStripeEvent } from "../../lib/observability/dashboard/billing.ts";
import { startDashboard } from "../../lib/dashboard/server.ts";
import { defaultSources } from "../../lib/observability/dashboard/index.ts";
import { emptyHost } from "../helpers/dashboard-fixture.ts";
import type { ViewContext } from "../../lib/dashboard/routes.ts";

const NOW = new Date("2026-12-15T12:00:00Z");
let n = 0;
const ev = (kind: MarketingKind, ts: string, client: string, data: Record<string, unknown>): DashboardEvent => makeEvent({ source: "t", key: `${kind}|${++n}`, ts, kind, client, piece_id: client, data });
const slug = (i: number): string => `p${String(i).padStart(3, "0")}`;

const COUNTRY = ["BR", "BR", "CH", "US"] as const; // by i % 4, so BR gets half
const batchOf = (i: number): string => (i < 100 ? "b1" : "b2");

/**
 * 200 prospects. The furthest step each one reaches is written by index:
 * 0-3 sale (0-1 pay in reais through venda.json, 2-3 pay through Stripe), 0-11 replied, 0-59 sent, 0-99 preview.
 * Subscriptions: 2 and 3 are active, 1 was cancelled after two months.
 */
function build() {
  const { root } = emptyHost();
  const store = new EventStore(root);
  const all: DashboardEvent[] = [];
  for (let i = 0; i < 200; i++) {
    const status = i < 12 ? "respondeu" : i < 60 ? "Enviada" : i < 100 ? "prévia" : "coletado";
    all.push(ev("prospect_collected", "2026-08-01T10:00:00Z", slug(i), { country: COUNTRY[i % 4], batch: batchOf(i), status }));
    if (i < 100 && i % 2 === 0) all.push(ev("render_finished", "2026-08-02T10:00:00Z", slug(i), { stage: "preview", ok: true }));
  }
  all.push(ev("prospect_collected", "2026-08-03T10:00:00Z", slug(150), { status: "talvez" })); // a status with no known step
  // sales
  all.push(ev("payment_received", "2026-10-03T10:00:00Z", slug(0), { amount: 356, currency: "BRL", processor: "abacatepay", delivered: true, amount_brl: 356, fx: "native" }));
  all.push(ev("payment_received", "2026-10-04T10:00:00Z", slug(1), { amount: 356, currency: "BRL", processor: "abacatepay", amount_brl: 356, fx: "native" }));
  all.push(ev("render_finished", "2026-10-06T10:00:00Z", slug(1), { stage: "final", ok: true }));
  all.push(ev("payment_received", "2026-08-15T10:00:00Z", slug(2), { amount: 356, currency: "USD", processor: "stripe", event_type: "checkout.session.completed", amount_brl: 1780, fx: "estimate:env PTAX_USD_BRL" }));
  all.push(ev("payment_received", "2026-11-20T10:00:00Z", slug(3), { amount: 99, currency: "USD", processor: "stripe", event_type: "checkout.session.completed" })); // no conversion rate
  // subscriptions and the recurring charges
  all.push(ev("subscription_changed", "2026-08-15T10:01:00Z", slug(2), { status: "active", plan: "pacote-4", currency: "USD", mrr: 356, amount_brl: 1780, next_charge_at: "2027-01-15T00:00:00.000Z" }));
  all.push(ev("subscription_changed", "2026-11-20T10:01:00Z", slug(3), { status: "active", plan: "social-piloto-automatico", currency: "USD", mrr: 99 }));
  all.push(ev("subscription_changed", "2026-10-01T10:00:00Z", slug(1), { status: "active", plan: "pacote-4", currency: "BRL", mrr: 356, amount_brl: 356 }));
  all.push(ev("subscription_changed", "2026-12-01T10:00:00Z", slug(1), { status: "canceled", plan: "pacote-4" }));
  all.push(ev("payment_received", "2026-12-02T10:00:00Z", slug(2), { amount: 356, currency: "USD", processor: "stripe", event_type: "invoice.paid", amount_brl: 1780, fx: "estimate:env PTAX_USD_BRL" }));
  all.push(ev("payment_received", "2026-12-05T10:00:00Z", slug(3), { amount: 99, currency: "USD", processor: "stripe", event_type: "invoice.paid" }));
  store.ingest(all);
  return { root, store };
}

const ctxOf = (root: string, store: EventStore, query = ""): ViewContext => ({ root, store, sources: defaultSources(root), now: NOW, query: new URLSearchParams(query), alerts: () => [] });

test("the fixture of 200 prospects, 4 sales and 2 subscriptions matches the reference computation", () => {
  const { root, store } = build();
  const d = funnel(ctxOf(root, store));
  assert.deepEqual(FUNNEL_STAGES, ["collected", "preview", "sent", "replied", "sale", "subscription"]);

  // reference: how many prospects got at least as far as each step, counted straight from the generating rule
  const reached = [200, 100, 60, 12, 4, 2];
  assert.deepEqual(d.funnel.stages.map((s) => s.count), reached);
  const conv = reached.map((c, i) => (i === 0 ? null : Math.round((c / (reached[i - 1] as number)) * 1000) / 10));
  assert.deepEqual(d.funnel.stages.map((s) => s.conversion_pct), conv, "conversion is the share of the previous step");
  assert.deepEqual(conv.slice(1), [50, 60, 20, 33.3, 50]);
  assert.equal(d.funnel.sale_rate_pct, 2);
  assert.equal(REFERENCE_SALE_RATE_PCT, 2);
  assert.equal(d.funnel.vs_reference_pp, 0);
  assert.deepEqual(d.funnel.unknown_statuses, ["talvez"], "a status with no known step is reported, and counts as collected only");

  // by country and batch: the same counts, cut by the generating rule
  const cuts = new Map<string, number[]>();
  for (let i = 0; i < 200; i++) {
    const key = `${COUNTRY[i % 4]}|${batchOf(i)}`;
    const stage = i < 2 ? 4 : i < 4 ? 5 : i < 12 ? 3 : i < 60 ? 2 : i < 100 ? 1 : 0; // 0,1 = sale only; 2,3 = sale with subscription
    cuts.set(key, [...(cuts.get(key) ?? []), stage]);
  }
  assert.equal(d.funnel.groups.length, cuts.size);
  for (const g of d.funnel.groups) {
    const mine = cuts.get(`${g.country}|${g.batch}`) as number[];
    assert.deepEqual(g.stages.map((s) => s.count), FUNNEL_STAGES.map((_, step) => mine.filter((s) => s >= step).length), `${g.country} ${g.batch}`);
  }
  assert.equal(d.funnel.groups.reduce((a, g) => a + (g.stages[0]?.count ?? 0), 0), 200);

});

test("revenue keeps the original currency, sums reais only when every payment carries them, and splits one-off from recurring", () => {
  const { root, store } = build();
  const r = funnel(ctxOf(root, store)).revenue;
  // all time: 356 BRL x2, 356 USD (1780 BRL), 99 USD with no rate, then two invoices of 356 USD (1780 BRL) and 99 USD (no rate)
  assert.equal(r.all_time.total.count, 6);
  assert.deepEqual(r.all_time.total.by_currency, { BRL: 712, USD: 910 });
  assert.equal(r.all_time.total.brl, null, "two payments have no conversion: no total in reais is invented");
  assert.equal(r.all_time.total.brl_missing, 2);
  assert.equal(r.all_time.one_off.count + r.all_time.recurring.count, 6);
  assert.equal(r.all_time.recurring.count, 2);
  // December: only the two invoices
  assert.equal(r.month_start, "2026-12-01T00:00:00.000Z");
  assert.deepEqual(r.month.total.by_currency, { USD: 455 });
  assert.equal(r.month.recurring.count, 2);
  assert.equal(r.month.one_off.count, 0);
  assert.equal(r.month.one_off.brl, 0, "no payment of that kind is zero reais, not missing");
  // by processor: Stripe abroad, AbacatePay in Brazil, with the currency of each
  const abacate = r.by_processor.find((p) => p.processor === "abacatepay")!;
  assert.deepEqual([abacate.count, abacate.by_currency, abacate.brl], [2, { BRL: 712 }, 712]);
  assert.equal(r.by_processor.find((p) => p.processor === "stripe")!.count, 4);

  // with the conversion recorded on every payment the total in reais appears
  const { root: root2 } = emptyHost();
  const store2 = new EventStore(root2);
  store2.ingest([
    ev("payment_received", "2026-12-02T10:00:00Z", "a", { amount: 100, currency: "USD", processor: "stripe", amount_brl: 500, fx: "estimate:env PTAX_USD_BRL" }),
    ev("payment_received", "2026-12-03T10:00:00Z", "b", { amount: 200, currency: "BRL", processor: "abacatepay", amount_brl: 200, fx: "native" }),
  ]);
  const total = funnel(ctxOf(root2, store2)).revenue.all_time.total;
  assert.deepEqual([total.brl, total.brl_missing, total.by_currency], [700, 0, { USD: 100, BRL: 200 }]);
});

test("subscriptions: MRR, plans, churn and the three month minimum", () => {
  const { root, store } = build();
  const s = funnel(ctxOf(root, store)).subscriptions;
  assert.equal(s.active, 2);
  assert.deepEqual(s.mrr.by_currency, { USD: 455 });
  assert.equal(s.mrr.brl, null, "one active subscription has no conversion");
  assert.deepEqual(s.by_plan.map((p) => [p.plan, p.active, p.mrr_brl]), [["pacote-4", 1, 1780], ["social-piloto-automatico", 1, null]]);
  assert.equal(s.minimum_months, MINIMUM_MONTHS);
  assert.deepEqual(s.churn_30d, { canceled: 1, rate_pct: 33.3, canceled_before_minimum: 1 });
  const byClient = Object.fromEntries(s.list.map((x) => [x.client, x]));
  assert.deepEqual([byClient.p002?.months_active, byClient.p002?.minimum_met, byClient.p002?.minimum_until, byClient.p002?.next_charge_at], [4, true, "2026-11-15T10:01:00.000Z", "2027-01-15T00:00:00.000Z"]);
  assert.deepEqual([byClient.p003?.months_active, byClient.p003?.minimum_met, byClient.p003?.minimum_until], [0.8, false, "2027-02-20T10:01:00.000Z"]);
  assert.deepEqual([byClient.p001?.status, byClient.p001?.canceled_at, byClient.p001?.months_active, byClient.p001?.minimum_met], ["canceled", "2026-12-01T10:00:00.000Z", 2, false]);
  assert.equal(byClient.p001?.next_charge_at, null, "a cancelled subscription has no next charge");
});

test("per client: LTV, months active, next charge and paid -> delivered", () => {
  const { root, store } = build();
  const rows = Object.fromEntries(funnel(ctxOf(root, store)).per_client.map((c) => [c.client, c]));
  assert.deepEqual(Object.keys(rows).sort(), ["p000", "p001", "p002", "p003"], "only clients with a sale or a subscription");
  assert.equal(rows.p000?.status, "entregue", "venda.json said delivered");
  assert.equal(rows.p001?.status, "entregue", "a final render after the payment delivers it");
  assert.equal(rows.p003?.status, "pago", "paid, nothing delivered yet");
  assert.deepEqual([rows.p000?.country, rows.p000?.batch, rows.p000?.stage], ["BR", "b1", "sale"]);
  assert.equal(rows.p002?.stage, "subscription");
  assert.equal(rows.p001?.stage, "sale", "a cancelled subscription is a sale, not an active subscription");
  assert.deepEqual(rows.p002?.ltv.by_currency, { USD: 712 });
  assert.equal(rows.p002?.ltv.brl, 3560);
  assert.equal(rows.p003?.ltv.brl, null);
  assert.equal(rows.p002?.next_charge_at, "2027-01-15T00:00:00.000Z");
});

test("presentation mode hides every per-client value and keeps the totals", () => {
  const { root, store } = build();
  const open = funnel(ctxOf(root, store));
  const masked = funnel(ctxOf(root, store, "present=1"));
  assert.equal(masked.presentation, true);
  assert.equal(masked.per_client_hidden, true);
  assert.deepEqual(masked.per_client, []);
  assert.deepEqual(masked.subscriptions.list, []);
  assert.deepEqual(masked.funnel, open.funnel, "the funnel totals stay");
  assert.deepEqual(masked.revenue, open.revenue, "the revenue totals stay");
  const text = JSON.stringify(masked);
  for (const clientSlug of ["p000", "p001", "p002", "p003"]) assert.equal(text.includes(clientSlug), false, `${clientSlug} must not appear`);
  assert.equal(open.per_client_hidden, false);
});

test("filters: a client, a country or a batch narrows the funnel; an empty store is sem dado, never zero conversion", () => {
  const { root, store } = build();
  const br = funnel(ctxOf(root, store, "country=BR"));
  assert.equal(br.funnel.stages[0]?.count, 100, "BR is half of the 200");
  assert.ok(br.funnel.groups.every((g) => g.country === "BR"));
  assert.equal(funnel(ctxOf(root, store, "batch=b2")).funnel.stages[0]?.count, 100);
  assert.deepEqual(funnel(ctxOf(root, store, "client=p002")).funnel.stages.map((s) => s.count), [1, 1, 1, 1, 1, 1]);
  const { root: emptyRoot } = emptyHost();
  const empty = funnel(ctxOf(emptyRoot, new EventStore(emptyRoot)));
  assert.deepEqual(empty.funnel.stages.map((s) => [s.count, s.conversion_pct]), FUNNEL_STAGES.map(() => [0, null]));
  assert.equal(empty.funnel.sale_rate_pct, null);
  assert.equal(empty.funnel.vs_reference_pp, null);
  assert.equal(empty.subscriptions.churn_30d.rate_pct, null);
  assert.equal(empty.subscriptions.mrr.brl, 0);
});

test("the Stripe subscription events now carry the next charge date", () => {
  const sub = (object: Record<string, unknown>) => mapStripeEvent({ id: "evt_s", type: "customer.subscription.updated", created: 1_790_000_000, data: { object: { status: "active", metadata: { client: "acme" }, ...object } } });
  const at = Date.UTC(2027, 0, 15) / 1000;
  assert.equal(sub({ current_period_end: at })?.data.next_charge_at, "2027-01-15T00:00:00.000Z");
  assert.equal(sub({ items: { data: [{ current_period_end: at, price: { id: "p" } }] } })?.data.next_charge_at, "2027-01-15T00:00:00.000Z", "newer API versions put it on the item");
  assert.equal(sub({})?.data.next_charge_at, undefined, "no date, no guess");
  assert.equal(mapStripeEvent({ id: "evt_d", type: "customer.subscription.deleted", created: 1_790_000_000, data: { object: { status: "canceled", current_period_end: at, metadata: { client: "acme" } } } })?.data.next_charge_at, undefined, "a cancelled subscription has no next charge");
});

test("the funnel route is read-only: every write method is refused", async () => {
  const { root } = emptyHost();
  const server = await startDashboard({ root, pollMs: 50 });
  try {
    const headers = { authorization: `Bearer ${server.token}` };
    const ok = await fetch(`${server.url}/api/funnel`, { headers });
    assert.equal(ok.status, 200);
    assert.equal(((await ok.json()) as { read_only: boolean }).read_only, true);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) assert.equal((await fetch(`${server.url}/api/funnel`, { method, headers })).status, 405);
    const masked = (await (await fetch(`${server.url}/api/funnel?present=1`, { headers })).json()) as { presentation: boolean };
    assert.equal(masked.presentation, true, "the presentation flag reaches the view");
  } finally {
    await server.close();
  }
});
