import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EventStore } from "../../lib/dashboard/store.ts";
import { FAILURES, PLAN_LIMITS, capacityOf, receiptDetail, receiptRow, sanitize, status } from "../../lib/dashboard/views/status.ts";
import { createReadOnlyRo } from "../../lib/dashboard/realoficial.ts";
import { startDashboard } from "../../lib/dashboard/server.ts";
import { defaultSources } from "../../lib/observability/dashboard/index.ts";
import { appendReceipt, receiptIdOf, scheduleKey, type Network, type ScheduleFailure, type ScheduleReceipt } from "../../lib/publish/publisher.ts";
import { DAY, emptyHost, planned } from "../helpers/dashboard-fixture.ts";
import type { ViewContext } from "../../lib/dashboard/routes.ts";

const NOW = new Date("2026-10-07T12:00:00Z");
let seq = 0;

interface Spec {
  client?: string;
  network?: Network;
  verdict?: ScheduleReceipt["verdict"];
  failure?: ScheduleFailure;
  publisher?: string;
  agoDays?: number;
  publishInDays?: number;
  dryRun?: boolean;
  detail?: string;
  evidence?: string;
}

function receipt(root: string, spec: Spec): ScheduleReceipt {
  const piece_id = `PIECE-${spec.client ?? "lothus"}-${++seq}`;
  const network = spec.network ?? "tiktok";
  const publish_at = new Date(NOW.getTime() + (spec.publishInDays ?? 3) * DAY).toISOString();
  const key = scheduleKey({ pieceId: piece_id, network, publishAt: publish_at });
  const r: ScheduleReceipt = {
    schema: "marketing-publish-receipt/v1",
    ts: new Date(NOW.getTime() - (spec.agoDays ?? 0) * DAY).toISOString(),
    piece_id,
    client: spec.client ?? "lothus",
    provider: spec.publisher ?? "realoficial-browser",
    publisher: spec.publisher ?? "realoficial-browser",
    dry_run: spec.dryRun ?? false,
    verdict: spec.verdict ?? "scheduled",
    claims_tag: "MEASURED",
    attempts: 1,
    stages: [{ stage: "schedule", ok: (spec.verdict ?? "scheduled") === "scheduled", ...(spec.detail ? { detail: spec.detail } : {}) }],
    network,
    publish_at,
    approval_ref: "ap-1",
    media_sha256: "a".repeat(64),
    receipt_id: receiptIdOf(key),
    schedule_key: key,
    ...(spec.failure ? { failure_class: spec.failure } : {}),
    ...(spec.evidence ? { evidence: { screenshot: spec.evidence } } : {}),
  };
  appendReceipt(root, r);
  return r;
}

function ctx(root: string, ro?: ViewContext["ro"], query = ""): ViewContext {
  return { root, store: new EventStore(root), sources: defaultSources(root), now: NOW, query: new URLSearchParams(query), alerts: () => [], ro };
}

function world() {
  const { root } = emptyHost();
  planned(root, NOW, "lothus");
  planned(root, NOW, "acme-us");
  return root;
}

test("every failure type shows its reason and the human next step", () => {
  const classes: ScheduleFailure[] = ["login_required", "captcha", "two_factor", "layout_changed", "platform_rejection", "policy_block", "claims_gate_blocked", "approval_missing", "approval_hash_mismatch", "approval_not_approved", "outside_window", "action_gate_blocked", "driver_unavailable", "unsupported_network", "invalid_request", "not_found"];
  for (const c of classes) {
    assert.ok(FAILURES[c]?.reason && FAILURES[c]?.next_step, `${c} needs a reason and a next step`);
  }
  assert.match(FAILURES.login_required!.next_step, /Wesley precisa logar/);
  const { root } = emptyHost();
  const row = receiptRow(receipt(root, { verdict: "failed", failure: "login_required" }));
  assert.equal(row.reason, FAILURES.login_required!.reason);
  assert.match(row.next_step ?? "", /Wesley precisa logar na Real Oficial/);
  assert.equal(receiptRow({ ...receipt(root, { verdict: "failed", failure: "layout_changed" }), failure_class: "never_seen" as ScheduleFailure }).next_step, "Abrir o recibo e investigar.");
});

test("the client by network matrix reports connection, last and next post, success rate and classified failures", async () => {
  const root = world();
  // lothus / tiktok: two scheduled live posts, one already due
  receipt(root, { network: "tiktok", agoDays: 1, publishInDays: -2 });
  receipt(root, { network: "tiktok", agoDays: 0, publishInDays: 5 });
  // lothus / ig_reels: one ok, one layout change
  receipt(root, { network: "ig_reels", agoDays: 2 });
  receipt(root, { network: "ig_reels", agoDays: 1, verdict: "failed", failure: "layout_changed" });
  // lothus / yt_shorts: the session was lost
  receipt(root, { network: "yt_shorts", agoDays: 2 });
  receipt(root, { network: "yt_shorts", agoDays: 0, verdict: "failed", failure: "login_required" });
  // acme-us / tiktok: only a simulation, and an old failure out of the 7 day window
  receipt(root, { client: "acme-us", network: "tiktok", dryRun: true });
  receipt(root, { client: "acme-us", network: "ig_reels", agoDays: 20, verdict: "failed", failure: "captcha" });

  const view = await status(ctx(root));
  const cell = (client: string, network: string) => view.matrix.find((c) => c.client === client && c.network === network)!;
  assert.equal(view.matrix.length, 6, "2 clients x 3 networks");

  const tt = cell("lothus", "tiktok");
  assert.equal(tt.connection, "connected");
  assert.equal(tt.success_rate_7d, 100);
  assert.equal(tt.attempts_7d, 2);
  assert.equal(new Date(tt.last_post!).getTime(), NOW.getTime() - 2 * DAY);
  assert.equal(new Date(tt.next_post!).getTime(), NOW.getTime() + 5 * DAY);
  assert.deepEqual(tt.failures, {});

  const ig = cell("lothus", "ig_reels");
  assert.equal(ig.success_rate_7d, 50);
  assert.deepEqual(ig.failures, { layout_changed: 1 });
  assert.equal(ig.last_failure?.failure_class, "layout_changed");
  assert.match(ig.last_failure?.next_step ?? "", /issue/);

  const yt = cell("lothus", "yt_shorts");
  assert.equal(yt.connection, "disconnected");
  assert.match(yt.last_failure?.next_step ?? "", /Wesley precisa logar na Real Oficial/);

  assert.equal(cell("acme-us", "tiktok").connection, "unknown", "a simulation proves nothing about the connection");
  assert.deepEqual([cell("acme-us", "tiktok").attempts_7d, cell("acme-us", "tiktok").success_rate_7d, cell("acme-us", "tiktok").simulated, cell("acme-us", "tiktok").last_post], [0, null, 1, null], "simulations are counted apart and never as posts or successes");
  assert.equal(cell("acme-us", "ig_reels").success_rate_7d, null, "no attempt in 7 days is sem dado, not 0%");
  assert.equal(cell("acme-us", "yt_shorts").last_post, null);
  assert.equal((await status(ctx(root, undefined, "client=acme-us"))).matrix.length, 3, "the client filter narrows the matrix");
});

test("publisher health: session active, expired, login required, challenge or unknown", async () => {
  const sessionOf = async (specs: Spec[]) => {
    const root = world();
    for (const s of specs) receipt(root, s);
    return (await status(ctx(root))).publisher;
  };
  assert.equal((await sessionOf([])).session, "unknown");
  assert.equal((await sessionOf([{ agoDays: 1 }])).session, "active");
  const expired = await sessionOf([{ agoDays: 10 }]);
  assert.equal(expired.session, "expired");
  assert.match(expired.next_step ?? "", /Wesley/);
  const lost = await sessionOf([{ agoDays: 3 }, { verdict: "failed", failure: "login_required" }]);
  assert.equal(lost.session, "login_required");
  assert.match(lost.next_step ?? "", /Wesley precisa logar/);
  assert.equal(new Date(lost.last_success!).getTime(), NOW.getTime() - 3 * DAY);
  assert.deepEqual(lost.failures_30d, { login_required: 1 });
  for (const failure of ["captcha", "two_factor"] as const) {
    const h = await sessionOf([{ agoDays: 3 }, { verdict: "failed", failure }]);
    assert.equal(h.session, "challenge");
    assert.equal(h.last_failure?.failure_class, failure);
  }
  const mixed = await sessionOf([{ verdict: "failed", failure: "layout_changed" }, { verdict: "failed", failure: "layout_changed", agoDays: 1 }, { verdict: "failed", failure: "captcha", agoDays: 2 }, { agoDays: 0, publisher: "dry-run" }]);
  assert.deepEqual(mixed.failures_30d, { layout_changed: 2, captcha: 1 });
  assert.equal(mixed.session, "unknown", "other publishers do not count as the Real Oficial session");
});

test("capacity shows connected accounts against the plan limit and warns before it fills", async () => {
  const root = world();
  const answer = { accounts: [...Array(4).fill({ platform: "instagram", untrusted_name: "x" }), ...Array(5).fill({ platform: "tiktok" }), { platform: "youtube" }] };
  const calls: string[] = [];
  const ro = createReadOnlyRo({ call: async (tool) => { calls.push(tool); return answer; } });
  const cap = await capacityOf(ctx(root, ro));
  const by = Object.fromEntries(cap!.platforms.map((p) => [p.platform, p]));
  assert.deepEqual(PLAN_LIMITS.lite, { instagram: 5, tiktok: 5, youtube: 1 });
  assert.deepEqual([by.instagram!.used, by.instagram!.pct, by.instagram!.warning], [4, 80, true], "warns at 80%");
  assert.deepEqual([by.tiktok!.used, by.tiktok!.pct, by.tiktok!.warning], [5, 100, true]);
  assert.equal(by.youtube!.warning, true);
  assert.deepEqual(calls, ["ro_list_social_accounts"], "one read-only call");
  const roomy = createReadOnlyRo({ call: async () => ({ accounts: [{ platform: "instagram" }] }) });
  assert.equal((await capacityOf(ctx(root, roomy)))!.platforms.find((p) => p.platform === "instagram")!.warning, false);
  assert.equal(await capacityOf(ctx(root)), null, "window off: sem dado");
  assert.equal(await capacityOf(ctx(root, createReadOnlyRo({ call: async () => ({ nothing: true }) }))), null, "an unusable answer is sem dado");
  assert.equal((await status(ctx(root, ro))).capacity?.plan, "lite");
});

test("no credential, cookie or token is ever shown", async () => {
  const root = world();
  const leak = "Cookie: sessionid=abc123SECRET; csrftoken=zzzSECRET2 Authorization: Bearer abcSECRET3.def password=hunter2 token=xyzSECRET4 api_key=KEYSECRET5 contato dono@example.com";
  const r = receipt(root, { verdict: "failed", failure: "layout_changed", detail: leak });
  const view = await status(ctx(root));
  const detail = receiptDetail({ root }, r.receipt_id)!;
  const text = JSON.stringify([view, detail]);
  for (const secret of ["abc123SECRET", "zzzSECRET2", "abcSECRET3", "hunter2", "xyzSECRET4", "KEYSECRET5", "dono@example.com"]) assert.ok(!text.includes(secret), `${secret} leaked`);
  assert.match(detail.stages[0]?.detail ?? "", /\[redacted/);
  assert.ok(!/"(cookie|password|token|secret|authorization)"\s*:/i.test(text), "no credential-shaped field exists in the payload");
  assert.equal(sanitize(undefined), undefined);
  assert.ok((sanitize("x".repeat(1000)) ?? "").length <= 300);
  assert.equal(receiptDetail({ root }, "0".repeat(20)), null);
});

test("the server exposes the status, a receipt and its evidence screenshot, and nothing outside the evidence folder", async () => {
  const root = world();
  const evidence = join(root, ".marketing-engine", "data", "evidence", "P-1");
  mkdirSync(evidence, { recursive: true });
  writeFileSync(join(evidence, "tiktok.confirmation.png"), Buffer.from("89504e470d0a1a0a", "hex"));
  writeFileSync(join(root, "outside.png"), Buffer.from("89504e470d0a1a0a", "hex"));
  const ok = receipt(root, { evidence: join(evidence, "tiktok.confirmation.png") });
  const bad = receipt(root, { evidence: join(root, "outside.png") });
  const s = await startDashboard({ root, pollMs: 50, ro: createReadOnlyRo({ call: async () => ({ accounts: [] }) }) });
  try {
    const get = (path: string) => fetch(`${s.url}${path}`, { headers: { authorization: `Bearer ${s.token}` } });
    const body = (await (await get("/api/status")).json()) as { matrix: unknown[]; receipts: Array<{ receipt_id: string; has_evidence: boolean }>; capacity: { plan: string } };
    assert.equal(body.matrix.length, 6);
    assert.equal(body.capacity.plan, "lite");
    assert.ok(body.receipts.some((r) => r.receipt_id === ok.receipt_id && r.has_evidence));
    assert.equal((await get(`/api/receipts/${ok.receipt_id}`)).status, 200);
    assert.equal((await get(`/api/receipts/${"0".repeat(20)}`)).status, 404);
    const shot = await get(`/api/evidence/${ok.receipt_id}`);
    assert.equal(shot.status, 200);
    assert.equal(shot.headers.get("content-type"), "image/png");
    assert.equal((await get(`/api/evidence/${bad.receipt_id}`)).status, 404, "a screenshot outside data/evidence is never served");
    assert.equal((await get(`/api/evidence/${"1".repeat(20)}`)).status, 404);
    assert.equal((await fetch(`${s.url}/api/status`)).status, 401);
  } finally {
    await s.close();
  }
});
