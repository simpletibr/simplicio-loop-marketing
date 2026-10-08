/**
 * batch.ts — turns a content plan into rendered, approved and scheduled posts.
 *
 *   renderBatch      creates the pieces and renders them with a persistent queue
 *                    (a re-run resumes: rendered pieces are never rendered twice)
 *   requestApprovals asks the client to approve each rendered piece
 *   scheduleApproved hands approved, in-window pieces to the Publisher seam
 *   planStatus       the status of every slot, computed from the logs
 *
 * Slots beyond the 30 day window are never rendered or sent to a publisher:
 * they wait for the next cycle.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { engineRoot } from "../clients/paths";
import { findApproval, listRequests, mediaSha256Of, requestApproval, listDecisions } from "../approval/store";
import { processPiece } from "../cli/generate";
import { appendHbp, readHbp, readHbi } from "../formats/binary";
import { emitEvent } from "../observability/events";
import { readPiece } from "../pieces/store";
import { serializePiece, type PieceFrontmatter } from "../pieces/frontmatter";
import { listReceipts, receiptIdOf, scheduleKey, scheduleVerified, type Network, type Publisher, type ScheduleReceipt } from "../publish/publisher";
import { pieceTypeFor } from "./formats";
import type { ContentPlan, PlanSlot } from "./content-plan";

export const NETWORK_PLATFORM: Record<Network, string> = { tiktok: "tiktok", ig_reels: "instagram", yt_shorts: "yt_shorts" };
export const MAX_RENDER_ATTEMPTS = 3;

export type RenderState = "rendering" | "rendered" | "failed";

interface QueueRecord {
  piece_id: string;
  plan_id: string;
  state: RenderState;
  attempts: number;
  error?: string;
  ts: string;
}

export function queuePath(root: string): string {
  return resolve(engineRoot(root), "data", "render-queue.hbp");
}

function queueState(root: string): Map<string, QueueRecord> {
  const latest = new Map<string, QueueRecord>();
  for (const rec of readHbp<QueueRecord>(queuePath(root))) latest.set(rec.piece_id, rec);
  return latest;
}

function pieceDirOf(root: string, plan: ContentPlan, slot: PlanSlot): string {
  return resolve(engineRoot(root), "outputs", plan.client, slot.publish_at.slice(0, 10), slot.piece_id);
}

/** Creates the piece file of a slot once; an existing file is left untouched. */
export function ensurePieceFile(root: string, plan: ContentPlan, slot: PlanSlot): string {
  const dir = resolve(engineRoot(root), "pieces");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${slot.piece_id}.md`);
  if (existsSync(path)) return path;
  const fm: PieceFrontmatter = {
    id: slot.piece_id,
    client: plan.client,
    campaign: plan.plan_id,
    date: slot.publish_at.slice(0, 10),
    status: "draft",
    type: pieceTypeFor(slot.format),
    pillar: slot.angle,
    platforms: [NETWORK_PLATFORM[slot.network]],
    locale: slot.language ?? "pt-BR",
    ...(slot.route.lane === "video-factory" ? { provider_override: { video: "simplicio-video" } } : {}),
  };
  const brief = `# Brief\n\nFormato: ${slot.format}\nÂngulo: ${slot.angle}\nGancho: ${slot.hook}\n\n${slot.caption}\n${slot.variant_of ? `\nVariação de: ${slot.variant_of}\n` : ""}`;
  writeFileSync(path, serializePiece(fm, brief));
  return path;
}

export interface RenderSummary {
  rendered: number;
  already_rendered: number;
  failed: number;
  skipped_next_cycle: number;
  skipped_other_lane: number;
}

export interface RenderOptions {
  root: string;
  plan: ContentPlan;
  /** Defaults to the real generate pipeline; tests may inject a stub. */
  render?: (slot: PlanSlot) => Promise<void>;
}

export async function renderBatch(opts: RenderOptions): Promise<RenderSummary> {
  const { root, plan } = opts;
  const summary: RenderSummary = { rendered: 0, already_rendered: 0, failed: 0, skipped_next_cycle: 0, skipped_other_lane: 0 };
  const state = queueState(root);
  const piecesDir = resolve(engineRoot(root), "pieces");
  const render =
    opts.render ??
    (async (slot: PlanSlot) => {
      await processPiece(readPiece(slot.piece_id, { piecesDir }), { root });
    });

  for (const slot of plan.slots) {
    if (slot.window === "next_cycle") {
      summary.skipped_next_cycle++;
      continue;
    }
    if (slot.route.lane !== "video-factory" && slot.route.lane !== "local-composition") {
      summary.skipped_other_lane++;
      continue;
    }
    const prev = state.get(slot.piece_id);
    const manifest = join(pieceDirOf(root, plan, slot), "manifest.hbi");
    if (prev?.state === "rendered" && existsSync(manifest)) {
      summary.already_rendered++;
      continue;
    }
    const attempts = (prev?.attempts ?? 0) + 1;
    if (prev?.state === "failed" && prev.attempts >= MAX_RENDER_ATTEMPTS) {
      summary.failed++;
      continue;
    }
    ensurePieceFile(root, plan, slot);
    appendHbp(queuePath(root), { piece_id: slot.piece_id, plan_id: plan.plan_id, state: "rendering", attempts, ts: new Date().toISOString() } satisfies QueueRecord);
    try {
      await render(slot);
      if (!existsSync(manifest)) throw new Error("render finished without a manifest");
      appendHbp(queuePath(root), { piece_id: slot.piece_id, plan_id: plan.plan_id, state: "rendered", attempts, ts: new Date().toISOString() } satisfies QueueRecord);
      summary.rendered++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendHbp(queuePath(root), { piece_id: slot.piece_id, plan_id: plan.plan_id, state: "failed", attempts, error: message.slice(0, 300), ts: new Date().toISOString() } satisfies QueueRecord);
      emitEvent(root, { kind: "render_failed", level: "warn", piece_id: slot.piece_id, client: plan.client, phase: "render", data: { attempts, message: message.slice(0, 200) } });
      summary.failed++;
    }
  }
  return summary;
}

export interface SlotMedia {
  path: string;
  sha256: string;
}

/** The media a slot would publish: the video of the render, else its first image. */
export function mediaOf(root: string, plan: ContentPlan, slot: PlanSlot): SlotMedia | null {
  const manifestPath = join(pieceDirOf(root, plan, slot), "manifest.hbi");
  if (!existsSync(manifestPath)) return null;
  const manifest = readHbi<{ outputs?: string[]; render_sha256?: string }>(manifestPath);
  const outputs = manifest.outputs ?? [];
  const video = outputs.find((o) => /\.mp4$/i.test(o));
  const image = outputs.find((o) => /\.(png|jpe?g|webp)$/i.test(o));
  const path = video ?? image;
  if (!path || !existsSync(path)) return null;
  return { path, sha256: video && manifest.render_sha256 ? manifest.render_sha256 : mediaSha256Of(path) };
}

export function requestApprovals(root: string, plan: ContentPlan, now?: Date): number {
  let requested = 0;
  const month = plan.start.slice(0, 7);
  for (const slot of plan.slots) {
    if (slot.window === "next_cycle") continue;
    const media = mediaOf(root, plan, slot);
    if (!media) continue;
    const before = listRequests(root, { client: plan.client }).length;
    requestApproval(root, { client: plan.client, pieceId: slot.piece_id, month, mediaSha256: media.sha256, preview: media.path, captions: { [slot.network]: slot.caption }, publishAt: slot.publish_at, now });
    if (listRequests(root, { client: plan.client }).length > before) requested++;
  }
  return requested;
}

export interface ScheduleSummary {
  scheduled: number;
  already_scheduled: number;
  blocked: number;
  failed: number;
  awaiting_approval: number;
  not_rendered: number;
  skipped_next_cycle: number;
  receipts: ScheduleReceipt[];
}

export async function scheduleApproved(opts: { root: string; plan: ContentPlan; publisherFor: (network: Network) => Publisher; now?: Date }): Promise<ScheduleSummary> {
  const { root, plan } = opts;
  const summary: ScheduleSummary = { scheduled: 0, already_scheduled: 0, blocked: 0, failed: 0, awaiting_approval: 0, not_rendered: 0, skipped_next_cycle: 0, receipts: [] };
  for (const slot of plan.slots) {
    if (slot.window === "next_cycle") {
      summary.skipped_next_cycle++;
      continue;
    }
    const media = mediaOf(root, plan, slot);
    if (!media) {
      summary.not_rendered++;
      continue;
    }
    const approval = findApproval(root, slot.piece_id, media.sha256);
    if (!approval) {
      summary.awaiting_approval++;
      continue;
    }
    const key = receiptIdOf(scheduleKey({ pieceId: slot.piece_id, network: slot.network, publishAt: slot.publish_at }));
    const before = listReceipts(root, { client: plan.client }).find((r) => r.receipt_id === key);
    const receipt = await scheduleVerified(
      { clientSlug: plan.client, pieceId: slot.piece_id, campaignId: plan.plan_id, mediaPath: media.path, mediaSha256: media.sha256, caption: slot.caption, network: slot.network, publishAt: slot.publish_at, approvalRef: approval.approval_id },
      { root, publisher: opts.publisherFor(slot.network), now: opts.now },
    );
    summary.receipts.push(receipt);
    if (receipt.verdict === "scheduled") {
      if (before?.verdict === "scheduled") summary.already_scheduled++;
      else summary.scheduled++;
    } else if (receipt.verdict === "blocked") summary.blocked++;
    else summary.failed++;
  }
  return summary;
}

export type SlotStatus = "queued_next_cycle" | "planned" | "rendering" | "render_failed" | "rendered" | "awaiting_approval" | "changes_requested" | "approved" | "scheduled" | "cancelled" | "schedule_failed";

export interface SlotView {
  slot: PlanSlot;
  status: SlotStatus;
  media?: SlotMedia;
  receipt?: ScheduleReceipt;
}

/** What has happened to each slot, derived from the queue, approvals and receipt ledger. */
export function planStatus(root: string, plan: ContentPlan): SlotView[] {
  const queue = queueState(root);
  const receipts = new Map(listReceipts(root, { client: plan.client }).map((r) => [r.receipt_id, r]));
  const decisions = listDecisions(root, { client: plan.client });
  return plan.slots.map((slot): SlotView => {
    if (slot.window === "next_cycle") return { slot, status: "queued_next_cycle" };
    const receipt = receipts.get(receiptIdOf(scheduleKey({ pieceId: slot.piece_id, network: slot.network, publishAt: slot.publish_at })));
    if (receipt?.verdict === "scheduled") return { slot, status: "scheduled", receipt };
    if (receipt?.verdict === "cancelled") return { slot, status: "cancelled", receipt };
    if (receipt && receipt.verdict !== "blocked") return { slot, status: "schedule_failed", receipt };
    const q = queue.get(slot.piece_id);
    const media = mediaOf(root, plan, slot) ?? undefined;
    if (!media) {
      if (q?.state === "failed") return { slot, status: "render_failed" };
      return { slot, status: q?.state === "rendering" ? "rendering" : "planned" };
    }
    const latest = decisions.filter((d) => d.piece_id === slot.piece_id && d.media_sha256 === media.sha256).at(-1);
    if (latest?.decision === "approved") return { slot, status: "approved", media, ...(receipt ? { receipt } : {}) };
    if (latest?.decision === "changes_requested") return { slot, status: "changes_requested", media };
    const requested = listRequests(root, { client: plan.client }).some((r) => r.piece_id === slot.piece_id && r.media_sha256 === media.sha256);
    return { slot, status: requested ? "awaiting_approval" : "rendered", media };
  });
}

