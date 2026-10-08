import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFileSync as read } from "node:fs";
import { resolve } from "node:path";
import { collectMetrics, linkPost, listLinks } from "../../lib/analytics/collect.ts";
import { appendSnapshot, readSnapshots } from "../../lib/analytics/score.ts";
import { listWinners, recordWinners, selectWinners } from "../../lib/analytics/winners.ts";
import { engineRoot } from "../../lib/clients/paths.ts";
import { allPlans } from "../../lib/dashboard/model.ts";
import { planContent, DEFAULT_WINNER_SHARE, VARIATION_FORMATS } from "../../lib/plan/content-plan.ts";
import { appendReceipt, listReceipts, receiptIdOf, scheduleKey, type ScheduleReceipt } from "../../lib/publish/publisher.ts";
import { buildMonthlyReport, NO_DATA } from "../../lib/report/monthly.ts";
import { markdownToPdf } from "../../lib/report/pdf.ts";
import { emptyHost, planned, profileFor } from "../helpers/dashboard-fixture.ts";
import { fromMetricSnapshots } from "../../lib/observability/dashboard/billing.ts";
import { fromWinners } from "../../lib/observability/dashboard/internal.ts";
import type { Fetcher } from "../../lib/analytics/post-metrics.ts";

const NOW = new Date("2026-10-07T12:00:00Z");

function setup() {
  process.env.DRY_RUN = "true";
  const { root } = emptyHost();
  const plan = planned(root, NOW, "lothus", { start: "2026-10-08" });
  const october = plan.slots.filter((s) => s.publish_at.startsWith("2026-10"));
  return { root, plan, october };
}

function receipt(root: string, slot: { piece_id: string; network: ScheduleReceipt["network"]; publish_at: string }, dryRun = true): ScheduleReceipt {
  const key = scheduleKey({ pieceId: slot.piece_id, network: slot.network, publishAt: slot.publish_at });
  const r: ScheduleReceipt = {
    schema: "marketing-publish-receipt/v1",
    ts: NOW.toISOString(),
    piece_id: slot.piece_id,
    client: "lothus",
    provider: "dry-run",
    publisher: "dry-run",
    dry_run: dryRun,
    verdict: "scheduled",
    claims_tag: "MEASURED",
    attempts: 1,
    stages: [{ stage: "schedule", ok: true }],
    network: slot.network,
    publish_at: slot.publish_at,
    approval_ref: "ap",
    media_sha256: "a".repeat(64),
    receipt_id: receiptIdOf(key),
    schedule_key: key,
  };
  appendReceipt(root, r);
  return r;
}

function views(root: string, piece_id: string, network: string, value: number, at = "2026-10-30T00:00:00Z"): void {
  appendSnapshot(engineRoot(root), { piece_id, channel_id: network, metric: "views", value, polled_at: at, source: "manual" });
}

test("a post is linked to the receipt that scheduled it, and only to a real one", () => {
  const { root, october } = setup();
  const slot = october[0]!;
  assert.throws(() => linkPost(root, { client: "lothus", pieceId: slot.piece_id, network: slot.network, publishAt: slot.publish_at, source: "youtube", externalId: "yt-aaa111" }), /no publish receipt/);
  const r = receipt(root, slot);
  const link = linkPost(root, { client: "lothus", pieceId: slot.piece_id, network: slot.network, publishAt: slot.publish_at, source: "youtube", externalId: "yt-aaa111", now: NOW });
  assert.equal(link.receipt_id, r.receipt_id);
  assert.equal(listLinks(root, "lothus").length, 1);
  assert.equal(listLinks(root, "other").length, 0);
  assert.throws(() => linkPost(root, { client: "lothus", pieceId: slot.piece_id, network: slot.network, publishAt: slot.publish_at, source: "youtube", externalId: "a b" }), /post id/);
  assert.throws(() => linkPost(root, { client: "lothus", pieceId: slot.piece_id, network: slot.network, publishAt: slot.publish_at, source: "nope" as never, externalId: "yt-aaa111" }), /unknown source/);
});

test("collect pulls recorded numbers into snapshots tied to the receipt, and DRY_RUN never fetches", async () => {
  const { root, october } = setup();
  const [a, b] = [october[0]!, october[1]!];
  const ra = receipt(root, a);
  receipt(root, b);
  linkPost(root, { client: "lothus", pieceId: a.piece_id, network: a.network, publishAt: a.publish_at, source: "youtube", externalId: "yt-aaa111" });
  linkPost(root, { client: "lothus", pieceId: b.piece_id, network: b.network, publishAt: b.publish_at, source: "youtube", externalId: "yt-bbb222" });
  let calls = 0;
  const fetcher: Fetcher = async () => {
    calls++;
    return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(resolve("tests/fixtures/analytics/youtube-videos-list.json"), "utf8")) };
  };
  const dry = await collectMetrics(root, { client: "lothus", credentials: { youtubeApiKey: "K" }, fetcher, dryRun: true });
  assert.equal(dry.snapshots, 0);
  assert.equal(calls, 0, "DRY_RUN does not touch the network");

  const live = await collectMetrics(root, { client: "lothus", credentials: { youtubeApiKey: "K" }, fetcher, dryRun: false, now: new Date("2026-10-30T00:00:00Z") });
  assert.equal(calls, 1, "one request for both videos");
  assert.equal(live.snapshots, 5, "3 metrics of the first video, 2 of the second");
  const snaps = readSnapshots(engineRoot(root));
  const first = snaps.filter((s) => s.piece_id === a.piece_id);
  assert.deepEqual(first.map((s) => s.metric).sort(), ["comments", "likes", "views"]);
  assert.ok(first.every((s) => s.receipt_id === ra.receipt_id && s.channel_id === a.network && s.source === "api"));
  assert.equal(snaps.filter((s) => s.piece_id === b.piece_id && s.metric === "likes").length, 0, "a metric the source did not report is not stored as zero");
});

test("collect skips what it cannot read and says why", async () => {
  const { root, october } = setup();
  const slot = october[0]!;
  receipt(root, slot);
  for (const source of ["youtube", "tiktok", "instagram", "realoficial"] as const) linkPost(root, { client: "lothus", pieceId: slot.piece_id, network: slot.network, publishAt: slot.publish_at, source, externalId: "post-1234" });
  const none = await collectMetrics(root, { client: "lothus", credentials: {}, dryRun: false });
  assert.equal(none.snapshots, 0);
  assert.deepEqual(none.skipped.map((s) => s.reason).sort(), ["no Instagram token", "no Real Oficial transport", "no TikTok token", "no YouTube API key"]);
  const broken: Fetcher = async () => ({ ok: false, status: 500, json: async () => ({}) });
  const failed = await collectMetrics(root, { client: "lothus", credentials: { youtubeApiKey: "K", tiktokToken: "T", instagramToken: "I" }, fetcher: broken, dryRun: false });
  assert.ok(failed.skipped.some((s) => s.source === "youtube" && s.reason === "youtube: HTTP 500"));
  assert.ok(failed.skipped.some((s) => s.source === "instagram" && s.reason === "instagram: HTTP 500"));
});

test("winners need enough measured posts; with data the top share is marked and kept for the planner", () => {
  const { root, plan, october } = setup();
  views(root, october[0]!.piece_id, october[0]!.network, 900);
  views(root, october[1]!.piece_id, october[1]!.network, 800);
  assert.deepEqual(selectWinners(root, [plan], "lothus", "2026-10", { now: NOW }), [], "two measured posts are not enough to call a winner");

  october.slice(2, 10).forEach((s, i) => views(root, s.piece_id, s.network, 100 + i * 10));
  views(root, october[10]!.piece_id, october[10]!.network, 25_000);
  const winners = selectWinners(root, [plan], "lothus", "2026-10", { now: NOW });
  assert.equal(winners.length, 3, "top 20% of 11 measured posts, rounded up");
  assert.equal(winners[0]?.piece_id, october[10]!.piece_id);
  assert.equal(winners[0]?.views, 25_000);
  assert.equal(winners[0]?.hook, october[10]!.hook);
  assert.equal(winners[0]?.format, october[10]!.format);
  assert.equal(selectWinners(root, [plan], "lothus", "2026-11", { now: NOW }).length, 0, "another month has no data");
  assert.equal(selectWinners(root, [plan], "other", "2026-10", { now: NOW }).length, 0);

  recordWinners(root, winners);
  recordWinners(root, winners);
  assert.equal(listWinners(root, { client: "lothus", month: "2026-10" }).length, 3, "re-marking the same winners adds nothing");
  const events = fromWinners(root);
  assert.equal(events.length, 3);
  assert.equal(events[0]?.kind, "marketing.winner_marked");
});

test("the month 2 plan carries more variations of the month 1 winners than a plain plan", () => {
  const { root, plan, october } = setup();
  october.slice(0, 10).forEach((s, i) => views(root, s.piece_id, s.network, 100 + i));
  views(root, october[10]!.piece_id, october[10]!.network, 25_000);
  const winners = selectWinners(root, [plan], "lothus", "2026-10", { now: NOW });
  const profile = profileFor("lothus", "https://lothus.example", "BR", NOW);
  const input = { client: "lothus", profile, start: "2026-11-01", days: 30, now: NOW } as const;
  const plain = planContent(input);
  const next = planContent({ ...input, winners });
  const ids = new Set(winners.map((w) => w.piece_id));
  const variations = next.slots.filter((s) => s.variant_of);
  assert.equal(plain.slots.filter((s) => s.variant_of).length, 0);
  assert.ok(variations.length > 0);
  assert.equal(variations.length, Math.round(next.slots.length * DEFAULT_WINNER_SHARE));
  assert.ok(variations.every((s) => ids.has(s.variant_of!)), "every variation points at a winner");
  assert.ok(variations.every((s) => (VARIATION_FORMATS as readonly string[]).includes(s.format)));
  assert.ok(variations.every((s) => s.hook === winners.find((w) => w.piece_id === s.variant_of)!.hook));
  assert.equal(next.slots.length, plain.slots.length, "variations replace slots, they do not add posts");
  assert.deepEqual(planContent({ ...input, winners }), next, "same winners, same plan");
  assert.equal(planContent({ ...input, winners, winnerShare: 0 }).slots.filter((s) => s.variant_of).length, 0);
  assert.throws(() => planContent({ ...input, winners, winnerShare: 1.5 }), /winnerShare/);
  assert.ok(allPlans(root).length === 1);
});

test("the report prints sem dado for what no source gave and never sums a missing number as zero", () => {
  const { root, plan, october } = setup();
  const [a, b, c, d] = october;
  for (const s of [a!, b!, c!, d!]) receipt(root, s, s === d);
  views(root, a!.piece_id, a!.network, 5000);
  views(root, b!.piece_id, b!.network, 12_000);
  views(root, c!.piece_id, c!.network, 300);
  appendSnapshot(engineRoot(root), { piece_id: a!.piece_id, channel_id: a!.network, metric: "likes", value: 400, polled_at: "2026-10-30T00:00:00Z", source: "manual" });
  recordWinners(root, [{ client: "lothus", month: "2026-10", piece_id: b!.piece_id, network: b!.network, format: b!.format, hook: b!.hook, angle: b!.angle, views: 12_000, marked_at: NOW.toISOString() }]);

  const report = buildMonthlyReport(root, [plan], "lothus", "2026-10", "Lothus");
  assert.equal(report.posts.length, 4);
  assert.equal(report.measured, 3);
  assert.deepEqual(report.top.map((p) => p.piece_id), [b!.piece_id, a!.piece_id, c!.piece_id]);
  const md = report.markdown;
  assert.match(md, /^# Relatório de outubro de 2026 - Lothus/);
  assert.match(md, /Posts do mês: 4 \(3 com número de visualizações\)/);
  assert.match(md, /Visualizações: 17\.300 \(soma de 3 de 4 posts com dado\)/);
  assert.match(md, /Curtidas: 400 \(soma de 1 de 4 posts com dado\)/);
  assert.match(md, /Compartilhamentos: sem dado/);
  assert.match(md, /1\. .*12\.000 visualizações/);
  assert.ok(md.includes(NO_DATA));
  assert.match(md, /\(simulação\)/, "a dry-run receipt is labelled as simulation");
  assert.match(md, /Mais variações de ".*" \(.*12\.000 visualizações\)/);
  assert.equal(buildMonthlyReport(root, [plan], "lothus", "2026-10", "Lothus").markdown, md, "deterministic");

  const empty = buildMonthlyReport(root, [plan], "lothus", "2026-11");
  assert.equal(empty.posts.length, 0);
  assert.match(empty.markdown, /Visualizações: sem dado/);
  assert.match(empty.markdown, /nenhum post tem visualizações medidas/);
  assert.match(empty.markdown, /sem dado: são necessários pelo menos 3 posts/);
  assert.throws(() => buildMonthlyReport(root, [plan], "lothus", "2026-13"), /YYYY-MM/);
  assert.equal(listReceipts(root).length, 4);
});

test("the PDF is a valid, deterministic Latin-1 text document with a correct xref", () => {
  const md = `# Relatório de março\n\n- Visualizações: 1.200\n\n${"linha de texto com acentuação e números 123 ".repeat(40)}\n${Array.from({ length: 120 }, (_, i) => `- item ${i}`).join("\n")}\n`;
  const pdf = markdownToPdf(md);
  assert.equal(pdf.subarray(0, 8).toString("latin1"), "%PDF-1.4");
  assert.ok(pdf.includes(Buffer.from([0xe9])) || pdf.includes(Buffer.from("Relat", "latin1")), "accents are written as Latin-1 bytes");
  const text = pdf.toString("latin1");
  const pages = Number(/\/Count (\d+)/.exec(text)?.[1]);
  assert.ok(pages >= 3, `long reports paginate (got ${pages})`);
  const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(text)?.[1]);
  assert.equal(text.slice(startxref, startxref + 4), "xref");
  const entries = [...text.slice(startxref).matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]));
  entries.forEach((offset, i) => assert.match(text.slice(offset, offset + 12), new RegExp(`^${i + 1} 0 obj`)));
  assert.deepEqual(markdownToPdf(md), pdf, "same markdown, same bytes");
  assert.ok(markdownToPdf("").length > 100, "an empty report is still a valid file");
  assert.ok(markdownToPdf("a ( b ) \\ “q” — x ≥ y 日本").toString("latin1").includes("a \\( b \\) \\\\"));
});

test("snapshots keep reaching the dashboard stream with their network", () => {
  const { root, october } = setup();
  views(root, october[0]!.piece_id, october[0]!.network, 77);
  const events = fromMetricSnapshots(root);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.data.value, 77);
  assert.equal(events[0]?.network, october[0]!.network);
  assert.ok(read(resolve(engineRoot(root), "data", "analytics-snapshots.jsonl"), "utf8").includes('"views"'));
});
