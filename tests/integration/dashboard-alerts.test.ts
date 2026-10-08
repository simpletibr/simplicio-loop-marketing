import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { makeEvent, type MarketingKind } from "../../lib/dashboard/events.ts";
import { EventStore, type StoredEvent } from "../../lib/dashboard/store.ts";
import { DEFAULT_THRESHOLDS, evaluateAlerts, thresholdsFromEnv, type AlertInput } from "../../lib/dashboard/alerts.ts";
import { alerts as alertsView } from "../../lib/dashboard/views/alerts.ts";
import { createReadOnlyRo } from "../../lib/dashboard/realoficial.ts";
import { startDashboard } from "../../lib/dashboard/server.ts";
import { defaultSources } from "../../lib/observability/dashboard/index.ts";
import { requestApproval } from "../../lib/approval/store.ts";
import { receiptIdOf, scheduleKey, type Network, type ScheduleFailure, type ScheduleReceipt } from "../../lib/publish/publisher.ts";
import { DAY, HOUR, emptyHost, planned, sha } from "../helpers/dashboard-fixture.ts";
import type { ViewContext } from "../../lib/dashboard/routes.ts";

const NOW = new Date("2026-10-10T12:00:00Z");
const MIN = 60_000;
const ago = (ms: number): string => new Date(NOW.getTime() - ms).toISOString();
let n = 0;

function stored(kind: MarketingKind, ts: string, over: { client?: string; piece_id?: string; network?: string; data?: Record<string, unknown> } = {}): StoredEvent {
  return { ...makeEvent({ source: "t", key: `${kind}|${++n}`, ts, kind, ...over }), seq: n };
}

function receipt(over: Partial<ScheduleReceipt> & { piece_id: string }): ScheduleReceipt {
  const network: Network = over.network ?? "tiktok";
  const publish_at = over.publish_at ?? ago(2 * HOUR);
  const key = scheduleKey({ pieceId: over.piece_id, network, publishAt: publish_at });
  return {
    schema: "marketing-publish-receipt/v1",
    ts: ago(3 * HOUR),
    client: "lothus",
    provider: "realoficial-browser",
    publisher: "realoficial-browser",
    dry_run: false,
    verdict: "scheduled",
    claims_tag: "MEASURED",
    attempts: 1,
    stages: [{ stage: "schedule", ok: true }],
    media_sha256: "a".repeat(64),
    approval_ref: "ap-1",
    network,
    publish_at,
    receipt_id: receiptIdOf(key),
    schedule_key: key,
    ...over,
  };
}

function inputOf(over: Partial<AlertInput> = {}): AlertInput {
  return { root: emptyHost().root, events: [], plans: [], receipts: [], now: NOW, ...over };
}

const keysOf = (input: AlertInput): string[] => evaluateAlerts(input).map((a) => a.key).sort();
const rulesOf = (input: AlertInput): string[] => [...new Set(evaluateAlerts(input).map((a) => a.rule))].sort();

const saved = { stuck: process.env.MARKETING_ALERT_STUCK_HOURS, min: process.env.MARKETING_ALERT_MIN_SCHEDULED, credits: process.env.MARKETING_ALERT_MIN_CREDITS, hook: process.env.MARKETING_DASHBOARD_ALERT_WEBHOOK };
afterEach(() => {
  for (const [k, v] of [["MARKETING_ALERT_STUCK_HOURS", saved.stuck], ["MARKETING_ALERT_MIN_SCHEDULED", saved.min], ["MARKETING_ALERT_MIN_CREDITS", saved.credits], ["MARKETING_DASHBOARD_ALERT_WEBHOOK", saved.hook]] as const) v === undefined ? delete process.env[k] : (process.env[k] = v);
});

test("a scheduled post that did not go out fires 15 minutes after its time and clears when it is published", () => {
  const late = receipt({ piece_id: "P-late", publish_at: ago(16 * MIN) });
  const input = inputOf({ receipts: [late] });
  const [a] = evaluateAlerts(input);
  assert.deepEqual([a?.rule, a?.severity, a?.client, a?.piece_id], ["post_not_published", "error", "lothus", "P-late"]);
  assert.equal(a?.since, late.publish_at, "since is when the condition began, not when it was noticed");
  assert.match(a?.next_step ?? "", /Real Oficial/);

  assert.deepEqual(keysOf(inputOf({ receipts: [receipt({ piece_id: "P-ok", publish_at: ago(14 * MIN) })] })), [], "inside the 15 minute grace");
  assert.deepEqual(keysOf(inputOf({ receipts: [receipt({ piece_id: "P-sim", publish_at: ago(2 * HOUR), dry_run: true })] })), [], "a simulation is not a post");
  assert.deepEqual(keysOf({ ...input, events: [stored("published", ago(HOUR), { client: "lothus", piece_id: "P-late", network: "tiktok" })] }), [], "published clears it");
  assert.deepEqual(keysOf({ ...input, events: [stored("metrics_snapshot", ago(HOUR), { client: "lothus", piece_id: "P-late" })] }), [], "a metrics snapshot proves it was published");
  assert.equal(keysOf({ ...input, events: [stored("published", ago(HOUR), { client: "lothus", piece_id: "P-late", network: "ig_reels" })] }).length, 1, "another network's publication does not clear this one");
  assert.deepEqual(keysOf(inputOf({ receipts: [{ ...late, verdict: "cancelled" }] })), [], "a cancelled post is not late");
});

test("publish_failed fires per failure type and clears on a new scheduling or after a week", () => {
  const failed = (piece_id: string, failure_class: ScheduleFailure, tsAgo = HOUR, extra: Partial<ScheduleReceipt> = {}) =>
    receipt({ piece_id, verdict: "failed", failure_class, ts: ago(tsAgo), publish_at: new Date(NOW.getTime() + 2 * DAY).toISOString(), ...extra });
  const input = inputOf({ receipts: [failed("P-a", "platform_rejection"), failed("P-b", "layout_changed"), failed("P-c", "policy_block", HOUR, { verdict: "blocked" })] });
  const found = evaluateAlerts(input).filter((a) => a.rule === "publish_failed");
  assert.equal(found.length, 3);
  assert.equal(found.find((a) => a.piece_id === "P-a")?.severity, "warn");
  assert.equal(found.find((a) => a.piece_id === "P-b")?.severity, "error", "a layout change is hard");
  assert.match(found.find((a) => a.piece_id === "P-a")?.message ?? "", /rejeitou/);
  assert.match(found.find((a) => a.piece_id === "P-a")?.next_step ?? "", /reagendar/);

  assert.deepEqual(keysOf(inputOf({ receipts: [failed("P-old", "platform_rejection", 8 * DAY)] })), [], "older than 7 days");
  assert.deepEqual(keysOf(inputOf({ receipts: [failed("P-sim", "platform_rejection", HOUR, { dry_run: true })] })), [], "simulations never alert");
  const retried = receipt({ piece_id: "P-a", ts: ago(10 * MIN), publish_at: new Date(NOW.getTime() + 3 * DAY).toISOString() });
  assert.deepEqual(keysOf(inputOf({ receipts: [failed("P-a", "platform_rejection"), retried] })), [], "scheduled again clears the failure");
  assert.equal(evaluateAlerts(inputOf({ receipts: [failed("P-x", "never_seen" as ScheduleFailure)] }))[0]?.next_step, "Abrir o recibo e investigar.", "an unclassified failure still has a next step");
});

test("the Real Oficial session alert follows the health of the publisher", () => {
  const base = (verdict: ScheduleReceipt["verdict"], failure_class: ScheduleFailure | undefined, tsAgo: number, piece_id: string): ScheduleReceipt =>
    receipt({ piece_id, verdict, ...(failure_class ? { failure_class } : {}), ts: ago(tsAgo), publish_at: new Date(NOW.getTime() + 5 * DAY).toISOString() });
  const login = evaluateAlerts(inputOf({ receipts: [base("scheduled", undefined, 2 * DAY, "P1"), base("failed", "login_required", HOUR, "P2")] })).find((a) => a.rule === "ro_session_expired");
  assert.equal(login?.severity, "error");
  assert.match(login?.message ?? "", /pediu login/);
  assert.match(login?.next_step ?? "", /Wesley precisa logar/);
  const challenge = evaluateAlerts(inputOf({ receipts: [base("scheduled", undefined, 2 * DAY, "P1"), base("failed", "captcha", HOUR, "P2")] })).find((a) => a.rule === "ro_session_expired");
  assert.match(challenge?.message ?? "", /verificação/);
  const expired = evaluateAlerts(inputOf({ receipts: [base("scheduled", undefined, 10 * DAY, "P1")] })).find((a) => a.rule === "ro_session_expired");
  assert.equal(expired?.severity, "warn");
  // cleared by a later success, and never raised without receipts or while the session is fine
  assert.equal(rulesOf(inputOf({ receipts: [base("failed", "login_required", 2 * HOUR, "P2"), base("scheduled", undefined, HOUR, "P3")] })).includes("ro_session_expired"), false);
  assert.equal(rulesOf(inputOf()).includes("ro_session_expired"), false);
  assert.equal(rulesOf(inputOf({ receipts: [base("scheduled", undefined, DAY, "P1")] })).includes("ro_session_expired"), false);
});

test("low balance and accounts near the plan limit need the read-only Real Oficial facts and clear when they recover", () => {
  const ro = (balance: number | null, used = 2, limit = 5) => ({ balance, capacity: [{ platform: "instagram", used, limit, pct: (used / limit) * 100, warning: used / limit >= 0.8 }], fetched_at: ago(MIN) });
  const low = evaluateAlerts(inputOf({ ro: ro(10) }));
  assert.deepEqual(low.map((a) => a.rule), ["balance_low"]);
  assert.match(low[0]?.message ?? "", /10, abaixo de 50/);
  assert.match(low[0]?.next_step ?? "", /não compra/);
  assert.deepEqual(keysOf(inputOf({ ro: ro(500) })), [], "balance recovered");
  assert.deepEqual(keysOf(inputOf({ ro: ro(null) })), [], "no balance, no guess");
  assert.deepEqual(keysOf(inputOf({ ro: ro(50) })), [], "at the threshold is not below it");
  assert.deepEqual(keysOf(inputOf()), [], "without the read-only window these rules stay silent");

  const near = evaluateAlerts(inputOf({ ro: ro(500, 4, 5) }));
  assert.deepEqual([near[0]?.rule, near[0]?.severity, near[0]?.key], ["accounts_near_limit", "warn", "accounts_near_limit:instagram"]);
  assert.equal(evaluateAlerts(inputOf({ ro: ro(500, 5, 5) }))[0]?.severity, "error", "full is an error");
  assert.deepEqual(keysOf(inputOf({ ro: ro(500, 3, 5) })), [], "below 80%");
  assert.deepEqual(keysOf(inputOf({ ro: { balance: 500, capacity: null, fetched_at: ago(MIN) } })), []);
});

test("the voice quota alert shows when the quota comes back and clears when it does", () => {
  const back = new Date(NOW.getTime() + 5 * HOUR + 15 * MIN).toISOString();
  const exhausted = stored("tts_quota", ago(HOUR), { data: { blocked_until: back, exhausted: true } });
  const [a] = evaluateAlerts(inputOf({ events: [exhausted] }));
  assert.deepEqual([a?.rule, a?.severity, a?.key], ["tts_exhausted", "warn", "tts_exhausted"]);
  assert.match(a?.message ?? "", /volta às 17:15 UTC/);
  assert.deepEqual(keysOf(inputOf({ events: [stored("tts_quota", ago(HOUR), { data: { blocked_until: ago(MIN), exhausted: true } })] })), [], "the block time has passed");
  assert.deepEqual(keysOf(inputOf({ events: [stored("tts_quota", ago(HOUR), { data: { requests: 80, limit: 100, exhausted: false } })] })), [], "not exhausted");
  assert.deepEqual(keysOf(inputOf({ events: [stored("tts_quota", ago(2 * DAY), { data: { blocked_until: back, exhausted: true } })] })), [], "a reading older than a day is not trusted");
  assert.equal(keysOf(inputOf({ events: [exhausted, { ...exhausted, event_id: "dup", seq: 99 }] })).length, 1, "the same fact twice is one alert");
});

test("a client approval about to cost a date raises an alert (red under 24 h, yellow under 72 h) and clears when decided", () => {
  const { root } = emptyHost();
  const slot = (piece_id: string, hours: number) => requestApproval(root, { client: "lothus", pieceId: piece_id, month: "2026-10", mediaSha256: sha(hours), preview: "p.mp4", captions: {}, publishAt: new Date(NOW.getTime() + hours * HOUR).toISOString(), now: new Date(NOW.getTime() - 5 * HOUR) });
  const red = slot("P-red", 10);
  slot("P-yellow", 48);
  slot("P-green", 120);
  slot("P-late", -3);
  const found = evaluateAlerts(inputOf({ root })).filter((a) => a.rule === "approval_due");
  assert.deepEqual(found.map((a) => [a.piece_id, a.severity]).sort(), [["P-late", "error"], ["P-red", "error"], ["P-yellow", "warn"]]);
  assert.match(found.find((a) => a.piece_id === "P-red")?.message ?? "", /10 h do post/);
  assert.match(found.find((a) => a.piece_id === "P-late")?.message ?? "", /a data do post já passou/);
  assert.equal(found.find((a) => a.piece_id === "P-red")?.since, red.created_at);

  const decided = stored("approval_decided", ago(MIN), { client: "lothus", piece_id: "P-red", data: { decision: "approved", media_sha256: sha(10) } });
  assert.equal(evaluateAlerts(inputOf({ root, events: [decided] })).some((a) => a.piece_id === "P-red"), false, "a decision clears it");
});

test("a piece stuck in a step, and a gate that keeps failing, raise alerts and clear when the piece moves", () => {
  const early = stored("script_ready", ago(60 * HOUR), { client: "lothus", piece_id: "P-stuck" });
  const [stuck] = evaluateAlerts(inputOf({ events: [early] }));
  assert.deepEqual([stuck?.rule, stuck?.piece_id, stuck?.since], ["piece_stuck", "P-stuck", early.ts]);
  assert.match(stuck?.message ?? "", /parada em script há mais de 48 h/);
  assert.deepEqual(keysOf(inputOf({ events: [stored("script_ready", ago(47 * HOUR), { client: "lothus", piece_id: "P-stuck" })] })), [], "inside the limit");
  assert.deepEqual(keysOf(inputOf({ events: [early, stored("voice_rendered", ago(HOUR), { client: "lothus", piece_id: "P-stuck", data: { cache_hit: false } })] })), [], "movement clears it");
  assert.deepEqual(keysOf(inputOf({ events: [stored("scheduled", ago(10 * DAY), { client: "lothus", piece_id: "P-wait", data: { publish_at: ago(-DAY), dry_run: false } })] })), [], "a scheduled piece is waiting for its date, not stuck");
  assert.equal(keysOf({ ...inputOf({ events: [stored("script_ready", ago(10 * HOUR), { client: "lothus", piece_id: "P-s2" })] }), thresholds: { ...DEFAULT_THRESHOLDS, stuckHours: 6 } }).length, 1, "the threshold is configurable");

  const fail = (kind: MarketingKind, data: Record<string, unknown>, h: number) => stored(kind, ago(h * HOUR), { client: "lothus", piece_id: "P-bad", data });
  const qa = [1, 2, 3].map((h) => fail("qa_result", { passed: false }, h));
  const gate = evaluateAlerts(inputOf({ events: qa })).find((a) => a.rule === "gate_failing");
  assert.equal(gate?.key, "gate_failing:qa:P-bad");
  assert.match(gate?.message ?? "", /reprovou 3 vezes seguidas no gate de QA técnico/);
  assert.equal(evaluateAlerts(inputOf({ events: qa.slice(0, 2) })).some((a) => a.rule === "gate_failing"), false, "two failures are not repeated failures");
  const compliance = [1, 2, 3].map((h) => fail("compliance_result", { pass: false, violations: 1 }, h));
  assert.equal(evaluateAlerts(inputOf({ events: compliance })).find((a) => a.rule === "gate_failing")?.key, "gate_failing:compliance:P-bad");
  assert.equal(gate?.since, qa[2]?.ts, "since is the first failure of the run");
  assert.equal(evaluateAlerts(inputOf({ events: [...compliance, fail("compliance_result", { pass: true }, 0)] })).some((a) => a.rule === "gate_failing"), false, "a pass after the failures clears it");
  assert.equal(evaluateAlerts(inputOf({ events: [fail("qa_result", { passed: true }, 5), ...qa.slice(0, 2)] })).some((a) => a.rule === "gate_failing"), false, "a pass followed by two failures is not three in a row");
});

test("a client month with too few scheduled posts raises an alert and clears when the month is filled", () => {
  const { root } = emptyHost();
  const plan = planned(root, NOW, "lothus");
  const sched = (i: number) => receipt({ piece_id: `P-m${i}`, publish_at: new Date(NOW.getTime() + (i + 1) * DAY).toISOString() });
  const few = evaluateAlerts(inputOf({ root, plans: [plan], receipts: [sched(0), sched(1)] })).find((a) => a.rule === "month_underfilled");
  assert.equal(few?.key, "month_underfilled:lothus");
  assert.match(few?.message ?? "", /só 2 post\(s\)/);
  assert.equal(few?.since, plan.generated_at);
  const full = Array.from({ length: 8 }, (_, i) => sched(i));
  assert.equal(evaluateAlerts(inputOf({ root, plans: [plan], receipts: full })).some((a) => a.rule === "month_underfilled"), false, "8 posts is the minimum");
  assert.equal(evaluateAlerts(inputOf({ root, plans: [plan], receipts: [...full.slice(0, 7), receipt({ piece_id: "P-far", publish_at: new Date(NOW.getTime() + 40 * DAY).toISOString() })] })).some((a) => a.rule === "month_underfilled"), true, "a post beyond 30 days does not count");
  process.env.MARKETING_ALERT_MIN_SCHEDULED = "1";
  assert.equal(evaluateAlerts(inputOf({ root, plans: [plan], receipts: [sched(0)], thresholds: thresholdsFromEnv() })).some((a) => a.rule === "month_underfilled"), false, "the minimum is configurable");
});

test("a payment with no delivery started raises an alert after an hour and clears when production starts", () => {
  const pay = stored("payment_received", ago(2 * HOUR), { client: "lothus", data: { amount: 200, currency: "BRL" } });
  const [a] = evaluateAlerts(inputOf({ events: [pay] }));
  assert.deepEqual([a?.rule, a?.client, a?.since], ["payment_without_delivery", "lothus", pay.ts]);
  assert.match(a?.message ?? "", /lothus pagou/);
  assert.deepEqual(keysOf(inputOf({ events: [stored("payment_received", ago(30 * MIN), { client: "lothus", data: { amount: 200 } })] })), [], "inside the grace hour");
  assert.deepEqual(keysOf(inputOf({ events: [pay, stored("script_ready", ago(HOUR), { client: "lothus", piece_id: "P-1" })] })), [], "production started");
  assert.equal(keysOf(inputOf({ events: [pay, stored("script_ready", ago(HOUR), { client: "acme-us", piece_id: "P-2" })] })).length, 1, "another client's production does not count");
  assert.equal(keysOf(inputOf({ events: [pay, stored("script_ready", ago(3 * HOUR), { client: "lothus", piece_id: "P-3" })] })).filter((k) => k.startsWith("payment_without_delivery")).length, 1, "work that began before the payment does not count");
});

test("alerts are never duplicated, are ordered by urgency and are a pure function of their inputs", () => {
  const late = receipt({ piece_id: "P-late", publish_at: ago(HOUR) });
  const dup = { ...late, ts: ago(2 * HOUR) };
  const failed = receipt({ piece_id: "P-f", verdict: "failed", failure_class: "platform_rejection", ts: ago(HOUR), publish_at: new Date(NOW.getTime() + DAY).toISOString() });
  const input = inputOf({ receipts: [late, dup, failed, failed], events: [stored("script_ready", ago(60 * HOUR), { client: "lothus", piece_id: "P-stuck" })], ro: { balance: 1, capacity: null, fetched_at: ago(MIN) } });
  const list = evaluateAlerts(input);
  const keys = list.map((a) => a.key);
  assert.equal(new Set(keys).size, keys.length, "one alert per key");
  assert.deepEqual(evaluateAlerts(input), list, "the same inputs give the same alerts");
  assert.deepEqual(list.map((a) => a.severity), [...list.map((a) => a.severity)].sort((x, y) => ({ error: 0, warn: 1, info: 2 })[x] - ({ error: 0, warn: 1, info: 2 })[y]), "errors come first");
  assert.equal(list[0]?.rule, "post_not_published");
});

test("the alert centre reads the read-only balance, filters by client and severity, and tells whether anything leaves the machine", async () => {
  const { root } = emptyHost();
  const store = new EventStore(root);
  store.ingest([makeEvent({ source: "t", key: "pay", ts: ago(3 * HOUR), kind: "payment_received", client: "lothus", data: { amount: 1 } }), makeEvent({ source: "t", key: "pay2", ts: ago(3 * HOUR), kind: "payment_received", client: "acme-us", data: { amount: 1 } })]);
  const ro = createReadOnlyRo({ call: async (tool) => (tool === "ro_whoami" ? { credits: 3 } : tool === "ro_list_social_accounts" ? { accounts: [] } : {}) });
  const ctx = (query = "", withRo = true): ViewContext => ({ root, store, sources: defaultSources(root), now: NOW, query: new URLSearchParams(query), alerts: () => [], ...(withRo ? { ro } : {}) });
  const all = await alertsView(ctx());
  assert.deepEqual(all.alerts.map((a) => a.rule).sort(), ["balance_low", "payment_without_delivery", "payment_without_delivery"]);
  assert.deepEqual(all.counts, { error: 0, warn: 3, info: 0 });
  assert.equal(all.external_delivery, "off");
  assert.equal(all.thresholds.minCredits, 50);
  const mine = await alertsView(ctx("client=lothus"));
  assert.deepEqual(mine.alerts.map((a) => [a.rule, a.client ?? null]).sort(), [["balance_low", null], ["payment_without_delivery", "lothus"]], "account-wide alerts stay, other clients' go");
  assert.equal((await alertsView(ctx("severity=error"))).alerts.length, 0);
  assert.equal((await alertsView(ctx("", false))).alerts.some((a) => a.rule === "balance_low"), false, "no read-only window, no balance rule");
  process.env.MARKETING_DASHBOARD_ALERT_WEBHOOK = "https://hooks.example/x";
  assert.equal((await alertsView(ctx())).external_delivery, "webhook");
  process.env.MARKETING_ALERT_MIN_CREDITS = "2";
  assert.equal((await alertsView(ctx())).alerts.some((a) => a.rule === "balance_low"), false, "the threshold comes from the environment");
});

test("the dashboard serves /api/alerts read-only and sends nothing outside unless the operator sets the webhook", async () => {
  const { root } = emptyHost();
  const got: string[] = [];
  const hook = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => { got.push(body); res.end("ok"); });
  });
  await new Promise<void>((done) => hook.listen(0, "127.0.0.1", done));
  const url = `http://127.0.0.1:${(hook.address() as AddressInfo).port}/hook`;
  let now = NOW;
  const store0 = new EventStore(root);
  const later = (ms: number): string => new Date(NOW.getTime() - ms).toISOString();
  try {
    // off by default: an alert begins and nothing is posted
    delete process.env.MARKETING_DASHBOARD_ALERT_WEBHOOK;
    const quiet = await startDashboard({ root, pollMs: 20, now: () => now });
    store0.ingest([makeEvent({ source: "t", key: "pay-a", ts: later(3 * HOUR), kind: "payment_received", client: "lothus", data: { amount: 1 } })]);
    quiet.syncNow();
    quiet.notifyAlerts();
    const res = await fetch(`${quiet.url}/api/alerts`, { headers: { authorization: `Bearer ${quiet.token}` } });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { alerts: Array<{ rule: string }>; external_delivery: string };
    assert.deepEqual(body.alerts.map((a) => a.rule), ["payment_without_delivery"]);
    assert.equal(body.external_delivery, "off");
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) assert.equal((await fetch(`${quiet.url}/api/alerts`, { method, headers: { authorization: `Bearer ${quiet.token}` } })).status, 405);
    await quiet.close();
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(got, [], "no webhook configured, nothing sent");

    // on: the alerts active at start are not repeated; one that begins later is sent once
    process.env.MARKETING_DASHBOARD_ALERT_WEBHOOK = url;
    const loud = await startDashboard({ root, pollMs: 20, now: () => now });
    loud.notifyAlerts();
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(got, [], "the alert active at start is not announced again");
    now = new Date(NOW.getTime() + 10 * MIN);
    store0.ingest([makeEvent({ source: "t", key: "pay-b", ts: later(3 * HOUR), kind: "payment_received", client: "acme-us", data: { amount: 1 } })]);
    loud.syncNow();
    loud.notifyAlerts();
    loud.notifyAlerts();
    for (let i = 0; i < 50 && got.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(got.length, 1, "announced once, not on every check");
    const sent = JSON.parse(got[0] as string) as { source: string; alerts: Array<{ client: string; rule: string }> };
    assert.equal(sent.source, "simplicio-marketing-dashboard");
    assert.deepEqual(sent.alerts.map((a) => [a.rule, a.client]), [["payment_without_delivery", "acme-us"]]);
    await loud.close();
  } finally {
    hook.close();
    hook.closeAllConnections?.();
  }
});
