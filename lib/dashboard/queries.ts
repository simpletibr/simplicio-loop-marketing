/**
 * queries.ts — read models behind the `/api` routes: clients, campaigns and
 * pieces, assembled from the event store and the repo's own artifacts. Pure
 * reads; nothing here can render, schedule, approve or spend.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { listDecisions, listRequests } from "../approval/store";
import { engineRoot } from "../clients/paths";
import { readHbi } from "../formats/binary";
import { listPlanIds, loadPlan, plansDir, type ContentPlan } from "../plan/content-plan";
import { planStatus } from "../plan/batch";
import { readBrandProfile, type BrandProfile } from "../profile/brand-profile";
import { listReceipts } from "../publish/publisher";
import type { EventStore, StoredEvent } from "./store";
import { mediaCandidate, pieceOutputDir, safeFile, allowedRoots } from "./media";
import { scrubPii } from "./events";

export interface ClientSummary {
  slug: string;
  name?: string;
  country?: string;
  has_profile: boolean;
  pieces: number;
  plans: string[];
  last_event_at?: string;
  next_publication?: string;
  events_by_kind: Record<string, number>;
}

function slugsOnDisk(root: string): string[] {
  const dir = resolve(engineRoot(root), "clients");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && /^[a-z0-9][a-z0-9-]{0,63}$/.test(e.name)).map((e) => e.name);
}

function profileOf(root: string, slug: string): BrandProfile | null {
  try {
    return readBrandProfile(root, slug);
  } catch {
    return null;
  }
}

export function listClients(root: string, store: EventStore, now = new Date()): ClientSummary[] {
  const slugs = new Set<string>(slugsOnDisk(root));
  for (const e of store.all()) if (e.client) slugs.add(e.client);
  return [...slugs].sort().map((slug) => {
    const events = store.query({ client: slug });
    const profile = profileOf(root, slug);
    const kinds: Record<string, number> = {};
    for (const e of events) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
    const upcoming = events
      .filter((e) => e.kind === "marketing.scheduled" && typeof e.data.publish_at === "string" && Date.parse(e.data.publish_at as string) > now.getTime())
      .map((e) => e.data.publish_at as string)
      .sort()[0];
    return {
      slug,
      ...(profile ? { name: profile.name, country: profile.country } : {}),
      has_profile: profile !== null,
      pieces: new Set(events.map((e) => e.piece_id).filter(Boolean)).size,
      plans: listPlanIds(root, slug),
      ...(events.at(-1) ? { last_event_at: events.at(-1)?.ts } : {}),
      ...(upcoming ? { next_publication: upcoming } : {}),
      events_by_kind: kinds,
    };
  });
}

export interface PieceRow {
  piece_id: string;
  last_kind: string;
  last_ts: string;
  events: number;
}

function piecesOf(events: StoredEvent[]): PieceRow[] {
  const rows = new Map<string, PieceRow>();
  for (const e of events) {
    if (!e.piece_id) continue;
    const row = rows.get(e.piece_id) ?? { piece_id: e.piece_id, last_kind: e.kind, last_ts: e.ts, events: 0 };
    row.events++;
    if (e.ts >= row.last_ts) {
      row.last_kind = e.kind;
      row.last_ts = e.ts;
    }
    rows.set(e.piece_id, row);
  }
  return [...rows.values()].sort((a, b) => b.last_ts.localeCompare(a.last_ts));
}

export function clientDetail(root: string, store: EventStore, slug: string): (ClientSummary & { profile: Pick<BrandProfile, "name" | "sector" | "country" | "language" | "colors" | "pillars" | "tone"> | null; piece_rows: PieceRow[] }) | null {
  const summary = listClients(root, store).find((c) => c.slug === slug);
  if (!summary) return null;
  const profile = profileOf(root, slug);
  return {
    ...summary,
    profile: profile ? { name: profile.name, sector: profile.sector, country: profile.country, language: profile.language, colors: profile.colors, pillars: profile.pillars, tone: profile.tone } : null,
    piece_rows: piecesOf(store.query({ client: slug })),
  };
}

/** A plan by id, searched across clients. */
export function findPlan(root: string, planId: string): ContentPlan | null {
  for (const slug of slugsOnDisk(root)) {
    if (existsSync(join(plansDir(root, slug), `${planId}.hbi`))) return loadPlan(root, slug, planId);
  }
  return null;
}

export function campaignDetail(root: string, store: EventStore, planId: string): { plan: Omit<ContentPlan, "slots">; slots: Array<ReturnType<typeof planStatus>[number]["slot"] & { status: string; receipt_id?: string }>; counts: Record<string, number>; events: number } | null {
  const plan = findPlan(root, planId);
  if (!plan) return null;
  const views = planStatus(root, plan);
  const counts: Record<string, number> = {};
  for (const v of views) counts[v.status] = (counts[v.status] ?? 0) + 1;
  const { slots: _slots, ...header } = plan;
  return {
    plan: header,
    slots: views.map((v) => ({ ...v.slot, status: v.status, ...(v.receipt ? { receipt_id: v.receipt.receipt_id } : {}) })),
    counts,
    events: store.query({ campaign_id: planId }).length,
  };
}

const ARTIFACTS: Array<[string, string]> = [["script", "script.md"], ["captions", "captions.json"], ["contract", "contract.yaml"], ["timing", "timing.lock.json"], ["final_command", "FINAL-COMANDO.md"], ["compliance", "compliance.json"], ["qa", "qa-tech-specs.json"]];

/** Text artifacts of a piece for the detail drawer: read-only, capped, scrubbed of contact data. */
function textArtifacts(dirs: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, file] of ARTIFACTS) {
    for (const dir of dirs) {
      const path = join(dir, file);
      if (existsSync(path)) {
        out[name] = scrubPii(readFileSync(path, "utf8").slice(0, 20_000));
        break;
      }
    }
  }
  return out;
}

export function pieceDetail(root: string, store: EventStore, videosDir: string, pieceId: string) {
  const events = store.query({ piece_id: pieceId });
  if (events.length === 0 && !pieceOutputDir(root, pieceId)) return null;
  const roots = allowedRoots(root, videosDir);
  const has = (variant: "preview" | "final"): boolean => {
    const candidate = mediaCandidate(root, videosDir, pieceId, variant);
    return Boolean(candidate && safeFile(candidate, roots));
  };
  const dir = pieceOutputDir(root, pieceId);
  let manifest: Record<string, unknown> | null = null;
  if (dir && existsSync(join(dir, "manifest.hbi"))) {
    try {
      const m = readHbi<Record<string, unknown>>(join(dir, "manifest.hbi"));
      manifest = { providers: m.providers, cost_estimate_usd: m.cost_estimate_usd, render_sha256: m.render_sha256, generated_at: m.generated_at, outputs: Array.isArray(m.outputs) ? m.outputs.length : 0 };
    } catch {
      manifest = null;
    }
  }
  return {
    piece_id: pieceId,
    client: events.find((e) => e.client)?.client,
    events,
    manifest,
    receipts: listReceipts(root).filter((r) => r.piece_id === pieceId).map((r) => ({ receipt_id: r.receipt_id, network: r.network, verdict: r.verdict, publish_at: r.publish_at, publisher: r.publisher, dry_run: r.dry_run, failure_class: r.failure_class })),
    approvals: listDecisions(root).filter((d) => d.piece_id === pieceId).map((d) => ({ decision: d.decision, decided_at: d.decided_at, decided_by_role: d.decided_by.startsWith("client:") ? "client" : "operator", media_sha256: d.media_sha256, note: d.note === undefined ? undefined : scrubPii(d.note) })),
    approval_requests: listRequests(root).filter((r) => r.piece_id === pieceId).map((r) => ({ request_id: r.request_id, media_sha256: r.media_sha256, month: r.month, created_at: r.created_at })),
    media: { preview: has("preview"), final: has("final") },
    artifacts: textArtifacts([...(dir ? [dir] : []), join(videosDir, pieceId)]),
  };
}

