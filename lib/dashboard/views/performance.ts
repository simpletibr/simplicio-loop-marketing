/**
 * performance.ts — what each post did and what the next month repeats.
 *
 * Read-only view of the metrics loop (issue #166): the ranking of posts by a
 * metric, the winners with the variations the plan made of them, the same
 * numbers cut by format, hook and language, and the growth of each client.
 * A metric a source did not report is `null` ("sem dado"), never zero: it is
 * left out of every sum, mean and median, and a group with no measured post has
 * no mean at all. Retention has no source yet and is listed as unavailable.
 */

import { METRICS, type Metric } from "../../analytics/post-metrics";
import { listWinners } from "../../analytics/winners";
import { allPlans, buildPieceModels, slotIndex } from "../model";
import { allowedRoots, mediaCandidate, safeFile } from "../media";
import { DAY_MS, round } from "./common";
import type { ViewContext, ViewRoute } from "../routes";

export const UNAVAILABLE_METRICS = ["retention"] as const;
const MAX_POSTS = 200;

type Values = Record<Metric, number | null>;

export interface Post {
  piece_id: string;
  client: string | null;
  network: string;
  format: string | null;
  /** The opening line: what the first two seconds say. */
  hook: string | null;
  language: string | null;
  dubbed: boolean;
  variant_of: string | null;
  month: string | null;
  metrics: Values;
  measured_at: string;
  /** The ranking metric of this post; null when the source did not report it. */
  value: number | null;
  rank: number | null;
  winner: boolean;
  has_preview: boolean;
}

export interface GroupStats {
  group: string;
  posts: number;
  measured: number;
  total: number | null;
  mean: number | null;
  median: number | null;
}

function statsOf(group: string, posts: Post[]): GroupStats {
  const values = posts.map((p) => p.value).filter((v): v is number => v !== null).sort((a, b) => a - b);
  const total = values.reduce((a, b) => a + b, 0);
  const mid = Math.floor(values.length / 2);
  return {
    group,
    posts: posts.length,
    measured: values.length,
    total: values.length === 0 ? null : total,
    mean: values.length === 0 ? null : round(total / values.length, 1),
    median: values.length === 0 ? null : values.length % 2 ? (values[mid] as number) : round(((values[mid - 1] as number) + (values[mid] as number)) / 2, 1),
  };
}

function groupBy(posts: Post[], keyOf: (p: Post) => string): GroupStats[] {
  const buckets = new Map<string, Post[]>();
  for (const p of posts) buckets.set(keyOf(p), [...(buckets.get(keyOf(p)) ?? []), p]);
  return [...buckets].map(([group, list]) => statsOf(group, list)).sort((a, b) => (b.mean ?? -1) - (a.mean ?? -1) || a.group.localeCompare(b.group));
}

const isMetric = (name: unknown): name is Metric => (METRICS as readonly string[]).includes(name as string);

export async function performance(ctx: ViewContext) {
  const { root, store, now } = ctx;
  const t = now.getTime();
  const metric: Metric = isMetric(ctx.query.get("metric")) ? (ctx.query.get("metric") as Metric) : "views";
  const only = ctx.query.get("client");
  const network = ctx.query.get("network");
  const days = Math.min(Math.max(Number(ctx.query.get("days")) || 30, 7), 120);
  const events = store.all().filter((e) => Date.parse(e.ts) <= t);
  const plans = allPlans(root);
  const slots = slotIndex(plans);
  const models = buildPieceModels(events, plans);
  const allowed = allowedRoots(root, ctx.sources.videosDir);
  const hasPreview = (id: string): boolean => {
    const c = mediaCandidate(root, ctx.sources.videosDir, id, "preview");
    return Boolean(c && safeFile(c, allowed));
  };

  // dubbed pieces: a finished dubbing receipt names the piece and the language
  const dubbed = new Map<string, string>();
  for (const e of events) if (e.kind === "marketing.dubbing_finished" && e.data.verdict === "dubbed" && e.piece_id) dubbed.set(e.piece_id, String(e.data.language ?? ""));

  // the latest reading of each metric of each post, and the readings over time for the growth curve
  type Reading = { ts: string; at: number; value: number };
  const latest = new Map<string, { piece_id: string; network: string; values: Partial<Record<Metric, Reading>> }>();
  const viewsOverTime = new Map<string, Reading[]>();
  for (const e of events) {
    if (e.kind !== "marketing.metrics_snapshot" || !e.piece_id || !e.network || !isMetric(e.data.metric)) continue;
    const value = Number(e.data.value);
    if (!Number.isFinite(value) || value < 0) continue;
    const key = `${e.piece_id}|${e.network}`;
    const post = latest.get(key) ?? { piece_id: e.piece_id, network: e.network, values: {} };
    const cur = post.values[e.data.metric];
    if (!cur || e.ts >= cur.ts) post.values[e.data.metric] = { ts: e.ts, at: Date.parse(e.ts), value };
    latest.set(key, post);
    if (e.data.metric === "views") viewsOverTime.set(key, [...(viewsOverTime.get(key) ?? []), { ts: e.ts, at: Date.parse(e.ts), value }]);
  }

  for (const list of viewsOverTime.values()) list.sort((a, b) => a.at - b.at);

  const winners = listWinners(root).filter((w) => !only || w.client === only);
  const winnerKeys = new Set(winners.map((w) => `${w.piece_id}|${w.network}`));

  const all: Post[] = [...latest.values()].map((l) => {
    const slot = slots.get(l.piece_id);
    const model = models.get(l.piece_id);
    const values = Object.fromEntries(METRICS.map((m) => [m, l.values[m]?.value ?? null])) as Values;
    const dubLang = dubbed.get(l.piece_id);
    return {
      piece_id: l.piece_id,
      client: slot?.client ?? model?.client ?? null,
      network: l.network,
      format: slot?.format ?? null,
      hook: slot?.hook ?? null,
      language: slot?.language ?? (dubLang || null),
      dubbed: dubLang !== undefined,
      variant_of: slot?.variant_of ?? null,
      month: slot ? slot.publish_at.slice(0, 7) : null,
      metrics: values,
      measured_at: Object.values(l.values).map((r) => (r as Reading).ts).sort().at(-1) as string,
      value: values[metric],
      rank: null,
      winner: winnerKeys.has(`${l.piece_id}|${l.network}`),
      has_preview: false,
    };
  }).filter((p) => (!only || p.client === only) && (!network || p.network === network));

  const ranked = [...all].sort((a, b) => (b.value ?? -1) - (a.value ?? -1) || a.piece_id.localeCompare(b.piece_id) || a.network.localeCompare(b.network));
  let position = 0;
  for (const p of ranked) p.rank = p.value === null ? null : ++position;
  const shown = ranked.slice(0, MAX_POSTS);
  for (const p of shown.slice(0, 12)) p.has_preview = hasPreview(p.piece_id);

  const winnersOut = winners.sort((a, b) => a.month.localeCompare(b.month) || b.views - a.views).map((w) => {
    const variations = [...slots.values()].filter((s) => s.variant_of === w.piece_id).sort((a, b) => a.publish_at.localeCompare(b.publish_at)).map((s) => {
      const m = models.get(s.piece_id);
      const measured = latest.get(`${s.piece_id}|${s.network}`)?.values.views?.value ?? null;
      return { piece_id: s.piece_id, network: s.network, format: s.format, publish_at: s.publish_at, month: s.publish_at.slice(0, 7), stage: m?.current ?? "planned", state: m?.current_state ?? "pending", views: measured };
    });
    return { client: w.client, month: w.month, piece_id: w.piece_id, network: w.network, format: w.format, hook: w.hook, views: w.views, marked_at: w.marked_at, variations };
  });

  const clients = [...new Set(all.map((p) => p.client ?? "sem cliente"))].sort();
  const growth = clients.map((client) => {
    const keys = all.filter((p) => (p.client ?? "sem cliente") === client).map((p) => `${p.piece_id}|${p.network}`);
    const points = Array.from({ length: days }, (_, i) => {
      const day = new Date(t - (days - 1 - i) * DAY_MS);
      const date = day.toISOString().slice(0, 10);
      const end = Math.min(Date.parse(`${date}T23:59:59.999Z`), t);
      let sum = 0;
      let measured = 0;
      for (const key of keys) {
        const list = viewsOverTime.get(key) ?? [];
        let i = list.length - 1;
        while (i >= 0 && (list[i] as Reading).at > end) i--;
        if (i >= 0) {
          sum += (list[i] as Reading).value;
          measured++;
        }
      }
      return { date, views: measured === 0 ? null : sum, posts: measured };
    });
    return { client, points };
  });

  return {
    generated_at: now.toISOString(),
    read_only: true,
    metric,
    metrics: METRICS,
    unavailable_metrics: UNAVAILABLE_METRICS,
    posts: shown,
    posts_total: all.length,
    winners: winnersOut,
    comparison: {
      by_format: groupBy(all, (p) => p.format ?? "sem dado"),
      by_hook: groupBy(all, (p) => p.hook ?? "sem dado").slice(0, 20),
      by_language: groupBy(all, (p) => `${p.dubbed ? "dublado" : "original"} (${p.language ?? "sem dado"})`),
    },
    growth: { days, clients: growth },
  };
}

export const performanceRoute: ViewRoute = { path: "/api/performance", handle: performance };
