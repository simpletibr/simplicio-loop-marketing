/**
 * funnel.ts — from the prospect to the money: collected -> preview -> sent ->
 * replied -> sale -> subscription, and the revenue behind it.
 *
 * Read-only, and never a billing client: it reads what the sources already
 * wrote (the control spreadsheet export, the factory's `venda.json`, the
 * recorded Stripe webhook log). A step counts everyone who got that far, so a
 * spreadsheet that skips a status still gives a monotone funnel. A sale and an
 * active subscription come from the money sources, never from a spreadsheet
 * status alone for the subscription step. Money keeps its original currency;
 * the real value is only summed when every payment carries it (never guessed).
 * Presentation mode (`?present=1`) drops every per-client value.
 */

import { round } from "./common";
import type { StoredEvent } from "../store";
import type { ViewContext, ViewRoute } from "../routes";

export const FUNNEL_STAGES = ["collected", "preview", "sent", "replied", "sale", "subscription"] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];
/** The playbook's reference for prospect -> sale. */
export const REFERENCE_SALE_RATE_PCT = 2;
/** The contract's minimum subscription length. */
export const MINIMUM_MONTHS = 3;

const DAY_MS = 86_400_000;
const MONTH_MS = 30.4375 * DAY_MS;

const norm = (value: unknown): string => String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Statuses of the control spreadsheet, in Portuguese and English, as the furthest funnel step they prove. */
const SHEET_STAGE: Record<string, number> = {
  coletado: 0, coletada: 0, collected: 0,
  previa: 1, preview: 1,
  enviada: 2, enviado: 2, sent: 2,
  respondeu: 3, resposta: 3, replied: 3,
  vendido: 4, vendida: 4, venda: 4, pago: 4, paga: 4, fechado: 4, sold: 4, paid: 4,
};

export interface Money {
  count: number;
  /** Sum in the original currency of each payment. */
  by_currency: Record<string, number>;
  /** Sum in reais when every payment carries it, else null; `brl_missing` says how many do not. */
  brl: number | null;
  brl_missing: number;
}

function moneyOf(events: StoredEvent[]): Money {
  const by: Record<string, number> = {};
  let brl = 0;
  let missing = 0;
  for (const e of events) {
    const currency = String(e.data.currency ?? "BRL").toUpperCase();
    const amount = Number(e.data.amount ?? 0);
    by[currency] = round((by[currency] ?? 0) + amount, 2);
    if (typeof e.data.amount_brl === "number") brl += e.data.amount_brl;
    else missing++;
  }
  return { count: events.length, by_currency: by, brl: missing === 0 ? round(brl, 2) : null, brl_missing: missing };
}

const isActive = (e: StoredEvent): boolean => e.data.status === "active" || e.data.status === "trialing";

function addMonths(iso: string, months: number): string {
  const d = new Date(iso);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString();
}

export interface StageCount {
  stage: FunnelStage;
  count: number;
  /** Share of the previous step that got here; null with no one in the previous step. */
  conversion_pct: number | null;
}

function stagesOf(stageOfClient: number[]): StageCount[] {
  const counts = FUNNEL_STAGES.map((_, i) => stageOfClient.filter((s) => s >= i).length);
  return FUNNEL_STAGES.map((stage, i) => ({ stage, count: counts[i] as number, conversion_pct: i === 0 || (counts[i - 1] as number) === 0 ? null : round(((counts[i] as number) / (counts[i - 1] as number)) * 100, 1) }));
}

export interface ClientRow {
  client: string;
  country: string | null;
  batch: string | null;
  stage: FunnelStage;
  ltv: Money;
  months_active: number | null;
  /** `pago -> entregue`, or no sale yet. */
  status: "sem venda" | "pago" | "entregue";
  subscription: string | null;
  next_charge_at: string | null;
  /** The earliest date the subscription may end under the minimum length; null with no active period. */
  minimum_until: string | null;
  minimum_met: boolean | null;
}

export function funnel(ctx: ViewContext) {
  const hide = ctx.query.get("present") === "1";
  const now = ctx.now.getTime();
  const only = ctx.query.get("client");
  const country = ctx.query.get("country");
  const batch = ctx.query.get("batch");
  const events = ctx.store.all().filter((e) => Date.parse(e.ts) <= now).sort((a, b) => a.ts.localeCompare(b.ts) || a.seq - b.seq);

  const prospects = new Map<string, { country: string | null; batch: string | null; sheet: number }>();
  const unknownStatuses = new Set<string>();
  const previews = new Set<string>();
  const payments = new Map<string, StoredEvent[]>();
  const subEvents = new Map<string, StoredEvent[]>();
  const finals = new Map<string, number[]>();
  const known = (client: string) => {
    let p = prospects.get(client);
    if (!p) prospects.set(client, (p = { country: null, batch: null, sheet: 0 }));
    return p;
  };
  for (const e of events) {
    if (!e.client || (only && e.client !== only)) continue;
    if (e.kind === "marketing.prospect_collected") {
      const p = known(e.client);
      const status = norm(e.data.status);
      if (status in SHEET_STAGE) p.sheet = Math.max(p.sheet, SHEET_STAGE[status] as number);
      else if (status) unknownStatuses.add(status);
      if (typeof e.data.country === "string" && e.data.country) p.country = e.data.country;
      if (typeof e.data.batch === "string" && e.data.batch) p.batch = e.data.batch;
    } else if (e.kind === "marketing.render_finished" && e.data.stage === "preview" && e.data.ok !== false) previews.add(e.client);
    else if (e.kind === "marketing.render_finished" && e.data.stage === "final" && e.data.ok !== false) finals.set(e.client, [...(finals.get(e.client) ?? []), Date.parse(e.ts)]);
    else if (e.kind === "marketing.payment_received") payments.set(e.client, [...(payments.get(e.client) ?? []), e]);
    else if (e.kind === "marketing.subscription_changed") subEvents.set(e.client, [...(subEvents.get(e.client) ?? []), e]);
  }
  // A client with money but no spreadsheet row was a prospect all along.
  for (const client of [...payments.keys(), ...subEvents.keys()]) known(client);

  const latestSub = new Map<string, StoredEvent>([...subEvents].map(([client, list]) => [client, list.at(-1) as StoredEvent]));
  const stageOf = (client: string): number => {
    const p = prospects.get(client) as { sheet: number };
    const sub = latestSub.get(client);
    return Math.max(p.sheet, previews.has(client) ? 1 : 0, payments.has(client) ? 4 : 0, sub && isActive(sub) ? 5 : 0);
  };

  const inScope = [...prospects].filter(([, p]) => (!country || p.country === country) && (!batch || p.batch === batch));
  const stagesAll = stagesOf(inScope.map(([client]) => stageOf(client)));
  const groupKeys = [...new Set(inScope.map(([, p]) => `${p.country ?? ""}\u0000${p.batch ?? ""}`))].sort();
  const groups = groupKeys.map((key) => {
    const [c = "", b = ""] = key.split("\u0000");
    return { country: c || null, batch: b || null, stages: stagesOf(inScope.filter(([, p]) => (p.country ?? "") === c && (p.batch ?? "") === b).map(([client]) => stageOf(client))) };
  });
  const collected = stagesAll[0]?.count ?? 0;
  const sales = stagesAll[4]?.count ?? 0;
  const saleRate = collected === 0 ? null : round((sales / collected) * 100, 2);

  // Revenue and subscriptions: scoped by client only (a country or batch is a prospecting cut, not a revenue cut).
  const allPayments = [...payments.values()].flat().sort((a, b) => a.ts.localeCompare(b.ts));
  const monthStart = Date.UTC(ctx.now.getUTCFullYear(), ctx.now.getUTCMonth(), 1);
  const recurring = (e: StoredEvent): boolean => e.data.event_type === "invoice.paid";
  const block = (list: StoredEvent[]) => ({ total: moneyOf(list), one_off: moneyOf(list.filter((e) => !recurring(e))), recurring: moneyOf(list.filter(recurring)) });
  const processors = [...new Set(allPayments.map((e) => String(e.data.processor ?? "sem dado")))].sort();

  const subs = [...subEvents].map(([client, list]) => {
    const latest = list.at(-1) as StoredEvent;
    const firstActive = list.find(isActive);
    const canceled = latest.data.status === "canceled" ? latest : null;
    const end = canceled ? Date.parse(canceled.ts) : now;
    const months = firstActive ? round((end - Date.parse(firstActive.ts)) / MONTH_MS, 1) : null;
    return {
      client,
      plan: String(latest.data.plan ?? [...list].reverse().find((e) => e.data.plan)?.data.plan ?? "sem plano"),
      status: String(latest.data.status ?? "sem dado"),
      active: isActive(latest),
      currency: String(latest.data.currency ?? "BRL").toUpperCase(),
      mrr: typeof latest.data.mrr === "number" ? latest.data.mrr : null,
      mrr_brl: typeof latest.data.amount_brl === "number" ? latest.data.amount_brl : null,
      first_active_at: firstActive?.ts ?? null,
      canceled_at: canceled?.ts ?? null,
      months_active: months,
      minimum_months: MINIMUM_MONTHS,
      minimum_until: firstActive ? addMonths(firstActive.ts, MINIMUM_MONTHS) : null,
      minimum_met: months === null ? null : months >= MINIMUM_MONTHS,
      next_charge_at: isActive(latest) && typeof latest.data.next_charge_at === "string" ? latest.data.next_charge_at : null,
    };
  });
  const active = subs.filter((s) => s.active);
  const mrrBy: Record<string, number> = {};
  for (const s of active) if (s.mrr !== null) mrrBy[s.currency] = round((mrrBy[s.currency] ?? 0) + s.mrr, 2);
  const brlOf = (list: typeof subs): number | null => (list.length > 0 && list.every((s) => s.mrr_brl !== null) ? round(list.reduce((a, s) => a + (s.mrr_brl as number), 0), 2) : list.length === 0 ? 0 : null);
  const plans = [...new Set(active.map((s) => s.plan))].sort().map((plan) => {
    const mine = active.filter((s) => s.plan === plan);
    return { plan, active: mine.length, mrr_brl: brlOf(mine) };
  });
  const canceled30 = subs.filter((s) => s.canceled_at && now - Date.parse(s.canceled_at) <= 30 * DAY_MS);
  const churnBase = active.length + canceled30.length;

  const perClient: ClientRow[] = inScope
    .map(([client, p]) => {
      const mine = payments.get(client) ?? [];
      const sub = subs.find((s) => s.client === client);
      const firstPaid = mine[0] ? Date.parse(mine[0].ts) : null;
      const delivered = mine.some((e) => e.data.delivered === true) || (firstPaid !== null && (finals.get(client) ?? []).some((t) => t >= firstPaid));
      return {
        client,
        country: p.country,
        batch: p.batch,
        stage: FUNNEL_STAGES[stageOf(client)] as FunnelStage,
        ltv: moneyOf(mine),
        months_active: sub?.months_active ?? null,
        status: mine.length === 0 ? ("sem venda" as const) : delivered ? ("entregue" as const) : ("pago" as const),
        subscription: sub?.status ?? null,
        next_charge_at: sub?.next_charge_at ?? null,
        minimum_until: sub?.minimum_until ?? null,
        minimum_met: sub?.minimum_met ?? null,
      };
    })
    .filter((row) => row.ltv.count > 0 || row.subscription !== null)
    .sort((a, b) => FUNNEL_STAGES.indexOf(b.stage) - FUNNEL_STAGES.indexOf(a.stage) || a.client.localeCompare(b.client));

  return {
    generated_at: ctx.now.toISOString(),
    read_only: true,
    presentation: hide,
    reference: { sale_rate_pct: REFERENCE_SALE_RATE_PCT, label: "referência do playbook: cerca de 2% dos prospects viram venda" },
    funnel: { stages: stagesAll, sale_rate_pct: saleRate, vs_reference_pp: saleRate === null ? null : round(saleRate - REFERENCE_SALE_RATE_PCT, 2), groups, unknown_statuses: [...unknownStatuses].sort() },
    revenue: {
      month_start: new Date(monthStart).toISOString(),
      month: block(allPayments.filter((e) => Date.parse(e.ts) >= monthStart)),
      all_time: block(allPayments),
      by_processor: processors.map((processor) => ({ processor, ...moneyOf(allPayments.filter((e) => String(e.data.processor ?? "sem dado") === processor)) })),
    },
    subscriptions: {
      active: active.length,
      mrr: { by_currency: mrrBy, brl: brlOf(active) },
      by_plan: plans,
      churn_30d: { canceled: canceled30.length, rate_pct: churnBase === 0 ? null : round((canceled30.length / churnBase) * 100, 1), canceled_before_minimum: subs.filter((s) => s.canceled_at && s.minimum_met === false).length },
      minimum_months: MINIMUM_MONTHS,
      list: hide ? [] : subs,
    },
    per_client: hide ? [] : perClient,
    per_client_hidden: hide,
  };
}

export const funnelRoute: ViewRoute = { path: "/api/funnel", handle: funnel };
