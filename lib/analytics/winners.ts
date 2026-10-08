/**
 * winners.ts — which posts of a month earned the next month's variations.
 *
 * The month's posts are ranked by their latest view count and the top 20% of
 * the posts that have a number (at least one) win. A month with fewer than
 * `minPieces` measured posts has no winners: with no data there is nothing to
 * double down on. The per-day accrual of score.ts is for amplifying a post over
 * several polls; a monthly pick compares totals, as the report's top 3 does.
 * Winners keep what the planner needs to vary them.
 */

import { resolve } from "node:path";
import { engineRoot } from "../clients/paths";
import { appendHbp, readHbp } from "../formats/binary";
import type { ContentPlan } from "../plan/content-plan";
import type { Format } from "../plan/formats";
import { readSnapshots, type MetricSnapshot } from "./score";

export interface Winner {
  client: string;
  /** `YYYY-MM` of the post. */
  month: string;
  piece_id: string;
  network: string;
  format: Format;
  hook: string;
  angle: string;
  views: number;
  marked_at: string;
}

export function winnersPath(root: string): string {
  return resolve(engineRoot(root), "data", "winners.hbp");
}

export function listWinners(root: string, filter: { client?: string; month?: string } = {}): Winner[] {
  const latest = new Map<string, Winner>();
  for (const w of readHbp<Winner>(winnersPath(root))) latest.set(`${w.client}|${w.month}|${w.piece_id}`, w);
  return [...latest.values()].filter((w) => (!filter.client || w.client === filter.client) && (!filter.month || w.month === filter.month));
}

/** The latest reading of a metric per piece and network. */
export function latestValues(snapshots: MetricSnapshot[], metric: string): Map<string, { piece_id: string; network: string; value: number }> {
  const out = new Map<string, { at: number; piece_id: string; network: string; value: number }>();
  for (const s of snapshots) {
    if (s.metric !== metric) continue;
    const key = `${s.piece_id}|${s.channel_id}`;
    const at = Date.parse(s.polled_at);
    const cur = out.get(key);
    if (!cur || at >= cur.at) out.set(key, { at, piece_id: s.piece_id, network: s.channel_id, value: s.value });
  }
  return out;
}

export function selectWinners(root: string, plans: ContentPlan[], client: string, month: string, opts: { minPieces?: number; now?: Date } = {}): Winner[] {
  const slots = new Map<string, ContentPlan["slots"][number]>();
  for (const plan of plans) if (plan.client === client) for (const slot of plan.slots) if (slot.publish_at.startsWith(month)) slots.set(slot.piece_id, slot);
  const measured = [...latestValues(readSnapshots(engineRoot(root)).filter((s) => slots.has(s.piece_id)), "views").values()].filter((v) => v.value > 0);
  if (measured.length < (opts.minPieces ?? 3)) return [];
  const ranked = measured.sort((a, b) => b.value - a.value || a.piece_id.localeCompare(b.piece_id));
  const marked_at = (opts.now ?? new Date()).toISOString();
  return ranked.slice(0, Math.max(1, Math.ceil(ranked.length * 0.2))).map((w) => {
    const slot = slots.get(w.piece_id) as ContentPlan["slots"][number];
    return { client, month, piece_id: w.piece_id, network: w.network, format: slot.format, hook: slot.hook, angle: slot.angle, views: w.value, marked_at };
  });
}

export function recordWinners(root: string, winners: Winner[]): void {
  for (const w of winners) appendHbp(winnersPath(root), w);
}
