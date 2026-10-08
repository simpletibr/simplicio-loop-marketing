import { defaultFetcher, pick, type Fetcher, type PostMetrics } from "./post-metrics";

interface VideosList {
  items?: Array<{ id?: string; statistics?: { viewCount?: string; likeCount?: string; commentCount?: string } }>;
}

/**
 * YouTube Data API `videos.list` (statistics), read-only, up to 50 ids per call.
 * Hidden counts (likes turned off) are absent, not zero.
 */
export async function fetchYoutubeStats(videoIds: string[], apiKey: string, fetcher: Fetcher = defaultFetcher): Promise<Map<string, PostMetrics>> {
  if (!apiKey) throw new Error("youtube: an API key is required");
  const out = new Map<string, PostMetrics>();
  for (let i = 0; i < videoIds.length; i += 50) {
    const ids = videoIds.slice(i, i + 50);
    const res = await fetcher(`https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${ids.map(encodeURIComponent).join(",")}&key=${encodeURIComponent(apiKey)}`);
    if (!res.ok) throw new Error(`youtube: HTTP ${res.status}`);
    for (const item of ((await res.json()) as VideosList).items ?? []) {
      if (!item.id) continue;
      const m: PostMetrics = {};
      pick(m, "views", item.statistics?.viewCount);
      pick(m, "likes", item.statistics?.likeCount);
      pick(m, "comments", item.statistics?.commentCount);
      out.set(item.id, m);
    }
  }
  return out;
}
