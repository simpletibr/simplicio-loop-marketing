'use strict';

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function captureStdout(): { restore: () => string } {
  const chunks: string[] = [];
  const original = process.stdout.write;
  process.stdout.write = ((chunk: any) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  return { restore: () => { process.stdout.write = original; return chunks.join(""); } };
}

function seedAbData(root: string): void {
  const dir = join(root, "data");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "analytics.jsonl"),
    `${JSON.stringify({ piece_id: "p1", impressions: 100, saves: 10, watch_time_s: 5 })}\n`,
  );
  writeFileSync(
    join(dir, "llm-usage.jsonl"),
    `${JSON.stringify({ piece_id: "p1", task: "script", provider: "claude", cost_usd: 0.02 })}\n`,
  );
}

test("cli/ab-report: markdown format prints a table", async (t) => {
  const cwd = process.cwd();
  const root = mkdtempSync(join(tmpdir(), "me-cli-abreport-md-"));
  seedAbData(root);
  process.chdir(root);
  t.after(() => process.chdir(cwd));
  const { cliEntry } = await import("../../lib/cli/ab-report.ts");
  const cap = captureStdout();
  await cliEntry([]);
  const out = cap.restore();
  assert.match(out, /\| Task \| Provider \| N \| Save rate/);
  assert.match(out, /script/);
});

test("cli/ab-report: --format json prints the raw rows", async (t) => {
  const cwd = process.cwd();
  const root = mkdtempSync(join(tmpdir(), "me-cli-abreport-json-"));
  seedAbData(root);
  process.chdir(root);
  t.after(() => process.chdir(cwd));
  const { cliEntry } = await import("../../lib/cli/ab-report.ts");
  const cap = captureStdout();
  await cliEntry(["--format", "json"]);
  const out = cap.restore();
  const parsed = JSON.parse(out);
  assert.ok(Array.isArray(parsed));
  assert.equal(parsed[0].task, "script");
});

test("cli/alerts: reports zero failures with no data and parses window flags", async (t) => {
  const cwd = process.cwd();
  const root = mkdtempSync(join(tmpdir(), "me-cli-alerts-"));
  process.chdir(root);
  t.after(() => process.chdir(cwd));
  const { cliEntry } = await import("../../lib/cli/alerts.ts");
  const cap = captureStdout();
  await cliEntry(["--window", "2d"]);
  const out = cap.restore();
  assert.match(out, /alerts: window=48h failures=0/);
});

test("cli/alerts: surfaces high_failure_rate alerts and posts a webhook when configured", async (t) => {
  const cwd = process.cwd();
  const root = mkdtempSync(join(tmpdir(), "me-cli-alerts-webhook-"));
  const dir = join(root, "data");
  mkdirSync(dir, { recursive: true });
  const now = new Date().toISOString();
  const rows = Array.from({ length: 5 }, () => ({ timestamp: now, provider: "claude", ok: false, error: "500" }));
  writeFileSync(join(dir, "llm-usage.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  process.chdir(root);
  t.after(() => process.chdir(cwd));
  process.env.ALERT_WEBHOOK_URL = "https://example.com/hook";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: true })) as unknown as typeof fetch;
  const { cliEntry } = await import("../../lib/cli/alerts.ts");
  const cap = captureStdout();
  try {
    await cliEntry(["--window", "24"]);
    const out = cap.restore();
    assert.match(out, /ALERT \[high_failure_rate\]/);
    assert.match(out, /webhook: delivered/);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.ALERT_WEBHOOK_URL;
  }
});

test("cli/cost: prints a window summary and can write a report file", async (t) => {
  const cwd = process.cwd();
  const root = mkdtempSync(join(tmpdir(), "me-cli-cost-"));
  const dir = join(root, "data");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "llm-usage.jsonl"),
    `${JSON.stringify({ timestamp: new Date().toISOString(), provider: "claude", task: "script", cost_usd: 0.05 })}\n`,
  );
  process.chdir(root);
  t.after(() => process.chdir(cwd));
  const { cliEntry } = await import("../../lib/cli/cost.ts");
  const cap = captureStdout();
  const reportPath = join(root, "cost-report.json");
  await cliEntry(["--window", "30d", "--report", reportPath]);
  const out = cap.restore();
  assert.match(out, /window: 30d/);
  assert.match(out, /report written to/);
});

test("cli/sync: dry-run (default) skips network IO", async () => {
  delete process.env.DRY_RUN;
  const { cliEntry } = await import("../../lib/cli/sync.ts");
  const cap = captureStdout();
  try {
    await cliEntry([]);
    const out = cap.restore();
    assert.match(out, /DRY_RUN=true/);
  } finally {
    delete process.env.DRY_RUN;
  }
});
