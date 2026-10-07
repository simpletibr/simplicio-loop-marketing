/**
 * verify-pipeline.ts — verified publication, the dev-cli apply+verify
 * pattern ported to publishing:
 *
 *   validate artifact → claims gate → compliance recheck → publish
 *   (DRY_RUN-safe) → receipt → retry with CLASSIFIED feedback
 *
 * Deterministic gate failures (missing/invalid manifest, UNVERIFIED claims
 * tag, failed compliance) fail CLOSED immediately — retrying cannot fix
 * them and paid/publish surfaces never run on unverified content. Only
 * transient provider errors retry, up to MAX_ATTEMPTS.
 *
 * Every run writes a `marketing-publish-receipt/v1` next to the piece's
 * manifest: the mechanical, never-hand-written record of what was checked
 * and what happened (pr_evidence discipline). Honesty rule: under DRY_RUN
 * the piece is NOT transitioned to `published` — a dry run proves the
 * pipeline, it does not fake a publication.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getPublishClient, type PublishClient } from "./adaptlypost";
import { readPiece, transitionStatus } from "../pieces/store";
import { readWatcherReport, type ClaimsTag } from "../gate/watcher-gate";
import { enforceClaimsGate } from "../gate/claims-gate";
import { readHbi } from "../formats/binary";
import { loadSchemaRegistry } from "../contracts/registry";
import { validateArtifact } from "../contracts/validate";
import { emitEvent } from "../observability/events";
import { checkActionGate } from "../gate/action-gate";
import { validateFreshAccept } from "../prototype/gate";
import { verifyRenderManifest } from "../video/contract";

export const RECEIPT_SCHEMA = "marketing-publish-receipt/v1";
export const MAX_ATTEMPTS = 5;

export type FailureClass =
  | "missing_manifest"
  | "invalid_manifest"
  | "claims_gate_blocked"
  | "compliance_blocked"
  | "provider_error"
  | "action_gate_blocked"
  | "prototype_gate_blocked"
  | "render_evidence_blocked";

export interface ReceiptStage {
  stage: string;
  ok: boolean;
  detail?: string;
}

export interface PublishReceipt {
  schema: typeof RECEIPT_SCHEMA;
  ts: string;
  piece_id: string;
  client?: string;
  provider?: string;
  dry_run: boolean;
  verdict: "scheduled" | "published" | "blocked" | "failed" | "cancelled";
  claims_tag: ClaimsTag;
  attempts: number;
  stages: ReceiptStage[];
  failure_class?: FailureClass;
  post_ref?: string;
}

export interface PublishVerifyOptions {
  root: string;
  /** Injectable for tests — defaults to the routed publish client. */
  publishClient?: PublishClient;
  maxAttempts?: number;
}

function engineRoot(root: string): string {
  const nested = resolve(root, ".marketing-engine");
  return existsSync(nested) ? nested : root;
}

function isDryRun(): boolean {
  const v = process.env.DRY_RUN;
  return v === undefined || v === "" || v === "true";
}

export function receiptPath(
  root: string,
  client: string,
  date: string,
  pieceId: string,
): string {
  return join(
    engineRoot(root),
    "outputs",
    client,
    date,
    pieceId,
    "publish-receipt.json",
  );
}

/** Deterministic sample receipt for the contract fixture (gen-fixtures.mjs). */
export function producePublishReceiptFixture(): PublishReceipt {
  return {
    schema: RECEIPT_SCHEMA,
    ts: "1970-01-01T00:00:00.000Z",
    piece_id: "PIECE-fixture-001",
    client: "fixture-client",
    provider: "adaptlypost",
    dry_run: true,
    verdict: "published",
    claims_tag: "MEASURED",
    attempts: 1,
    stages: [
      { stage: "manifest_valid", ok: true },
      { stage: "claims_gate", ok: true },
      { stage: "compliance", ok: true },
      { stage: "publish", ok: true, detail: "dry-run draft written" },
    ],
    post_ref: "https://adaptlypost.test/drafts/PIECE-fixture-001",
  };
}

export async function publishVerified(
  pieceId: string,
  opts: PublishVerifyOptions,
): Promise<PublishReceipt> {
  const root = opts.root;
  const eRoot = engineRoot(root);
  const maxAttempts = opts.maxAttempts ?? MAX_ATTEMPTS;
  const piecesDir = join(eRoot, "pieces");
  const piece = readPiece(pieceId, { piecesDir });
  const fm = piece.frontmatter;
  const dateStr = fm.date.slice(0, 10);
  const pieceDir = join(eRoot, "outputs", fm.client, dateStr, pieceId);
  const stages: ReceiptStage[] = [];
  const dryRun = isDryRun();

  // Exactly-once: a successful receipt for the same effect is authoritative.
  // Retries/restarts return it rather than calling the platform again.
  const existingReceiptPath = join(pieceDir, "publish-receipt.json");
  if (existsSync(existingReceiptPath)) {
    try {
      const existing = JSON.parse(readFileSync(existingReceiptPath, "utf8")) as PublishReceipt;
      if (existing.schema === RECEIPT_SCHEMA && existing.verdict === "published" && existing.dry_run === dryRun) return existing;
    } catch { /* malformed receipts are replaced by the normal verified flow */ }
  }

  const finish = (
    verdict: PublishReceipt["verdict"],
    attempts: number,
    claimsTag: ClaimsTag,
    extra?: { failure_class?: FailureClass; post_ref?: string; provider?: string },
  ): PublishReceipt => {
    const receipt: PublishReceipt = {
      schema: RECEIPT_SCHEMA,
      ts: new Date().toISOString(),
      piece_id: pieceId,
      client: fm.client,
      dry_run: dryRun,
      verdict,
      claims_tag: claimsTag,
      attempts,
      stages,
      ...(extra?.provider !== undefined && { provider: extra.provider }),
      ...(extra?.failure_class !== undefined && { failure_class: extra.failure_class }),
      ...(extra?.post_ref !== undefined && { post_ref: extra.post_ref }),
    };
    try {
      writeFileSync(
        join(pieceDir, "publish-receipt.json"),
        JSON.stringify(receipt, null, 2),
      );
    } catch {
      // receipt write is best-effort; the returned object is authoritative
    }
    emitEvent(root, {
      kind: verdict === "published" ? "publish_verified" : "publish_attempt",
      level: verdict === "published" ? "info" : "warn",
      piece_id: pieceId,
      client: fm.client,
      phase: "publish",
      verdict,
      data: { attempts, dry_run: dryRun, failure_class: extra?.failure_class },
    });
    return receipt;
  };

  // --- stage 1: manifest exists and validates against its contract ---------
  const manifestPath = join(pieceDir, "manifest.hbi");
  if (!existsSync(manifestPath)) {
    stages.push({ stage: "manifest_valid", ok: false, detail: "manifest.hbi missing" });
    return finish("blocked", 0, "UNVERIFIED", { failure_class: "missing_manifest" });
  }
  let manifest: Record<string, unknown>;
  try {
    manifest = readHbi<Record<string, unknown>>(manifestPath);
  } catch {
    stages.push({ stage: "manifest_valid", ok: false, detail: "manifest.hbi unreadable" });
    return finish("blocked", 0, "UNVERIFIED", { failure_class: "invalid_manifest" });
  }
  const validation = validateArtifact(manifest, loadSchemaRegistry());
  if (!validation.ok) {
    stages.push({
      stage: "manifest_valid",
      ok: false,
      detail: validation.errors.slice(0, 3).join("; "),
    });
    return finish("blocked", 0, "UNVERIFIED", { failure_class: "invalid_manifest" });
  }
  stages.push({ stage: "manifest_valid", ok: true });

  // --- stage 1b: video factory evidence — the MP4 hash must match its render manifest
  if (typeof manifest.render_manifest_path === "string") {
    const render = verifyRenderManifest(manifest.render_manifest_path);
    const hashAgrees = !manifest.render_sha256 || render.manifest?.output.sha256 === manifest.render_sha256;
    const ok = render.ok && hashAgrees;
    stages.push({
      stage: "render_manifest",
      ok,
      detail: ok ? "sha256 verified" : (render.reasons[0] ?? "render sha256 differs from the piece manifest"),
    });
    if (!ok) return finish("blocked", 0, "UNVERIFIED", { failure_class: "render_evidence_blocked" });
  }

  // --- stage 2: claims gate — no publish for UNVERIFIED content ------------
  const watcherReport = readWatcherReport(eRoot, pieceId);
  const enforcement = enforceClaimsGate(pieceId, watcherReport);
  const claimsTag: ClaimsTag = watcherReport?.tag ?? "UNVERIFIED";
  if (enforcement.blocked) {
    stages.push({
      stage: "claims_gate",
      ok: false,
      detail: enforcement.reasons[0] ?? "claims gate blocked",
    });
    return finish("blocked", 0, claimsTag, { failure_class: "claims_gate_blocked" });
  }
  stages.push({ stage: "claims_gate", ok: true });

  // Policy-required pieces must carry a fresh Prototype-First ACCEPT bound
  // to the exact brand/offer/channel/policy/source inputs being published.
  if (manifest.prototype_required === true) {
    const proto = validateFreshAccept(eRoot, {
      piece_id: pieceId,
      campaign_id: fm.campaign,
      client: fm.client,
      channel: fm.platforms[0] ?? "unknown",
      brief: typeof manifest.prototype_brief === "string" ? manifest.prototype_brief : "",
      brand_version: typeof manifest.brand_version === "string" ? manifest.brand_version : undefined,
      offer_version: typeof manifest.offer_version === "string" ? manifest.offer_version : undefined,
      policy_version: typeof manifest.policy_version === "string" ? manifest.policy_version : undefined,
      source_version: typeof manifest.source_version === "string" ? manifest.source_version : undefined,
    });
    stages.push({ stage: "prototype_gate", ok: proto.ok, detail: proto.ok ? "fresh ACCEPT found" : proto.reasons.join("; ") });
    if (!proto.ok) return finish("blocked", 0, claimsTag, { failure_class: "prototype_gate_blocked" });
  }

  // --- stage 3: compliance recheck on the persisted artifact ---------------
  const compliancePath = join(pieceDir, "compliance.json");
  let compliancePass = false;
  try {
    const report = JSON.parse(readFileSync(compliancePath, "utf8"));
    compliancePass = report?.pass === true;
  } catch {
    compliancePass = false;
  }
  if (!compliancePass) {
    stages.push({
      stage: "compliance",
      ok: false,
      detail: "compliance.json missing or pass!=true",
    });
    return finish("blocked", 0, claimsTag, { failure_class: "compliance_blocked" });
  }
  stages.push({ stage: "compliance", ok: true });
  if (!dryRun) {
    const gate = checkActionGate({ root: eRoot, action: "publish", pieceId, campaignId: fm.campaign });
    stages.push({ stage: "action_gate", ok: gate.ok, detail: gate.ok ? "human approval found" : gate.reasons.join("; ") });
    if (!gate.ok) return finish("blocked", 0, claimsTag, { failure_class: "action_gate_blocked" });
  }

  // --- stage 4: publish with classified retry ------------------------------
  let captions: Record<string, string> = {};
  try {
    captions = JSON.parse(readFileSync(join(pieceDir, "captions.json"), "utf8"));
  } catch {
    // captions optional at this layer; caption presence was gated upstream
  }
  const client = opts.publishClient ?? getPublishClient();
  const primaryPlatform = fm.platforms[0] ?? "instagram";
  const outputs = Array.isArray(manifest.outputs) ? (manifest.outputs as string[]) : [];
  let lastError = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await client.schedule({
        id: pieceId,
        client: fm.client,
        platforms: fm.platforms,
        caption: captions[primaryPlatform] ?? "",
        media_paths: outputs.filter((o) => /\.(png|jpe?g|mp4|webm)$/i.test(o)),
        scheduled_at: `${dateStr}T00:00:00Z`,
      });
      if (result.ok) {
        stages.push({
          stage: "publish",
          ok: true,
          detail: dryRun ? "dry-run draft written" : "scheduled via provider",
        });
        if (!dryRun && fm.status === "scheduled") {
          // A real publication moves the piece forward; a dry run never does.
          transitionStatus(pieceId, "scheduled", "published", { piecesDir });
        }
        return finish("published", attempt, claimsTag, {
          post_ref: result.draft_url,
          provider: (client as { name?: string }).name ?? "publish",
        });
      }
      lastError = result.error ?? "provider returned ok=false";
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    emitEvent(root, {
      kind: "publish_attempt",
      level: "warn",
      piece_id: pieceId,
      client: fm.client,
      phase: "publish",
      verdict: "retry",
      data: { attempt, error: lastError.slice(0, 200) },
    });
  }
  stages.push({
    stage: "publish",
    ok: false,
    detail: `${maxAttempts} attempt(s) failed: ${lastError.slice(0, 200)}`,
  });
  return finish("failed", maxAttempts, claimsTag, { failure_class: "provider_error" });
}
