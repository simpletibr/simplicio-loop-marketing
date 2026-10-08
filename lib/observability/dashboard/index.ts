/**
 * index.ts — runs every adapter and feeds the idempotent store.
 *
 * Tail-style sources (JSONL logs) keep a byte cursor in
 * `data/dashboard-cursors.hbi`; the other sources are small and are re-read
 * whole because event ids make re-reading harmless.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { engineRoot } from "../../clients/paths";
import type { DashboardEvent } from "../../dashboard/events";
import { EventStore } from "../../dashboard/store";
import { readHbi, writeHbiAtomic } from "../../formats/binary";
import { fromCredits, fromMetricSnapshots, fromStripeLog, fromTtsQuota, fromTtsUsage } from "./billing";
import { fromApprovals, fromDubbing, fromJournal, fromManifests, fromMarketingEvents, fromReceipts, fromWinners, fromYoolBoard } from "./internal";
import { fromProspectCsv, fromVideosDir } from "./videos";

export interface SyncOptions {
  /** Output folder of the video factory (prospects and renders). */
  videosDir?: string;
  /** CSV export of the operator's control spreadsheet. */
  controlCsv?: string;
}

export interface SyncResult {
  added: number;
  total: number;
  rejected_credit_rows: number;
}

type Cursors = Record<string, number>;

function cursorsPath(root: string): string {
  return resolve(engineRoot(root), "data", "dashboard-cursors.hbi");
}

function loadCursors(root: string): Cursors {
  const path = cursorsPath(root);
  return existsSync(path) ? readHbi<Cursors>(path) : {};
}

export function defaultSources(root: string): Required<SyncOptions> {
  const data = resolve(engineRoot(root), "data");
  return {
    videosDir: process.env.SIMPLICIO_VIDEOS_OUT ? resolve(process.env.SIMPLICIO_VIDEOS_OUT) : resolve(data, "prospects"),
    controlCsv: process.env.MARKETING_CONTROL_CSV ? resolve(process.env.MARKETING_CONTROL_CSV) : resolve(data, "controle-prospects.csv"),
  };
}

export function syncDashboard(root: string, store: EventStore, options: SyncOptions = {}): SyncResult {
  const sources = { ...defaultSources(root), ...options };
  const cursors = loadCursors(root);
  const events: DashboardEvent[] = [];

  const marketing = fromMarketingEvents(root, cursors.marketing ?? 0);
  cursors.marketing = marketing.next;
  events.push(...marketing.events);

  const stripe = fromStripeLog(root, cursors.stripe ?? 0);
  cursors.stripe = stripe.next;
  events.push(...stripe.events);

  const credits = fromCredits(root, cursors.credits ?? 0);
  cursors.credits = credits.next;
  events.push(...credits.events);

  const ttsUsage = fromTtsUsage(root, cursors.tts ?? 0);
  cursors.tts = ttsUsage.next;
  events.push(...ttsUsage.events);

  events.push(
    ...fromJournal(root),
    ...fromYoolBoard(root),
    ...fromReceipts(root),
    ...fromApprovals(root),
    ...fromDubbing(root),
    ...fromWinners(root),
    ...fromManifests(root),
    ...fromMetricSnapshots(root),
    ...fromTtsQuota(root),
    ...fromVideosDir(sources.videosDir),
    ...fromProspectCsv(resolve(sources.videosDir, "lote.csv"), "simplicio-videos-lote"),
    ...fromProspectCsv(sources.controlCsv, "control-spreadsheet"),
  );

  // Stable by time only: events with the same instant keep the order their adapter produced them in.
  events.sort((a, b) => a.ts.localeCompare(b.ts));
  const added = store.ingest(events);
  writeHbiAtomic(cursorsPath(root), cursors);
  return { added: added.length, total: store.size, rejected_credit_rows: credits.rejected };
}
