import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { makeEvent, type MarketingKind } from "../../lib/dashboard/events.ts";
import { EventStore } from "../../lib/dashboard/store.ts";
import { createReadOnlyRo } from "../../lib/dashboard/realoficial.ts";
import { credits } from "../../lib/dashboard/views/credits.ts";
import { defaultSources } from "../../lib/observability/dashboard/index.ts";
import { emptyHost } from "../helpers/dashboard-fixture.ts";
import type { ViewContext } from "../../lib/dashboard/routes.ts";

// 2026-10-10 12:00 UTC: 9.5 days into a 31 day month.
const NOW = new Date("2026-10-10T12:00:00Z");
const at = (iso: string) => iso;
let n = 0;

function ev(kind: MarketingKind, ts: string, client: string | undefined, piece_id: string | undefined, data: Record<string, unknown>) {
  return makeEvent({ source: "t", key: `${kind}|${++n}`, ts, kind, client, piece_id, data });
}

function build() {
  const { root, eRoot } = emptyHost();
  const store = new EventStore(root);
  store.ingest([
    // Real Oficial spends, all approved: lothus 30 + 20 cuts, 10 dubbing; acme 15 cuts; one last month
    ev("credit_spent", at("2026-10-02T10:00:00Z"), "lothus", "P1", { credits: 30, purpose: "cortes", approved_by: "wesley", provider: "realoficial" }),
    ev("credit_spent", at("2026-10-05T10:00:00Z"), "lothus", "P2", { credits: 20, purpose: "cortes", approved_by: "wesley", provider: "realoficial" }),
    ev("credit_spent", at("2026-10-06T10:00:00Z"), "lothus", "P3", { credits: 10, purpose: "dublagem", approved_by: "ana", provider: "realoficial" }),
    ev("credit_spent", at("2026-10-07T10:00:00Z"), "acme-us", "P9", { credits: 15, purpose: "cortes", approved_by: "wesley", provider: "realoficial" }),
    ev("credit_spent", at("2026-09-20T10:00:00Z"), "lothus", "P0", { credits: 100, purpose: "cortes", approved_by: "wesley", provider: "realoficial" }),
    // voice: lothus two new takes (0.02 + 0.03 USD, 10 s + 15 s) and two cache hits; acme one take (0.05 USD, 20 s)
    ev("voice_rendered", at("2026-10-03T10:00:00Z"), "lothus", "P1", { provider: "tts", seconds: 10, cost_usd: 0.02, cache_hit: false }),
    ev("voice_rendered", at("2026-10-04T10:00:00Z"), "lothus", "P2", { provider: "tts", seconds: 15, cost_usd: 0.03, cache_hit: false }),
    ev("voice_rendered", at("2026-10-04T11:00:00Z"), "lothus", "P2b", { provider: "tts", seconds: 15, cost_usd: 0.03, cache_hit: true }),
    ev("voice_rendered", at("2026-10-04T12:00:00Z"), "lothus", "P2c", { provider: "tts", seconds: 15, cost_usd: 0.03, cache_hit: true }),
    ev("voice_rendered", at("2026-10-05T10:00:00Z"), "acme-us", "P9", { provider: "tts", seconds: 20, cost_usd: 0.05, cache_hit: false }),
    // quota
    ev("tts_quota", at("2026-10-10T08:00:00Z"), undefined, undefined, { requests: 87, limit: 100, exhausted: false }),
    ev("tts_quota", at("2026-10-10T09:00:00Z"), undefined, undefined, { blocked_until: "2026-10-11T07:00:00.000Z", exhausted: true }),
    // previews: 4 pieces rendered a preview; two sales; lothus subscription 200 BRL, acme in USD with no BRL conversion
    ...["P1", "P2", "P3", "P9"].map((p) => ev("render_finished", at("2026-10-03T00:00:00Z"), p === "P9" ? "acme-us" : "lothus", p, { stage: "preview", ok: true })),
    ev("payment_received", at("2026-10-08T00:00:00Z"), "lothus", undefined, { amount: 200, currency: "BRL", processor: "abacatepay" }),
    ev("payment_received", at("2026-10-09T00:00:00Z"), "acme-us", undefined, { amount: 99, currency: "USD", processor: "stripe" }),
    ev("subscription_changed", at("2026-10-08T00:00:00Z"), "lothus", undefined, { status: "active", currency: "BRL", mrr: 200, amount_brl: 200 }),
    ev("subscription_changed", at("2026-10-09T00:00:00Z"), "acme-us", undefined, { status: "active", currency: "USD", mrr: 99 }),
  ]);
  mkdirSync(join(eRoot, "data"), { recursive: true });
  const usage = [
    { timestamp: "2026-10-02T00:00:00Z", task: "script", provider: "p-a", cost_usd: 0.04, tokens: 100 },
    { timestamp: "2026-10-03T00:00:00Z", task: "caption", provider: "p-b", cost_usd: 0.06, tokens: 200 },
    { timestamp: "2026-09-03T00:00:00Z", task: "script", provider: "p-a", cost_usd: 9, tokens: 100 },
  ];
  appendFileSync(join(eRoot, "data", "llm-usage.jsonl"), usage.map((u) => JSON.stringify(u)).join("\n") + "\n");
  return { root, store };
}

function ctxOf(root: string, store: EventStore, ro?: ViewContext["ro"], query = ""): ViewContext {
  return { root, store, sources: defaultSources(root), now: NOW, query: new URLSearchParams(query), alerts: () => [], ro };
}

const saved = { ptax: process.env.PTAX_USD_BRL, credit: process.env.RO_CREDIT_BRL };
afterEach(() => {
  for (const [k, v] of [["PTAX_USD_BRL", saved.ptax], ["RO_CREDIT_BRL", saved.credit]] as const) v === undefined ? delete process.env[k] : (process.env[k] = v);
});

test("fixture numbers match the reference computation and estimates are labelled", async () => {
  process.env.PTAX_USD_BRL = "5";
  process.env.RO_CREDIT_BRL = "0.5";
  const { root, store } = build();
  const ro = createReadOnlyRo({ call: async (tool) => (tool === "ro_whoami" ? { credits: 420 } : {}) });
  const d = await credits(ctxOf(root, store, ro));

  // Real Oficial: October spend 30 + 20 + 10 + 15 = 75 (September's 100 is outside the month)
  assert.equal(d.realoficial.balance, 420);
  assert.equal(d.realoficial.spent_month, 75);
  // linear projection: 75 credits over 9.5 elapsed days, 31 days in the month
  assert.equal(d.realoficial.projected_month, Math.round(((75 / 9.5) * 31) * 100) / 100);
  assert.equal(d.realoficial.projection_estimate, true);
  assert.deepEqual(d.realoficial.by_purpose, { cortes: 65, dublagem: 10 }, "by purpose, this month only");
  assert.equal(d.realoficial.period, "2026-10");
  assert.equal(d.realoficial.purchases, null, "no purchase history source: sem dado, and no purchase is ever started");

  // Voice: October takes 0.02 + 0.03 + 0.05 USD; cache hits cost nothing; 3 of 5 events are new takes, 2 are cache hits
  assert.equal(d.tts.requests_today, 87);
  assert.equal(d.tts.limit, 100);
  assert.equal(d.tts.blocked_until, "2026-10-11T07:00:00.000Z");
  assert.equal(d.tts.seconds_month, 75);
  assert.equal(d.tts.cost_usd_month, 0.1);
  assert.equal(d.tts.cost_brl_month, 0.5);
  assert.deepEqual(d.tts.fx, { rate: 5, label: "estimativa: PTAX_USD_BRL do ambiente" });
  assert.equal(d.tts.cache_hit_rate, 40);

  // LLM (October rows only): 0.04 + 0.06
  assert.equal(d.llm?.calls, 2);
  assert.equal(d.llm?.cost_usd, 0.1);
  assert.deepEqual(d.llm?.by_provider, { "p-a": { calls: 1, cost: 0.04 }, "p-b": { calls: 1, cost: 0.06 } });
  assert.equal(d.render.machine_time_s, null);

  // Unit economics: variable cost = voice 0.10 + llm 0.10 = 0.20 USD over 4 previews and 2 sales
  const ue = d.unit_economics;
  assert.deepEqual([ue.previews, ue.sales], [4, 2]);
  assert.equal(ue.cost_per_preview_usd, 0.05);
  assert.equal(ue.previews_per_sale, 2);
  assert.equal(ue.cost_per_sale_usd, 0.1);
  assert.equal(ue.estimate, true);
  const lothus = ue.per_client.find((c) => c.client === "lothus")!;
  // credits 60 x 0.5 = 30 BRL; voice 0.05 USD x 5 = 0.25 BRL; price 200 BRL
  assert.deepEqual([lothus.credits, lothus.tts_usd, lothus.cost_brl, lothus.mrr_brl, lothus.margin_brl], [60, 0.05, 30.25, 200, 169.75]);
  assert.deepEqual(lothus.credits_by_purpose, { cortes: 50, dublagem: 10 });
  assert.deepEqual(lothus.approved_by, ["ana", "wesley"]);
  const acme = ue.per_client.find((c) => c.client === "acme-us")!;
  assert.equal(acme.mrr_brl, null, "a USD price with no BRL conversion is sem dado");
  assert.equal(acme.margin_brl, null);
  assert.equal(acme.cost_brl, 7.5 + 0.25, "15 credits x 0.5 + 0.05 USD x 5");
  assert.ok(d.labels.some((l) => /estimativas/.test(l)));
});

test("without a rate, a conversion or the read-only window, the value is sem dado and never zero", async () => {
  delete process.env.PTAX_USD_BRL;
  delete process.env.RO_CREDIT_BRL;
  const { root, store } = build();
  const d = await credits(ctxOf(root, store));
  assert.equal(d.realoficial.balance, null);
  assert.equal(d.realoficial.balance_source, "leitura da Real Oficial desligada");
  assert.equal(d.tts.cost_brl_month, null);
  assert.equal(d.tts.fx, null);
  const lothus = d.unit_economics.per_client.find((c) => c.client === "lothus")!;
  assert.equal(lothus.cost_brl, null);
  assert.equal(lothus.margin_brl, null);
  assert.equal(lothus.mrr_brl, 200);

  const empty = emptyHost();
  const none = await credits(ctxOf(empty.root, new EventStore(empty.root)));
  assert.deepEqual([none.realoficial.projected_month, none.tts.requests_today, none.tts.cost_usd_month, none.tts.cache_hit_rate, none.llm, none.unit_economics.cost_per_preview_usd, none.unit_economics.cost_per_sale_usd], [null, null, null, null, null, null, null]);
});

test("the client filter scopes every number, and a failing balance read is sem dado, not an error", async () => {
  process.env.PTAX_USD_BRL = "5";
  const { root, store } = build();
  const d = await credits(ctxOf(root, store, createReadOnlyRo({ call: async () => { throw new Error("offline"); } }), "client=acme-us"));
  assert.equal(d.realoficial.balance, null);
  assert.equal(d.realoficial.spent_month, 15);
  assert.equal(d.tts.seconds_month, 20);
  assert.deepEqual(d.unit_economics.per_client.map((c) => c.client), ["acme-us"]);
  assert.equal(d.unit_economics.previews, 1);
});
