/**
 * status.ts — is each network of each client publishing, and is the bridge to
 * Real Oficial healthy. Derived from the publish receipts (the ledger of what
 * the publishers actually did) and, when the operator enabled the read-only
 * Real Oficial window, from the connected accounts. Nothing here logs in,
 * publishes or retries: a failure is shown with its reason and the human next
 * step. Credentials, cookies and tokens are never read, and free text from
 * receipts is redacted before it leaves the server.
 */

import { redact } from "../../automation/browser-lane";
import { NETWORKS, listReceipts, type Network, type ScheduleReceipt } from "../../publish/publisher";
import { listClients } from "../queries";
import { DAY_MS, round } from "./common";
import { scrubPii } from "../events";
import type { ViewContext, ViewRoute } from "../routes";

export interface FailureInfo {
  reason: string;
  next_step: string;
}

/** Why a post did not go out and what a human has to do about it. */
export const FAILURES: Record<string, FailureInfo> = {
  login_required: { reason: "A sessão da Real Oficial no navegador do box expirou ou foi deslogada.", next_step: "Wesley precisa logar na Real Oficial no navegador do box e rodar o agendamento de novo." },
  captcha: { reason: "A rede pediu uma verificação (captcha).", next_step: "Wesley precisa resolver o captcha no navegador do box." },
  two_factor: { reason: "A rede pediu um código de verificação em duas etapas.", next_step: "Wesley precisa informar o código de verificação no navegador do box." },
  layout_changed: { reason: "A tela da Real Oficial mudou e o publicador não reconheceu o formulário.", next_step: "Abrir uma issue com o screenshot da evidência; nada foi publicado." },
  platform_rejection: { reason: "A rede rejeitou o post.", next_step: "Revisar legenda e mídia e reagendar." },
  policy_block: { reason: "A rede bloqueou o post por política.", next_step: "Revisar o conteúdo contra as regras da rede antes de tentar de novo." },
  claims_gate_blocked: { reason: "A verificação de afirmações (watcher) bloqueou a peça.", next_step: "Corrigir ou comprovar as afirmações da peça e rodar o watcher de novo." },
  approval_missing: { reason: "A peça não tem aprovação do cliente.", next_step: "Enviar o link de aprovação ao cliente." },
  approval_hash_mismatch: { reason: "A mídia mudou depois de aprovada.", next_step: "Pedir uma nova aprovação do arquivo atual." },
  approval_not_approved: { reason: "O cliente pediu ajustes na peça.", next_step: "Aplicar os ajustes e pedir nova aprovação." },
  outside_window: { reason: "A data está fora da janela de 30 dias.", next_step: "Aguardar o próximo ciclo ou escolher uma data dentro da janela." },
  action_gate_blocked: { reason: "Falta aprovação humana para agir ao vivo.", next_step: "Registrar a aprovação humana antes de publicar." },
  driver_unavailable: { reason: "O navegador do box não está disponível.", next_step: "Abrir o navegador do box e conferir a sessão da Real Oficial." },
  unsupported_network: { reason: "O publicador não atende essa rede.", next_step: "Escolher outro publicador para essa rede." },
  invalid_request: { reason: "Faltam legenda, mídia ou data válidas.", next_step: "Completar a peça e agendar de novo." },
  not_found: { reason: "O agendamento não foi encontrado.", next_step: "Conferir o recibo e agendar de novo." },
};

const SECRET = /\b(cookie|set-cookie|authorization|password|passwd|senha|token|secret|api[_-]?key|session(?:[_-]?id)?|sid|jwt|bearer)\b\s*[:=]\s*[^\s,;]+(?:;\s*[^\s,;]+=[^\s,;]+)*/gi;

/** Free text from a receipt: browser-lane redaction plus anything that looks like a credential. */
export function sanitize(text: string | undefined): string | undefined {
  return text === undefined ? undefined : scrubPii(redact(text).replace(SECRET, "$1=[redacted]")).slice(0, 300);
}

/** Plan limits of Real Oficial by platform; the warning starts at 80%. Assumed from the plan description in issue #178. */
export const PLAN_LIMITS: Record<string, Record<string, number>> = { lite: { instagram: 5, tiktok: 5, youtube: 1 } };
export const CAPACITY_WARN_AT = 0.8;
const SESSION_MAX_AGE_DAYS = 7;
const WINDOW_DAYS = 7;

export interface ReceiptRow {
  receipt_id: string;
  ts: string;
  client: string;
  piece_id: string;
  network: Network;
  publisher: string;
  verdict: ScheduleReceipt["verdict"];
  dry_run: boolean;
  publish_at: string;
  failure_class?: string;
  reason?: string;
  next_step?: string;
  post_ref?: string;
  has_evidence: boolean;
  stages: Array<{ stage: string; ok: boolean; detail?: string }>;
}

export function receiptRow(r: ScheduleReceipt): ReceiptRow {
  const info = r.failure_class ? FAILURES[r.failure_class] : undefined;
  return {
    receipt_id: r.receipt_id,
    ts: r.ts,
    client: r.client,
    piece_id: r.piece_id,
    network: r.network,
    publisher: r.publisher,
    verdict: r.verdict,
    dry_run: r.dry_run,
    publish_at: r.publish_at,
    ...(r.failure_class ? { failure_class: r.failure_class, reason: info?.reason ?? "Falha não classificada.", next_step: info?.next_step ?? "Abrir o recibo e investigar." } : {}),
    ...(r.post_ref ? { post_ref: r.post_ref } : {}),
    has_evidence: Boolean(r.evidence?.screenshot),
    stages: r.stages.map((s) => ({ stage: s.stage, ok: s.ok, ...(s.detail ? { detail: sanitize(s.detail) } : {}) })),
  };
}

const BAD = (r: ScheduleReceipt): boolean => r.verdict === "failed" || r.verdict === "blocked";

export interface Cell {
  client: string;
  network: Network;
  connection: "connected" | "disconnected" | "unknown";
  last_post: string | null;
  next_post: string | null;
  success_rate_7d: number | null;
  attempts_7d: number;
  /** Dry-run receipts: a rehearsal says nothing about whether the network accepted a post, so they are counted apart. */
  simulated: number;
  failures: Record<string, number>;
  last_failure: ReceiptRow | null;
}

function cellOf(client: string, network: Network, receipts: ScheduleReceipt[], now: number): Cell {
  const all = receipts.filter((r) => r.client === client && r.network === network);
  const mine = all.filter((r) => !r.dry_run).sort((a, b) => a.ts.localeCompare(b.ts));
  const recent = mine.filter((r) => now - Date.parse(r.ts) <= WINDOW_DAYS * DAY_MS);
  const ok = recent.filter((r) => r.verdict === "scheduled").length;
  const failures: Record<string, number> = {};
  for (const r of recent.filter(BAD)) failures[r.failure_class ?? "unknown"] = (failures[r.failure_class ?? "unknown"] ?? 0) + 1;
  const live = mine.filter((r) => r.verdict === "scheduled");
  const latest = mine.at(-1);
  const sessionLost = latest !== undefined && BAD(latest) && ["login_required", "two_factor", "captcha"].includes(latest.failure_class ?? "");
  const past = live.map((r) => r.publish_at).filter((t) => Date.parse(t) <= now).sort();
  const future = live.map((r) => r.publish_at).filter((t) => Date.parse(t) > now).sort();
  const failed = mine.filter(BAD).at(-1);
  return {
    client,
    network,
    connection: sessionLost ? "disconnected" : live.length > 0 ? "connected" : "unknown",
    last_post: past.at(-1) ?? null,
    next_post: future[0] ?? null,
    success_rate_7d: recent.length === 0 ? null : round((ok / recent.length) * 100, 1),
    attempts_7d: recent.length,
    simulated: all.length - mine.length,
    failures,
    last_failure: failed ? receiptRow(failed) : null,
  };
}

export interface PublisherHealth {
  publisher: string;
  session: "active" | "expired" | "login_required" | "challenge" | "unknown";
  last_success: string | null;
  failures_30d: Record<string, number>;
  last_failure: ReceiptRow | null;
  /** The receipt whose confirmation or failure screenshot is the latest evidence. */
  evidence_receipt: string | null;
  next_step: string | null;
}

export function healthOf(receipts: ScheduleReceipt[], now: number): PublisherHealth {
  const mine = receipts.filter((r) => r.publisher === "realoficial-browser").sort((a, b) => a.ts.localeCompare(b.ts));
  const latest = mine.at(-1);
  const success = mine.filter((r) => r.verdict === "scheduled" || r.verdict === "cancelled").at(-1);
  const failures: Record<string, number> = {};
  for (const r of mine.filter((x) => BAD(x) && now - Date.parse(x.ts) <= 30 * DAY_MS)) failures[r.failure_class ?? "unknown"] = (failures[r.failure_class ?? "unknown"] ?? 0) + 1;
  const lastFailure = mine.filter(BAD).at(-1);
  let session: PublisherHealth["session"] = "unknown";
  if (latest) {
    if (BAD(latest) && latest.failure_class === "login_required") session = "login_required";
    else if (BAD(latest) && (latest.failure_class === "captcha" || latest.failure_class === "two_factor")) session = "challenge";
    else if (success && now - Date.parse(success.ts) > SESSION_MAX_AGE_DAYS * DAY_MS) session = "expired";
    else if (success) session = "active";
  }
  const withEvidence = mine.filter((r) => r.evidence?.screenshot).at(-1);
  const blocking = session === "login_required" || session === "challenge" ? lastFailure : undefined;
  return {
    publisher: "realoficial-browser",
    session,
    last_success: success?.ts ?? null,
    failures_30d: failures,
    last_failure: lastFailure ? receiptRow(lastFailure) : null,
    evidence_receipt: withEvidence?.receipt_id ?? null,
    next_step: blocking ? (FAILURES[blocking.failure_class ?? ""]?.next_step ?? null) : session === "expired" ? "A sessão pode ter expirado: Wesley deve abrir a Real Oficial no navegador do box e conferir o login." : null,
  };
}

export interface Capacity {
  platform: string;
  used: number;
  limit: number;
  pct: number;
  warning: boolean;
}

/** Connected accounts against the plan limit; null when the read-only window is off or answers nothing usable. */
export async function capacityOf(ctx: ViewContext): Promise<{ plan: string; platforms: Capacity[]; fetched_at: string } | null> {
  if (!ctx.ro) return null;
  const { data, fetched_at } = await ctx.ro.get("ro_list_social_accounts");
  const accounts = (data as { accounts?: unknown })?.accounts;
  if (!Array.isArray(accounts)) return null;
  const used: Record<string, number> = {};
  for (const a of accounts) {
    const platform = (a as { platform?: unknown })?.platform;
    if (typeof platform === "string") used[platform] = (used[platform] ?? 0) + 1;
  }
  const limits = PLAN_LIMITS.lite as Record<string, number>;
  return {
    plan: "lite",
    fetched_at,
    platforms: Object.entries(limits).map(([platform, limit]) => ({ platform, used: used[platform] ?? 0, limit, pct: round(((used[platform] ?? 0) / limit) * 100, 0), warning: (used[platform] ?? 0) / limit >= CAPACITY_WARN_AT })),
  };
}

export async function status(ctx: ViewContext) {
  const now = ctx.now.getTime();
  const receipts = listReceipts(ctx.root);
  const clients = listClients(ctx.root, ctx.store, ctx.now).map((c) => c.slug);
  const only = ctx.query.get("client");
  const shown = clients.filter((c) => !only || c === only);
  return {
    generated_at: ctx.now.toISOString(),
    matrix: shown.flatMap((client) => NETWORKS.map((network) => cellOf(client, network, receipts, now))),
    publisher: healthOf(receipts, now),
    capacity: await capacityOf(ctx),
    receipts: receipts
      .filter((r) => (!only || r.client === only) && (!ctx.query.get("network") || r.network === ctx.query.get("network")))
      .sort((a, b) => b.ts.localeCompare(a.ts))
      .slice(0, 200)
      .map(receiptRow),
  };
}

export const statusRoute: ViewRoute = { path: "/api/status", handle: status };

/** One receipt in full (stages and evidence flag), or null. */
export function receiptDetail(ctx: Pick<ViewContext, "root">, id: string): ReceiptRow | null {
  const r = listReceipts(ctx.root).find((x) => x.receipt_id === id);
  return r ? receiptRow(r) : null;
}
