/**
 * alerts.ts — what threatens a post or a sale, as a pure function of the
 * event stream, the receipts and the plans at an instant.
 *
 * Stateless on purpose: an alert exists exactly while its condition holds, so
 * it clears by itself when the cause is fixed, and its `key` (rule + subject)
 * makes duplicates impossible. `since` is the instant the condition began, not
 * the instant it was noticed. Nothing here sends anything: the panel shows the
 * alerts, and the only outbound path is the optional webhook of the server,
 * off unless the operator sets it.
 */

import { listReceipts, type ScheduleReceipt } from "../publish/publisher";
import type { ContentPlan } from "../plan/content-plan";
import { allPlans, buildPieceModels } from "./model";
import type { DashboardAlert } from "./routes";
import type { StoredEvent } from "./store";
import { FAILURES, healthOf, type Capacity } from "./views/status";
import { pendingClientApprovals } from "./views/approvals";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export interface AlertThresholds {
  /** A scheduled post not published this long after its time. */
  publishGraceMin: number;
  /** A piece with no news this long, before it reaches scheduling. */
  stuckHours: number;
  /** The same gate failing this many times on one piece. */
  gateFailures: number;
  /** A client with fewer posts scheduled in the next 30 days. */
  minScheduled30d: number;
  /** Real Oficial balance below this. */
  minCredits: number;
  /** A payment with no delivery started after this long. */
  paymentGraceHours: number;
}

export const DEFAULT_THRESHOLDS: AlertThresholds = { publishGraceMin: 15, stuckHours: 48, gateFailures: 3, minScheduled30d: 8, minCredits: 50, paymentGraceHours: 1 };

function envNumber(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return process.env[name] && Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Thresholds with the operator's overrides from the environment. */
export function thresholdsFromEnv(): AlertThresholds {
  return {
    ...DEFAULT_THRESHOLDS,
    stuckHours: envNumber("MARKETING_ALERT_STUCK_HOURS", DEFAULT_THRESHOLDS.stuckHours),
    minScheduled30d: envNumber("MARKETING_ALERT_MIN_SCHEDULED", DEFAULT_THRESHOLDS.minScheduled30d),
    minCredits: envNumber("MARKETING_ALERT_MIN_CREDITS", DEFAULT_THRESHOLDS.minCredits),
  };
}

export interface RoSnapshot {
  balance: number | null;
  capacity: Capacity[] | null;
  fetched_at: string;
}

export interface AlertInput {
  root: string;
  events: StoredEvent[];
  plans: ContentPlan[];
  receipts: ScheduleReceipt[];
  now: Date;
  thresholds?: AlertThresholds;
  /** Real Oficial read-only facts; the rules that need them stay silent without. */
  ro?: RoSnapshot;
}

const SEVERITY_RANK = { error: 0, warn: 1, info: 2 } as const;
const HARD_FAILURES = new Set(["login_required", "captcha", "two_factor", "layout_changed"]);
const PRODUCTION = new Set(["marketing.script_ready", "marketing.voice_rendered", "marketing.render_started", "marketing.render_finished", "marketing.scheduled", "marketing.published"]);

export function evaluateAlerts(input: AlertInput): DashboardAlert[] {
  const { events, plans, receipts, now } = input;
  const t = now.getTime();
  const th = input.thresholds ?? DEFAULT_THRESHOLDS;
  const out = new Map<string, DashboardAlert>();
  const add = (a: DashboardAlert): void => void out.set(a.key, a);
  const live = receipts.filter((r) => !r.dry_run);

  // A scheduled post that never went out (the latest receipt of a cancelled post is "cancelled", so it never gets here).
  const signals = new Set(events.filter((e) => (e.kind === "marketing.published" || e.kind === "marketing.metrics_snapshot") && e.piece_id).map((e) => `${e.piece_id}|${e.network ?? ""}`));
  for (const r of live.filter((x) => x.verdict === "scheduled")) {
    if (Date.parse(r.publish_at) + th.publishGraceMin * 60_000 >= t || signals.has(`${r.piece_id}|`) || signals.has(`${r.piece_id}|${r.network}`)) continue;
    add({ key: `post_not_published:${r.piece_id}:${r.network}`, rule: "post_not_published", severity: "error", client: r.client, piece_id: r.piece_id, message: `O post de ${r.piece_id} em ${r.network} era para ${r.publish_at.slice(0, 16).replace("T", " ")} UTC e não foi publicado.`, next_step: "Conferir a Real Oficial e a rede; reagendar se preciso.", since: r.publish_at });
  }

  // Publishing failures, by type; a later scheduling of the same piece and network clears it.
  const rescheduled = (x: ScheduleReceipt): boolean => live.some((y) => y.verdict === "scheduled" && y.piece_id === x.piece_id && y.network === x.network && y.ts > x.ts);
  for (const r of live.filter((x) => (x.verdict === "failed" || x.verdict === "blocked") && t - Date.parse(x.ts) <= 7 * DAY_MS && !rescheduled(x))) {
    const info = r.failure_class ? FAILURES[r.failure_class] : undefined;
    add({ key: `publish_failed:${r.failure_class ?? "unknown"}:${r.piece_id}:${r.network}`, rule: "publish_failed", severity: HARD_FAILURES.has(r.failure_class ?? "") ? "error" : "warn", client: r.client, piece_id: r.piece_id, message: `${r.piece_id} em ${r.network}: ${info?.reason ?? "falha não classificada"}`, next_step: info?.next_step ?? "Abrir o recibo e investigar.", since: r.ts });
  }

  // The Real Oficial browser session.
  const health = healthOf(receipts, t);
  if (health.session === "login_required" || health.session === "challenge" || health.session === "expired") {
    add({ key: "ro_session", rule: "ro_session_expired", severity: health.session === "expired" ? "warn" : "error", message: health.session === "challenge" ? "A Real Oficial pediu uma verificação no navegador do box." : health.session === "expired" ? "A sessão da Real Oficial no navegador do box pode ter expirado." : "A sessão da Real Oficial no navegador do box pediu login.", next_step: health.next_step ?? undefined, since: health.last_failure?.ts ?? health.last_success ?? now.toISOString() });
  }

  // Credits, accounts and voice quota.
  if (input.ro) {
    if (input.ro.balance !== null && input.ro.balance < th.minCredits) {
      add({ key: "balance_low", rule: "balance_low", severity: "warn", message: `Saldo de créditos da Real Oficial em ${input.ro.balance}, abaixo de ${th.minCredits}.`, next_step: "Wesley decide se compra créditos; o painel não compra.", since: input.ro.fetched_at });
    }
    for (const c of input.ro.capacity ?? []) {
      if (c.warning) add({ key: `accounts_near_limit:${c.platform}`, rule: "accounts_near_limit", severity: c.used >= c.limit ? "error" : "warn", message: `${c.used} de ${c.limit} contas de ${c.platform} no plano.`, next_step: "Avaliar o plano antes de conectar mais contas.", since: input.ro.fetched_at });
    }
  }
  const quota = events.filter((e) => e.kind === "marketing.tts_quota" && t - Date.parse(e.ts) < DAY_MS);
  const exhausted = quota.filter((e) => e.data.exhausted === true && typeof e.data.blocked_until === "string").at(-1);
  if (exhausted && Date.parse(exhausted.data.blocked_until as string) > t) {
    add({ key: "tts_exhausted", rule: "tts_exhausted", severity: "warn", message: `A cota de voz do dia acabou; volta às ${(exhausted.data.blocked_until as string).slice(11, 16)} UTC.`, next_step: "Os vídeos que precisam de voz nova esperam; os derivados com voz em cache seguem.", since: exhausted.ts });
  }

  // Client approvals about to cost a date.
  for (const a of pendingClientApprovals(input.root, events, plans, receipts, now)) {
    if (a.sla !== "red" && a.sla !== "yellow") continue;
    add({ key: `approval_due:${a.piece_id}`, rule: "approval_due", severity: a.sla === "red" ? "error" : "warn", client: a.client, piece_id: a.piece_id, message: a.hours_to_post !== null && a.hours_to_post < 0 ? `${a.piece_id} sem aprovação e a data do post já passou.` : `${a.piece_id} sem aprovação a ${Math.max(a.hours_to_post ?? 0, 0)} h do post.`, next_step: "Cobrar o cliente pelo link de aprovação.", since: a.requested_at });
  }

  // Pieces that stopped moving, and gates that keep failing.
  const byPiece = new Map<string, StoredEvent[]>();
  for (const e of events) if (e.piece_id) byPiece.set(e.piece_id, [...(byPiece.get(e.piece_id) ?? []), e]);
  for (const m of buildPieceModels(events, plans).values()) {
    if (!m.current || !m.last_event_at) continue;
    const waiting = m.current === "scheduled" || m.current === "published" || m.current === "metrics" || (m.current === "approval" && m.current_state === "active");
    if (!waiting && t - Date.parse(m.last_event_at) > th.stuckHours * HOUR_MS) {
      add({ key: `piece_stuck:${m.piece_id}`, rule: "piece_stuck", severity: "warn", ...(m.client ? { client: m.client } : {}), piece_id: m.piece_id, message: `${m.piece_id} parada em ${m.current} há mais de ${th.stuckHours} h.`, next_step: "Abrir a peça no pipeline e ver o que falta.", since: m.last_event_at });
    }
  }
  for (const [piece, evs] of byPiece) {
    for (const [gate, kind, ok] of [["qa", "marketing.qa_result", "passed"], ["compliance", "marketing.compliance_result", "pass"]] as const) {
      // Repeated means in a row: a pass after the failures clears the alert.
      const results = evs.filter((e) => e.kind === kind).sort((a, b) => a.ts.localeCompare(b.ts));
      let run = 0;
      while (run < results.length && results[results.length - 1 - run]?.data[ok] !== true) run++;
      if (run >= th.gateFailures) add({ key: `gate_failing:${gate}:${piece}`, rule: "gate_failing", severity: "warn", ...(results[0]?.client ? { client: results[0].client } : {}), piece_id: piece, message: `${piece} reprovou ${run} vezes seguidas no gate de ${gate === "qa" ? "QA técnico" : "compliance"}.`, next_step: "Revisar o roteiro ou o contrato da peça em vez de rodar de novo.", since: results[results.length - run]?.ts ?? now.toISOString() });
    }
  }

  // Clients whose month is thin.
  for (const client of new Set(plans.map((p) => p.client))) {
    const scheduled = receipts.filter((r) => r.client === client && r.verdict === "scheduled" && Date.parse(r.publish_at) > t && Date.parse(r.publish_at) <= t + 30 * DAY_MS).length;
    if (scheduled < th.minScheduled30d) {
      const latest = plans.filter((p) => p.client === client).sort((a, b) => a.generated_at.localeCompare(b.generated_at)).at(-1);
      add({ key: `month_underfilled:${client}`, rule: "month_underfilled", severity: "warn", client, message: `${client}: só ${scheduled} post(s) agendado(s) nos próximos 30 dias (mínimo ${th.minScheduled30d}).`, next_step: "Renderizar, aprovar e agendar o restante do mês.", since: latest?.generated_at ?? now.toISOString() });
    }
  }

  // A payment with no delivery started.
  for (const pay of events.filter((e) => e.kind === "marketing.payment_received" && e.client)) {
    if (t - Date.parse(pay.ts) < th.paymentGraceHours * HOUR_MS) continue;
    const started = events.some((e) => e.client === pay.client && PRODUCTION.has(e.kind) && Date.parse(e.ts) > Date.parse(pay.ts));
    if (!started) add({ key: `payment_without_delivery:${pay.client}:${pay.event_id}`, rule: "payment_without_delivery", severity: "warn", client: pay.client, message: `${pay.client} pagou e a entrega ainda não começou.`, next_step: "Iniciar a produção das peças do cliente.", since: pay.ts });
  }

  return [...out.values()].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.since.localeCompare(a.since) || a.key.localeCompare(b.key));
}

/** Alerts from what is on disk and in the store right now (the rules that need no Real Oficial call). */
export function currentAlerts(root: string, events: StoredEvent[], now: Date, ro?: RoSnapshot): DashboardAlert[] {
  return evaluateAlerts({ root, events: events.filter((e) => Date.parse(e.ts) <= now.getTime()), plans: allPlans(root), receipts: listReceipts(root), now, thresholds: thresholdsFromEnv(), ro });
}
