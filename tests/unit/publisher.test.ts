import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DryRunPublisher,
  MAX_SCHEDULE_DAYS,
  NETWORK_CHANNEL,
  cancelScheduled,
  findReceipt,
  listReceipts,
  publisherFor,
  receiptIdOf,
  scheduleKey,
  scheduleVerified,
  type Publisher,
  type ScheduleRequest,
} from "../../lib/publish/publisher.ts";
import { requestApproval, recordDecision } from "../../lib/approval/store.ts";
import { writeWatcherReport } from "../../lib/gate/watcher-gate.ts";
import { choosePublisher } from "../../lib/integrations/broker.ts";
import { loadSchemaRegistry } from "../../lib/contracts/registry.ts";
import { validateArtifact } from "../../lib/contracts/validate.ts";

const NOW = new Date("2026-10-07T12:00:00Z");
const SHA = "d".repeat(64);

function setup(tag: "MEASURED" | "UNVERIFIED" = "MEASURED") {
  process.env.DRY_RUN = "true";
  const root = mkdtempSync(join(tmpdir(), "me-publisher-"));
  mkdirSync(join(root, "data"), { recursive: true });
  const media = join(root, "final.mp4");
  writeFileSync(media, "bytes");
  writeWatcherReport(root, { piece_id: "PIECE-1", tag, passed: tag !== "UNVERIFIED", checked: [], checked_at: NOW.toISOString() });
  requestApproval(root, { client: "acme", pieceId: "PIECE-1", month: "2026-10", mediaSha256: SHA, preview: "p.mp4", captions: {} });
  const approval = recordDecision(root, { client: "acme", pieceId: "PIECE-1", mediaSha256: SHA, decision: "approved", decidedBy: "client:Ana" });
  const req: ScheduleRequest = {
    clientSlug: "acme",
    pieceId: "PIECE-1",
    mediaPath: media,
    mediaSha256: SHA,
    caption: "Legenda",
    network: "tiktok",
    publishAt: "2026-10-20T18:00:00.000Z",
    approvalRef: approval.approval_id,
  };
  return { root, req };
}

test("a fully gated dry-run schedule writes a valid scheduled receipt", async () => {
  const { root, req } = setup();
  const receipt = await scheduleVerified(req, { root, publisher: new DryRunPublisher(), now: NOW });
  assert.equal(receipt.verdict, "scheduled");
  assert.equal(receipt.dry_run, true);
  assert.equal(receipt.publisher, "dry-run");
  assert.deepEqual(receipt.stages.map((s) => s.stage), ["request", "claims_gate", "window", "action_gate", "schedule"]);
  assert.deepEqual(validateArtifact(receipt, loadSchemaRegistry()).errors, []);
  assert.equal(receipt.receipt_id, receiptIdOf(scheduleKey(req)));
  assert.equal(findReceipt(root, receipt.receipt_id)?.verdict, "scheduled");
});

test("scheduling twice for the same piece, network and day never calls the publisher again", async () => {
  const { root, req } = setup();
  let calls = 0;
  const counting: Publisher = {
    ...new DryRunPublisher(),
    id: "dry-run",
    capabilities: () => new DryRunPublisher().capabilities(),
    schedule: async (r) => {
      calls++;
      return new DryRunPublisher().schedule(r);
    },
    status: async (rt, id) => new DryRunPublisher().status(rt, id),
    cancel: async (rt, id) => new DryRunPublisher().cancel(rt, id),
  };
  const first = await scheduleVerified(req, { root, publisher: counting, now: NOW });
  const second = await scheduleVerified(req, { root, publisher: counting, now: NOW });
  assert.equal(calls, 1);
  assert.deepEqual(second, first);
  assert.equal(listReceipts(root).length, 1);
  // another day is a different effect
  const other = await scheduleVerified({ ...req, publishAt: "2026-10-21T18:00:00.000Z" }, { root, publisher: counting, now: NOW });
  assert.equal(other.verdict, "scheduled");
  assert.equal(calls, 2);
  assert.equal(listReceipts(root, { client: "acme", network: "tiktok" }).length, 2);
  assert.equal(listReceipts(root, { client: "other" }).length, 0);
});

test("every gate fails closed with a classified reason and records a blocked receipt", async () => {
  const dry = new DryRunPublisher();
  const run = async (mutate: (s: ReturnType<typeof setup>) => Partial<ScheduleRequest> | void, tag?: "UNVERIFIED") => {
    const s = setup(tag);
    const patch = mutate(s) ?? {};
    return scheduleVerified({ ...s.req, ...patch }, { root: s.root, publisher: dry, now: NOW });
  };
  assert.equal((await run(() => ({ network: "linkedin" as never }))).failure_class, "unsupported_network");
  assert.equal((await run(() => ({ caption: "  " }))).failure_class, "invalid_request");
  assert.equal((await run(() => ({ mediaPath: "/nope.mp4" }))).failure_class, "invalid_request");
  assert.equal((await run(() => ({ publishAt: "garbage" }))).failure_class, "invalid_request");
  assert.equal((await run(() => ({}), "UNVERIFIED")).failure_class, "claims_gate_blocked");
  assert.equal((await run(() => ({ publishAt: "2026-10-01T00:00:00.000Z" }))).failure_class, "outside_window");
  const far = new Date(NOW.getTime() + (MAX_SCHEDULE_DAYS + 1) * 86_400_000).toISOString();
  const beyond = await run(() => ({ publishAt: far }));
  assert.equal(beyond.failure_class, "outside_window");
  assert.equal(beyond.verdict, "blocked");
  assert.equal((await run(() => ({ approvalRef: "unknown" }))).failure_class, "approval_missing");
  assert.equal((await run(() => ({ mediaSha256: "e".repeat(64) }))).failure_class, "approval_hash_mismatch");
});

test("a withdrawn approval blocks the schedule", async () => {
  const { root, req } = setup();
  recordDecision(root, { client: "acme", pieceId: "PIECE-1", mediaSha256: SHA, decision: "changes_requested", note: "mudar", decidedBy: "client:Ana" });
  const receipt = await scheduleVerified(req, { root, publisher: new DryRunPublisher(), now: NOW });
  assert.equal(receipt.failure_class, "approval_not_approved");
});

test("a failing effect is recorded as failed, not scheduled", async () => {
  const { root, req } = setup();
  const failing: Publisher = {
    id: "failing",
    capabilities: () => new DryRunPublisher().capabilities(),
    schedule: async () => ({ ok: false, failure: "captcha", detail: "captcha", evidence: { screenshot: "/x.png" } }),
    status: async () => null,
    cancel: async () => ({ ok: false }),
  };
  const receipt = await scheduleVerified(req, { root, publisher: failing, now: NOW });
  assert.equal(receipt.verdict, "failed");
  assert.equal(receipt.failure_class, "captcha");
  assert.equal(receipt.evidence?.screenshot, "/x.png");
  assert.equal(receipt.attempts, 1);
  const retry = await scheduleVerified(req, { root, publisher: new DryRunPublisher(), now: NOW });
  assert.equal(retry.verdict, "scheduled", "a failed attempt does not block a later success");
});

test("cancelScheduled keeps both records and ignores receipts that are not scheduled", async () => {
  const { root, req } = setup();
  const dry = new DryRunPublisher();
  const scheduled = await scheduleVerified(req, { root, publisher: dry, now: NOW });
  const cancelled = await cancelScheduled(root, dry, scheduled.receipt_id);
  assert.equal(cancelled.verdict, "cancelled");
  assert.equal(listReceipts(root)[0]?.verdict, "cancelled");
  assert.equal((await cancelScheduled(root, dry, scheduled.receipt_id)).verdict, "cancelled");
  await assert.rejects(cancelScheduled(root, dry, "nope"), /unknown receipt/);
  assert.deepEqual(await dry.cancel(root, "nope"), { ok: false, failure: "not_found", detail: "unknown receipt" });
  const stuck: Publisher = { ...dry, id: "stuck", capabilities: () => dry.capabilities(), schedule: dry.schedule.bind(dry), status: dry.status.bind(dry), cancel: async () => ({ ok: false, failure: "layout_changed", detail: "ui" }) };
  const again = await scheduleVerified({ ...req, publishAt: "2026-10-22T18:00:00.000Z" }, { root, publisher: dry, now: NOW });
  const failed = await cancelScheduled(root, stuck, again.receipt_id);
  assert.equal(failed.verdict, "scheduled");
  assert.equal(failed.failure_class, "layout_changed");
});

test("broker resolves the publisher: dry-run by default, explicit and known when live", () => {
  assert.equal(choosePublisher("tiktok", {}).publisher, "dry-run");
  assert.equal(choosePublisher("tiktok", { DRY_RUN: "true", PUBLISHER: "realoficial-browser" }).publisher, "dry-run");
  assert.throws(() => choosePublisher("tiktok", { DRY_RUN: "false" }), /PUBLISHER/);
  assert.throws(() => choosePublisher("tiktok", { DRY_RUN: "false", PUBLISHER: "nope" }), /PUBLISHER/);
  assert.throws(() => choosePublisher("tiktok", { DRY_RUN: "false", PUBLISHER: "dry-run" }), /PUBLISHER/);
  assert.equal(choosePublisher("instagram", { DRY_RUN: "false", PUBLISHER: "realoficial-browser" }).publisher, "realoficial-browser");
  assert.match(choosePublisher("youtube", { DRY_RUN: "false", PUBLISHER: "realoficial-api" }).rationale, /reserved/);
  assert.deepEqual(NETWORK_CHANNEL, { tiktok: "tiktok", ig_reels: "instagram", yt_shorts: "youtube" });
});

test("publisherFor injects live drivers and refuses unconfigured ones", () => {
  const prev = { dry: process.env.DRY_RUN, pub: process.env.PUBLISHER };
  try {
    process.env.DRY_RUN = "true";
    assert.equal(publisherFor("tiktok").id, "dry-run");
    process.env.DRY_RUN = "false";
    process.env.PUBLISHER = "realoficial-browser";
    assert.throws(() => publisherFor("tiktok"), /not configured/);
    const fake = new DryRunPublisher();
    assert.equal(publisherFor("tiktok", { "realoficial-browser": () => fake }), fake);
  } finally {
    if (prev.dry === undefined) delete process.env.DRY_RUN; else process.env.DRY_RUN = prev.dry;
    if (prev.pub === undefined) delete process.env.PUBLISHER; else process.env.PUBLISHER = prev.pub;
  }
});
