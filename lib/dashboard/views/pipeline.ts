/**
 * pipeline.ts — every piece in every stage, with timings and bottlenecks.
 * Read-only: the preview is whatever exists; a final render that does not exist
 * is reported as missing, never produced.
 */

import { STAGES, allPlans, buildPieceModels, type PieceModel, type Stage } from "../model";
import { allowedRoots, mediaCandidate, safeFile } from "../media";
import { round } from "./common";
import type { ViewContext, ViewRoute } from "../routes";

export interface Card {
  piece_id: string;
  client: string | null;
  campaign_id: string | null;
  format: string | null;
  network: string | null;
  language: string | null;
  variant_of: string | null;
  stage: Stage;
  state: string;
  since: string | null;
  time_in_stage_h: number | null;
  retries: number;
  has_preview: boolean;
  has_final: boolean;
}

const DONE_STAGES: Stage[] = ["published", "metrics"];

function retriesOf(m: PieceModel): number {
  return STAGES.reduce((n, s) => n + Math.max(m.stages[s].attempts - 1, 0), 0);
}

export async function pipeline(ctx: ViewContext) {
  const { root, store, now, query } = ctx;
  const models = [...buildPieceModels(store.all().filter((e) => Date.parse(e.ts) <= now.getTime()), allPlans(root)).values()];
  const allowed = allowedRoots(root, ctx.sources.videosDir);
  const has = (id: string, variant: "preview" | "final"): boolean => {
    const c = mediaCandidate(root, ctx.sources.videosDir, id, variant);
    return Boolean(c && safeFile(c, allowed));
  };
  const f = (name: string): string | null => query.get(name);
  const q = f("q")?.toLowerCase();

  const cards: Card[] = models
    .filter((m) => m.current !== null)
    .filter((m) => (!f("client") || m.client === f("client")) && (!f("campaign") || m.campaign_id === f("campaign")) && (!f("format") || m.format === f("format")) && (!f("network") || m.network === f("network")) && (!f("language") || m.language === f("language")))
    .filter((m) => !f("status") || m.current_state === f("status"))
    .filter((m) => !q || m.piece_id.toLowerCase().includes(q) || (m.client ?? "").toLowerCase().includes(q))
    .map((m) => {
      const stage = m.current as Stage;
      const since = m.stages[stage].at ?? null;
      return {
        piece_id: m.piece_id,
        client: m.client ?? null,
        campaign_id: m.campaign_id ?? null,
        format: m.format ?? null,
        network: m.network ?? null,
        language: m.language ?? null,
        variant_of: m.variant_of ?? null,
        stage,
        state: m.current_state,
        since,
        time_in_stage_h: since ? round((now.getTime() - Date.parse(since)) / 3_600_000) : null,
        retries: retriesOf(m),
        has_preview: has(m.piece_id, "preview"),
        has_final: has(m.piece_id, "final"),
      };
    })
    .sort((a, b) => STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage) || (a.since ?? "").localeCompare(b.since ?? ""));

  const counts = Object.fromEntries(STAGES.map((s) => [s, cards.filter((c) => c.stage === s).length]));

  // time spent getting into each stage, averaged over the pieces that went through it
  const avgHours = Object.fromEntries(
    STAGES.map((stage, i) => {
      const prevStages = STAGES.slice(0, i);
      const hops = models
        .filter((m) => m.stages[stage].at)
        .map((m) => {
          const before = prevStages.map((p) => m.stages[p].at).filter((x): x is string => Boolean(x)).sort().at(-1);
          return before ? (Date.parse(m.stages[stage].at as string) - Date.parse(before)) / 3_600_000 : null;
        })
        .filter((x): x is number => x !== null && x >= 0);
      return [stage, hops.length ? round(hops.reduce((a, b) => a + b, 0) / hops.length) : null];
    }),
  ) as Record<Stage, number | null>;

  const stuck = cards
    .filter((c) => !DONE_STAGES.includes(c.stage) && c.time_in_stage_h !== null)
    .sort((a, b) => (b.time_in_stage_h as number) - (a.time_in_stage_h as number))[0];

  // hero -> variations, only where the plan links them
  const tree = new Map<string, string[]>();
  for (const c of cards) if (c.variant_of) tree.set(c.variant_of, [...(tree.get(c.variant_of) ?? []), c.piece_id]);

  return {
    generated_at: now.toISOString(),
    stages: STAGES,
    counts,
    cards,
    bottlenecks: { avg_hours_into_stage: avgHours, oldest_stuck: stuck ? { piece_id: stuck.piece_id, stage: stuck.stage, hours: stuck.time_in_stage_h } : null },
    variations: [...tree.entries()].map(([root_piece, children]) => ({ root_piece, children })),
    filters: {
      clients: [...new Set(models.map((m) => m.client).filter(Boolean))].sort(),
      formats: [...new Set(models.map((m) => m.format).filter(Boolean))].sort(),
      networks: [...new Set(models.map((m) => m.network).filter(Boolean))].sort(),
      languages: [...new Set(models.map((m) => m.language).filter(Boolean))].sort(),
    },
  };
}

export const pipelineRoute: ViewRoute = { path: "/api/pipeline", handle: pipeline };
