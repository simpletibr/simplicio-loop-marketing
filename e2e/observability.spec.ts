import { test, expect } from "@playwright/test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { appendHbp } from "../lib/formats/binary";
import { join } from "node:path";
import {
  filterWindow,
  readUsage,
  renderHtml,
  summarize,
  writeReport,
} from "../lib/observability/cost";
import { buildReport } from "../lib/observability/ab-report";
import { collectFailures, detectAlerts } from "../lib/observability/failures";

function writeUsage(host: string, lines: object[]): void {
  mkdirSync(join(host, "data"), { recursive: true });
  writeFileSync(
    join(host, "data", "llm-usage.jsonl"),
    lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
  );
}

test("cost summarize aggregates totals and per-provider", () => {
  const host = mkdtempSync(join(tmpdir(), "me-cost-"));
  const now = new Date().toISOString();
  writeUsage(host, [
    { timestamp: now, task: "caption", provider: "deepseek", tokens: 100, cost_usd: 0.001, ok: true, latency_ms: 100 },
    { timestamp: now, task: "script", provider: "claude", tokens: 500, cost_usd: 0.015, ok: true, latency_ms: 400 },
    { timestamp: now, task: "caption", provider: "deepseek", tokens: 200, cost_usd: 0.002, ok: true, latency_ms: 120 },
  ]);
  const rows = readUsage(join(host, "data", "llm-usage.jsonl"));
  const filtered = filterWindow(rows, 7);
  expect(filtered).toHaveLength(3);
  const summary = summarize(filtered);
  expect(summary.total_calls).toBe(3);
  expect(summary.total_cost_usd).toBeCloseTo(0.018, 5);
  expect(summary.by_provider.deepseek?.calls).toBe(2);
  expect(summary.by_provider.claude?.calls).toBe(1);
});

test("cost writeReport produces valid HTML", () => {
  const host = mkdtempSync(join(tmpdir(), "me-cost-html-"));
  writeUsage(host, [
    {
      timestamp: new Date().toISOString(),
      task: "caption",
      provider: "deepseek",
      tokens: 100,
      cost_usd: 0.001,
      ok: true,
    },
  ]);
  const rows = readUsage(join(host, "data", "llm-usage.jsonl"));
  const summary = summarize(rows);
  const html = renderHtml(summary, "Test");
  expect(html).toContain("<!doctype html>");
  expect(html).toContain("deepseek");
  const out = join(host, "report.html");
  writeReport(out, summary, "Test");
  expect(existsSync(out)).toBe(true);
  expect(readFileSync(out, "utf8")).toContain("Test");
});

test("buildReport joins runs and analytics", () => {
  const host = mkdtempSync(join(tmpdir(), "me-ab-"));
  mkdirSync(join(host, "data"), { recursive: true });
  appendHbp(join(host, "data", "runs.hbp"), {
    timestamp: new Date().toISOString(),
    piece_id: "p1",
    providers_used: ["claude"],
    cost_estimate_usd: 0.02,
    status: "success",
  });
  writeFileSync(
    join(host, "data", "analytics.jsonl"),
    JSON.stringify({
      piece_id: "p1",
      impressions: 1000,
      saves: 50,
      watch_time_s: 1200,
      captured_at: new Date().toISOString(),
    }) + "\n",
  );
  const rows = buildReport(host);
  expect(rows.length).toBeGreaterThanOrEqual(1);
  expect(rows[0].provider).toBe("claude");
  expect(rows[0].low_sample).toBe(true);
});

test("collectFailures + detectAlerts flag high failure rate", () => {
  const host = mkdtempSync(join(tmpdir(), "me-failures-"));
  const now = new Date().toISOString();
  const lines = [];
  for (let i = 0; i < 8; i++) {
    lines.push({
      timestamp: now,
      task: "script",
      provider: "claude",
      ok: false,
      error: "synthetic",
    });
  }
  for (let i = 0; i < 2; i++) {
    lines.push({ timestamp: now, task: "script", provider: "claude", ok: true });
  }
  writeUsage(host, lines);
  const summary = collectFailures(host, 24);
  expect(summary.total).toBe(8);
  expect(summary.provider_failure_rate.claude).toBeCloseTo(0.8, 1);
  const alerts = detectAlerts(summary, []);
  expect(alerts.some((a) => a.event_type === "high_failure_rate")).toBe(true);
});
