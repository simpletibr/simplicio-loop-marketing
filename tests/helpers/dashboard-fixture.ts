import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeEvent, type DashboardEvent, type MarketingKind } from "../../lib/dashboard/events.ts";
import { EventStore } from "../../lib/dashboard/store.ts";
import { STAGES } from "../../lib/dashboard/model.ts";
import { planContent, savePlan, type ContentPlan } from "../../lib/plan/content-plan.ts";
import { buildBrandProfile, fixtureCollection, writeBrandProfile, type BrandProfile } from "../../lib/profile/brand-profile.ts";

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

export const CLIENTS = [
  { slug: "lothus", host: "https://lothus.com.br", country: "BR" },
  { slug: "wjr", host: "https://wjr.example", country: "CH" },
  { slug: "acme-us", host: "https://acme.example", country: "US" },
  { slug: "berlin-gmbh", host: "https://berlin.example", country: "DE" },
  { slug: "lion-sg", host: "https://lion.example", country: "SG" },
] as const;

export function emptyHost(): { root: string; eRoot: string } {
  const root = mkdtempSync(join(tmpdir(), "me-dashfx-"));
  const eRoot = join(root, ".marketing-engine");
  mkdirSync(join(eRoot, "data"), { recursive: true });
  return { root, eRoot };
}

export function profileFor(slug: string, hostUrl: string, country: string, now: Date): BrandProfile {
  const collection = { ...fixtureCollection(hostUrl), country };
  return buildBrandProfile(collection, { client: slug, url: hostUrl, mode: "dry-run", now });
}

export function sha(k: number): string {
  return createHash("sha256").update(`media-${k}`).digest("hex");
}

/**
 * One event per stage the piece has reached (indexes 0..reach), one hour apart,
 * ending `ageDays` before `now`. The last stages carry the data the KPIs read.
 */
export function pieceEvents(opts: { k: number; client: string; piece_id: string; network?: string; reach: number; baseTs: number; publishAt: string }): DashboardEvent[] {
  const { k, client, piece_id, network, reach, baseTs, publishAt } = opts;
  const out: DashboardEvent[] = [];
  const add = (stage: number, kind: MarketingKind, data: Record<string, unknown>, severity: "info" | "warn" = "info", key = "") =>
    out.push(makeEvent({ source: "fixture", key: `${piece_id}|${stage}|${kind}|${key}`, ts: new Date(baseTs + stage * HOUR).toISOString(), kind, client, piece_id, network, severity, data }));
  for (let i = 0; i <= reach; i++) {
    switch (STAGES[i]) {
      case "prospect": add(i, "prospect_collected", { status: "coletado" }); break;
      case "script": add(i, "script_ready", {}); break;
      case "voice": add(i, "voice_rendered", { provider: "gemini-tts", seconds: 20, cost_usd: 0.01, cache_hit: k % 2 === 0 }); break;
      case "preview": add(i, "render_finished", { stage: "preview", ok: true, sha256: sha(k) }); break;
      case "qa": add(i, "qa_result", { passed: true }); break;
      case "compliance": add(i, "compliance_result", { pass: true, violations: 0 }); break;
      case "approval":
        add(i, "approval_requested", { queue: "client", request_id: `req-${k}`, media_sha256: sha(k) }, "info", "req");
        if (reach > i) add(i, "approval_decided", { decision: "approved", decided_by_role: "client", media_sha256: sha(k) }, "info", "dec");
        break;
      case "final": add(i, "render_finished", { stage: "final", ok: true, sha256: sha(k) }); break;
      case "scheduled": add(i, "scheduled", { publish_at: publishAt, receipt_id: `rc-${k}`, publisher: "dry-run", dry_run: false }); break;
      case "published": add(i, "published", {}); break;
      case "metrics": add(i, "metrics_snapshot", { metric: "views", value: 100 + k, source: "api" }); break;
    }
  }
  return out;
}

export interface SyntheticOperation {
  root: string;
  eRoot: string;
  now: Date;
  store: EventStore;
  /** For each of the 60 pieces: where it stands and when its events started. */
  pieces: Array<{ k: number; client: string; piece_id: string; reach: number; baseTs: number; publishAtMs: number }>;
  plans: ContentPlan[];
}

/** 5 clients x 12 pieces. Piece k reaches stage k % 11 (0..10), started (k % 20) days + 20 h before `now`. */
export function syntheticOperation(now = new Date("2026-10-07T12:00:00Z")): SyntheticOperation {
  const { root, eRoot } = emptyHost();
  const store = new EventStore(root);
  const pieces: SyntheticOperation["pieces"] = [];
  const plans: ContentPlan[] = [];
  const all: DashboardEvent[] = [];
  CLIENTS.forEach((c, ci) => {
    writeBrandProfile(root, profileFor(c.slug, c.host, c.country, now));
    for (let j = 0; j < 12; j++) {
      const k = ci * 12 + j;
      const piece_id = `PIECE-${c.slug}-${String(j).padStart(2, "0")}`;
      const reach = k % 11;
      const baseTs = now.getTime() - (k % 20) * DAY - 20 * HOUR;
      const publishAtMs = now.getTime() + (k % 40) * DAY + 3 * HOUR;
      pieces.push({ k, client: c.slug, piece_id, reach, baseTs, publishAtMs });
      all.push(...pieceEvents({ k, client: c.slug, piece_id, network: ["tiktok", "ig_reels", "yt_shorts"][k % 3], reach, baseTs, publishAt: new Date(publishAtMs).toISOString() }));
    }
  });
  store.ingest(all.sort((a, b) => a.ts.localeCompare(b.ts)));
  return { root, eRoot, now, store, pieces, plans };
}

/** A real 30 day plan for one client, saved to disk, with piece ids ready for events. */
export function planned(root: string, now: Date, slug = "lothus", opts: { days?: number; perWeek?: number; start?: string } = {}): ContentPlan {
  const profile = profileFor(slug, `https://${slug}.example`, "BR", now);
  writeBrandProfile(root, profile);
  const plan = planContent({ client: slug, profile, start: opts.start ?? now.toISOString().slice(0, 10), days: opts.days ?? 30, perWeek: opts.perWeek ?? 3, now });
  savePlan(root, plan);
  return plan;
}
