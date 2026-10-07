/**
 * formats.ts — which lane produces each content format.
 *
 * The plan carries the resolved route per slot so the batch renderer and the
 * dashboard never guess. Only the long-video cut lane spends credits, and it
 * does so irreversibly, so it is the only route that demands the owner's OK
 * (see lib/clips/realoficial-clips.ts).
 */

export type Format = "hero" | "cutdown" | "hook_variant" | "slideshow" | "carousel" | "long_cut";

export const FORMATS: readonly Format[] = ["hero", "cutdown", "hook_variant", "slideshow", "carousel", "long_cut"];

export type Lane = "video-factory" | "local-composition" | "realoficial-clips";

export interface Route {
  lane: Lane;
  /** Task id inside the lane (a video matrix task for the factory lane). */
  task: string;
  spends_credits: boolean;
}

const ROUTES: Record<Format, Route> = {
  hero: { lane: "video-factory", task: "programmatic-short", spends_credits: false },
  // Cutdowns and hook variants reuse the cached voice of the hero: no new TTS.
  cutdown: { lane: "video-factory", task: "programmatic-short", spends_credits: false },
  hook_variant: { lane: "video-factory", task: "batch-hooks", spends_credits: false },
  slideshow: { lane: "video-factory", task: "motion-typography", spends_credits: false },
  // Carousels prefer the local composition; generated imagery is a separate, explicit request.
  carousel: { lane: "local-composition", task: "carousel", spends_credits: false },
  long_cut: { lane: "realoficial-clips", task: "clips", spends_credits: true },
};

export function routeForFormat(format: Format): Route {
  return { ...ROUTES[format] };
}

/** Piece `type` understood by the generate pipeline for each format. */
export function pieceTypeFor(format: Format): string {
  return format === "carousel" ? "carousel" : "reel";
}
