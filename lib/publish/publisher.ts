/**
 * publisher.ts — the scheduling seam between the content plan and a network.
 *
 * `Publisher` is the interface; implementations are `dry-run` (default),
 * `realoficial-browser` (interim, lib/publish/realoficial-browser.ts) and a
 * reserved `realoficial-api`. `scheduleVerified` is the only entry point the
 * rest of the engine should use: it applies the gates (claims tag, 30 day
 * window, client approval bound to the media hash, action-gate when live),
 * is idempotent per piece + network + day, and records every outcome in an
 * append-only ledger as a `marketing-publish-receipt/v1`.
 *
 * `AdaptlyPostClient` (lib/publish/adaptlypost.ts) is deprecated in favour of
 * this seam but is kept until its callers migrate.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { engineRoot } from "../clients/paths";
import { appendHbp, readHbp } from "../formats/binary";
import { enforceClaimsGate } from "../gate/claims-gate";
import { readWatcherReport, type ClaimsTag } from "../gate/watcher-gate";
import { checkActionGate } from "../gate/action-gate";
import { choosePublisher } from "../integrations/broker";
import { emitEvent } from "../observability/events";
import { loadSchemaRegistry } from "../contracts/registry";
import { validateArtifact } from "../contracts/validate";

export type Network = "tiktok" | "ig_reels" | "yt_shorts";
export const NETWORKS: readonly Network[] = ["tiktok", "ig_reels", "yt_shorts"];
/** Channel ids of lib/channels/registry.ts for each supported network. */
export const NETWORK_CHANNEL: Record<Network, string> = { tiktok: "tiktok", ig_reels: "instagram", yt_shorts: "youtube" };
export const MAX_SCHEDULE_DAYS = 30;
export const RECEIPT_SCHEMA = "marketing-publish-receipt/v1";

export type ScheduleFailure =
  | "login_required"
  | "captcha"
  | "two_factor"
  | "platform_rejection"
  | "policy_block"
  | "layout_changed"
  | "claims_gate_blocked"
  | "approval_missing"
  | "approval_hash_mismatch"
  | "approval_not_approved"
  | "outside_window"
  | "action_gate_blocked"
  | "driver_unavailable"
  | "unsupported_network"
  | "invalid_request"
  | "not_found";

export interface ScheduleRequest {
  clientSlug: string;
  pieceId: string;
  campaignId?: string;
  mediaPath: string;
  mediaSha256: string;
  caption: string;
  network: Network;
  /** ISO timestamp of the post. */
  publishAt: string;
  approvalRef: string;
}

export interface ScheduleReceipt {
  schema: typeof RECEIPT_SCHEMA;
  ts: string;
  piece_id: string;
  client: string;
  provider: string;
  publisher: string;
  dry_run: boolean;
  verdict: "scheduled" | "blocked" | "failed" | "cancelled";
  claims_tag: ClaimsTag;
  attempts: number;
  stages: Array<{ stage: string; ok: boolean; detail?: string }>;
  failure_class?: ScheduleFailure;
  post_ref?: string;
  network: Network;
  publish_at: string;
  approval_ref: string;
  media_sha256: string;
  receipt_id: string;
  schedule_key: string;
  evidence?: { screenshot?: string; dom_snapshot?: string };
}

export interface PublisherCapabilities {
  networks: Network[];
  maxScheduleDays: number;
}

/** What an implementation returns for the effect only; gates and the ledger live in scheduleVerified. */
export interface EffectOutcome {
  ok: boolean;
  failure?: ScheduleFailure;
  detail?: string;
  post_ref?: string;
  evidence?: ScheduleReceipt["evidence"];
}

export interface Publisher {
  readonly id: string;
  capabilities(): PublisherCapabilities;
  /** Performs the scheduling effect. Never called without the gates having passed. */
  schedule(req: ScheduleRequest): Promise<EffectOutcome>;
  /** Last known state of a receipt (implementations may refresh it remotely). */
  status(root: string, receiptId: string): Promise<ScheduleReceipt | null>;
  cancel(root: string, receiptId: string): Promise<EffectOutcome>;
}

function isDryRun(): boolean {
  const v = process.env.DRY_RUN;
  return v === undefined || v === "" || v === "true";
}

export function scheduleKey(req: Pick<ScheduleRequest, "pieceId" | "network" | "publishAt">): string {
  return `${req.pieceId}:${req.network}:${req.publishAt.slice(0, 10)}`;
}

export function receiptIdOf(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 20);
}

// --- ledger -----------------------------------------------------------------

export function ledgerPath(root: string): string {
  return resolve(engineRoot(root), "data", "schedule.hbp");
}

export function appendReceipt(root: string, receipt: ScheduleReceipt): void {
  const valid = validateArtifact(receipt, loadSchemaRegistry());
  if (!valid.ok) throw new Error(`publisher: invalid receipt: ${valid.errors.join("; ")}`);
  appendHbp(ledgerPath(root), receipt);
}

/** Current state of every receipt: the last record per receipt id wins. */
export function listReceipts(root: string, filter: { client?: string; network?: Network } = {}): ScheduleReceipt[] {
  const latest = new Map<string, ScheduleReceipt>();
  for (const r of readHbp<ScheduleReceipt>(ledgerPath(root))) latest.set(r.receipt_id, r);
  return [...latest.values()].filter((r) => (!filter.client || r.client === filter.client) && (!filter.network || r.network === filter.network));
}

export function findReceipt(root: string, receiptId: string): ScheduleReceipt | null {
  return listReceipts(root).find((r) => r.receipt_id === receiptId) ?? null;
}

// --- dry-run implementation -------------------------------------------------

export class DryRunPublisher implements Publisher {
  readonly id = "dry-run";
  capabilities(): PublisherCapabilities {
    return { networks: [...NETWORKS], maxScheduleDays: MAX_SCHEDULE_DAYS };
  }
  async schedule(req: ScheduleRequest): Promise<EffectOutcome> {
    return { ok: true, post_ref: `dry-run://${req.network}/${receiptIdOf(scheduleKey(req))}`, detail: "dry-run: nothing was sent" };
  }
  async status(root: string, receiptId: string): Promise<ScheduleReceipt | null> {
    return findReceipt(root, receiptId);
  }
  async cancel(root: string, receiptId: string): Promise<EffectOutcome> {
    return findReceipt(root, receiptId) ? { ok: true, detail: "dry-run: nothing to cancel remotely" } : { ok: false, failure: "not_found", detail: "unknown receipt" };
  }
}

// --- orchestration ----------------------------------------------------------

export interface ScheduleContext {
  root: string;
  publisher: Publisher;
  now?: Date;
}

export function publisherFor(network: Network, factories: Partial<Record<string, () => Publisher>> = {}): Publisher {
  const choice = choosePublisher(NETWORK_CHANNEL[network]);
  if (choice.publisher === "dry-run") return new DryRunPublisher();
  const make = factories[choice.publisher];
  if (!make) throw new Error(`publisher: "${choice.publisher}" is not configured (live drivers are injected by the caller)`);
  return make();
}

function base(req: ScheduleRequest, ctx: ScheduleContext, claims: ClaimsTag): Omit<ScheduleReceipt, "verdict" | "stages" | "attempts"> {
  const key = scheduleKey(req);
  return {
    schema: RECEIPT_SCHEMA,
    ts: (ctx.now ?? new Date()).toISOString(),
    piece_id: req.pieceId,
    client: req.clientSlug,
    provider: ctx.publisher.id,
    publisher: ctx.publisher.id,
    dry_run: isDryRun(),
    claims_tag: claims,
    network: req.network,
    publish_at: req.publishAt,
    approval_ref: req.approvalRef,
    media_sha256: req.mediaSha256,
    receipt_id: receiptIdOf(key),
    schedule_key: key,
  };
}

/** Schedules one post through all gates. Re-running with the same request never schedules twice. */
export async function scheduleVerified(req: ScheduleRequest, ctx: ScheduleContext): Promise<ScheduleReceipt> {
  const root = ctx.root;
  const eRoot = engineRoot(root);
  const now = ctx.now ?? new Date();
  const stages: ScheduleReceipt["stages"] = [];
  const watcher = readWatcherReport(eRoot, req.pieceId);
  const claims: ClaimsTag = watcher?.tag ?? "UNVERIFIED";

  const existing = findReceipt(root, receiptIdOf(scheduleKey(req)));
  if (existing && existing.verdict === "scheduled" && existing.dry_run === isDryRun()) return existing;

  const finish = (verdict: ScheduleReceipt["verdict"], attempts: number, extra: Partial<ScheduleReceipt> = {}): ScheduleReceipt => {
    const receipt: ScheduleReceipt = { ...base(req, ctx, claims), verdict, attempts, stages, ...extra };
    appendReceipt(root, receipt);
    emitEvent(root, {
      kind: verdict === "scheduled" ? "scheduled" : "publish_failed",
      level: verdict === "scheduled" ? "info" : "warn",
      piece_id: req.pieceId,
      client: req.clientSlug,
      phase: "schedule",
      verdict,
      data: { network: req.network, publisher: ctx.publisher.id, publish_at: req.publishAt, failure_class: extra.failure_class },
    });
    return receipt;
  };
  const block = (stage: string, failure: ScheduleFailure, detail: string): ScheduleReceipt => {
    stages.push({ stage, ok: false, detail });
    return finish("blocked", 0, { failure_class: failure });
  };

  if (!ctx.publisher.capabilities().networks.includes(req.network)) return block("network", "unsupported_network", `${ctx.publisher.id} does not serve ${req.network}`);
  if (!req.caption.trim() || !existsSync(req.mediaPath) || Number.isNaN(Date.parse(req.publishAt))) {
    return block("request", "invalid_request", "caption, existing media and a valid publishAt are required");
  }
  stages.push({ stage: "request", ok: true });

  const enforcement = enforceClaimsGate(req.pieceId, watcher);
  if (enforcement.blocked) return block("claims_gate", "claims_gate_blocked", enforcement.reasons[0] ?? "claims gate blocked");
  stages.push({ stage: "claims_gate", ok: true });

  const at = Date.parse(req.publishAt);
  const horizon = now.getTime() + MAX_SCHEDULE_DAYS * 24 * 60 * 60 * 1000;
  if (at <= now.getTime() || at > horizon) {
    return block("window", "outside_window", `publishAt must be in the future and within ${MAX_SCHEDULE_DAYS} days`);
  }
  stages.push({ stage: "window", ok: true });

  const gate = checkActionGate({ root: eRoot, action: "schedule", pieceId: req.pieceId, campaignId: req.campaignId, approvalRef: req.approvalRef, mediaSha256: req.mediaSha256 });
  if (!gate.ok) {
    const approval = gate.reasons.find((r) => /^approval_/.test(r))?.split(":")[0] as ScheduleFailure | undefined;
    return block("action_gate", approval ?? "action_gate_blocked", gate.reasons.join("; "));
  }
  stages.push({ stage: "action_gate", ok: true });

  const outcome = await ctx.publisher.schedule(req);
  stages.push({ stage: "schedule", ok: outcome.ok, ...(outcome.detail ? { detail: outcome.detail } : {}) });
  if (!outcome.ok) {
    return finish("failed", 1, { failure_class: outcome.failure ?? "layout_changed", ...(outcome.evidence ? { evidence: outcome.evidence } : {}) });
  }
  return finish("scheduled", 1, { ...(outcome.post_ref ? { post_ref: outcome.post_ref } : {}), ...(outcome.evidence ? { evidence: outcome.evidence } : {}) });
}

/** Cancels a scheduled receipt; the ledger keeps both records. */
export async function cancelScheduled(root: string, publisher: Publisher, receiptId: string): Promise<ScheduleReceipt> {
  const current = findReceipt(root, receiptId);
  if (!current) throw new Error(`publisher: unknown receipt ${receiptId}`);
  if (current.verdict !== "scheduled") return current;
  const outcome = await publisher.cancel(root, receiptId);
  const next: ScheduleReceipt = outcome.ok
    ? { ...current, ts: new Date().toISOString(), verdict: "cancelled", stages: [...current.stages, { stage: "cancel", ok: true }] }
    : { ...current, ts: new Date().toISOString(), stages: [...current.stages, { stage: "cancel", ok: false, detail: outcome.detail }], failure_class: outcome.failure ?? "layout_changed" };
  appendReceipt(root, next);
  return next;
}
