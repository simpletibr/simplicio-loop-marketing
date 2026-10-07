import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { listPlanIds, loadPlan } from "../lib/plan/content-plan";
import { mediaOf, planStatus } from "../lib/plan/batch";
import { recordDecision } from "../lib/approval/store";
import { listReceipts } from "../lib/publish/publisher";
import { loadSchemaRegistry } from "../lib/contracts/registry";
import { validateArtifact } from "../lib/contracts/validate";

const CLI = resolve("bin/marketing-engine.mjs");
const START = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

function run(root: string, args: string[]) {
  const r = spawnSync(process.execPath, [CLI, ...args, "--root", root], { encoding: "utf8", env: { ...process.env, DRY_RUN: "true" }, maxBuffer: 16 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function host(): string {
  const root = mkdtempSync(join(tmpdir(), "me-campaign-e2e-"));
  mkdirSync(join(root, ".marketing-engine", "pieces"), { recursive: true });
  mkdirSync(join(root, ".marketing-engine", "data"), { recursive: true });
  expect(run(root, ["profile", "https://lothus.com.br", "--client", "lothus"]).status).toBe(0);
  return root;
}

test("campaign --days 30 plans, renders in batch, collects approvals and schedules dry-run receipts without duplicates", async () => {
  test.setTimeout(120_000);
  const root = host();
  const planned = run(root, ["campaign", "--client", "lothus", "--days", "30", "--start", START, "--per-week", "1"]);
  expect(planned.status, planned.stderr).toBe(0);
  const summary = JSON.parse(planned.stdout);
  expect(summary.plan_id).toBe(`lothus-${START}-30d`);
  expect(summary.slots).toBeGreaterThanOrEqual(12);
  expect(summary.status.planned + (summary.status.queued_next_cycle ?? 0)).toBe(summary.slots);

  const plan = loadPlan(root, "lothus");
  expect(validateArtifact(plan, loadSchemaRegistry()).errors).toEqual([]);
  expect(listPlanIds(root, "lothus")).toEqual([plan.plan_id]);
  // planning twice is a no-op in effect: same plan id, same slots
  const again = JSON.parse(run(root, ["campaign", "--client", "lothus", "--days", "30", "--start", START, "--per-week", "1"]).stdout);
  expect(again.slots).toBe(summary.slots);

  const inWindow = plan.slots.filter((s) => s.window === "in_window");
  const rendered = JSON.parse(run(root, ["campaign", "render", "--client", "lothus"]).stdout);
  expect(rendered.rendered).toBe(inWindow.length);
  const resumed = JSON.parse(run(root, ["campaign", "render", "--client", "lothus"]).stdout);
  expect(resumed.rendered).toBe(0);
  expect(resumed.already_rendered).toBe(inWindow.length);

  expect(JSON.parse(run(root, ["campaign", "approvals", "--client", "lothus"]).stdout).requested).toBe(inWindow.length);
  for (const slot of inWindow) {
    const media = mediaOf(root, plan, slot)!;
    recordDecision(root, { client: "lothus", pieceId: slot.piece_id, mediaSha256: media.sha256, decision: "approved", decidedBy: "client:Ana" });
  }

  const scheduled = JSON.parse(run(root, ["campaign", "schedule", "--client", "lothus"]).stdout);
  expect(scheduled.scheduled).toBe(inWindow.length);
  expect(scheduled.receipts.every((r: { verdict: string }) => r.verdict === "scheduled")).toBe(true);
  const receipts = listReceipts(root, { client: "lothus" });
  expect(receipts).toHaveLength(inWindow.length);
  expect(receipts.every((r) => r.dry_run && r.publisher === "dry-run" && validateArtifact(r, loadSchemaRegistry()).errors.length === 0)).toBe(true);

  const rerun = JSON.parse(run(root, ["campaign", "schedule", "--client", "lothus"]).stdout);
  expect(rerun.scheduled).toBe(0);
  expect(rerun.already_scheduled).toBe(inWindow.length);
  expect(listReceipts(root, { client: "lothus" })).toHaveLength(inWindow.length);
  expect(planStatus(root, plan).filter((v) => v.status === "scheduled")).toHaveLength(inWindow.length);

  const table = run(root, ["calendar", "--client", "lothus"]);
  expect(table.status).toBe(0);
  expect(table.stdout).toContain("scheduled");
  const md = run(root, ["calendar", "--client", "lothus", "--format", "markdown"]);
  expect(md.stdout).toMatch(/^# Calendário lothus/);
  expect(md.stdout).toContain("| scheduled |");
});

test("posts beyond the 30 day window are never rendered or scheduled", () => {
  const root = host();
  const planned = JSON.parse(run(root, ["campaign", "--client", "lothus", "--days", "50", "--start", START, "--per-week", "1", "--networks", "tiktok"]).stdout);
  expect(planned.next_cycle).toBeGreaterThan(0);
  const plan = loadPlan(root, "lothus");
  const rendered = JSON.parse(run(root, ["campaign", "render", "--client", "lothus"]).stdout);
  expect(rendered.skipped_next_cycle).toBe(planned.next_cycle);
  expect(rendered.rendered).toBe(planned.in_window);
  expect(planStatus(root, plan).filter((v) => v.status === "queued_next_cycle")).toHaveLength(planned.next_cycle);
  const table = run(root, ["calendar", "--client", "lothus", "--format", "markdown"]).stdout;
  expect(table).toContain("fila do próximo ciclo");
});

test("campaign and calendar reject bad input", () => {
  const root = host();
  const noProfile = run(root, ["campaign", "--client", "ghost", "--days", "30"]);
  expect(noProfile.status).toBe(1);
  expect(noProfile.stderr).toContain("no brand profile");
  const badDays = run(root, ["campaign", "--client", "lothus", "--days", "400"]);
  expect(badDays.status).toBe(1);
  expect(badDays.stderr).toContain("days must be");
  const badNet = run(root, ["campaign", "--client", "lothus", "--days", "7", "--networks", "myspace"]);
  expect(badNet.status).toBe(1);
  const noPlan = run(root, ["calendar", "--client", "lothus"]);
  expect(noPlan.status).toBe(1);
  expect(noPlan.stderr).toContain("no plan for");
  expect(run(root, ["calendar"]).status).toBe(2);
  run(root, ["campaign", "--client", "lothus", "--days", "7", "--start", START]);
  expect(run(root, ["calendar", "--client", "lothus", "--format", "csv"]).status).toBe(1);
  const badMix = run(root, ["campaign", "--client", "lothus", "--days", "7", "--mix", "nonsense=1"]);
  expect(badMix.status).toBe(1);
  expect(run(root, ["campaign", "--client", "lothus", "--days", "7", "--start", "next-month", "--tz", "Asia/Singapore"]).status).toBe(0);
});
