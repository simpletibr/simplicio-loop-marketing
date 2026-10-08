import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSnapshot } from "../../lib/dashboard/snapshot.ts";
import { planContent, savePlan } from "../../lib/plan/content-plan.ts";
import { buildBrandProfile, fixtureCollection, writeBrandProfile } from "../../lib/profile/brand-profile.ts";
import { readDashboardState, statePath, writeDashboardState, clearDashboardState } from "../../lib/dashboard/state.ts";
import { viewHash } from "../../lib/cli/dashboard.ts";
import { existsSync, writeFileSync } from "node:fs";

const NOW = new Date("2026-10-07T12:00:00Z");

function host(): string {
  const root = mkdtempSync(join(tmpdir(), "me-snap-"));
  mkdirSync(join(root, ".marketing-engine", "data"), { recursive: true });
  const profile = buildBrandProfile(fixtureCollection("https://lothus.com.br"), { client: "lothus", url: "https://lothus.com.br", mode: "dry-run", now: NOW });
  writeBrandProfile(root, profile);
  savePlan(root, planContent({ client: "lothus", profile, start: "2026-10-08", days: 14, perWeek: 2, networks: ["tiktok"], now: NOW }));
  return root;
}

test("the snapshot lists the month's posts with honest status and no internal data", () => {
  const root = host();
  const { html, posts, simulated } = buildSnapshot(root, { client: "lothus", month: "2026-10", now: NOW });
  assert.equal(posts, 4);
  assert.equal(simulated, false, "nothing was scheduled yet");
  assert.match(html, /<title>Calendário 2026-10 — Lothus<\/title>/);
  assert.match(html, /planejado/);
  assert.doesNotMatch(html, /<script|cost|token|sha256|dry_run|publisher/i);
  assert.match(html, /sem dado/);
  assert.equal(buildSnapshot(root, { client: "lothus", month: "2027-01", now: NOW }).posts, 0);
  assert.throws(() => buildSnapshot(root, { client: "lothus", month: "2026-13" }), /YYYY-MM/);
  assert.throws(() => buildSnapshot(root, { client: "../x", month: "2026-10" }), /invalid client slug/);
});

test("presentation mode hides the client's name everywhere, including captions", () => {
  const root = host();
  const normal = buildSnapshot(root, { client: "lothus", month: "2026-10", now: NOW }).html;
  assert.ok(normal.includes("Lothus"));
  const masked = buildSnapshot(root, { client: "lothus", month: "2026-10", presentation: true, now: NOW }).html;
  assert.ok(!masked.includes("Lothus") && !masked.includes("lothus"));
  assert.ok(masked.includes("— Cliente"));
});

test("metrics prove publication and a missing metric is never shown as zero", () => {
  const root = host();
  const first = buildSnapshot(root, { client: "lothus", month: "2026-10", now: NOW });
  const pieceId = /PIECE-lothus-\d{8}-tiktok/.exec(first.html);
  assert.equal(pieceId, null, "piece ids are not part of the client page");
  const plan = planContent({ client: "lothus", profile: buildBrandProfile(fixtureCollection("https://lothus.com.br"), { client: "lothus", url: "https://lothus.com.br", mode: "dry-run", now: NOW }), start: "2026-10-08", days: 14, perWeek: 2, networks: ["tiktok"], now: NOW });
  const slot = plan.slots[0]!;
  appendFileSync(join(root, ".marketing-engine", "data", "analytics-snapshots.jsonl"), `${JSON.stringify({ piece_id: slot.piece_id, channel_id: "tiktok", metric: "views", value: 777, polled_at: "2026-10-09T00:00:00Z" })}\n${JSON.stringify({ piece_id: slot.piece_id, channel_id: "tiktok", metric: "views", value: 900, polled_at: "2026-10-10T00:00:00Z" })}\n`);
  const { html } = buildSnapshot(root, { client: "lothus", month: "2026-10", now: NOW });
  assert.match(html, /Visualizações: 900/, "the latest poll wins");
  assert.match(html, /publicado/);
  assert.match(html, /Salvamentos: sem dado/);
  assert.doesNotMatch(html, /Salvamentos: 0/);
});

test("the dashboard process state tracks a live pid and cleans up a dead one", () => {
  const root = mkdtempSync(join(tmpdir(), "me-state-"));
  assert.equal(readDashboardState(root), null);
  writeDashboardState(root, { pid: process.pid, port: 8787, started_at: NOW.toISOString(), token: "t" });
  assert.equal(readDashboardState(root)?.port, 8787);
  writeDashboardState(root, { pid: 2 ** 22 + 12345, port: 1, started_at: NOW.toISOString(), token: "t" });
  assert.equal(readDashboardState(root), null, "a dead pid is stale");
  assert.equal(existsSync(statePath(root)), false);
  writeFileSync(statePath(root).replace(/dashboard\.hbi$/, "dashboard.hbi"), "garbage");
  assert.equal(readDashboardState(root), null, "an unreadable file is stale");
  writeDashboardState(root, { pid: process.pid, port: 1, started_at: NOW.toISOString(), token: "t" });
  clearDashboardState(root);
  clearDashboardState(root);
  assert.equal(readDashboardState(root), null);
});

test("viewHash encodes the initial view for the UI", () => {
  assert.equal(viewHash([]), "");
  assert.equal(viewHash(["--client", "lothus", "--present"]), "#client=lothus&present=1");
  assert.equal(viewHash(["--campaign", "a b"]), "#campaign=a%20b");
});
