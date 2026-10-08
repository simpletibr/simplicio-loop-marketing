import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { RealOficialBrowserPublisher, SCHEDULE_URL, classifyScreen } from "../../lib/publish/realoficial-browser.ts";
import { FixtureBrowserDriver } from "../../lib/providers/__mocks__/realoficial-browser.ts";
import { findReceipt, scheduleVerified, type ScheduleRequest } from "../../lib/publish/publisher.ts";
import { recordPromotionApproval } from "../../lib/gate/action-gate.ts";
import { recordDecision, requestApproval } from "../../lib/approval/store.ts";
import { writeWatcherReport } from "../../lib/gate/watcher-gate.ts";

const FIXTURES = resolve("tests/fixtures/realoficial");
const SHA = "f".repeat(64);
const NOW = new Date("2026-10-07T12:00:00Z");

function setup() {
  const root = mkdtempSync(join(tmpdir(), "me-ro-browser-"));
  mkdirSync(join(root, "data"), { recursive: true });
  const media = join(root, "final.mp4");
  writeFileSync(media, "bytes");
  writeWatcherReport(root, { piece_id: "PIECE-RO", tag: "MEASURED", passed: true, checked: [], checked_at: NOW.toISOString() });
  requestApproval(root, { client: "acme", pieceId: "PIECE-RO", month: "2026-10", mediaSha256: SHA, preview: "p.mp4", captions: {} });
  const approval = recordDecision(root, { client: "acme", pieceId: "PIECE-RO", mediaSha256: SHA, decision: "approved", decidedBy: "client:Ana" });
  const req: ScheduleRequest = {
    clientSlug: "acme",
    pieceId: "PIECE-RO",
    mediaPath: media,
    mediaSha256: SHA,
    caption: "Contato: ana@example.com",
    network: "ig_reels",
    publishAt: "2026-10-20T18:00:00.000Z",
    approvalRef: approval.approval_id,
  };
  return { root, req };
}

test("classifyScreen recognises every recorded screen and falls back to unknown", () => {
  const read = (n: string) => readFileSync(join(FIXTURES, `${n}.html`), "utf8");
  assert.equal(classifyScreen(read("login")), "login");
  assert.equal(classifyScreen(read("captcha")), "captcha");
  assert.equal(classifyScreen(read("two-factor")), "two_factor");
  assert.equal(classifyScreen(read("schedule")), "schedule_form");
  assert.equal(classifyScreen(read("scheduled")), "scheduled");
  assert.equal(classifyScreen(read("cancelled")), "cancelled");
  assert.equal(classifyScreen(read("error-policy")), "error");
  assert.equal(classifyScreen(read("redesigned")), "unknown");
});

test("schedules through the recorded screens and leaves a screenshot and a redacted snapshot as evidence", async () => {
  const { root, req } = setup();
  const driver = new FixtureBrowserDriver(FIXTURES, { onOpen: ["schedule"], onSubmit: "scheduled" });
  const publisher = new RealOficialBrowserPublisher(driver, root);
  const outcome = await publisher.schedule(req);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.post_ref, "realoficial://scheduled/ro-98765");
  assert.deepEqual(driver.opened, [SCHEDULE_URL]);
  assert.deepEqual(driver.filled, [{ media: req.mediaPath, caption: req.caption, network: "ig_reels", publish_at: req.publishAt }]);
  assert.deepEqual(driver.clicks, ["submit"]);
  assert.ok(outcome.evidence?.screenshot && existsSync(outcome.evidence.screenshot));
  assert.ok(outcome.evidence?.dom_snapshot && existsSync(outcome.evidence.dom_snapshot));
  const snapshot = readFileSync(outcome.evidence.dom_snapshot as string, "utf8");
  assert.ok(snapshot.includes("Conta:") && !snapshot.includes("ana@example.com"), "the account e-mail on the page is redacted");
  assert.ok(snapshot.includes("[redacted-email]"));
});

test("each unexpected screen is classified instead of being retried blindly", async () => {
  const { root, req } = setup();
  const cases: Array<[string[], string | undefined, string]> = [
    [["login"], undefined, "login_required"],
    [["captcha"], undefined, "captcha"],
    [["two-factor"], undefined, "two_factor"],
    [["redesigned"], undefined, "layout_changed"],
    [["schedule"], "error-policy", "policy_block"],
    [["schedule"], "error-rejected", "platform_rejection"],
    [["schedule"], "scheduled-no-id", "layout_changed"],
    [["schedule"], "redesigned", "layout_changed"],
  ];
  for (const [onOpen, onSubmit, expected] of cases) {
    const driver = new FixtureBrowserDriver(FIXTURES, { onOpen, onSubmit });
    const outcome = await new RealOficialBrowserPublisher(driver, root).schedule(req);
    assert.equal(outcome.ok, false, `${onOpen}/${onSubmit}`);
    assert.equal(outcome.failure, expected, `${onOpen}/${onSubmit}`);
    assert.ok(outcome.evidence?.screenshot, "failures keep their evidence");
  }
});

test("a live run needs the human approval record and then schedules through the browser publisher", async () => {
  const { root, req } = setup();
  const prev = process.env.DRY_RUN;
  process.env.DRY_RUN = "false";
  try {
    const driver = new FixtureBrowserDriver(FIXTURES, { onOpen: ["schedule"], onSubmit: "scheduled" });
    const publisher = new RealOficialBrowserPublisher(driver, root);
    const blocked = await scheduleVerified(req, { root, publisher, now: NOW });
    assert.equal(blocked.verdict, "blocked");
    assert.equal(blocked.failure_class, "action_gate_blocked");
    assert.equal(driver.opened.length, 0, "the browser is never touched without the gate");

    recordPromotionApproval(root, { approved_by: "wesley", approved_at: NOW.toISOString(), expires_at: "2099-01-01T00:00:00.000Z", piece_id: "PIECE-RO", evidence_reviewed: ["preview"], spend_ceiling_usd: 0 });
    const receipt = await scheduleVerified(req, { root, publisher, now: NOW });
    assert.equal(receipt.verdict, "scheduled");
    assert.equal(receipt.dry_run, false);
    assert.equal(receipt.publisher, "realoficial-browser");
    assert.equal(receipt.post_ref, "realoficial://scheduled/ro-98765");
    assert.ok(receipt.evidence?.screenshot);
  } finally {
    if (prev === undefined) delete process.env.DRY_RUN; else process.env.DRY_RUN = prev;
  }
});

test("cancel and status work against the ledger and the recorded screens", async () => {
  const { root, req } = setup();
  const scheduleDriver = new FixtureBrowserDriver(FIXTURES, { onOpen: ["schedule"], onSubmit: "scheduled" });
  const scheduled = await scheduleVerified(req, { root, publisher: new RealOficialBrowserPublisher(scheduleDriver, root), now: NOW });

  const ok = new FixtureBrowserDriver(FIXTURES, { onOpen: ["scheduled"], onCancel: "cancelled" });
  const publisher = new RealOficialBrowserPublisher(ok, root);
  assert.equal((await publisher.status(root, scheduled.receipt_id))?.verdict, "scheduled");
  assert.deepEqual(await publisher.cancel(root, scheduled.receipt_id), { ok: true, detail: "cancelled in Real Oficial" });
  assert.match(ok.opened[0] as string, /\/ro-98765$/);

  const unknown = await publisher.cancel(root, "nope");
  assert.equal(unknown.failure, "not_found");

  const loggedOut = new RealOficialBrowserPublisher(new FixtureBrowserDriver(FIXTURES, { onOpen: ["login"] }), root);
  assert.equal((await loggedOut.cancel(root, scheduled.receipt_id)).failure, "login_required");

  const unconfirmed = new RealOficialBrowserPublisher(new FixtureBrowserDriver(FIXTURES, { onOpen: ["scheduled"], onCancel: "redesigned" }), root);
  const result = await unconfirmed.cancel(root, scheduled.receipt_id);
  assert.equal(result.ok, false);
  assert.equal(result.failure, "layout_changed");
  assert.equal(findReceipt(root, scheduled.receipt_id)?.verdict, "scheduled");
});
