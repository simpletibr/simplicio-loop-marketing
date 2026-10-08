import { defaultFetcher, pick, type Fetcher, type PostMetrics } from "./post-metrics";

interface VideoList {
  data?: { videos?: Array<{ id?: string; view_count?: unknown; like_count?: unknown; comment_count?: unknown; share_count?: unknown }>; cursor?: number; has_more?: boolean };
  error?: { code?: string };
}

const MAX_PAGES = 10;

/**
 * TikTok Display API `video.list` with the account owner's token (scope
 * `video.list`), read-only. The Research API is not used: it is not available
 * for a client's own account. Pages are followed until every wanted id is found.
 */
export async function fetchTiktokVideos(videoIds: string[], token: string, fetcher: Fetcher = defaultFetcher): Promise<Map<string, PostMetrics>> {
  if (!token) throw new Error("tiktok: the account owner's token is required");
  const wanted = new Set(videoIds);
  const out = new Map<string, PostMetrics>();
  let cursor = 0;
  for (let page = 0; page < MAX_PAGES && out.size < wanted.size; page++) {
    const res = await fetcher("https://open.tiktokapis.com/v2/video/list/?fields=id,view_count,like_count,comment_count,share_count", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ max_count: 20, cursor }),
    });
    if (!res.ok) throw new Error(`tiktok: HTTP ${res.status}`);
    const body = (await res.json()) as VideoList;
    if (body.error?.code && body.error.code !== "ok") throw new Error(`tiktok: ${body.error.code}`);
    for (const v of body.data?.videos ?? []) {
      if (!v.id || !wanted.has(v.id)) continue;
      const m: PostMetrics = {};
      pick(m, "views", v.view_count);
      pick(m, "likes", v.like_count);
      pick(m, "comments", v.comment_count);
      pick(m, "shares", v.share_count);
      out.set(v.id, m);
    }
    if (!body.data?.has_more || typeof body.data.cursor !== "number") break;
    cursor = body.data.cursor;
  }
  return out;
}
