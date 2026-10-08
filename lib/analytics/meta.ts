import { defaultFetcher, pick, type Fetcher, type Metric, type PostMetrics } from "./post-metrics";

interface Insights {
  data?: Array<{ name?: string; values?: Array<{ value?: unknown }>; total_value?: { value?: unknown } }>;
}

const INSIGHT_TO_METRIC: Record<string, Metric> = { views: "views", likes: "likes", comments: "comments", shares: "shares", saved: "saves" };

/**
 * Instagram Insights of one Reel (`/{media-id}/insights`), read-only, with the
 * client's token. The token travels in the Authorization header, not the URL.
 */
export async function fetchInstagramInsights(mediaId: string, token: string, fetcher: Fetcher = defaultFetcher): Promise<PostMetrics> {
  if (!token) throw new Error("instagram: a client access token is required");
  const res = await fetcher(`https://graph.facebook.com/v21.0/${encodeURIComponent(mediaId)}/insights?metric=${Object.keys(INSIGHT_TO_METRIC).join(",")}`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`instagram: HTTP ${res.status}`);
  const m: PostMetrics = {};
  for (const row of ((await res.json()) as Insights).data ?? []) {
    const metric = row.name ? INSIGHT_TO_METRIC[row.name] : undefined;
    if (metric) pick(m, metric, row.total_value?.value ?? row.values?.[0]?.value);
  }
  return m;
}
