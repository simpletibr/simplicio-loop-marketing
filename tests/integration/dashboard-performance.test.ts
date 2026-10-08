import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEvent } from "../../lib/dashboard/events.ts";
import { EventStore } from "../../lib/dashboard/store.ts";
import { performance } from "../../lib/dashboard/views/performance.ts";
import { startDashboard } from "../../lib/dashboard/server.ts";
import { defaultSources, syncDashboard } from "../../lib/observability/dashboard/index.ts";
import { appendSnapshot } from "../../lib/analytics/score.ts";
import { recordWinners, selectWinners } from "../../lib/analytics/winners.ts";
import { planContent, savePlan, type ContentPlan } from "../../lib/plan/content-plan.ts";
import { writeBrandProfile } from "../../lib/profile/brand-profile.ts";
import { DAY, emptyHost, profileFor } from "../helpers/dashboard-fixture.ts";
import type { ViewContext } from "../../lib/dashboard/routes.ts";

const NOW = new Date("2026-11-10T12:00:00Z");
const iso = (ms: number): string => new Date(ms).toISOString();

/**
 * Two months of one client. Month 1 (October): 10 posts measured on views (1000, 900, ... 100), the even ones also on likes,
 * the first three on shares, the first twice (300 views a day later, then 1000). The month's winners are picked by the real
 * loop, recorded, and the plan of month 2 (November) varies them. One variation is measured (700 views).
 */
function world() {
  const { root, eRoot } = emptyHost();
  const profile = profileFor("lothus", "https://lothus.example", "BR", NOW);
  writeBrandProfile(root, profile);
  const plan1 = planContent({ client: "lothus", profile, start: "2026-10-01", days: 30, perWeek: 3, networks: ["tiktok", "ig_reels"], now: new Date("2026-09-30T12:00:00Z") });
  savePlan(root, plan1);
  const month1 = plan1.slots.slice(0, 10);
  const views = (i: number): number => 1000 - i * 100;
  month1.forEach((s, i) => {
    const at = Date.parse(s.publish_at) + DAY;
    const snap = (metric: string, value: number, polled: number) => appendSnapshot(eRoot, { piece_id: s.piece_id, channel_id: s.network, metric, value, polled_at: iso(polled), source: "api" });
    if (i === 0) snap("views", 300, at - 18 * 3_600_000);
    snap("views", views(i), at);
    if (i % 2 === 0) snap("likes", 50 + i, at);
    if (i < 3) snap("shares", 5 + i, at);
  });
  const winners = selectWinners(root, [plan1], "lothus", "2026-10", { now: new Date("2026-11-01T00:00:00Z") });
  recordWinners(root, winners);
  const plan2 = planContent({ client: "lothus", profile, start: "2026-11-01", days: 30, perWeek: 3, networks: ["tiktok", "ig_reels"], winners: winners.map((w) => ({ piece_id: w.piece_id, hook: w.hook, angle: w.angle })), now: new Date("2026-10-31T12:00:00Z") });
  savePlan(root, plan2);
  const measuredVariation = plan2.slots.find((s) => s.variant_of === winners[0]?.piece_id) as ContentPlan["slots"][number];
  appendSnapshot(eRoot, { piece_id: measuredVariation.piece_id, channel_id: measuredVariation.network, metric: "views", value: 700, polled_at: "2026-11-09T10:00:00Z", source: "api" });
  const store = new EventStore(root);
  syncDashboard(root, store);
  // the second piece was dubbed to English
  store.ingest([makeEvent({ source: "t", key: "dub", ts: "2026-10-20T10:00:00Z", kind: "dubbing_finished", client: "lothus", piece_id: (month1[1] as { piece_id: string }).piece_id, data: { language: "en", verdict: "dubbed" } })]);
  return { root, store, plan1, plan2, month1, winners, measuredVariation, views };
}

const ctxOf = (root: string, store: EventStore, query = ""): ViewContext => ({ root, store, sources: defaultSources(root), now: NOW, query: new URLSearchParams(query), alerts: () => [] });
const mean = (xs: number[]): number => Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10;

test("the ranking is by the chosen metric, and a metric a post never reported is null, never zero", async () => {
  const { root, store, month1, views, measuredVariation } = world();
  const d = await performance(ctxOf(root, store));
  assert.equal(d.read_only, true);
  assert.equal(d.metric, "views");
  assert.equal(d.posts_total, 11, "10 posts of October and the measured variation");
  const ids = d.posts.map((p) => p.piece_id);
  const expectedOrder = [...month1.map((s, i) => ({ id: s.piece_id, v: views(i) })), { id: measuredVariation.piece_id, v: 700 }].sort((a, b) => b.v - a.v).map((x) => x.id);
  assert.deepEqual(ids, expectedOrder, "ranked by views, highest first");
  assert.deepEqual(d.posts.map((p) => p.rank), Array.from({ length: 11 }, (_, i) => i + 1));
  const first = d.posts[0]!;
  assert.equal(first.metrics.views, 1000, "the latest reading wins over the earlier 300");
  assert.deepEqual([first.metrics.likes, first.metrics.shares], [50, 5]);
  const odd = d.posts.find((p) => p.piece_id === (month1[1] as { piece_id: string }).piece_id)!;
  assert.equal(odd.metrics.likes, null, "never reported: null, not 0");
  assert.equal(odd.metrics.comments, null);
  assert.equal(odd.metrics.saves, null);
  assert.deepEqual(d.unavailable_metrics, ["retention"], "retention has no source and is said so");

  // by likes: only the five posts that reported it have a value and a rank
  const likes = await performance(ctxOf(root, store, "metric=likes"));
  assert.equal(likes.metric, "likes");
  assert.deepEqual(likes.posts.filter((p) => p.rank !== null).map((p) => p.metrics.likes), [58, 56, 54, 52, 50]);
  assert.equal(likes.posts.filter((p) => p.rank !== null).length, 5);
  assert.ok(likes.posts.slice(5).every((p) => p.value === null && p.rank === null), "posts without the metric come last, unranked");

  // a metric nobody reported: no value, no mean, no total
  const saves = await performance(ctxOf(root, store, "metric=saves"));
  assert.ok(saves.posts.every((p) => p.value === null && p.rank === null));
  for (const g of [...saves.comparison.by_format, ...saves.comparison.by_language, ...saves.comparison.by_hook]) assert.deepEqual([g.measured, g.total, g.mean, g.median], [0, null, null, null], `${g.group} has no data, not zeros`);
});

test("the winners of month 1 are linked to the variations the plan of month 2 made of them", async () => {
  const { root, store, plan2, winners, measuredVariation } = world();
  const d = await performance(ctxOf(root, store));
  assert.equal(winners.length, 2, "the top 20% of 10 measured posts");
  assert.deepEqual(d.winners.map((w) => [w.piece_id, w.month, w.views]), winners.map((w) => [w.piece_id, "2026-10", w.views]).sort((a, b) => (b[2] as number) - (a[2] as number)));
  for (const w of d.winners) {
    const expected = plan2.slots.filter((s) => s.variant_of === w.piece_id).map((s) => s.piece_id).sort();
    assert.ok(expected.length > 0, "every winner got variations in the next month");
    assert.deepEqual(w.variations.map((v) => v.piece_id).sort(), expected);
    assert.ok(w.variations.every((v) => v.month === "2026-11"));
    assert.ok(w.variations.filter((v) => v.piece_id !== measuredVariation.piece_id).every((v) => v.stage === "planned" && v.state === "pending"), "planned, nothing produced yet");
    assert.ok(w.variations.every((v) => ["hook_variant", "cutdown", "slideshow"].includes(v.format)));
  }
  const measured = d.winners.flatMap((w) => w.variations).find((v) => v.piece_id === measuredVariation.piece_id)!;
  assert.deepEqual([measured.views, measured.stage, measured.state], [700, "metrics", "done"], "a measured variation has been published");
  assert.ok(d.winners.flatMap((w) => w.variations).filter((v) => v.piece_id !== measuredVariation.piece_id).every((v) => v.views === null), "an unmeasured variation is null, not 0");
  // the ranking marks the winners and the variations point back to them
  assert.deepEqual(d.posts.filter((p) => p.winner).map((p) => p.piece_id).sort(), winners.map((w) => w.piece_id).sort());
  assert.equal(d.posts.find((p) => p.piece_id === measuredVariation.piece_id)?.variant_of, winners[0]?.piece_id);
});

test("format, hook and language comparisons match a reference computation", async () => {
  const { root, store, plan1, month1, views, measuredVariation } = world();
  const d = await performance(ctxOf(root, store));
  const rows = [...month1.map((s, i) => ({ format: s.format, hook: s.hook, piece: s.piece_id, v: views(i) })), { format: measuredVariation.format, hook: measuredVariation.hook, piece: measuredVariation.piece_id, v: 700 }];
  const byFormat = new Map<string, number[]>();
  for (const r of rows) byFormat.set(r.format, [...(byFormat.get(r.format) ?? []), r.v]);
  assert.equal(d.comparison.by_format.length, byFormat.size);
  for (const g of d.comparison.by_format) {
    const vs = (byFormat.get(g.group) as number[]).sort((a, b) => a - b);
    assert.deepEqual([g.posts, g.measured, g.total, g.mean], [vs.length, vs.length, vs.reduce((a, b) => a + b, 0), mean(vs)], g.group);
    assert.equal(g.median, vs.length % 2 ? vs[(vs.length - 1) / 2] : (vs[vs.length / 2 - 1]! + vs[vs.length / 2]!) / 2, `${g.group} median`);
  }
  assert.deepEqual(d.comparison.by_format.map((g) => g.mean), [...d.comparison.by_format.map((g) => g.mean)].sort((a, b) => (b ?? -1) - (a ?? -1)), "best group first");
  const byHook = new Map<string, number[]>();
  for (const r of rows) byHook.set(r.hook, [...(byHook.get(r.hook) ?? []), r.v]);
  assert.equal(d.comparison.by_hook.length, Math.min(byHook.size, 20));
  for (const g of d.comparison.by_hook) assert.equal(g.mean, mean(byHook.get(g.group) as number[]), g.group);
  // language: the second piece was dubbed to English, everything else is the original
  const original = d.comparison.by_language.find((g) => g.group.startsWith("original"))!;
  const dubbed = d.comparison.by_language.find((g) => g.group.startsWith("dublado"))!;
  assert.equal(original.posts, 10);
  assert.deepEqual([dubbed.group, dubbed.posts, dubbed.total], [`dublado (${plan1.slots[1]?.language})`, 1, 900], "the dubbed post and its language label");
});

test("growth per client is the sum of each post's latest views by day, and a day before any reading is null", async () => {
  const { root, store, month1 } = world();
  const d = await performance(ctxOf(root, store, "days=60"));
  assert.equal(d.growth.days, 60);
  const g = d.growth.clients.find((c) => c.client === "lothus")!;
  assert.equal(g.points.length, 60);
  assert.equal(g.points.at(-1)?.date, "2026-11-10");
  const at = (date: string) => g.points.find((p) => p.date === date)!;
  const firstPublish = Date.parse((month1[0] as { publish_at: string }).publish_at);
  const dayBefore = iso(firstPublish - 2 * DAY).slice(0, 10);
  assert.deepEqual([at(dayBefore).views, at(dayBefore).posts], [null, 0], "no reading yet: null, not 0");
  const first = at(iso(firstPublish + DAY).slice(0, 10));
  assert.ok(first.views !== null && first.posts >= 1);
  assert.equal(at("2026-11-10").views, 5500 + 700, "all ten posts of October at their latest (1000 + 900 + ... + 100) and the variation");
  const series = g.points.filter((p) => p.views !== null).map((p) => p.views as number);
  assert.deepEqual(series, [...series].sort((a, b) => a - b), "cumulative views never go down");
  assert.equal(at("2026-11-09").views, 5500 + 700, "the variation is read on the 9th");
  assert.equal(at("2026-11-08").views, 5500);
});

test("filters, preview flag and the read-only route", async () => {
  const { root, store } = world();
  const ig = await performance(ctxOf(root, store, "network=ig_reels"));
  assert.ok(ig.posts.length > 0 && ig.posts.every((p) => p.network === "ig_reels"));
  assert.equal((await performance(ctxOf(root, store, "client=nobody"))).posts.length, 0);
  assert.equal((await performance(ctxOf(root, store, "metric=bogus"))).metric, "views", "an unknown metric falls back to views");
  assert.ok((await performance(ctxOf(root, store))).posts.every((p) => p.has_preview === false), "no preview file, no preview");

  const server = await startDashboard({ root, pollMs: 50 });
  try {
    const headers = { authorization: `Bearer ${server.token}` };
    const ok = await fetch(`${server.url}/api/performance?metric=likes`, { headers });
    assert.equal(ok.status, 200);
    assert.equal(((await ok.json()) as { metric: string }).metric, "likes");
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) assert.equal((await fetch(`${server.url}/api/performance`, { method, headers })).status, 405);
  } finally {
    await server.close();
  }
});
