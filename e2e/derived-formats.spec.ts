import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadPlan } from "../lib/plan/content-plan";
import { listClipsReceipts } from "../lib/clips/realoficial-clips";

const CLI = resolve("bin/marketing-engine.mjs");
const START = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const VIDEO = "https://www.youtube.com/watch?v=live123";

function run(root: string, args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args, "--root", root], { encoding: "utf8", env: { ...process.env, DRY_RUN: "true", ...env }, maxBuffer: 16 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function host(): string {
  const root = mkdtempSync(join(tmpdir(), "me-formats-e2e-"));
  mkdirSync(join(root, ".marketing-engine", "pieces"), { recursive: true });
  mkdirSync(join(root, ".marketing-engine", "data"), { recursive: true });
  expect(run(root, ["profile", "https://lothus.com.br", "--client", "lothus"]).status).toBe(0);
  return root;
}

test("a plan with long cuts resolves each format to its lane, and the cuts run in DRY_RUN without spending", async () => {
  const root = host();
  const planned = run(root, ["campaign", "--client", "lothus", "--days", "30", "--start", START, "--per-week", "3", "--mix", "hero=4,cutdown=6,hook_variant=4,slideshow=3,carousel=3,long_cut=4"]);
  expect(planned.status, planned.stderr).toBe(0);
  const plan = loadPlan(root, "lothus");
  const lanes = new Map(plan.slots.map((s) => [s.format, s.route.lane]));
  expect(Object.fromEntries(lanes)).toMatchObject({ hero: "video-factory", cutdown: "video-factory", hook_variant: "video-factory", slideshow: "video-factory", carousel: "local-composition", long_cut: "realoficial-clips" });
  expect(plan.slots.filter((s) => s.route.spends_credits).every((s) => s.format === "long_cut")).toBe(true);

  const estimate = run(root, ["clips", "--client", "lothus", "--url", VIDEO, "--estimate"]);
  expect(estimate.status, estimate.stderr).toBe(0);
  expect(JSON.parse(estimate.stdout).credits).toBeGreaterThan(0);

  const cut = run(root, ["clips", "--client", "lothus", "--url", VIDEO]);
  expect(cut.status, cut.stderr).toBe(0);
  const receipt = JSON.parse(cut.stdout);
  expect(receipt).toMatchObject({ verdict: "created", dry_run: true, credits_spent: 0 });
  expect(receipt.clips.length).toBeGreaterThan(0);
  expect(JSON.stringify(receipt)).not.toContain("live123");
  expect(existsSync(join(root, ".marketing-engine", "data", "credits.jsonl"))).toBe(false);
  expect(listClipsReceipts(root, "lothus")).toHaveLength(1);
});

test("the live mode is blocked without the owner's OK and never spends from the CLI", async () => {
  const root = host();
  expect(run(root, ["campaign", "--client", "lothus", "--days", "30", "--start", START, "--per-week", "3", "--mix", "hero=1,long_cut=1"]).status).toBe(0);

  const blocked = run(root, ["clips", "--client", "lothus", "--url", VIDEO], { DRY_RUN: "false" });
  expect(blocked.status).toBe(1);
  expect(JSON.parse(blocked.stdout)).toMatchObject({ verdict: "blocked", failure_class: "approval_missing", credits_spent: 0 });

  const approved = run(root, ["clips", "--client", "lothus", "--url", VIDEO, "--approved-by-wesley"], { DRY_RUN: "false" });
  expect(approved.status).toBe(1);
  expect(JSON.parse(approved.stdout)).toMatchObject({ verdict: "failed", failure_class: "driver_unavailable", credits_spent: 0 });
  expect(existsSync(join(root, ".marketing-engine", "data", "credits.jsonl"))).toBe(false);

  const liveEstimate = run(root, ["clips", "--client", "lothus", "--url", VIDEO, "--estimate"], { DRY_RUN: "false" });
  expect(liveEstimate.status).not.toBe(0);
  expect(run(root, ["clips", "--client", "lothus"]).status).toBe(2);
});

test("cost --by-format reports the credits and voice spend of each format", async () => {
  const root = host();
  expect(run(root, ["campaign", "--client", "lothus", "--days", "30", "--start", START, "--per-week", "3", "--mix", "hero=1,long_cut=1"]).status).toBe(0);
  const plan = loadPlan(root, "lothus");
  const longCut = plan.slots.find((s) => s.format === "long_cut" && s.window === "in_window")!;
  const row = { ts: new Date().toISOString(), client: "lothus", piece_id: longCut.piece_id, provider: "realoficial", credits: 18, purpose: "cortes", approved_by: "wesley", format: "long_cut" };
  const { appendFileSync } = await import("node:fs");
  appendFileSync(join(root, ".marketing-engine", "data", "credits.jsonl"), `${JSON.stringify(row)}\n`);
  const cost = run(root, ["cost", "--by-format", "--client", "lothus"]);
  expect(cost.status, cost.stderr).toBe(0);
  const rows = JSON.parse(cost.stdout) as Array<{ format: string; credits: number; pieces: number }>;
  expect(rows.find((r) => r.format === "long_cut")).toMatchObject({ credits: 18, pieces: 1 });
  expect(readFileSync(join(root, ".marketing-engine", "data", "credits.jsonl"), "utf8")).toContain("wesley");
});
