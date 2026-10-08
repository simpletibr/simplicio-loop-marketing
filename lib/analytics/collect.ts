/**
 * collect.ts — links published posts to their receipts and pulls their
 * numbers into `data/analytics-snapshots.jsonl`.
 *
 * A post is linked once it is live (`post-links.hbp`: piece, receipt, network,
 * where to read it and its id there). `collectMetrics` then reads each source
 * once, read-only, and appends one snapshot per metric the source reported.
 * DRY_RUN never touches the network.
 */

import { resolve } from "node:path";
import { engineRoot } from "../clients/paths";
import { appendHbp, readHbp } from "../formats/binary";
import { findReceipt, receiptIdOf, scheduleKey, type Network } from "../publish/publisher";
import { isDryRun, type RoToolTransport } from "../realoficial/transport";
import { fetchRealOficialPost } from "./realoficial";
import { fetchInstagramInsights } from "./meta";
import { defaultFetcher, METRICS, type Fetcher, type PostMetrics } from "./post-metrics";
import { appendSnapshot } from "./score";
import { fetchTiktokVideos } from "./tiktok";
import { fetchYoutubeStats } from "./youtube";

export const SOURCES = ["realoficial", "youtube", "instagram", "tiktok"] as const;
export type MetricSource = (typeof SOURCES)[number];

export interface PostLink {
  receipt_id: string;
  piece_id: string;
  client: string;
  network: Network;
  source: MetricSource;
  external_id: string;
  linked_at: string;
}

export function linksPath(root: string): string {
  return resolve(engineRoot(root), "data", "post-links.hbp");
}

export function listLinks(root: string, client?: string): PostLink[] {
  const latest = new Map<string, PostLink>();
  for (const l of readHbp<PostLink>(linksPath(root))) latest.set(`${l.receipt_id}|${l.source}`, l);
  return [...latest.values()].filter((l) => !client || l.client === client);
}

/** Links a live post to the receipt that scheduled it. The receipt must exist: a metric always traces back to a publish. */
export function linkPost(root: string, input: { client: string; pieceId: string; network: Network; publishAt: string; source: MetricSource; externalId: string; now?: Date }): PostLink {
  if (!SOURCES.includes(input.source)) throw new Error(`metrics: unknown source "${input.source}"`);
  if (!/^[A-Za-z0-9_.:-]{3,128}$/.test(input.externalId)) throw new Error("metrics: the post id must be 3 to 128 characters of letters, digits and _.:-");
  const receipt_id = receiptIdOf(scheduleKey({ pieceId: input.pieceId, network: input.network, publishAt: input.publishAt }));
  if (!findReceipt(root, receipt_id)) throw new Error(`metrics: no publish receipt for ${input.pieceId} on ${input.network} at ${input.publishAt}`);
  const link: PostLink = { receipt_id, piece_id: input.pieceId, client: input.client, network: input.network, source: input.source, external_id: input.externalId, linked_at: (input.now ?? new Date()).toISOString() };
  appendHbp(linksPath(root), link);
  return link;
}

export interface MetricCredentials {
  realoficial?: RoToolTransport;
  youtubeApiKey?: string;
  instagramToken?: string;
  tiktokToken?: string;
}

export interface CollectOptions {
  client: string;
  credentials: MetricCredentials;
  fetcher?: Fetcher;
  now?: Date;
  dryRun?: boolean;
}

export interface CollectResult {
  dry_run: boolean;
  links: number;
  snapshots: number;
  /** Links not read, with the reason. */
  skipped: Array<{ piece_id: string; source: MetricSource; reason: string }>;
}

export async function collectMetrics(root: string, opts: CollectOptions): Promise<CollectResult> {
  const dryRun = opts.dryRun ?? isDryRun();
  const links = listLinks(root, opts.client);
  const result: CollectResult = { dry_run: dryRun, links: links.length, snapshots: 0, skipped: [] };
  if (dryRun) return result;
  const fetcher = opts.fetcher ?? defaultFetcher;
  const polled_at = (opts.now ?? new Date()).toISOString();
  const store = (link: PostLink, m: PostMetrics | undefined): void => {
    if (!m) {
      result.skipped.push({ piece_id: link.piece_id, source: link.source, reason: "the source did not return this post" });
      return;
    }
    for (const metric of METRICS) {
      const value = m[metric];
      if (value === undefined) continue;
      appendSnapshot(engineRoot(root), { piece_id: link.piece_id, channel_id: link.network, metric, value, polled_at, source: "api", receipt_id: link.receipt_id });
      result.snapshots++;
    }
  };
  const skip = (list: PostLink[], reason: string): void => {
    for (const l of list) result.skipped.push({ piece_id: l.piece_id, source: l.source, reason });
  };

  for (const source of SOURCES) {
    const group = links.filter((l) => l.source === source);
    if (group.length === 0) continue;
    try {
      if (source === "youtube") {
        if (!opts.credentials.youtubeApiKey) skip(group, "no YouTube API key");
        else {
          const stats = await fetchYoutubeStats(group.map((l) => l.external_id), opts.credentials.youtubeApiKey, fetcher);
          for (const l of group) store(l, stats.get(l.external_id));
        }
      } else if (source === "tiktok") {
        if (!opts.credentials.tiktokToken) skip(group, "no TikTok token");
        else {
          const stats = await fetchTiktokVideos(group.map((l) => l.external_id), opts.credentials.tiktokToken, fetcher);
          for (const l of group) store(l, stats.get(l.external_id));
        }
      } else if (source === "instagram") {
        if (!opts.credentials.instagramToken) skip(group, "no Instagram token");
        else for (const l of group) store(l, await fetchInstagramInsights(l.external_id, opts.credentials.instagramToken, fetcher));
      } else if (!opts.credentials.realoficial) skip(group, "no Real Oficial transport");
      else for (const l of group) store(l, await fetchRealOficialPost(opts.credentials.realoficial, l.external_id));
    } catch (error) {
      skip(group, error instanceof Error ? error.message.slice(0, 120) : "source failed");
    }
  }
  return result;
}
