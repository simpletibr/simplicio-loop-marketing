import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fetchYoutubeStats } from "../../lib/analytics/youtube.ts";
import { fetchInstagramInsights } from "../../lib/analytics/meta.ts";
import { fetchTiktokVideos } from "../../lib/analytics/tiktok.ts";
import { fetchRealOficialPost } from "../../lib/analytics/realoficial.ts";
import { count, type Fetcher } from "../../lib/analytics/post-metrics.ts";
import { ReplayTransport } from "../helpers/ro-transport.ts";

const recorded = (name: string): unknown => JSON.parse(readFileSync(resolve("tests/fixtures/analytics", `${name}.json`), "utf8"));
const reply = (...bodies: unknown[]): { fetcher: Fetcher; calls: Array<{ url: string; init?: Parameters<Fetcher>[1] }> } => {
  const calls: Array<{ url: string; init?: Parameters<Fetcher>[1] }> = [];
  let i = 0;
  const fetcher: Fetcher = async (url, init) => {
    calls.push({ url, init });
    const body = bodies[Math.min(i++, bodies.length - 1)];
    return { ok: true, status: 200, json: async () => body };
  };
  return { fetcher, calls };
};
const failing: Fetcher = async () => ({ ok: false, status: 403, json: async () => ({}) });

test("count accepts finite non-negative numbers and numeric strings only", () => {
  assert.equal(count("20310"), 20310);
  assert.equal(count(0), 0);
  for (const bad of [undefined, null, "", "abc", -1, NaN, Infinity, {}]) assert.equal(count(bad), undefined, String(bad));
});

test("youtube: statistics map to metrics and a hidden count is absent, not zero", async () => {
  const { fetcher, calls } = reply(recorded("youtube-videos-list"));
  const stats = await fetchYoutubeStats(["yt-aaa111", "yt-bbb222"], "KEY", fetcher);
  assert.deepEqual(stats.get("yt-aaa111"), { views: 20310, likes: 1500, comments: 87 });
  assert.deepEqual(stats.get("yt-bbb222"), { views: 310, comments: 2 }, "no likes: the metric is missing");
  assert.equal("likes" in (stats.get("yt-bbb222") ?? {}), false);
  assert.match(calls[0]?.url ?? "", /videos\?part=statistics&id=yt-aaa111,yt-bbb222&key=KEY$/);
  await assert.rejects(() => fetchYoutubeStats(["x"], "KEY", failing), (e: Error) => e.message === "youtube: HTTP 403" && !e.message.includes("KEY"));
  await assert.rejects(() => fetchYoutubeStats(["x"], "", failing), /API key/);
});

test("youtube: more than 50 ids are read in batches", async () => {
  const { fetcher, calls } = reply({ items: [] });
  await fetchYoutubeStats(Array.from({ length: 120 }, (_, i) => `v${i}`), "KEY", fetcher);
  assert.equal(calls.length, 3);
});

test("instagram: insights map to metrics, the token travels in a header", async () => {
  const { fetcher, calls } = reply(recorded("instagram-insights"));
  const m = await fetchInstagramInsights("17900000000000000", "TOKEN", fetcher);
  assert.deepEqual(m, { views: 8800, likes: 640, comments: 31, saves: 77 });
  assert.ok(!calls[0]?.url.includes("TOKEN"));
  assert.equal(calls[0]?.init?.headers?.authorization, "Bearer TOKEN");
  await assert.rejects(() => fetchInstagramInsights("1", "TOKEN", failing), /HTTP 403/);
  await assert.rejects(() => fetchInstagramInsights("1", "", failing), /token/);
});

test("tiktok: the Display API list is paged until every wanted video is found", async () => {
  const { fetcher, calls } = reply(recorded("tiktok-video-list-page1"), recorded("tiktok-video-list-page2"));
  const stats = await fetchTiktokVideos(["tt-111", "tt-222", "tt-missing"], "TOKEN", fetcher);
  assert.deepEqual(stats.get("tt-111"), { views: 5400, likes: 410, comments: 12, shares: 33 });
  assert.deepEqual(stats.get("tt-222"), { views: 120, likes: 3 });
  assert.equal(stats.has("tt-missing"), false, "a post the source does not return has no numbers");
  assert.equal(calls.length, 2, "stops when has_more is false");
  assert.match(calls[0]?.url ?? "", /open\.tiktokapis\.com\/v2\/video\/list\//);
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(JSON.parse(calls[1]?.init?.body ?? "{}").cursor, 1700000000);
  assert.ok(!calls.some((c) => c.url.includes("research")), "the Research API is not used");

  const stop = reply(recorded("tiktok-video-list-page1"));
  const one = await fetchTiktokVideos(["tt-111"], "TOKEN", stop.fetcher);
  assert.equal(stop.calls.length, 1, "no extra page once the wanted video is found");
  assert.equal(one.size, 1);
  await assert.rejects(() => fetchTiktokVideos(["a"], "TOKEN", reply({ error: { code: "access_token_invalid" } }).fetcher), /access_token_invalid/);
  await assert.rejects(() => fetchTiktokVideos(["a"], "TOKEN", failing), /HTTP 403/);
});

test("real oficial: the post report gives the metrics the app shows", async () => {
  const t = new ReplayTransport({ ro_get_social_analytics: "social-analytics-post" });
  const m = await fetchRealOficialPost(t, "01HZXQ3M8K2V5N7P9R1S4T6P01");
  assert.deepEqual(m, { views: 12840, likes: 931, comments: 44, shares: 120 });
  assert.deepEqual(t.calls[0], { tool: "ro_get_social_analytics", args: { report: "post", social_post_id: "01HZXQ3M8K2V5N7P9R1S4T6P01" } });
  const empty = new ReplayTransport({ ro_get_social_analytics: "estimate-clips" });
  assert.deepEqual(await fetchRealOficialPost(empty, "x"), {}, "an answer without metrics is no data");
});
