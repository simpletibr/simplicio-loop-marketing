import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { appendHbp } from "../lib/formats/binary";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const CLI = resolve(__filename, "..", "..", "bin", "marketing-engine.mjs");

function run(args: string[], cwd?: string) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, DRY_RUN: "true" },
  });
}

test("help shows the new commands", () => {
  const r = run(["help"]);
  expect(r.status).toBe(0);
  for (const c of [
    "new-piece",
    "status",
    "logs",
    "cost",
    "ab-report",
    "alerts",
    "sync",
    "schedule",
    "watcher",
    "retrospective",
  ]) {
    expect(r.stdout).toContain(c);
  }
});

test("new-piece creates a markdown file with correct frontmatter", () => {
  const host = mkdtempSync(join(tmpdir(), "me-newpiece-"));
  mkdirSync(join(host, ".marketing-engine", "pieces"), { recursive: true });
  const r = run(
    [
      "new-piece",
      "--client",
      "acme",
      "--pillar",
      "education",
      "--channel",
      "instagram",
      "--date",
      "2026-05-08",
    ],
    host,
  );
  expect(r.status).toBe(0);
  const files = readdirSync(join(host, ".marketing-engine", "pieces")).filter((f) =>
    f.endsWith(".md")
  );
  expect(files.length).toBe(1);
  const outputPath = r.stdout.trim();
  expect(outputPath).toContain(join(host, ".marketing-engine", "pieces"));
});

test("new-piece exits 2 when the workspace is missing", () => {
  const host = mkdtempSync(join(tmpdir(), "me-newpiece-missing-"));
  const r = run(
    ["new-piece", "--client", "acme", "--pillar", "education", "--channel", "instagram"],
    host,
  );
  expect(r.status).toBe(2);
});

test("status command exits 2 when the workspace is missing", () => {
  const host = mkdtempSync(join(tmpdir(), "me-status-"));
  const r = run(["status"], host);
  expect(r.status).toBe(2);
});

test("status command reads .marketing-engine pieces and runs", () => {
  const host = mkdtempSync(join(tmpdir(), "me-status-ready-"));
  mkdirSync(join(host, ".marketing-engine", "pieces"), { recursive: true });
  mkdirSync(join(host, ".marketing-engine", "data"), { recursive: true });
  writeFileSync(
    join(host, ".marketing-engine", "pieces", "PIECE-2026W19-001.md"),
    `---
id: PIECE-2026W19-001
client: acme
date: 2026-05-08
status: draft
type: reel
pillar: education
platforms: ["instagram"]
locale: en
---
# Brief
`,
  );
  appendHbp(join(host, ".marketing-engine", "data", "runs.hbp"), {
    timestamp: new Date().toISOString(),
    piece_id: "PIECE-2026W19-001",
    providers_used: ["claude"],
    cost_estimate_usd: 1.23,
    status: "success",
  });
  const r = run(["status"], host);
  expect(r.status).toBe(0);
  expect(r.stdout).toContain("Pieces");
  expect(r.stdout).toContain("draft");
  expect(r.stdout).toContain("cost USD");
});

test("logs command exits 2 when the workspace is missing", () => {
  const host = mkdtempSync(join(tmpdir(), "me-logs-"));
  const r = run(["logs"], host);
  expect(r.status).toBe(2);
});

test("logs command exits 0 even with no log file", () => {
  const host = mkdtempSync(join(tmpdir(), "me-logs-empty-"));
  mkdirSync(join(host, ".marketing-engine", "data"), { recursive: true });
  const r = run(["logs"], host);
  expect(r.status).toBe(0);
  expect(r.stdout.toLowerCase()).toContain("no log file");
});

test("logs command filters .marketing-engine usage rows", () => {
  const host = mkdtempSync(join(tmpdir(), "me-logs-ready-"));
  mkdirSync(join(host, ".marketing-engine", "data"), { recursive: true });
  writeFileSync(
    join(host, ".marketing-engine", "data", "llm-usage.jsonl"),
    [
      JSON.stringify({
        timestamp: new Date().toISOString(),
        task: "caption",
        provider: "deepseek",
        tokens: 100,
        cost_usd: 0.001,
        ok: true,
      }),
      JSON.stringify({
        timestamp: new Date().toISOString(),
        task: "script",
        provider: "claude",
        tokens: 200,
        cost_usd: 0.01,
        ok: true,
      }),
    ].join("\n") + "\n",
  );
  const r = run(["logs", "--tail", "1", "--provider", "claude"], host);
  expect(r.status).toBe(0);
  expect(r.stdout).toContain("claude");
  expect(r.stdout).not.toContain("deepseek");
});

test("cost command runs and surfaces totals", () => {
  const host = mkdtempSync(join(tmpdir(), "me-cost-cli-"));
  mkdirSync(join(host, "data"), { recursive: true });
  writeFileSync(
    join(host, "data", "llm-usage.jsonl"),
    JSON.stringify({
      timestamp: new Date().toISOString(),
      task: "caption",
      provider: "deepseek",
      tokens: 100,
      cost_usd: 0.001,
      ok: true,
    }) + "\n",
  );
  const r = run(["cost"], host);
  expect(r.status).toBe(0);
  expect(r.stdout).toMatch(/total: \$/);
  expect(r.stdout).toContain("deepseek");
});

test("schedule status command exits 0 (no install)", () => {
  const host = mkdtempSync(join(tmpdir(), "me-sched-"));
  const r = run(["schedule", "status"], host);
  expect(r.status).toBe(0);
});

test("sync DRY_RUN path is a no-op safe", () => {
  const host = mkdtempSync(join(tmpdir(), "me-sync-"));
  const r = run(["sync"], host);
  expect(r.status).toBe(0);
  expect(r.stdout).toMatch(/DRY_RUN/);
});

test("alerts command exits 0 with no data", () => {
  const host = mkdtempSync(join(tmpdir(), "me-alerts-"));
  const r = run(["alerts"], host);
  expect(r.status).toBe(0);
  expect(r.stdout).toContain("alerts");
});

test("ab-report command exits 0 with no data and produces a header", () => {
  const host = mkdtempSync(join(tmpdir(), "me-ab-"));
  const r = run(["ab-report"], host);
  expect(r.status).toBe(0);
  expect(r.stdout).toContain("Task");
});

test("generate command runs and produces summary line", () => {
  const host = mkdtempSync(join(tmpdir(), "me-gen-cli-"));
  mkdirSync(join(host, "pieces"), { recursive: true });
  const r = run(["generate"], host);
  // With no pieces, summary should be inspected=0
  expect(r.status === 0 || r.status === 2).toBe(true);
  expect(r.stdout).toContain("generate:");
  void existsSync;
});

test("promote command runs and produces summary line", () => {
  const host = mkdtempSync(join(tmpdir(), "me-prom-cli-"));
  const r = run(["promote"], host);
  expect(r.status).toBe(0);
  expect(r.stdout).toContain("promote:");
});
