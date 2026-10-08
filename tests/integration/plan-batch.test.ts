import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_RENDER_ATTEMPTS, ensurePieceFile, mediaOf, planStatus, renderBatch, requestApprovals, scheduleApproved } from "../../lib/plan/batch.ts";
import { planContent, type ContentPlan } from "../../lib/plan/content-plan.ts";
import { buildBrandProfile, fixtureCollection } from "../../lib/profile/brand-profile.ts";
import { recordDecision, listRequests, findApproval } from "../../lib/approval/store.ts";
import { DryRunPublisher, cancelScheduled, listReceipts, type Network, type Publisher } from "../../lib/publish/publisher.ts";

process.env.DRY_RUN = "true";

const NOW = new Date();
const START = new Date(NOW.getTime() + 86_400_000).toISOString().slice(0, 10);
const profile = buildBrandProfile(fixtureCollection("https://lothus.com.br"), { client: "lothus", url: "https://lothus.com.br", mode: "dry-run" });

function host(): string {
  const root = mkdtempSync(join(tmpdir(), "me-plan-batch-"));
  mkdirSync(join(root, ".marketing-engine", "pieces"), { recursive: true });
  mkdirSync(join(root, ".marketing-engine", "data"), { recursive: true });
  return root;
}

function smallPlan(over: Partial<Parameters<typeof planContent>[0]> = {}): ContentPlan {
  return planContent({ client: "lothus", profile, start: START, days: 7, perWeek: 1, networks: ["tiktok", "ig_reels"], mix: { hero: 1 }, now: NOW, ...over });
}

class CountingPublisher extends DryRunPublisher {
  calls: string[] = [];
  override async schedule(req: Parameters<DryRunPublisher["schedule"]>[0]) {
    this.calls.push(`${req.pieceId}:${req.network}`);
    return super.schedule(req);
  }
}

test("renderBatch renders once, resumes after a failure and gives up after the attempt limit", async () => {
  const root = host();
  const plan = smallPlan();
  assert.equal(plan.slots.length, 2);
  const failing = plan.slots[0]!.piece_id;
  let attempts = 0;
  const stub = async (slot: { piece_id: string }) => {
    if (slot.piece_id === failing) {
      attempts++;
      throw new Error("voice quota");
    }
  };
  // The second slot renders for real below; here only the failing one is stubbed.
  const first = await renderBatch({ root, plan, render: async (slot) => (slot.piece_id === failing ? stub(slot) : undefined) });
  assert.equal(first.failed + first.rendered, 2);
  assert.equal(attempts, 1);

  // A render that finishes without a manifest is a failure, not a success.
  assert.equal(planStatus(root, plan)[0]?.status, "render_failed");

  for (let i = 1; i < MAX_RENDER_ATTEMPTS; i++) await renderBatch({ root, plan, render: stub });
  const again = await renderBatch({ root, plan, render: stub });
  assert.equal(attempts, MAX_RENDER_ATTEMPTS, "no further attempts after the limit");
  assert.ok(again.failed >= 1);
});

test("a real render writes the manifest, resumes without re-rendering and plans media for approval", async () => {
  const root = host();
  const plan = smallPlan({ networks: ["tiktok"] });
  const slot = plan.slots[0]!;
  const first = await renderBatch({ root, plan });
  assert.equal(first.rendered, 1);
  const media = mediaOf(root, plan, slot);
  assert.ok(media && existsSync(media.path) && /^[a-f0-9]{64}$/.test(media.sha256));
  assert.equal(planStatus(root, plan)[0]?.status, "rendered");

  const second = await renderBatch({ root, plan, render: async () => assert.fail("rendered pieces are never rendered again") });
  assert.deepEqual(second, { rendered: 0, already_rendered: 1, failed: 0, skipped_next_cycle: 0, skipped_other_lane: 0 });

  assert.equal(requestApprovals(root, plan), 1);
  assert.equal(requestApprovals(root, plan), 0, "requests are idempotent");
  assert.equal(planStatus(root, plan)[0]?.status, "awaiting_approval");
  assert.equal(listRequests(root, { client: "lothus", month: plan.start.slice(0, 7) }).length, 1);
});

test("ensurePieceFile creates the piece once and routes factory slots to the video factory", () => {
  const root = host();
  const plan = smallPlan({ networks: ["yt_shorts"] });
  const path = ensurePieceFile(root, plan, plan.slots[0]!);
  const text = readFileSync(path, "utf8");
  assert.match(text, /provider_override:/);
  assert.match(text, /yt_shorts/);
  assert.equal(ensurePieceFile(root, plan, plan.slots[0]!), path);
  assert.equal(readFileSync(path, "utf8"), text, "an existing piece file is untouched");
  const carousel = smallPlan({ networks: ["tiktok"], mix: { carousel: 1 } });
  const cpath = ensurePieceFile(root, carousel, carousel.slots[0]!);
  assert.doesNotMatch(readFileSync(cpath, "utf8"), /provider_override/);
});

test("scheduleApproved sends only approved in-window pieces, once, and never the next cycle", async () => {
  const root = host();
  const plan = smallPlan({ days: 45, perWeek: 1, networks: ["tiktok"] });
  const inWindow = plan.slots.filter((s) => s.window === "in_window");
  const later = plan.slots.filter((s) => s.window === "next_cycle");
  assert.ok(inWindow.length > 0 && later.length > 0);

  await renderBatch({ root, plan });
  const rendered = planStatus(root, plan);
  assert.ok(rendered.filter((v) => v.status === "queued_next_cycle").length === later.length);
  assert.equal(requestApprovals(root, plan), inWindow.length);

  const publisher = new CountingPublisher();
  const pf = (_n: Network): Publisher => publisher;
  const before = await scheduleApproved({ root, plan, publisherFor: pf, now: NOW });
  assert.equal(before.awaiting_approval, inWindow.length);
  assert.equal(before.scheduled, 0);
  assert.equal(publisher.calls.length, 0);

  // approve all but the first
  for (const slot of inWindow.slice(1)) {
    const media = mediaOf(root, plan, slot)!;
    recordDecision(root, { client: "lothus", pieceId: slot.piece_id, mediaSha256: media.sha256, decision: "approved", decidedBy: "client:Ana" });
  }
  const run1 = await scheduleApproved({ root, plan, publisherFor: pf, now: NOW });
  assert.equal(run1.scheduled, inWindow.length - 1);
  assert.equal(run1.awaiting_approval, 1);
  assert.equal(run1.skipped_next_cycle, later.length);
  assert.equal(publisher.calls.length, inWindow.length - 1);

  const run2 = await scheduleApproved({ root, plan, publisherFor: pf, now: NOW });
  assert.equal(run2.scheduled, 0);
  assert.equal(run2.already_scheduled, inWindow.length - 1);
  assert.equal(publisher.calls.length, inWindow.length - 1, "re-running never schedules twice");
  assert.equal(listReceipts(root, { client: "lothus" }).length, inWindow.length - 1);
  assert.ok(publisher.calls.every((c) => !later.some((s) => c.startsWith(s.piece_id))), "next-cycle pieces never reach a publisher");

  const views = planStatus(root, plan);
  assert.equal(views.filter((v) => v.status === "scheduled").length, inWindow.length - 1);
  assert.equal(views.filter((v) => v.status === "awaiting_approval").length, 1);
});

test("status follows approvals, change requests, cancellations and slots not rendered yet", async () => {
  const root = host();
  const plan = smallPlan({ networks: ["tiktok"], days: 14, perWeek: 2 });
  assert.ok(plan.slots.length >= 2);
  assert.ok(planStatus(root, plan).every((v) => v.status === "planned"));
  const [a, b] = [plan.slots[0]!, plan.slots[1]!];
  await renderBatch({ root, plan });
  requestApprovals(root, plan);
  const ma = mediaOf(root, plan, a)!;
  const mb = mediaOf(root, plan, b)!;
  recordDecision(root, { client: "lothus", pieceId: a.piece_id, mediaSha256: ma.sha256, decision: "approved", decidedBy: "client:Ana" });
  recordDecision(root, { client: "lothus", pieceId: b.piece_id, mediaSha256: mb.sha256, decision: "changes_requested", note: "mais curto", decidedBy: "client:Ana" });
  const byPiece = new Map(planStatus(root, plan).map((v) => [v.slot.piece_id, v.status]));
  assert.equal(byPiece.get(a.piece_id), "approved");
  assert.equal(byPiece.get(b.piece_id), "changes_requested");
  assert.equal(findApproval(root, b.piece_id, mb.sha256), null);

  const publisher = new CountingPublisher();
  const summary = await scheduleApproved({ root, plan, publisherFor: () => publisher, now: NOW });
  assert.equal(summary.scheduled, 1);
  assert.equal(summary.awaiting_approval, plan.slots.length - 1);
  const receipt = summary.receipts[0]!;
  await cancelScheduled(root, publisher, receipt.receipt_id);
  assert.equal(planStatus(root, plan).find((v) => v.slot.piece_id === a.piece_id)?.status, "cancelled");
});

test("a window-blocked or unapproved slot is reported as blocked, not silently dropped", async () => {
  const root = host();
  const plan = smallPlan({ networks: ["tiktok"] });
  await renderBatch({ root, plan });
  requestApprovals(root, plan);
  const slot = plan.slots[0]!;
  recordDecision(root, { client: "lothus", pieceId: slot.piece_id, mediaSha256: mediaOf(root, plan, slot)!.sha256, decision: "approved", decidedBy: "client:Ana" });
  // "now" is after the planned time: the publisher gate refuses it.
  const late = await scheduleApproved({ root, plan, publisherFor: () => new DryRunPublisher(), now: new Date(Date.parse(slot.publish_at) + 3_600_000) });
  assert.equal(late.blocked, 1);
  assert.equal(late.receipts[0]?.failure_class, "outside_window");
  assert.equal(planStatus(root, plan)[0]?.status, "approved", "a blocked receipt leaves the slot approved");
});
