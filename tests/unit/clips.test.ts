import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLIPS_ALLOWED_TOOLS, DryRunClipsTransport, cutLongVideo, estimateClips, listClipsReceipts, type ClipRequest } from "../../lib/clips/realoficial-clips.ts";
import { ReplayTransport } from "../helpers/ro-transport.ts";

const NOW = new Date("2026-10-07T12:00:00Z");
const REQUEST: ClipRequest = { client: "lothus", url: "https://www.youtube.com/watch?v=abc123", pieceIds: ["PIECE-A", "PIECE-B", "PIECE-C"] };
const LIVE_ANSWERS = { ro_estimate_clips: "estimate-clips", ro_create_clips: "create-clips", ro_wait_for_clips: "wait-clips", ro_render_clip: "render-clip" };

function host(): string {
  const root = mkdtempSync(join(tmpdir(), "me-clips-"));
  mkdirSync(join(root, "data"), { recursive: true });
  return root;
}

function creditRows(root: string): Array<Record<string, unknown>> {
  const path = join(root, "data", "credits.jsonl");
  return existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>) : [];
}

test("the estimate never spends: it only calls ro_estimate_clips", async () => {
  const t = new ReplayTransport(LIVE_ANSWERS);
  const est = await estimateClips(REQUEST, t);
  assert.deepEqual(t.tools, ["ro_estimate_clips"]);
  assert.equal(est.credits, 36);
  assert.equal(est.quote_id, "AbCdEfGhIjKlMnOpQrStUv");
  await assert.rejects(() => estimateClips({ ...REQUEST, url: "https://example.com/video" }, t), /YouTube or Twitch/);
  await assert.rejects(() => estimateClips({ ...REQUEST, pieceIds: [] }, t), /long_cut slot/);
});

test("DRY_RUN runs the whole flow with canned answers, spends nothing and writes no credit row", async () => {
  const root = host();
  const t = new DryRunClipsTransport(3);
  const receipt = await cutLongVideo({ root, request: REQUEST, transport: t, dryRun: true, now: NOW });
  assert.equal(receipt.verdict, "created");
  assert.equal(receipt.dry_run, true);
  assert.equal(receipt.credits_spent, 0);
  assert.equal(receipt.credits, 36, "the estimated price is still recorded");
  assert.deepEqual(receipt.clips.map((c) => c.piece_id), ["PIECE-A", "PIECE-B", "PIECE-C"]);
  assert.deepEqual(t.calls, ["ro_estimate_clips", "ro_create_clips", "ro_wait_for_clips", "ro_render_clip", "ro_render_clip", "ro_render_clip"]);
  assert.equal(creditRows(root).length, 0);
  assert.equal(receipt.url_sha256.length, 16);
  assert.ok(!JSON.stringify(receipt).includes("abc123"), "the receipt never carries the video address");
});

test("live without approvedByWesley is blocked before any call", async () => {
  const root = host();
  const t = new ReplayTransport(LIVE_ANSWERS);
  const receipt = await cutLongVideo({ root, request: REQUEST, transport: t, dryRun: false, now: NOW });
  assert.equal(receipt.verdict, "blocked");
  assert.equal(receipt.failure_class, "approval_missing");
  assert.equal(t.calls.length, 0, "not even the estimate is requested");
  assert.equal(creditRows(root).length, 0);
});

test("live without a transport fails closed", async () => {
  const receipt = await cutLongVideo({ root: host(), request: REQUEST, approvedByWesley: true, dryRun: false, now: NOW });
  assert.equal(receipt.verdict, "failed");
  assert.equal(receipt.failure_class, "driver_unavailable");
});

test("live with the owner's OK creates the clips and records each spend with its approver and format", async () => {
  const root = host();
  const t = new ReplayTransport(LIVE_ANSWERS);
  const receipt = await cutLongVideo({ root, request: REQUEST, transport: t, approvedByWesley: true, dryRun: false, now: NOW });
  assert.equal(receipt.verdict, "created");
  assert.equal(receipt.credits_spent, 36);
  assert.equal(receipt.approved_by, "wesley");
  assert.equal(receipt.project_id, "01HZXQ3M8K2V5N7P9R1S4T6W8Y");
  assert.deepEqual(t.calls[1], { tool: "ro_create_clips", args: { quote_id: "AbCdEfGhIjKlMnOpQrStUv", confirm: true } }, "create takes only the quote and the confirmation");
  const rows = creditRows(root);
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r.approved_by === "wesley" && r.format === "long_cut" && r.client === "lothus"));
  assert.equal(rows.reduce((a, r) => a + (r.credits as number), 0), 36);

  // Running again never charges twice.
  const again = await cutLongVideo({ root, request: REQUEST, transport: t, approvedByWesley: true, dryRun: false, now: NOW });
  assert.equal(again.receipt_id, receipt.receipt_id);
  assert.equal(t.calls.filter((c) => c.tool === "ro_create_clips").length, 1);
  assert.equal(creditRows(root).length, 3);
  assert.equal(listClipsReceipts(root, "lothus").length, 1);
});

test("a quote with terms, an expired quote and a short balance are refused without spending", async () => {
  for (const [estimate, failure] of [["estimate-clips-terms", "terms_not_accepted"], ["estimate-clips-expired", "quote_expired"], ["estimate-clips-insufficient", "insufficient_credits"]] as const) {
    const root = host();
    const t = new ReplayTransport({ ...LIVE_ANSWERS, ro_estimate_clips: estimate });
    const receipt = await cutLongVideo({ root, request: REQUEST, transport: t, approvedByWesley: true, dryRun: false, now: NOW });
    assert.equal(receipt.failure_class, failure, estimate);
    assert.ok(!t.tools.includes("ro_create_clips"), estimate);
    assert.equal(creditRows(root).length, 0);
  }
  // The same terms, accepted by the owner, go through and are forwarded.
  const root = host();
  const t = new ReplayTransport({ ...LIVE_ANSWERS, ro_estimate_clips: "estimate-clips-terms" });
  const ok = await cutLongVideo({ root, request: REQUEST, transport: t, approvedByWesley: true, acceptTerms: ["tiktok"], dryRun: false, now: NOW });
  assert.equal(ok.verdict, "created");
  assert.deepEqual(t.calls[1]?.args.accept_terms, ["tiktok"]);
});

test("a failure after the charge keeps the spend on the receipt and is never retried with a new quote", async () => {
  const root = host();
  const t = new ReplayTransport(LIVE_ANSWERS);
  const original = t.call.bind(t);
  t.call = async (tool, args) => {
    if (tool === "ro_wait_for_clips") throw new Error("network down");
    return original(tool, args);
  };
  const receipt = await cutLongVideo({ root, request: REQUEST, transport: t, approvedByWesley: true, dryRun: false, now: NOW });
  assert.equal(receipt.verdict, "failed");
  assert.equal(receipt.credits_spent, 36);
  assert.equal(receipt.project_id, "01HZXQ3M8K2V5N7P9R1S4T6W8Y");
  assert.equal(creditRows(root).length, 3);
  const again = await cutLongVideo({ root, request: REQUEST, transport: t, approvedByWesley: true, dryRun: false, now: NOW });
  assert.equal(again.credits_spent, 36);
  assert.equal(t.calls.filter((c) => c.tool === "ro_create_clips").length, 1, "no second charge");
});

test("only the four clip tools are reachable", async () => {
  assert.deepEqual([...CLIPS_ALLOWED_TOOLS], ["ro_estimate_clips", "ro_create_clips", "ro_wait_for_clips", "ro_render_clip"]);
  await assert.rejects(() => new DryRunClipsTransport().call("ro_start_purchase", {}), /allowlist/);
});
