/**
 * store.ts — client approvals (`approval/v1`).
 *
 * Nothing is scheduled without an approval bound to the exact media hash.
 * The log is append-only (HBP): a later decision on the same piece and hash
 * supersedes an earlier one, and a new render (different hash) needs a new
 * request, so an approval can never be carried over to changed media.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { appendHbp, readHbp, writeHbiAtomic, readHbi } from "../formats/binary";
import { loadSchemaRegistry } from "../contracts/registry";
import { validateArtifact } from "../contracts/validate";
import { assertClientSlug, engineRoot } from "../clients/paths";

export const APPROVAL_SCHEMA = "approval/v1";

export type Decision = "approved" | "changes_requested";

export interface Approval {
  schema: typeof APPROVAL_SCHEMA;
  approval_id: string;
  request_id?: string;
  client: string;
  piece_id: string;
  month?: string;
  media_sha256: string;
  decision: Decision;
  note?: string;
  decided_by: string;
  decided_at: string;
}

export interface ApprovalRequest {
  kind: "request";
  request_id: string;
  client: string;
  piece_id: string;
  month: string;
  media_sha256: string;
  /** Lightweight preview (540x960) relative to the page, never the final render. */
  preview: string;
  captions: Record<string, string>;
  publish_at?: string;
  created_at: string;
}

type LogRecord = ApprovalRequest | (Approval & { kind: "decision" });

export function approvalsPath(root: string): string {
  return resolve(engineRoot(root), "data", "approvals.hbp");
}

function secretPath(root: string): string {
  return resolve(engineRoot(root), "data", "approval-secret.hbi");
}

const SHA = /^[a-f0-9]{64}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function readLog(root: string): LogRecord[] {
  return readHbp<LogRecord>(approvalsPath(root));
}

export function requestIdOf(client: string, pieceId: string, mediaSha256: string): string {
  return createHash("sha256").update(`${client}|${pieceId}|${mediaSha256}`).digest("hex").slice(0, 24);
}

export interface RequestInput {
  client: string;
  pieceId: string;
  month: string;
  mediaSha256: string;
  preview: string;
  captions: Record<string, string>;
  publishAt?: string;
  now?: Date;
}

/** Idempotent: asking again for the same piece and hash returns the existing request. */
export function requestApproval(root: string, input: RequestInput): ApprovalRequest {
  assertClientSlug(input.client);
  if (!SHA.test(input.mediaSha256)) throw new Error("approval: media_sha256 must be 64 hex characters");
  if (!MONTH.test(input.month)) throw new Error("approval: month must be YYYY-MM");
  const request_id = requestIdOf(input.client, input.pieceId, input.mediaSha256);
  const existing = listRequests(root).find((r) => r.request_id === request_id);
  if (existing) return existing;
  const record: ApprovalRequest = {
    kind: "request",
    request_id,
    client: input.client,
    piece_id: input.pieceId,
    month: input.month,
    media_sha256: input.mediaSha256,
    preview: input.preview,
    captions: input.captions,
    ...(input.publishAt ? { publish_at: input.publishAt } : {}),
    created_at: (input.now ?? new Date()).toISOString(),
  };
  appendHbp(approvalsPath(root), record);
  return record;
}

export function listRequests(root: string, filter: { client?: string; month?: string } = {}): ApprovalRequest[] {
  return readLog(root).filter(
    (r): r is ApprovalRequest =>
      r.kind === "request" && (!filter.client || r.client === filter.client) && (!filter.month || r.month === filter.month),
  );
}

export function listDecisions(root: string, filter: { client?: string } = {}): Approval[] {
  return readLog(root)
    .filter((r): r is Approval & { kind: "decision" } => r.kind === "decision" && (!filter.client || r.client === filter.client))
    .map(({ kind: _kind, ...approval }) => approval);
}

export interface DecisionInput {
  client: string;
  pieceId: string;
  mediaSha256: string;
  decision: Decision;
  note?: string;
  decidedBy: string;
  now?: Date;
}

/** Records a decision for media that was actually requested; unknown media is refused. */
export function recordDecision(root: string, input: DecisionInput): Approval {
  const request = listRequests(root, { client: input.client }).find(
    (r) => r.piece_id === input.pieceId && r.media_sha256 === input.mediaSha256,
  );
  if (!request) throw new Error(`approval: no request for ${input.pieceId} with that media hash`);
  if (!input.decidedBy.trim()) throw new Error("approval: decided_by is required");
  if (input.decision === "changes_requested" && !input.note?.trim()) {
    throw new Error("approval: changes_requested needs the client's text");
  }
  const decided_at = (input.now ?? new Date()).toISOString();
  const approval: Approval = {
    schema: APPROVAL_SCHEMA,
    approval_id: createHash("sha256")
      .update(`${request.request_id}|${input.decision}|${decided_at}|${input.decidedBy}`)
      .digest("hex")
      .slice(0, 24),
    request_id: request.request_id,
    client: input.client,
    piece_id: input.pieceId,
    month: request.month,
    media_sha256: input.mediaSha256,
    decision: input.decision,
    ...(input.note?.trim() ? { note: input.note.trim().slice(0, 1000) } : {}),
    decided_by: input.decidedBy.trim().slice(0, 120),
    decided_at,
  };
  const valid = validateArtifact(approval, loadSchemaRegistry());
  if (!valid.ok) throw new Error(`approval: invalid approval/v1: ${valid.errors.join("; ")}`);
  appendHbp(approvalsPath(root), { kind: "decision", ...approval });
  return approval;
}

export type ApprovalFailure = "approval_missing" | "approval_hash_mismatch" | "approval_not_approved";

export interface ApprovalCheck {
  ok: boolean;
  failure?: ApprovalFailure;
  reason?: string;
  approval?: Approval;
}

/**
 * The only way a piece may be scheduled: the referenced approval exists, is an
 * approval (not a change request), belongs to this piece, is not superseded
 * by a later decision, and was given for exactly this media hash.
 */
export function verifyApproval(
  root: string,
  input: { pieceId: string; mediaSha256: string; approvalRef: string },
): ApprovalCheck {
  const decisions = listDecisions(root).filter((d) => d.piece_id === input.pieceId);
  const referenced = decisions.find((d) => d.approval_id === input.approvalRef);
  if (!referenced) return { ok: false, failure: "approval_missing", reason: `no approval ${input.approvalRef} for ${input.pieceId}` };
  if (referenced.media_sha256 !== input.mediaSha256) {
    return { ok: false, failure: "approval_hash_mismatch", reason: "the media changed after it was approved" };
  }
  const latest = decisions.filter((d) => d.media_sha256 === input.mediaSha256).at(-1);
  if (!latest || latest.decision !== "approved") {
    return { ok: false, failure: "approval_not_approved", reason: "a later decision withdrew the approval" };
  }
  return { ok: true, approval: latest };
}

/** Latest approved decision for this exact media, or null (used to pick the approvalRef). */
export function findApproval(root: string, pieceId: string, mediaSha256: string): Approval | null {
  const latest = listDecisions(root)
    .filter((d) => d.piece_id === pieceId && d.media_sha256 === mediaSha256)
    .at(-1);
  return latest?.decision === "approved" ? latest : null;
}

export interface Adjustment {
  client: string;
  piece_id: string;
  media_sha256: string;
  note: string;
  decided_by: string;
  decided_at: string;
}

/** Open change requests: the client's text goes back to the queue until the media is re-requested. */
export function openAdjustments(root: string, client?: string): Adjustment[] {
  const log = readLog(root);
  const out: Adjustment[] = [];
  for (const rec of log) {
    if (rec.kind !== "decision" || rec.decision !== "changes_requested") continue;
    if (client && rec.client !== client) continue;
    const idx = log.indexOf(rec);
    const superseded = log.slice(idx + 1).some(
      (later) => later.piece_id === rec.piece_id && (later.kind === "request" || later.kind === "decision") && later.client === rec.client,
    );
    if (!superseded) {
      out.push({ client: rec.client, piece_id: rec.piece_id, media_sha256: rec.media_sha256, note: rec.note ?? "", decided_by: rec.decided_by, decided_at: rec.decided_at });
    }
  }
  return out;
}

function secretOf(root: string): string {
  const path = secretPath(root);
  if (existsSync(path)) return readHbi<{ secret: string }>(path).secret;
  const secret = randomBytes(32).toString("hex");
  writeHbiAtomic(path, { secret });
  return secret;
}

/** Token that lets one page form decide one request; derived, never stored per request. */
export function requestToken(root: string, requestId: string): string {
  return createHmac("sha256", secretOf(root)).update(requestId).digest("hex").slice(0, 32);
}

export function tokenMatches(root: string, requestId: string, token: string): boolean {
  const expected = Buffer.from(requestToken(root, requestId));
  const actual = Buffer.from(token);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function mediaSha256Of(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
