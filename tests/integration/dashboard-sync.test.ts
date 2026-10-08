import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { EventStore, eventsLogPath } from "../../lib/dashboard/store.ts";
import { syncDashboard } from "../../lib/observability/dashboard/index.ts";
import { emitEvent } from "../../lib/observability/events.ts";
import { recordAttempt } from "../../lib/loop/journal.ts";
import { writeTuple } from "../../lib/yool/board.ts";
import { appendSnapshot } from "../../lib/analytics/score.ts";
import { recordDecision, requestApproval } from "../../lib/approval/store.ts";
import { DryRunPublisher, scheduleVerified } from "../../lib/publish/publisher.ts";
import { writeWatcherReport } from "../../lib/gate/watcher-gate.ts";
import { writeHbiAtomic } from "../../lib/formats/binary.ts";

const FIXTURES = resolve("tests/fixtures/dashboard");
const NOW = new Date("2026-10-07T12:00:00Z");

function host(): { root: string; data: string } {
  const root = mkdtempSync(join(tmpdir(), "me-dash-sync-"));
  const data = join(root, ".marketing-engine", "data");
  mkdirSync(data, { recursive: true });
  cpSync(join(FIXTURES, "prospects"), join(data, "prospects"), { recursive: true });
  cpSync(join(FIXTURES, "stripe-webhooks.jsonl"), join(data, "stripe-webhooks.jsonl"));
  cpSync(join(FIXTURES, "controle-prospects.csv"), join(data, "controle-prospects.csv"));
  return { root, data };
}

function kinds(store: EventStore): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of store.all()) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
  return counts;
}

test("a pilot prospect and a paid video produce the expected sequence of events (contract test)", () => {
  const { root } = host();
  const store = new EventStore(root);
  syncDashboard(root, store);
  const lothus = store.query({ client: "lothus-pilot" });
  const order = lothus.filter((e) => e.source === "simplicio-videos").map((e) => `${e.kind.replace("marketing.", "")}${e.data.stage ? `:${e.data.stage}` : ""}`);
  assert.deepEqual(order, ["prospect_collected", "render_finished:preview", "qa_result", "voice_rendered", "render_finished:final", "payment_received"]);
  const voice = lothus.find((e) => e.kind === "marketing.voice_rendered");
  assert.deepEqual([voice?.data.provider, voice?.data.seconds, voice?.data.cost_usd, voice?.data.cache_hit], ["gemini-tts", 28, 0.012, false]);
  const qa = store.query({ client: "wjr-pilot", kinds: ["marketing.qa_result"] })[0];
  assert.equal(qa?.severity, "warn");
  assert.equal(qa?.data.passed, false);
  const payment = lothus.find((e) => e.kind === "marketing.payment_received");
  assert.deepEqual([payment?.data.amount, payment?.data.currency, payment?.data.processor, payment?.data.amount_brl], [197, "BRL", "abacatepay", 197]);
  const wjr = store.query({ client: "wjr-pilot" }).filter((e) => e.source === "stripe-webhook").map((e) => e.kind.replace("marketing.", ""));
  assert.deepEqual(wjr, ["payment_received", "subscription_changed", "payment_received", "subscription_changed"]);
  assert.equal(store.query({ client: "wjr-pilot", kinds: ["marketing.subscription_changed"] }).at(-1)?.data.status, "canceled");
});

test("contact data in the sources never reaches the stream", () => {
  const { root } = host();
  const store = new EventStore(root);
  syncDashboard(root, store);
  const dump = JSON.stringify(store.all());
  for (const secret of ["91234-5678", "contato@lothus.example", "Nome Privado"]) assert.ok(!dump.includes(secret), secret);
});

test("syncing again adds nothing; a rebuilt log has the same ids", () => {
  const { root } = host();
  const store = new EventStore(root);
  const first = syncDashboard(root, store);
  assert.ok(first.added > 10);
  assert.equal(syncDashboard(root, store).added, 0);
  assert.equal(syncDashboard(root, new EventStore(root)).added, 0, "a new process sees the same state");

  const ids = store.all().map((e) => e.event_id).sort();
  unlinkSync(eventsLogPath(root));
  unlinkSync(join(root, ".marketing-engine", "data", "dashboard-cursors.hbi"));
  const rebuilt = new EventStore(root);
  syncDashboard(root, rebuilt);
  assert.deepEqual(rebuilt.all().map((e) => e.event_id).sort(), ids);
});

test("only new lines of a tailed log become new events", () => {
  const { root, data } = host();
  const store = new EventStore(root);
  syncDashboard(root, store);
  const before = store.size;
  appendFileSync(join(data, "stripe-webhooks.jsonl"), `${JSON.stringify({ id: "evt_new", type: "invoice.paid", created: 1790001000, data: { object: { amount_paid: 100, currency: "usd", subscription_details: { metadata: { client: "wjr-pilot" } } } } })}\n`);
  assert.equal(syncDashboard(root, store).added, 1);
  assert.equal(store.size, before + 1);
  appendFileSync(join(data, "credits.jsonl"), `${JSON.stringify({ ts: NOW.toISOString(), client: "wjr-pilot", provider: "realoficial", credits: 12, purpose: "clips", approved_by: "wesley" })}\n${JSON.stringify({ ts: NOW.toISOString(), provider: "realoficial", credits: 5, purpose: "dub" })}\n`);
  const credits = syncDashboard(root, store);
  assert.equal(credits.added, 1);
  assert.equal(credits.rejected_credit_rows, 1);
});

test("the repo's own producers feed the stream, each occurrence from exactly one source", async () => {
  const { root } = host();
  process.env.DRY_RUN = "true";
  const eRoot = join(root, ".marketing-engine");
  emitEvent(root, { kind: "piece_start", piece_id: "P1", client: "acme", phase: "generate" });
  emitEvent(root, { kind: "gate_pass", piece_id: "P1", client: "acme", phase: "watcher-gate", verdict: "MEASURED" });
  emitEvent(root, { kind: "manifest_written", piece_id: "P1", client: "acme", phase: "generate" });
  emitEvent(root, { kind: "loop_start" });
  recordAttempt(root, { item_id: "P1", client: "acme", attempt: 1, action: "generate", gate: "pass", stage: "copy" });
  recordAttempt(root, { item_id: "P1", client: "acme", attempt: 1, action: "generate", gate: "fail", failure_text: "boom", stage: "copy" });
  recordAttempt(root, { item_id: "P1", client: "acme", attempt: 1, action: "generate", gate: "pass", stage: "creative" });
  writeTuple(eRoot, { id: "human.approval_required:P1", class: "human.approval_required", status: "pending" });
  writeTuple(eRoot, { id: "winner.promote:P1", class: "winner.promote", status: "done" });
  writeTuple(eRoot, { id: "winner.promote:P2", class: "winner.promote", status: "pending" });
  writeTuple(eRoot, { id: "piece.plan:P1", class: "piece.plan", status: "done" });
  appendSnapshot(root, { piece_id: "P1", channel_id: "tiktok", metric: "views", value: 1200, polled_at: NOW.toISOString() });

  // per-piece artifacts, as the generate pipeline writes them
  const pieceDir = join(eRoot, "outputs", "acme", "2026-10-07", "P1");
  mkdirSync(pieceDir, { recursive: true });
  writeFileSync(join(pieceDir, "compliance.json"), JSON.stringify({ pass: false, violations: [{ rule_id: "r1" }] }));
  writeFileSync(join(pieceDir, "qa-tech-specs.json"), JSON.stringify({ pass: true }));
  writeWatcherReport(eRoot, { piece_id: "P1", tag: "MEASURED", passed: true, checked: [], checked_at: NOW.toISOString() });
  writeHbiAtomic(join(pieceDir, "manifest.hbi"), { generated_at: NOW.toISOString(), render_sha256: "e".repeat(64), cost_estimate_usd: 0.4, watcher_report_path: join(eRoot, "data", "gate", "P1.json") });

  const sha = "c".repeat(64);
  requestApproval(root, { client: "acme", pieceId: "P1", month: "2026-10", mediaSha256: sha, preview: "p.mp4", captions: {} });
  const approval = recordDecision(root, { client: "acme", pieceId: "P1", mediaSha256: sha, decision: "approved", decidedBy: "client:Ana" });
  recordDecision(root, { client: "acme", pieceId: "P1", mediaSha256: sha, decision: "changes_requested", note: "ajustar", decidedBy: "wesley" });
  writeFileSync(join(eRoot, "media.mp4"), "bytes");
  const send = (network: "tiktok" | "ig_reels", approvalRef: string) =>
    scheduleVerified(
      { clientSlug: "acme", pieceId: "P1", mediaPath: join(eRoot, "media.mp4"), mediaSha256: sha, caption: "c", network, publishAt: "2026-10-20T18:00:00.000Z", approvalRef },
      { root, publisher: new DryRunPublisher(), now: NOW },
    );
  // the later change request withdrew the approval, so both attempts are blocked; use a fresh approval for one
  recordDecision(root, { client: "acme", pieceId: "P1", mediaSha256: sha, decision: "approved", decidedBy: "client:Ana", now: new Date(Date.now() + 1000) });
  const fresh = (await import("../../lib/approval/store.ts")).findApproval(root, "P1", sha)!;
  assert.notEqual(fresh.approval_id, approval.approval_id);
  await send("tiktok", fresh.approval_id);
  await send("ig_reels", "unknown");

  const store = new EventStore(root);
  syncDashboard(root, store);
  const piece = store.query({ piece_id: "P1" });
  const by = (source: string) => piece.filter((e) => e.source === source).map((e) => e.kind.replace("marketing.", "")).sort();
  assert.deepEqual(by("marketing-event/v1"), ["render_started"], "gate, manifest and loop events are owned by the artifacts");
  assert.deepEqual(by("marketing-loop-state/v1"), ["script_ready"], "only a passing copy attempt");
  assert.deepEqual(by("yool-board"), ["approval_requested", "winner_marked"]);
  assert.deepEqual(by("marketing-manifest/v1"), ["compliance_result", "qa_result", "render_finished", "watcher_gate"]);
  assert.equal(piece.find((e) => e.kind === "marketing.compliance_result")?.severity, "warn");
  assert.equal(piece.find((e) => e.kind === "marketing.render_finished" && e.source === "marketing-manifest/v1")?.data.sha256, "e".repeat(64));
  assert.deepEqual(by("approval/v1"), ["approval_decided", "approval_decided", "approval_decided", "approval_requested"]);
  const roles = piece.filter((e) => e.source === "approval/v1" && e.kind === "marketing.approval_decided").map((e) => e.data.decided_by_role).sort();
  assert.deepEqual(roles, ["client", "client", "operator"]);
  assert.deepEqual(by("marketing-publish-receipt/v1"), ["publish_failed", "scheduled"]);
  assert.equal(piece.find((e) => e.kind === "marketing.publish_failed")?.data.failure_class, "approval_missing");
  assert.deepEqual(by("analytics-snapshots"), ["metrics_snapshot"]);
  assert.equal(store.query({ kinds: ["marketing.winner_marked"] }).length, 1, "only a done winner tuple counts");
  const counts = kinds(store);
  assert.equal(counts["marketing.scheduled"], 1, "one occurrence, one event");
  assert.ok(existsSync(eventsLogPath(root)) && readFileSync(eventsLogPath(root)).length > 0);
});
