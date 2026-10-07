import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readRuns, runsLogPath } from "../data/runs";

interface UsageRow {
  timestamp?: string;
  task?: string;
  provider?: string;
  ok?: boolean;
  error?: string;
  fallback_used?: boolean;
}

export interface FailureEvent {
  kind: "llm" | "run";
  timestamp: string;
  provider?: string;
  task?: string;
  piece_id?: string;
  status?: string;
  error?: string;
}

export interface FailureSummary {
  total: number;
  by_provider: Record<string, number>;
  by_task: Record<string, number>;
  recent: FailureEvent[];
  provider_failure_rate: Record<string, number>;
  stuck_in_review: string[];
}

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const out: T[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch {}
  }
  return out;
}

export function collectFailures(
  root: string,
  windowHours = 24,
): FailureSummary {
  const cutoff = Date.now() - windowHours * 3600 * 1000;
  const usage = readJsonl<UsageRow>(resolve(root, "data", "llm-usage.jsonl"));
  const runs = readRuns(runsLogPath(root));
  const events: FailureEvent[] = [];
  const providerTotals: Record<string, { ok: number; fail: number }> = {};

  for (const u of usage) {
    if (!u.timestamp) continue;
    if (Date.parse(u.timestamp) < cutoff) continue;
    const p = u.provider ?? "unknown";
    providerTotals[p] = providerTotals[p] ?? { ok: 0, fail: 0 };
    if (u.ok === false) {
      providerTotals[p].fail++;
      events.push({
        kind: "llm",
        timestamp: u.timestamp,
        provider: u.provider,
        task: u.task,
        error: u.error,
      });
    } else {
      providerTotals[p].ok++;
    }
  }
  for (const r of runs) {
    if (!r.timestamp) continue;
    if (Date.parse(r.timestamp) < cutoff) continue;
    if (r.status === "failed" || r.status === "blocked") {
      events.push({
        kind: "run",
        timestamp: r.timestamp,
        piece_id: r.piece_id,
        status: r.status,
        error: r.notes,
      });
    }
  }
  const summary: FailureSummary = {
    total: events.length,
    by_provider: {},
    by_task: {},
    recent: events.slice(-50),
    provider_failure_rate: {},
    stuck_in_review: [],
  };
  for (const e of events) {
    if (e.provider) {
      summary.by_provider[e.provider] = (summary.by_provider[e.provider] ?? 0) + 1;
    }
    if (e.task) {
      summary.by_task[e.task] = (summary.by_task[e.task] ?? 0) + 1;
    }
  }
  for (const [p, t] of Object.entries(providerTotals)) {
    summary.provider_failure_rate[p] = t.fail / Math.max(t.ok + t.fail, 1);
  }
  return summary;
}

export interface AlertEvent {
  event_type: "compliance_block_streak" | "high_failure_rate" | "stuck_review";
  summary: string;
  piece_ids: string[];
  provider?: string;
  rate?: number;
}

export function detectAlerts(
  summary: FailureSummary,
  complianceEvents: Array<{ rule_id: string; client?: string; piece_id?: string; ts: string }>,
): AlertEvent[] {
  const alerts: AlertEvent[] = [];
  for (const [p, rate] of Object.entries(summary.provider_failure_rate)) {
    if (rate > 0.2) {
      alerts.push({
        event_type: "high_failure_rate",
        summary: `Provider ${p} failed ${(rate * 100).toFixed(1)}% of calls in window`,
        piece_ids: [],
        provider: p,
        rate,
      });
    }
  }
  const streak = new Map<string, string[]>();
  const weekAgo = Date.now() - 7 * 86400 * 1000;
  for (const ce of complianceEvents) {
    if (Date.parse(ce.ts) < weekAgo) continue;
    const key = `${ce.client ?? "?"}::${ce.rule_id}`;
    const list = streak.get(key) ?? [];
    if (ce.piece_id) list.push(ce.piece_id);
    streak.set(key, list);
  }
  for (const [key, list] of streak) {
    if (list.length >= 3) {
      const [client, rule] = key.split("::");
      alerts.push({
        event_type: "compliance_block_streak",
        summary: `Compliance rule ${rule} blocked ${list.length} pieces for ${client} this week`,
        piece_ids: list,
      });
    }
  }
  return alerts;
}

export async function postWebhook(url: string, payload: unknown): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch (err) {
    process.stderr.write(`webhook post failed: ${String(err)}\n`);
    return false;
  }
}
