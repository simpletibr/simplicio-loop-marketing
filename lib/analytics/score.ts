/**
 * score.ts — cross-channel analytics scoring for social, Reddit, forums,
 * and developer portals (issue #54).
 *
 * Amplify-decision design note (see issue #46 discussion, m13v): ranking
 * "what to repost/promote" off a single cached snapshot rewards whatever
 * happened to be hot at the moment of that one poll, and starves posts that
 * accumulate slowly-but-steadily (a thread earning a few reactions every
 * day, with no single spike) because a one-shot re-rank makes them look
 * "dead" next to yesterday's spike. This module stores every poll as a
 * snapshot and ranks by the ACCRUAL DELTA between polls (normalized to a
 * per-day rate), not by the latest raw total. `classify()` in
 * lib/promotion/classifier.ts still ranks a single analytics.jsonl export
 * for the simpler save-rate view used by `promote`; `rankByAccrual` here is
 * the multi-poll view that should drive re-promotion/amplification
 * decisions once more than one snapshot exists for a piece.
 */

import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Vanity vs business KPI classification
// ---------------------------------------------------------------------------

export const VANITY_METRICS = new Set([
  "impressions",
  "reach",
  "views",
  "likes",
  "upvotes",
  "points",
  "reactions",
  "stars",
]);

export const BUSINESS_METRICS = new Set([
  "trial_signup",
  "demo_booked",
  "waitlist_join",
  "activation",
  "paid_conversion",
]);

export const QUALITY_ENGAGEMENT_METRICS = new Set([
  "saves",
  "bookmarks",
  "comments",
  "technical_comments",
  "shares",
]);

export type MetricClass = "vanity" | "business" | "quality_engagement" | "unclassified";

export function classifyMetric(metric: string): MetricClass {
  if (BUSINESS_METRICS.has(metric)) return "business";
  if (QUALITY_ENGAGEMENT_METRICS.has(metric)) return "quality_engagement";
  if (VANITY_METRICS.has(metric)) return "vanity";
  return "unclassified";
}

// ---------------------------------------------------------------------------
// Snapshot storage
// ---------------------------------------------------------------------------

export interface MetricSnapshot {
  piece_id: string;
  channel_id: string;
  metric: string;
  value: number;
  polled_at: string;
  source?: "api" | "manual" | "browser-evidence";
  /** The publish receipt of the post the metric belongs to. */
  receipt_id?: string;
}

export function snapshotsPath(root: string): string {
  return resolve(root, "data", "analytics-snapshots.jsonl");
}

export function appendSnapshot(root: string, snapshot: MetricSnapshot): void {
  const path = snapshotsPath(root);
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(snapshot)}\n`);
}

export function readSnapshots(root: string): MetricSnapshot[] {
  const path = snapshotsPath(root);
  if (!existsSync(path)) return [];
  const rows: MetricSnapshot[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line) as MetricSnapshot);
    } catch {
      // malformed line: skip rather than corrupt the ranking
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Accrual scoring
// ---------------------------------------------------------------------------

export interface AccrualScore {
  piece_id: string;
  channel_id: string;
  metric: string;
  metric_class: MetricClass;
  latest_value: number;
  previous_value: number;
  delta: number;
  days_between_polls: number;
  delta_rate_per_day: number;
  poll_count: number;
  spam_risk: boolean;
}

function groupKey(s: MetricSnapshot): string {
  return `${s.piece_id}::${s.channel_id}::${s.metric}`;
}

/**
 * A very low comment_ratio combined with an implausibly high like/upvote
 * spike is a common spam/bot-inflation signature; flag for human review
 * rather than auto-promoting it.
 */
function isSpamRisk(deltaRatePerDay: number, metric: string): boolean {
  if (!VANITY_METRICS.has(metric)) return false;
  return deltaRatePerDay > 5000;
}

export function computeAccrual(snapshots: MetricSnapshot[]): AccrualScore[] {
  const grouped = new Map<string, MetricSnapshot[]>();
  for (const s of snapshots) {
    const key = groupKey(s);
    const list = grouped.get(key) ?? [];
    list.push(s);
    grouped.set(key, list);
  }

  const out: AccrualScore[] = [];
  for (const list of grouped.values()) {
    list.sort((a, b) => Date.parse(a.polled_at) - Date.parse(b.polled_at));
    const latest = list[list.length - 1];
    const previous = list.length > 1 ? list[list.length - 2] : undefined;
    const latestT = Date.parse(latest.polled_at);
    const prevT = previous ? Date.parse(previous.polled_at) : latestT;
    const daysBetween = Math.max((latestT - prevT) / 86_400_000, 1 / 24);
    const delta = latest.value - (previous?.value ?? 0);
    const deltaRate = delta / daysBetween;
    out.push({
      piece_id: latest.piece_id,
      channel_id: latest.channel_id,
      metric: latest.metric,
      metric_class: classifyMetric(latest.metric),
      latest_value: latest.value,
      previous_value: previous?.value ?? 0,
      delta,
      days_between_polls: daysBetween,
      delta_rate_per_day: deltaRate,
      poll_count: list.length,
      spam_risk: isSpamRisk(deltaRate, latest.metric),
    });
  }
  return out;
}

/**
 * Rank pieces for amplification by accrual rate, not raw snapshot total.
 * A piece with only one poll has no accrual signal yet (delta === latest
 * value by construction) and is placed after any piece with >=2 polls, so
 * a single lucky first snapshot can't outrank an established compounder.
 */
export function rankByAccrual(scores: AccrualScore[]): AccrualScore[] {
  return [...scores].sort((a, b) => {
    const aEstablished = a.poll_count >= 2 ? 1 : 0;
    const bEstablished = b.poll_count >= 2 ? 1 : 0;
    if (aEstablished !== bEstablished) return bEstablished - aEstablished;
    return b.delta_rate_per_day - a.delta_rate_per_day;
  });
}

export interface WinnerLoserResult {
  winners: AccrualScore[];
  weakButPromising: AccrualScore[];
  losers: AccrualScore[];
  flaggedSpam: AccrualScore[];
}

/**
 * Classify pieces into winners / weak-but-promising / losers using accrual
 * rate. "Weak but promising" separates a slow-but-still-positive compounder
 * from an outright loser (negative or flat accrual).
 */
export function classifyByAccrual(scores: AccrualScore[]): WinnerLoserResult {
  const flaggedSpam = scores.filter((s) => s.spam_risk);
  const clean = scores.filter((s) => !s.spam_risk);
  const ranked = rankByAccrual(clean);
  const positive = ranked.filter((s) => s.delta_rate_per_day > 0);
  const nonPositive = ranked.filter((s) => s.delta_rate_per_day <= 0);

  const topCut = Math.max(1, Math.ceil(positive.length * 0.2));
  const winners = positive.slice(0, topCut);
  const weakButPromising = positive.slice(topCut);

  return { winners, weakButPromising, losers: nonPositive, flaggedSpam };
}
