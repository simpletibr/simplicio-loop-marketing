/**
 * cockpit.ts — the entry screen: how is the whole operation today.
 *
 * Every KPI is a pure function of the events up to an instant, so "versus last
 * week" is the same computation run seven days earlier. A KPI with no source
 * is `null` ("sem dado"), never zero.
 */

import { DAY_MS, inWindow, round } from "./common";
import { STAGES, allPlans, buildPieceModels, type Stage } from "../model";
import { mediaCandidate, safeFile, allowedRoots } from "../media";
import { listClients } from "../queries";
import type { StoredEvent } from "../store";
import type { ViewContext, ViewRoute } from "../routes";

export interface Kpi {
  id: string;
  label: string;
  value: number | null;
  previous: number | null;
  delta: number | null;
  detail?: Record<string, unknown>;
}

function uniqueBy<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Map<string, T>();
  for (const i of items) seen.set(key(i), i);
  return [...seen.values()];
}

interface Computed {
  funnel: Record<Stage, number>;
  funnelTotal: number;
  scheduled30d: number;
  publishedToday: number;
  publishedWeek: number;
  failures7d: number;
  pendingClient: number;
  pendingOperator: number;
  mrr: number | null;
  salesMonth: number | null;
  salesCurrency: string | null;
  ttsUsed: number | null;
  ttsLimit: number | null;
  ttsBlockedUntil: string | null;
}

export function compute(allEvents: StoredEvent[], plans: ReturnType<typeof allPlans>, asOf: Date): Computed {
  const events = allEvents.filter((e) => Date.parse(e.ts) <= asOf.getTime());
  const t = asOf.getTime();
  const models = buildPieceModels(events, plans);
  const funnel = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<Stage, number>;
  for (const m of models.values()) if (m.current) funnel[m.current]++;

  const scheduled = uniqueBy(events.filter((e) => e.kind === "marketing.scheduled"), (e) => String(e.data.receipt_id ?? e.event_id));
  const scheduled30d = scheduled.filter((e) => {
    const at = Date.parse(String(e.data.publish_at ?? ""));
    return at > t && at <= t + 30 * DAY_MS;
  }).length;

  // "Published" is the first evidence that a post is live: a published event or its first metric.
  const firstLive = new Map<string, number>();
  for (const e of events) {
    if ((e.kind === "marketing.published" || e.kind === "marketing.metrics_snapshot") && e.piece_id) {
      const at = Date.parse(e.ts);
      firstLive.set(e.piece_id, Math.min(firstLive.get(e.piece_id) ?? Infinity, at));
    }
  }
  const startOfDay = new Date(asOf);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const live = [...firstLive.values()];

  const requests = events.filter((e) => e.kind === "marketing.approval_requested" && e.data.queue === "client");
  const decided = new Set(events.filter((e) => e.kind === "marketing.approval_decided").map((e) => `${e.piece_id}|${e.data.media_sha256}`));
  const pendingClient = uniqueBy(requests, (e) => String(e.data.request_id ?? e.event_id)).filter((e) => !decided.has(`${e.piece_id}|${e.data.media_sha256}`)).length;
  const operator = uniqueBy(events.filter((e) => e.kind === "marketing.approval_requested" && e.data.queue === "operator"), (e) => String(e.piece_id));
  const pendingOperator = operator.filter((e) => e.data.status === "pending").length;

  const latestSub = new Map<string, StoredEvent>();
  for (const e of events.filter((x) => x.kind === "marketing.subscription_changed")) latestSub.set(e.client ?? e.event_id, e);
  const active = [...latestSub.values()].filter((e) => e.data.status === "active" || e.data.status === "trialing");
  const mrrValues = active.map((e) => (typeof e.data.amount_brl === "number" ? e.data.amount_brl : typeof e.data.mrr === "number" ? e.data.mrr : null));
  const mrr = active.length === 0 ? null : mrrValues.every((v) => v !== null) ? round(mrrValues.reduce((a, b) => a + (b as number), 0)) : null;

  const monthStart = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), 1);
  const month = events.filter((e) => e.kind === "marketing.payment_received" && Date.parse(e.ts) >= monthStart);
  const currencies = new Set(month.map((e) => String(e.data.currency)));
  const sales = month.length === 0 ? null : round(month.reduce((a, e) => a + (typeof e.data.amount_brl === "number" ? e.data.amount_brl : Number(e.data.amount ?? 0)), 0));

  const tts = events.filter((e) => e.kind === "marketing.tts_quota" && asOf.getTime() - Date.parse(e.ts) < DAY_MS).at(-1);
  return {
    funnel,
    funnelTotal: models.size,
    scheduled30d,
    publishedToday: live.filter((at) => at >= startOfDay.getTime()).length,
    publishedWeek: live.filter((at) => at > t - 7 * DAY_MS).length,
    failures7d: events.filter((e) => e.kind === "marketing.publish_failed" && inWindow(e, t - 7 * DAY_MS, t)).length,
    pendingClient,
    pendingOperator,
    mrr,
    salesMonth: sales,
    salesCurrency: sales === null ? null : month.every((e) => typeof e.data.amount_brl === "number") ? "BRL" : currencies.size === 1 ? [...currencies][0] ?? null : "mixed",
    ttsUsed: typeof tts?.data.requests === "number" ? tts.data.requests : null,
    ttsLimit: typeof tts?.data.limit === "number" ? tts.data.limit : null,
    ttsBlockedUntil: typeof tts?.data.blocked_until === "string" ? tts.data.blocked_until : null,
  };
}

function kpi(id: string, label: string, now: number | null, before: number | null, detail?: Record<string, unknown>): Kpi {
  return { id, label, value: now, previous: before, delta: now !== null && before !== null ? round(now - before) : null, ...(detail ? { detail } : {}) };
}

const TEXT: Record<string, (e: StoredEvent) => string> = {
  "marketing.prospect_collected": (e) => `Prospect coletado${e.data.country ? ` (${String(e.data.country)})` : ""}`,
  "marketing.script_ready": () => "Roteiro pronto",
  "marketing.voice_rendered": (e) => `Voz gerada (${String(e.data.provider ?? "?")}, ${e.data.cache_hit === true ? "cache" : "nova"})`,
  "marketing.render_started": () => "Render iniciado",
  "marketing.render_finished": (e) => `Render ${String(e.data.stage ?? "final")} ${e.data.ok === false ? "falhou" : "pronto"}`,
  "marketing.qa_result": (e) => `QA técnico ${e.data.passed === true ? "aprovado" : "reprovado"}`,
  "marketing.compliance_result": (e) => `Compliance ${e.data.pass === true ? "aprovado" : "reprovado"}`,
  "marketing.watcher_gate": (e) => `Watcher: ${String(e.data.tag ?? (e.data.passed === true ? "ok" : "reprovado"))}`,
  "marketing.approval_requested": (e) => `Aprovação pedida (${e.data.queue === "operator" ? "operador" : "cliente"})`,
  "marketing.approval_decided": (e) => `Aprovação: ${e.data.decision === "approved" ? "aprovado" : "ajuste pedido"}`,
  "marketing.scheduled": (e) => `Agendado${e.network ? ` em ${e.network}` : ""}${e.data.publish_at ? ` para ${String(e.data.publish_at).replace("T", " ").slice(0, 16)} UTC` : ""}${e.data.dry_run === true ? " (simulação)" : ""}`,
  "marketing.published": () => "Publicado",
  "marketing.publish_failed": (e) => `Falha ao publicar (${String(e.data.failure_class ?? "?")})`,
  "marketing.metrics_snapshot": (e) => `Métrica ${String(e.data.metric)}: ${String(e.data.value)}`,
  "marketing.winner_marked": () => "Vencedor marcado",
  "marketing.credit_spent": (e) => `Crédito gasto: ${String(e.data.credits)} (${String(e.data.purpose)}, aprovado por ${String(e.data.approved_by)})`,
  "marketing.tts_quota": (e) => (e.data.exhausted === true ? "Cota do TTS esgotada" : "Cota do TTS atualizada"),
  "marketing.payment_received": (e) => `Pagamento recebido (${String(e.data.processor)})`,
  "marketing.subscription_changed": (e) => `Assinatura: ${String(e.data.status)}`,
};

export function describe(e: StoredEvent): string {
  return (TEXT[e.kind] ?? (() => e.kind))(e);
}

export async function cockpit(ctx: ViewContext) {
  const { root, store, now } = ctx;
  const plans = allPlans(root);
  const events = store.all();
  const cur = compute(events, plans, now);
  const prev = compute(events, plans, new Date(now.getTime() - 7 * DAY_MS));
  const roBalance = ctx.ro ? await ctx.ro.get("ro_whoami").then((r) => r.data, () => null) : null;
  const kpis: Kpi[] = [
    kpi("pieces_in_funnel", "Peças no funil", cur.funnelTotal, prev.funnelTotal, { by_stage: cur.funnel }),
    kpi("scheduled_30d", "Agendadas nos próximos 30 dias", cur.scheduled30d, prev.scheduled30d),
    kpi("published_today", "Publicadas hoje", cur.publishedToday, prev.publishedToday),
    kpi("published_week", "Publicadas na semana", cur.publishedWeek, prev.publishedWeek),
    kpi("publish_failures", "Falhas de publicação (7 dias)", cur.failures7d, prev.failures7d),
    kpi("approvals_client", "Aprovações pendentes (cliente)", cur.pendingClient, prev.pendingClient),
    kpi("approvals_operator", "Aprovações pendentes (operador/créditos)", cur.pendingOperator, prev.pendingOperator),
    kpi("credits_ro", "Créditos Real Oficial", roBalance && typeof (roBalance as { credits?: unknown }).credits === "number" ? (roBalance as { credits: number }).credits : null, null, { source: ctx.ro ? "ro_whoami (somente leitura)" : "leitura da Real Oficial desligada" }),
    kpi("tts_quota", "Cota Gemini TTS do dia", cur.ttsUsed, prev.ttsUsed, { limit: cur.ttsLimit, blocked_until: cur.ttsBlockedUntil }),
    kpi("mrr", "MRR", cur.mrr, prev.mrr, { currency: "BRL" }),
    kpi("sales_month", "Vendas do mês", cur.salesMonth, prev.salesMonth, { currency: cur.salesCurrency }),
  ];

  // "River": how many pieces reached each stage, and how long the hop took on average.
  const models = [...buildPieceModels(events.filter((e) => Date.parse(e.ts) <= now.getTime()), plans).values()];
  const reached = STAGES.map((_stage, i) => models.filter((m) => m.current !== null && STAGES.indexOf(m.current) >= i).length);
  const river = {
    nodes: STAGES.map((stage, i) => ({ stage, reached: reached[i] ?? 0 })),
    links: STAGES.slice(0, -1).map((from, i) => {
      const to = STAGES[i + 1] as Stage;
      const hops = models.filter((m) => m.stages[from].at && m.stages[to].at).map((m) => (Date.parse(m.stages[to].at as string) - Date.parse(m.stages[from].at as string)) / 3_600_000);
      const value = reached[i + 1] ?? 0;
      return { from, to, value, dropped: Math.max((reached[i] ?? 0) - value, 0), avg_hours: hops.length ? round(hops.reduce((a, b) => a + b, 0) / hops.length) : null };
    }),
  };

  const allowed = allowedRoots(root, ctx.sources.videosDir);
  const feed = events.slice(-30).reverse().map((e) => ({
    seq: e.seq,
    ts: e.ts,
    kind: e.kind,
    severity: e.severity,
    client: e.client ?? null,
    piece_id: e.piece_id ?? null,
    text: describe(e),
    thumbnail: e.piece_id ? Boolean((() => { const c = mediaCandidate(root, ctx.sources.videosDir, e.piece_id as string, "preview"); return c && safeFile(c, allowed); })()) : false,
  }));

  const alerts = ctx.alerts();
  const monthKey = now.toISOString().slice(0, 7);
  const clients = listClients(root, store, now).map((c) => {
    const mine = alerts.filter((a) => a.client === c.slug);
    const slots = plans.filter((p) => p.client === c.slug).flatMap((p) => p.slots).filter((s) => s.local_time.startsWith(monthKey));
    const scheduled = new Set(events.filter((e) => e.client === c.slug && e.kind === "marketing.scheduled").map((e) => e.piece_id));
    const views = events.filter((e) => e.client === c.slug && e.kind === "marketing.metrics_snapshot" && e.data.metric === "views");
    const latestViews = new Map<string, number>();
    for (const v of views) latestViews.set(`${v.piece_id}`, Number(v.data.value));
    return {
      slug: c.slug,
      name: c.name ?? null,
      country: c.country ?? null,
      health: mine.some((a) => a.severity === "error") ? "critical" : mine.length > 0 ? "attention" : "ok",
      alerts: mine.length,
      next_publication: c.next_publication ?? null,
      month_filled_pct: slots.length === 0 ? null : round((slots.filter((s) => scheduled.has(s.piece_id)).length / slots.length) * 100, 0),
      views_total: latestViews.size === 0 ? null : [...latestViews.values()].reduce((a, b) => a + b, 0),
    };
  });

  const byCountry = new Map<string, { clients: string[]; languages: Set<string>; dubbed: number }>();
  for (const c of clients) {
    if (!c.country) continue;
    const entry = byCountry.get(c.country) ?? { clients: [], languages: new Set<string>(), dubbed: 0 };
    entry.clients.push(c.slug);
    for (const p of plans.filter((pl) => pl.client === c.slug)) for (const s of p.slots) if (s.language) entry.languages.add(s.language);
    entry.dubbed += events.filter((e) => e.client === c.slug && e.kind === "marketing.dubbing_finished").length;
    byCountry.set(c.country, entry);
  }
  const world = [...byCountry.entries()].sort().map(([country, v]) => ({ country, clients: v.clients, languages: [...v.languages].sort(), dubbed_versions: v.dubbed }));
  return { generated_at: now.toISOString(), kpis, river, feed, clients, world };
}

export const cockpitRoute: ViewRoute = { path: "/api/cockpit", handle: cockpit };
