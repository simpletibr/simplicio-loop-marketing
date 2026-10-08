'use strict';

import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectFailures, detectAlerts, postWebhook } from "../../lib/observability/failures.ts";
import { appendHbp } from "../../lib/formats/binary.ts";

function withData(root: string): string {
  const dir = join(root, "data");
  mkdirSync(dir, { recursive: true });
  return dir;
}

test("collectFailures: returns an empty summary when no data files exist", () => {
  const root = mkdtempSync(join(tmpdir(), "me-failures-empty-"));
  const summary = collectFailures(root);
  assert.equal(summary.total, 0);
  assert.deepEqual(summary.by_provider, {});
  assert.deepEqual(summary.recent, []);
});

test("collectFailures: counts llm failures inside the window and computes per-provider failure rate", () => {
  const root = mkdtempSync(join(tmpdir(), "me-failures-llm-"));
  const dir = withData(root);
  const now = new Date().toISOString();
  const old = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  const rows = [
    { timestamp: now, provider: "claude", task: "script", ok: true },
    { timestamp: now, provider: "claude", task: "script", ok: false, error: "500" },
    { timestamp: now, provider: "claude", task: "caption", ok: false, error: "timeout" },
    { timestamp: old, provider: "claude", ok: false, error: "stale, outside window" },
    { timestamp: now, ok: false, error: "unknown provider row" },
  ];
  writeFileSync(join(dir, "llm-usage.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const summary = collectFailures(root, 24);
  assert.equal(summary.total, 3);
  assert.equal(summary.by_provider.claude, 2);
  assert.equal(summary.by_task.script, 1);
  assert.equal(summary.by_task.caption, 1);
  assert.ok(summary.provider_failure_rate.claude > 0 && summary.provider_failure_rate.claude < 1);
});

test("collectFailures: includes failed/blocked run rows and ignores rows without a timestamp", () => {
  const root = mkdtempSync(join(tmpdir(), "me-failures-runs-"));
  const dir = withData(root);
  const now = new Date().toISOString();
  const rows = [
    { timestamp: now, piece_id: "p1", status: "failed", notes: "boom" },
    { timestamp: now, piece_id: "p2", status: "blocked", notes: "compliance" },
    { timestamp: now, piece_id: "p3", status: "ok" },
    { piece_id: "p4", status: "failed" }, // no timestamp, skipped
  ];
  for (const row of rows) appendHbp(join(dir, "runs.hbp"), row);
  const summary = collectFailures(root, 24);
  assert.equal(summary.total, 2);
  assert.equal(summary.recent.length, 2);
});

test("collectFailures: caps recent events at 50 and rejects a corrupted runs envelope", () => {
  const root = mkdtempSync(join(tmpdir(), "me-failures-many-"));
  const dir = withData(root);
  const now = new Date().toISOString();
  for (let i = 0; i < 60; i++) {
    appendHbp(join(dir, "runs.hbp"), { timestamp: now, piece_id: `p${i}`, status: "failed" });
  }
  const summary = collectFailures(root, 24);
  assert.equal(summary.total, 60);
  assert.equal(summary.recent.length, 50);
  appendFileSync(join(dir, "runs.hbp"), "not-an-envelope");
  assert.throws(() => collectFailures(root, 24));
});

test("detectAlerts: raises high_failure_rate when a provider exceeds the 20% threshold", () => {
  const alerts = detectAlerts(
    {
      total: 0,
      by_provider: {},
      by_task: {},
      recent: [],
      provider_failure_rate: { claude: 0.5, deepseek: 0.05 },
      stuck_in_review: [],
    },
    [],
  );
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].event_type, "high_failure_rate");
  assert.equal(alerts[0].provider, "claude");
});

test("detectAlerts: raises compliance_block_streak for 3+ recent blocks on the same client/rule", () => {
  const now = new Date().toISOString();
  const alerts = detectAlerts(
    { total: 0, by_provider: {}, by_task: {}, recent: [], provider_failure_rate: {}, stuck_in_review: [] },
    [
      { rule_id: "medical.claims", client: "acme", piece_id: "p1", ts: now },
      { rule_id: "medical.claims", client: "acme", piece_id: "p2", ts: now },
      { rule_id: "medical.claims", client: "acme", piece_id: "p3", ts: now },
      { rule_id: "medical.claims", client: "other", piece_id: "p4", ts: now },
    ],
  );
  const streakAlert = alerts.find((a) => a.event_type === "compliance_block_streak");
  assert.ok(streakAlert);
  assert.equal(streakAlert!.piece_ids.length, 3);
});

test("detectAlerts: ignores compliance events older than a week", () => {
  const old = new Date(Date.now() - 10 * 86400 * 1000).toISOString();
  const alerts = detectAlerts(
    { total: 0, by_provider: {}, by_task: {}, recent: [], provider_failure_rate: {}, stuck_in_review: [] },
    [
      { rule_id: "medical.claims", client: "acme", piece_id: "p1", ts: old },
      { rule_id: "medical.claims", client: "acme", piece_id: "p2", ts: old },
      { rule_id: "medical.claims", client: "acme", piece_id: "p3", ts: old },
    ],
  );
  assert.equal(alerts.length, 0);
});

test("postWebhook: returns true when the endpoint responds ok", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: true })) as unknown as typeof fetch;
  try {
    assert.equal(await postWebhook("https://example.com/hook", { a: 1 }), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("postWebhook: returns false and logs when the fetch throws", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error("network down"); }) as unknown as typeof fetch;
  try {
    assert.equal(await postWebhook("https://example.com/hook", {}), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("postWebhook: returns false when the endpoint responds not-ok", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: false })) as unknown as typeof fetch;
  try {
    assert.equal(await postWebhook("https://example.com/hook", {}), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
