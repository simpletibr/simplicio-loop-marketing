/**
 * credits.ts — what each piece, client and sale costs, and how much credit is
 * left. Read-only: the balance comes from the allowlisted `ro_whoami` call and
 * every spend shown is a row some human approved. Nothing here can spend, buy
 * or render. Money in reais is an estimate and says so: it uses the
 * `PTAX_USD_BRL` of the environment and, for Real Oficial credits,
 * `RO_CREDIT_BRL`; without them the value is "sem dado", never a guess.
 */

import { engineRoot } from "../../clients/paths";
import { readUsage, summarize, usageLogPath } from "../../observability/cost";
import type { StoredEvent } from "../store";
import { DAY_MS, round } from "./common";
import type { ViewContext, ViewRoute } from "../routes";

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const envNumber = (name: string): number | null => {
  const n = Number(process.env[name]);
  return process.env[name] && Number.isFinite(n) && n > 0 ? n : null;
};

export interface ClientCost {
  client: string;
  credits: number;
  credits_by_purpose: Record<string, number>;
  approved_by: string[];
  tts_usd: number;
  cost_brl: number | null;
  mrr_brl: number | null;
  margin_brl: number | null;
}

export async function credits(ctx: ViewContext) {
  const { root, store, now } = ctx;
  const t = now.getTime();
  const events: StoredEvent[] = store.all().filter((e) => Date.parse(e.ts) <= t);
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const inMonth = (e: StoredEvent): boolean => Date.parse(e.ts) >= monthStart;
  const ptax = envNumber("PTAX_USD_BRL");
  const creditBrl = envNumber("RO_CREDIT_BRL");
  const only = ctx.query.get("client");
  const scoped = events.filter((e) => !only || e.client === only);

  // Real Oficial: balance (read-only), spend by client and purpose, projection.
  const who = ctx.ro ? await ctx.ro.get("ro_whoami").then((r) => r.data, () => null) : null;
  const balance = num((who as { credits?: unknown } | null)?.credits);
  // Everything below is this month, so a client's cost and price are compared like for like.
  const spends = scoped.filter((e) => e.kind === "marketing.credit_spent" && inMonth(e));
  const spentMonth = spends.reduce((a, e) => a + (num(e.data.credits) ?? 0), 0);
  const elapsedDays = Math.max((t - monthStart) / DAY_MS, 1);
  const purposes: Record<string, number> = {};
  for (const e of spends) purposes[String(e.data.purpose ?? "outros")] = round((purposes[String(e.data.purpose ?? "outros")] ?? 0) + (num(e.data.credits) ?? 0), 2);

  // Gemini TTS (the voice provider): today's quota, seconds, cost and cache.
  const voice = scoped.filter((e) => e.kind === "marketing.voice_rendered" && inMonth(e));
  const voiceMonth = voice;
  const ttsUsd = (list: StoredEvent[]): number => list.filter((e) => e.data.cache_hit !== true).reduce((a, e) => a + (num(e.data.cost_usd) ?? 0), 0);
  const quota = events.filter((e) => e.kind === "marketing.tts_quota" && t - Date.parse(e.ts) < DAY_MS);
  const lastUsage = quota.filter((e) => num(e.data.requests) !== null).at(-1);
  const blockedUntil = [...quota].reverse().map((e) => e.data.blocked_until).find((b) => typeof b === "string") as string | undefined;

  // LLM usage from data/llm-usage.jsonl (this month); render machine time is not reported by the video factory yet.
  const usageRows = readUsage(usageLogPath(engineRoot(root))).filter((r) => r.timestamp && Date.parse(r.timestamp) >= monthStart && Date.parse(r.timestamp) <= t);
  const llm = usageRows.length === 0 ? null : summarize(usageRows);

  // Unit economics for the month.
  const month = scoped.filter(inMonth);
  const previews = new Set(month.filter((e) => e.kind === "marketing.render_finished" && e.data.stage === "preview" && e.data.ok !== false && e.piece_id).map((e) => e.piece_id)).size;
  const sales = month.filter((e) => e.kind === "marketing.payment_received").length;
  const variableUsd = ttsUsd(voice) + (llm?.total_cost_usd ?? 0);
  const costPerPreview = previews === 0 ? null : variableUsd / previews;
  const previewsPerSale = sales === 0 || previews === 0 ? null : previews / sales;

  const slugs = [...new Set(scoped.map((e) => e.client).filter((c): c is string => Boolean(c)))].sort();
  const subs = new Map<string, StoredEvent>();
  for (const e of scoped.filter((x) => x.kind === "marketing.subscription_changed" && x.client)) subs.set(e.client as string, e);
  const perClient: ClientCost[] = slugs.map((client) => {
    const own = spends.filter((e) => e.client === client);
    const byPurpose: Record<string, number> = {};
    for (const e of own) byPurpose[String(e.data.purpose ?? "outros")] = round((byPurpose[String(e.data.purpose ?? "outros")] ?? 0) + (num(e.data.credits) ?? 0), 2);
    const creditsTotal = round(own.reduce((a, e) => a + (num(e.data.credits) ?? 0), 0), 2);
    const tts = ttsUsd(voice.filter((e) => e.client === client));
    const ttsBrl = tts === 0 ? 0 : ptax === null ? null : tts * ptax;
    const roBrl = creditsTotal === 0 ? 0 : creditBrl === null ? null : creditsTotal * creditBrl;
    const cost = ttsBrl === null || roBrl === null ? null : round(ttsBrl + roBrl, 2);
    const sub = subs.get(client);
    const active = sub && (sub.data.status === "active" || sub.data.status === "trialing");
    const mrr = active ? (num(sub.data.amount_brl) ?? (sub.data.currency === "BRL" ? num(sub.data.mrr) : null)) : null;
    return { client, credits: creditsTotal, credits_by_purpose: byPurpose, approved_by: [...new Set(own.map((e) => String(e.data.approved_by)))].sort(), tts_usd: round(tts, 4), cost_brl: cost, mrr_brl: mrr, margin_brl: cost === null || mrr === null ? null : round(mrr - cost, 2) };
  });

  return {
    generated_at: now.toISOString(),
    labels: ["Valores em reais são estimativas: dólar pela PTAX_USD_BRL do ambiente e crédito da Real Oficial por RO_CREDIT_BRL; sem esses valores o campo é \"sem dado\".", "Projeção do mês é linear sobre os dias decorridos."],
    realoficial: {
      balance,
      balance_source: ctx.ro ? "ro_whoami (somente leitura)" : "leitura da Real Oficial desligada",
      spent_month: round(spentMonth, 2),
      period: now.toISOString().slice(0, 7),
      projected_month: spends.length === 0 ? null : round((spentMonth / elapsedDays) * daysInMonth, 2),
      projection_estimate: true,
      by_purpose: purposes,
      purchases: null,
      purchases_note: "sem dado: o painel não inicia nem lista compras",
    },
    tts: {
      requests_today: num(lastUsage?.data.requests),
      limit: num(lastUsage?.data.limit),
      blocked_until: blockedUntil ?? null,
      seconds_month: voiceMonth.length === 0 ? null : round(voiceMonth.reduce((a, e) => a + (num(e.data.seconds) ?? 0), 0), 1),
      cost_usd_month: voiceMonth.length === 0 ? null : round(ttsUsd(voiceMonth), 4),
      cost_brl_month: voiceMonth.length === 0 || ptax === null ? null : round(ttsUsd(voiceMonth) * ptax, 2),
      fx: ptax === null ? null : { rate: ptax, label: "estimativa: PTAX_USD_BRL do ambiente" },
      cache_hit_rate: voice.length === 0 ? null : round((voice.filter((e) => e.data.cache_hit === true).length / voice.length) * 100, 1),
    },
    llm: llm ? { calls: llm.total_calls, cost_usd: round(llm.total_cost_usd, 4), by_provider: Object.fromEntries(Object.entries(llm.by_provider).map(([k, v]) => [k, { calls: v.calls, cost: round(v.cost, 4) }])) } : null,
    render: { machine_time_s: null, note: "sem dado: a fábrica de vídeo ainda não informa o tempo de máquina" },
    unit_economics: {
      previews,
      sales,
      cost_per_preview_usd: costPerPreview === null ? null : round(costPerPreview, 4),
      previews_per_sale: previewsPerSale === null ? null : round(previewsPerSale, 2),
      cost_per_sale_usd: costPerPreview === null || previewsPerSale === null ? null : round(costPerPreview * previewsPerSale, 4),
      estimate: true,
      per_client: perClient,
    },
  };
}

export const creditsRoute: ViewRoute = { path: "/api/credits", handle: credits };
