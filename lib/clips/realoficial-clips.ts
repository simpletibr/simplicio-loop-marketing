/**
 * realoficial-clips.ts — the long-video cut lane (`long_cut` slots).
 *
 *   ro_estimate_clips -> owner OK -> ro_create_clips -> ro_wait_for_clips -> ro_render_clip
 *
 * Only `ro_create_clips` spends credits, and it does so irreversibly, so:
 *  - the estimate always comes first and never spends;
 *  - a live run without `approvedByWesley: true` is blocked before any call;
 *  - the quote must still be valid, and a quote that lists terms (autopilot
 *    posting, AI video terms, ...) is refused unless the owner accepted each
 *    kind explicitly;
 *  - every spend is written to `data/credits.jsonl` with `approved_by` and the
 *    format, so the dashboard and the cost report see it.
 * DRY_RUN uses `DryRunClipsTransport`: nothing leaves the machine and nothing
 * is spent, but the whole flow and its receipts are exercised.
 */

import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { engineRoot } from "../clients/paths";
import { appendHbp, readHbp } from "../formats/binary";
import { isDryRun, num, str, type RoAnswer, type RoArgs, type RoToolTransport } from "../realoficial/transport";

export const CLIPS_RECEIPT_SCHEMA = "realoficial-clips-receipt/v1";
export const CLIPS_ALLOWED_TOOLS = ["ro_estimate_clips", "ro_create_clips", "ro_wait_for_clips", "ro_render_clip"] as const;

export type ClipsFailure = "approval_missing" | "quote_expired" | "terms_not_accepted" | "insufficient_credits" | "driver_unavailable" | "invalid_request" | "remote_error";

export interface ClipRequest {
  client: string;
  /** YouTube watch or Twitch VOD URL of the client's long video. */
  url: string;
  /** Slots that will receive the clips, in order. */
  pieceIds: string[];
  /** Options frozen in the quote (clip_duration, aspect_ratio, dub_languages, ...). */
  options?: RoArgs;
}

export interface ClipEstimate {
  quote_id: string;
  credits: number;
  budget_remaining_credits?: number;
  quote_expires_at: string;
  /** Terms the owner must accept (`accept_terms` kinds). */
  terms: string[];
  warnings: string[];
}

export interface ClipsReceipt {
  schema: typeof CLIPS_RECEIPT_SCHEMA;
  ts: string;
  receipt_id: string;
  client: string;
  url_sha256: string;
  dry_run: boolean;
  verdict: "estimated" | "created" | "blocked" | "failed";
  failure_class?: ClipsFailure;
  quote_id?: string;
  credits: number;
  credits_spent: number;
  approved_by?: string;
  project_id?: string;
  clips: Array<{ piece_id: string; clip_id: string; render_id?: string }>;
  stages: Array<{ stage: string; ok: boolean; detail?: string }>;
}

export function clipsLedgerPath(root: string): string {
  return resolve(engineRoot(root), "data", "clips.hbp");
}

export function listClipsReceipts(root: string, client?: string): ClipsReceipt[] {
  const latest = new Map<string, ClipsReceipt>();
  for (const r of readHbp<ClipsReceipt>(clipsLedgerPath(root))) latest.set(r.receipt_id, r);
  return [...latest.values()].filter((r) => !client || r.client === client);
}

/** The URL is hashed: receipts and ledgers never carry the raw address of a private video. */
function urlHash(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

export function clipsReceiptId(client: string, url: string, pieceIds: string[]): string {
  return createHash("sha256").update([client, url, ...pieceIds].join("\u0000")).digest("hex").slice(0, 20);
}

/** Deterministic stand-in with the shape of the ro_* answers; no network. */
export class DryRunClipsTransport implements RoToolTransport {
  readonly calls: string[] = [];
  constructor(private readonly clipCount = 3) {}
  async call(tool: string, args: RoArgs): Promise<RoAnswer> {
    this.calls.push(tool);
    const seed = createHash("sha256").update(JSON.stringify(args)).digest("hex");
    const ulid = (n: number): string => seed.slice(n, n + 26).toUpperCase().padEnd(26, "0");
    switch (tool) {
      case "ro_estimate_clips":
        return { quote_id: seed.slice(0, 22), credits: 12 * this.clipCount, budget_remaining_credits: 500, quote_expires_at: new Date(Date.now() + 5 * 60_000).toISOString(), terms: [], warnings: [] };
      case "ro_create_clips":
        return { project_id: ulid(0), stage: "processing", dry_run: true };
      case "ro_wait_for_clips":
        return { project_id: String(args.project_id), status: "ready", clips: Array.from({ length: this.clipCount }, (_, i) => ({ clip_id: ulid(i + 1), score: 100 - i })) };
      case "ro_render_clip":
        return { render_id: ulid(Number(String(args.clip_id).length) % 8), status: "queued", poll_after_seconds: 60 };
      default:
        throw new Error(`clips: tool "${tool}" is not on the allowlist`);
    }
  }
}

function guarded(transport: RoToolTransport): RoToolTransport {
  return {
    call(tool, args) {
      if (!(CLIPS_ALLOWED_TOOLS as readonly string[]).includes(tool)) throw new Error(`clips: tool "${tool}" is not on the allowlist`);
      return transport.call(tool, args);
    },
  };
}

/** Quotes the cut. Never spends; safe to call as often as needed. */
export async function estimateClips(req: ClipRequest, transport: RoToolTransport): Promise<ClipEstimate> {
  if (!/^https:\/\/(www\.)?(youtube\.com|youtu\.be|twitch\.tv)\//.test(req.url)) throw new Error("clips: the source must be a YouTube or Twitch VOD URL");
  if (req.pieceIds.length === 0) throw new Error("clips: at least one long_cut slot is required");
  const a = await guarded(transport).call("ro_estimate_clips", { url: req.url, ...(req.options ?? {}) });
  const quote = str(a.quote_id);
  const credits = num(a.credits);
  if (!quote || credits === undefined) throw new Error("clips: the estimate answer has no quote_id or credits");
  return {
    quote_id: quote,
    credits,
    ...(num(a.budget_remaining_credits) !== undefined ? { budget_remaining_credits: num(a.budget_remaining_credits) as number } : {}),
    quote_expires_at: str(a.quote_expires_at) ?? new Date(0).toISOString(),
    terms: Array.isArray(a.terms) ? a.terms.filter((t): t is string => typeof t === "string") : [],
    warnings: Array.isArray(a.warnings) ? a.warnings.filter((t): t is string => typeof t === "string") : [],
  };
}

export interface CutOptions {
  root: string;
  request: ClipRequest;
  /** Live runs inject the MCP session; DRY_RUN may omit it. */
  transport?: RoToolTransport;
  /** The owner's explicit OK to spend the quoted credits. Required when not in DRY_RUN. */
  approvedByWesley?: boolean;
  /** Kinds of quote terms the owner accepted. */
  acceptTerms?: string[];
  now?: Date;
  dryRun?: boolean;
}

function creditsPath(root: string): string {
  return resolve(engineRoot(root), "data", "credits.jsonl");
}

function appendCredit(root: string, row: Record<string, unknown>): void {
  mkdirSync(dirname(creditsPath(root)), { recursive: true });
  appendFileSync(creditsPath(root), `${JSON.stringify(row)}\n`);
}

/** Estimate, then (with the owner's OK) create, wait and render. Re-running the same request never charges twice. */
export async function cutLongVideo(opts: CutOptions): Promise<ClipsReceipt> {
  const { root, request } = opts;
  const now = opts.now ?? new Date();
  const dryRun = opts.dryRun ?? isDryRun();
  const receipt_id = clipsReceiptId(request.client, request.url, request.pieceIds);
  const prior = listClipsReceipts(root, request.client).find((r) => r.receipt_id === receipt_id);
  // A created project, or any run that already charged, is final: a new quote would charge again.
  if (prior && (prior.verdict === "created" || prior.credits_spent > 0) && prior.dry_run === dryRun) return prior;

  const stages: ClipsReceipt["stages"] = [];
  const base = { schema: CLIPS_RECEIPT_SCHEMA, receipt_id, client: request.client, url_sha256: urlHash(request.url), dry_run: dryRun } as const;
  const finish = (verdict: ClipsReceipt["verdict"], extra: Partial<ClipsReceipt> = {}): ClipsReceipt => {
    const r: ClipsReceipt = { ...base, ts: now.toISOString(), verdict, credits: 0, credits_spent: 0, clips: [], stages, ...extra };
    appendHbp(clipsLedgerPath(root), r);
    return r;
  };
  const block = (stage: string, failure: ClipsFailure, detail: string, extra: Partial<ClipsReceipt> = {}): ClipsReceipt => {
    stages.push({ stage, ok: false, detail });
    return finish(verdict(failure), { failure_class: failure, ...extra });
  };
  const verdict = (f: ClipsFailure): ClipsReceipt["verdict"] => (f === "remote_error" || f === "driver_unavailable" ? "failed" : "blocked");

  const raw = opts.transport ?? (dryRun ? new DryRunClipsTransport(request.pieceIds.length) : undefined);
  const transport = raw ? guarded(raw) : undefined;
  if (!dryRun && opts.approvedByWesley !== true) return block("approval", "approval_missing", "ro_create_clips spends credits irreversibly: approvedByWesley is required");
  if (!transport) return block("driver", "driver_unavailable", "live runs need a Real Oficial transport injected by the caller");

  let estimate: ClipEstimate;
  try {
    estimate = await estimateClips(request, transport);
  } catch (error) {
    return block("estimate", "invalid_request", error instanceof Error ? error.message : "estimate failed");
  }
  stages.push({ stage: "estimate", ok: true, detail: `${estimate.credits} credits` });
  const extra = { quote_id: estimate.quote_id, credits: estimate.credits };
  if (estimate.warnings.includes("insufficient_credits")) return block("estimate", "insufficient_credits", "the workspace balance does not cover the quote", extra);
  if (Date.parse(estimate.quote_expires_at) <= now.getTime() && !dryRun) return block("estimate", "quote_expired", "the quote expired; estimate again", extra);
  const missingTerms = estimate.terms.filter((t) => !(opts.acceptTerms ?? []).includes(t));
  if (missingTerms.length > 0) return block("terms", "terms_not_accepted", `the quote lists terms the owner did not accept: ${missingTerms.join(", ")}`, extra);

  let spent = 0;
  let project: string | undefined;
  try {
    const created = await transport.call("ro_create_clips", { quote_id: estimate.quote_id, confirm: true, ...(estimate.terms.length ? { accept_terms: estimate.terms } : {}) });
    project = str(created.project_id);
    if (!project) return block("create", "remote_error", "ro_create_clips answered without a project_id", extra);
    stages.push({ stage: "create", ok: true });
    // The charge happened at creation: record it before anything else can fail.
    if (!dryRun) {
      spent = estimate.credits;
      for (const piece_id of request.pieceIds) {
        appendCredit(root, { ts: now.toISOString(), client: request.client, piece_id, provider: "realoficial", credits: estimate.credits / request.pieceIds.length, purpose: "cortes", format: "long_cut", approved_by: "wesley" });
      }
    }
    const waited = await transport.call("ro_wait_for_clips", { project_id: project, min_clips: request.pieceIds.length });
    const ready = (Array.isArray(waited.clips) ? waited.clips : []).flatMap((c) => (c && typeof c === "object" && str((c as RoAnswer).clip_id) ? [str((c as RoAnswer).clip_id) as string] : []));
    stages.push({ stage: "wait", ok: ready.length > 0, detail: `${ready.length} clips ready` });
    const clips: ClipsReceipt["clips"] = [];
    for (const [i, clip_id] of ready.slice(0, request.pieceIds.length).entries()) {
      const rendered = await transport.call("ro_render_clip", { project_id: project, clip_id });
      clips.push({ piece_id: request.pieceIds[i] as string, clip_id, ...(str(rendered.render_id) ? { render_id: str(rendered.render_id) as string } : {}) });
    }
    stages.push({ stage: "render", ok: clips.length > 0, detail: `${clips.length} renders started` });
    return finish("created", { ...extra, credits_spent: spent, ...(spent ? { approved_by: "wesley" } : {}), project_id: project, clips });
  } catch (error) {
    // After a charge the receipt keeps the project and the spend so nothing is lost or paid twice.
    return block("remote", "remote_error", error instanceof Error ? error.message.slice(0, 200) : "remote call failed", { ...extra, credits_spent: spent, ...(spent ? { approved_by: "wesley" } : {}), ...(project ? { project_id: project } : {}) });
  }
}
