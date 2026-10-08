import { test } from "node:test";
import assert from "node:assert/strict";
import { cockpit, compute, describe } from "../../lib/dashboard/views/cockpit.ts";
import { pipeline } from "../../lib/dashboard/views/pipeline.ts";
import { calendar } from "../../lib/dashboard/views/calendar.ts";
import { STAGES, allPlans, buildPieceModels } from "../../lib/dashboard/model.ts";
import { aliasMap, maskTree } from "../../lib/dashboard/views/common.ts";
import { DAY, HOUR, emptyHost, pieceEvents, planned, syntheticOperation, sha } from "../helpers/dashboard-fixture.ts";
import { EventStore } from "../../lib/dashboard/store.ts";
import { defaultSources } from "../../lib/observability/dashboard/index.ts";
import { makeEvent } from "../../lib/dashboard/events.ts";
import type { ViewContext } from "../../lib/dashboard/routes.ts";

const NOW = new Date("2026-10-07T12:00:00Z");

function ctx(root: string, store: EventStore, query = "", now = NOW, alerts: ViewContext["alerts"] = () => []): ViewContext {
  return { root, store, sources: defaultSources(root), now, query: new URLSearchParams(query), alerts };
}

/** Reference KPIs: written independently of lib/dashboard/views/cockpit.ts, straight from the fixture's rules. */
function reference(op: ReturnType<typeof syntheticOperation>, asOf: Date) {
  const t = asOf.getTime();
  const stageTs = (p: (typeof op.pieces)[number], stage: number) => p.baseTs + stage * HOUR;
  const funnel: number[] = Array(11).fill(0);
  let started = 0;
  let scheduled30 = 0;
  let publishedToday = 0;
  let publishedWeek = 0;
  let pendingClient = 0;
  const startOfDay = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
  for (const p of op.pieces) {
    // the furthest stage whose event had already happened by `asOf`
    let reached = -1;
    for (let s = 0; s <= p.reach; s++) if (stageTs(p, s) <= t) reached = s;
    if (reached < 0) continue;
    started++;
    funnel[reached]++;
    if (reached >= 8 && p.publishAtMs > t && p.publishAtMs <= t + 30 * DAY) scheduled30++;
    const liveAt = reached >= 9 ? stageTs(p, 9) : null; // published (or metrics) is the first proof it is live
    if (liveAt !== null && liveAt >= startOfDay) publishedToday++;
    if (liveAt !== null && liveAt > t - 7 * DAY) publishedWeek++;
    if (reached === 6 && p.reach === 6) pendingClient++; // requested, not yet decided
  }
  return { started, funnel, scheduled30, publishedToday, publishedWeek, pendingClient };
}

test("cockpit KPIs match the reference computation for 5 clients and 60 pieces, now and a week ago", async () => {
  const op = syntheticOperation(NOW);
  assert.equal(op.pieces.length, 60);
  const view = await cockpit(ctx(op.root, op.store));
  const now = reference(op, NOW);
  const before = reference(op, new Date(NOW.getTime() - 7 * DAY));
  const kpi = (id: string) => view.kpis.find((k) => k.id === id)!;

  assert.equal(kpi("pieces_in_funnel").value, now.started);
  assert.equal(kpi("pieces_in_funnel").previous, before.started);
  assert.equal(kpi("pieces_in_funnel").delta, now.started - before.started);
  assert.deepEqual(STAGES.map((s) => (kpi("pieces_in_funnel").detail!.by_stage as Record<string, number>)[s]), now.funnel);
  assert.equal(kpi("scheduled_30d").value, now.scheduled30);
  assert.equal(kpi("scheduled_30d").previous, before.scheduled30);
  assert.equal(kpi("published_today").value, now.publishedToday);
  assert.equal(kpi("published_week").value, now.publishedWeek);
  assert.equal(kpi("published_week").previous, before.publishedWeek);
  assert.equal(kpi("approvals_client").value, now.pendingClient);
  assert.equal(kpi("approvals_client").previous, before.pendingClient);
  assert.equal(kpi("publish_failures").value, 0);
  // no source: "sem dado", never zero
  for (const id of ["credits_ro", "tts_quota", "mrr", "sales_month"]) assert.equal(kpi(id).value, null, id);
  assert.equal(kpi("credits_ro").detail!.source, "leitura da Real Oficial desligada");
});

test("cockpit: river drops, feed text, client grid health and the country tiles", async () => {
  const op = syntheticOperation(NOW);
  const alerts: ViewContext["alerts"] = () => [
    { key: "a", rule: "publish_failed", severity: "error", client: "wjr", message: "x", since: NOW.toISOString() },
    { key: "b", rule: "stage_stuck", severity: "warn", client: "lothus", message: "y", since: NOW.toISOString() },
  ];
  const view = await cockpit(ctx(op.root, op.store, "", NOW, alerts));
  assert.equal(view.river.nodes.length, 11);
  assert.equal(view.river.nodes[0]!.reached, 60 - op.pieces.filter(() => false).length, "every started piece passes through the first stage");
  for (let i = 1; i < view.river.nodes.length; i++) assert.ok(view.river.nodes[i]!.reached <= view.river.nodes[i - 1]!.reached, "the river only narrows");
  assert.equal(view.river.links.length, 10);
  assert.ok(view.river.links.every((l) => l.dropped >= 0 && (l.avg_hours === null || l.avg_hours >= 0)));
  assert.equal(view.feed.length, 30);
  assert.ok(view.feed.every((f, i, a) => i === 0 || (a[i - 1]!.seq > f.seq)));
  assert.ok(view.feed.every((f) => f.text.length > 0 && f.text !== f.kind));
  const health = Object.fromEntries(view.clients.map((c) => [c.slug, c.health]));
  assert.deepEqual(health, { "acme-us": "ok", "berlin-gmbh": "ok", "lion-sg": "ok", lothus: "attention", wjr: "critical" });
  assert.deepEqual(view.world.map((w) => w.country), ["BR", "CH", "DE", "SG", "US"]);
  assert.ok(view.world.every((w) => w.clients.length === 1 && w.dubbed_versions === 0));
  assert.equal(view.clients.find((c) => c.slug === "lothus")!.month_filled_pct, null, "no plan, no percentage");
});

test("cockpit: money, quota and credits come from their events and the read-only window", async () => {
  const { root } = emptyHost();
  const store = new EventStore(root);
  const e = (kind: Parameters<typeof makeEvent>[0]["kind"], key: string, ts: string, data: Record<string, unknown>, client = "acme") => makeEvent({ source: "fx", key, ts, kind, client, data });
  store.ingest([
    e("payment_received", "p1", "2026-10-02T10:00:00Z", { amount: 356, currency: "USD", amount_brl: 1958, processor: "stripe" }),
    e("payment_received", "p2", "2026-10-03T10:00:00Z", { amount: 197, currency: "BRL", amount_brl: 197, processor: "abacatepay" }),
    e("payment_received", "old", "2026-09-20T10:00:00Z", { amount: 999, currency: "BRL", amount_brl: 999, processor: "abacatepay" }),
    e("subscription_changed", "s1", "2026-10-02T10:00:00Z", { status: "active", mrr: 356, amount_brl: 1958 }),
    e("subscription_changed", "s2", "2026-10-01T10:00:00Z", { status: "active", mrr: 100, amount_brl: 550 }, "other"),
    e("subscription_changed", "s3", "2026-10-04T10:00:00Z", { status: "canceled" }, "other"),
    e("tts_quota", "t1", "2026-10-07T09:00:00Z", { requests: 8, limit: 10, exhausted: false }),
    e("tts_quota", "t2", "2026-10-07T10:00:00Z", { requests: 10, limit: 10, exhausted: true, blocked_until: "2026-10-07T21:27:00.000Z" }),
    e("publish_failed", "f1", "2026-10-06T10:00:00Z", { failure_class: "login_required" }),
  ]);
  const roCalls: string[] = [];
  const ro = { get: async (tool: string) => (roCalls.push(tool), { data: { credits: 420 }, cached: false, fetched_at: NOW.toISOString() }) };
  const view = await cockpit({ ...ctx(root, store), ro: ro as never });
  const kpi = (id: string) => view.kpis.find((k) => k.id === id)!;
  assert.equal(kpi("mrr").value, 1958, "the canceled subscription no longer counts");
  assert.equal(kpi("sales_month").value, 2155, "only this month, in BRL");
  assert.equal(kpi("sales_month").detail!.currency, "BRL");
  assert.deepEqual([kpi("tts_quota").value, kpi("tts_quota").detail!.limit, kpi("tts_quota").detail!.blocked_until], [10, 10, "2026-10-07T21:27:00.000Z"]);
  assert.equal(kpi("publish_failures").value, 1);
  assert.equal(kpi("credits_ro").value, 420);
  assert.deepEqual(roCalls, ["ro_whoami"]);
  assert.match(describe(store.all().find((x) => x.kind === "marketing.payment_received")!), /Pagamento recebido \(stripe\)/);
  assert.equal(describe({ ...store.all()[0]!, kind: "marketing.watcher_gate", data: { passed: true, tag: "MEASURED" } } as never), "Watcher: MEASURED");
});

test("pipeline: a 30 day campaign shows every column with the right counts, timings and filters", async () => {
  const { root } = emptyHost();
  const plan = planned(root, NOW);
  assert.ok(plan.slots.length >= 36);
  const store = new EventStore(root);
  const events = plan.slots.flatMap((slot, i) => {
    const reach = [1, 3, 5, 6, 7, 8, 9][i % 7]!;
    return pieceEvents({ k: i, client: "lothus", piece_id: slot.piece_id, network: slot.network, reach, baseTs: NOW.getTime() - (i % 5) * DAY - 30 * HOUR, publishAt: slot.publish_at });
  });
  store.ingest(events.sort((a, b) => a.ts.localeCompare(b.ts)));
  const view = await pipeline(ctx(root, store));
  assert.deepEqual([...view.stages], [...STAGES]);
  const expected: Record<string, number> = Object.fromEntries(STAGES.map((s) => [s, 0]));
  plan.slots.forEach((_s, i) => { expected[STAGES[[1, 3, 5, 6, 7, 8, 9][i % 7]!]!]++; });
  assert.deepEqual(view.counts, expected);
  assert.equal(view.cards.length, plan.slots.length);
  assert.ok(view.cards.every((c) => c.format !== null && c.network !== null && c.client === "lothus" && c.campaign_id === plan.plan_id), "format and network come from the plan");
  assert.ok(view.cards.every((c, i, a) => i === 0 || STAGES.indexOf(a[i - 1]!.stage) <= STAGES.indexOf(c.stage)));
  assert.ok(view.cards.every((c) => c.time_in_stage_h !== null && c.time_in_stage_h >= 0));
  assert.equal(view.cards.every((c) => c.has_final === false), true, "no final file exists: the panel never produces one");
  assert.ok(view.bottlenecks.oldest_stuck && view.bottlenecks.oldest_stuck.hours! > 0);
  assert.ok(Object.values(view.bottlenecks.avg_hours_into_stage).some((h) => h !== null && h > 0));

  const tiktok = await pipeline(ctx(root, store, "network=tiktok"));
  assert.ok(tiktok.cards.length > 0 && tiktok.cards.every((c) => c.network === "tiktok"));
  assert.equal((await pipeline(ctx(root, store, "format=hero"))).cards.every((c) => c.format === "hero"), true);
  assert.equal((await pipeline(ctx(root, store, "client=ghost"))).cards.length, 0);
  assert.equal((await pipeline(ctx(root, store, `q=${plan.slots[0]!.piece_id.toLowerCase()}`))).cards.length, 1);
  assert.equal((await pipeline(ctx(root, store, "status=done"))).cards.every((c) => c.state === "done"), true);
  assert.deepEqual(view.filters.clients, ["lothus"]);
});

test("pipeline: failures and retries stay on the stage that failed, variations form a tree", async () => {
  const { root } = emptyHost();
  const store = new EventStore(root);
  const base = NOW.getTime() - 10 * HOUR;
  const ev = (piece: string, key: string, tsOffset: number, kind: Parameters<typeof makeEvent>[0]["kind"], data: Record<string, unknown>) =>
    makeEvent({ source: "fx", key, ts: new Date(base + tsOffset * HOUR).toISOString(), kind, client: "acme", piece_id: piece, data });
  store.ingest([
    ev("P-retry", "1", 0, "qa_result", { passed: false }),
    ev("P-retry", "2", 1, "qa_result", { passed: false }),
    ev("P-retry", "3", 2, "qa_result", { passed: true }),
    ev("P-bad", "4", 0, "compliance_result", { pass: false }),
    ev("P-fin", "5", 0, "render_started", {}),
    ev("P-adj", "6", 0, "approval_requested", { queue: "client" }),
    ev("P-adj", "7", 1, "approval_decided", { decision: "changes_requested" }),
  ]);
  const view = await pipeline(ctx(root, store));
  const card = (id: string) => view.cards.find((c) => c.piece_id === id)!;
  assert.deepEqual([card("P-retry").stage, card("P-retry").state, card("P-retry").retries], ["qa", "done", 2]);
  assert.deepEqual([card("P-bad").stage, card("P-bad").state], ["compliance", "failed"]);
  assert.deepEqual([card("P-fin").stage, card("P-fin").state], ["final", "active"]);
  assert.deepEqual([card("P-adj").stage, card("P-adj").state], ["approval", "failed"]);
  assert.deepEqual(view.bottlenecks.oldest_stuck?.piece_id, "P-bad");
  const models = buildPieceModels(store.all(), []);
  assert.equal(models.get("P-retry")!.stages.qa.attempts, 3);
  assert.deepEqual(allPlans(root), []);
});

test("calendar: 30 days x 3 networks render in Sao Paulo, New York and Singapore, and the next cycle never reads as scheduled", async () => {
  const { root } = emptyHost();
  const plan = planned(root, NOW, "lothus", { days: 45, perWeek: 3 });
  const view = await calendar(ctx(root, new EventStore(root), "tz=America/Sao_Paulo,America/New_York,Asia/Singapore&from=2026-10-07&to=2026-12-31"));
  assert.deepEqual(view.zones, ["America/Sao_Paulo", "America/New_York", "Asia/Singapore"]);
  assert.equal(view.entries.length, plan.slots.length);
  assert.deepEqual([...new Set(view.entries.map((e) => e.network))].sort(), ["ig_reels", "tiktok", "yt_shorts"]);
  for (const entry of view.entries) {
    const at = new Date(entry.publish_at);
    const hourIn = (tz: string) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(at));
    assert.equal(Number(entry.zones["America/Sao_Paulo"]!.slice(11, 13)), hourIn("America/Sao_Paulo"));
    assert.equal(Number(entry.zones["America/New_York"]!.slice(11, 13)), hourIn("America/New_York"));
    assert.equal(Number(entry.zones["Asia/Singapore"]!.slice(11, 13)), hourIn("Asia/Singapore"));
    assert.equal(entry.brt, entry.zones["America/Sao_Paulo"]);
  }
  const later = view.entries.filter((e) => e.window === "next_cycle");
  assert.ok(later.length > 0);
  assert.ok(later.every((e) => e.status === "queued_next_cycle" && e.scheduled_on_realoficial === false && e.next_cycle_note === "na fila do próximo ciclo"));
  assert.ok(view.entries.every((e) => e.scheduled_on_realoficial === false), "nothing was scheduled in this fixture");
  assert.ok(view.heatmap[0]!.weekly_goal > 0);
  const imminent = plan.slots.filter((s) => Date.parse(s.publish_at) > NOW.getTime() && Date.parse(s.publish_at) - NOW.getTime() < DAY);
  assert.ok(imminent.length > 0, "the fixture has a post due within 24 h and not approved");
  assert.deepEqual(view.conflicts.map((c) => [c.type, c.piece_id]), imminent.map((s) => ["without_approval", s.piece_id]));
});

test("calendar: filters, invalid zones, conflicts and the keyboard-relevant ordering", async () => {
  const { root } = emptyHost();
  const plan = planned(root, NOW, "lothus", { days: 10, perWeek: 7 });
  const store = new EventStore(root);
  const only = await calendar(ctx(root, store, "network=tiktok&tz=Mars/Base,America/New_York"));
  assert.deepEqual(only.zones, ["America/New_York"], "invalid zones are dropped");
  assert.ok(only.entries.every((e) => e.network === "tiktok"));
  assert.ok(only.entries.every((e, i, a) => i === 0 || a[i - 1]!.publish_at <= e.publish_at));
  assert.equal((await calendar(ctx(root, store, "client=ghost"))).entries.length, 0);
  assert.deepEqual((await calendar(ctx(root, store, "tz=bad"))).zones.length, 3, "falls back to the default zones");

  // a post less than 24 h away without approval is flagged
  const soon = plan.slots.find((s) => Date.parse(s.publish_at) > NOW.getTime())!;
  const near = new Date(Date.parse(soon.publish_at) - 20 * HOUR);
  const flagged = await calendar(ctx(root, store, "", near));
  assert.ok(flagged.conflicts.some((c) => c.type === "without_approval" && c.piece_id === soon.piece_id));
});

test("presentation masking replaces slugs and names in any shape of data", () => {
  const aliases = aliasMap(["wjr", "lothus"]);
  assert.deepEqual([...aliases.entries()], [["lothus", "Cliente A"], ["wjr", "Cliente B"]]);
  const masked = maskTree({ client: "lothus", rows: [{ piece_id: "PIECE-lothus-01", text: "Lothus resolve", lothus: 1 }] }, aliases, new Map([["Lothus", "Cliente A"]]));
  assert.deepEqual(masked, { client: "Cliente A", rows: [{ piece_id: "PIECE-Cliente A-01", text: "Cliente A resolve", "Cliente A": 1 }] });
  assert.equal(sha(1).length, 64);
  assert.equal(compute([], [], NOW).funnelTotal, 0);
});
