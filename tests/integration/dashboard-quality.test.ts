import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeEvent, type MarketingKind } from "../../lib/dashboard/events.ts";
import { EventStore } from "../../lib/dashboard/store.ts";
import { quality, qaReasons } from "../../lib/dashboard/views/quality.ts";
import { defaultSources } from "../../lib/observability/dashboard/index.ts";
import { fromManifests } from "../../lib/observability/dashboard/internal.ts";
import { DAY, HOUR, emptyHost, sha } from "../helpers/dashboard-fixture.ts";
import type { ViewContext } from "../../lib/dashboard/routes.ts";

const NOW = new Date("2026-10-07T12:00:00Z");
const A = sha(1);
const B = sha(2);
let n = 0;

function ev(piece_id: string, kind: MarketingKind, data: Record<string, unknown>, agoH = 1, client = "lothus") {
  return makeEvent({ source: "t", key: `${piece_id}|${kind}|${++n}`, ts: new Date(NOW.getTime() - agoH * HOUR).toISOString(), kind, client, piece_id, network: "tiktok", data });
}

function ctxOf(root: string, store: EventStore, query = ""): ViewContext {
  return { root, store, sources: defaultSources(root), now: NOW, query: new URLSearchParams(query), alerts: () => [] };
}

function world() {
  const { root, eRoot } = emptyHost();
  const store = new EventStore(root);
  const events = [
    // P1: everything passes; the approved hash is the hash of the final render
    ev("P1", "qa_result", { passed: true }, 50), ev("P1", "compliance_result", { pass: true }, 49), ev("P1", "watcher_gate", { passed: true, tag: "MEASURED" }, 48),
    ev("P1", "render_finished", { stage: "final", ok: true, sha256: A }, 47), ev("P1", "approval_requested", { queue: "client", media_sha256: A }, 46), ev("P1", "approval_decided", { decision: "approved", media_sha256: A }, 45),
    // P2: QA fails at first (three reasons), then passes
    ev("P2", "qa_result", { passed: false, resolution: "720x1280", lufs: -20, freeze_s: 1.2 }, 30), ev("P2", "qa_result", { passed: true }, 20),
    // P3: compliance fails with two rules; QA rules from the tech-specs report
    ev("P3", "compliance_result", { pass: false, violations: 2, rules: ["medical-claim", "financial-claim"] }, 10), ev("P3", "qa_result", { passed: false, rules: ["aspect_ratio"] }, 9),
    // P4: approved a file, then the file changed
    ev("P4", "render_finished", { stage: "final", ok: true, sha256: A }, 8), ev("P4", "approval_decided", { decision: "approved", media_sha256: A }, 7), ev("P4", "render_finished", { stage: "final", ok: true, sha256: B }, 6),
    // P5: the watcher could not verify the claims; the client asked for changes on P6
    ev("P5", "watcher_gate", { passed: false, tag: "UNVERIFIED" }, 5),
    ev("P6", "approval_decided", { decision: "changes_requested", media_sha256: A }, 4),
    // P7 and P8: dubbed with AI voice, without and with the label; P9 waits for a client; P10 other client
    ev("P7", "qa_result", { passed: true }, 3), ev("P7", "dubbing_finished", { ai_generated_voice: true, verdict: "dubbed" }, 3),
    ev("P8", "qa_result", { passed: true }, 3), ev("P8", "dubbing_finished", { ai_generated_voice: true, verdict: "dubbed" }, 3),
    ev("P9", "approval_requested", { queue: "client", media_sha256: A }, 2),
    ev("P10", "qa_result", { passed: false, resolution: "1080x1920", lufs: -14.5, freeze_s: 0 }, 2, "acme-us"),
  ];
  store.ingest(events.sort((a, b) => a.ts.localeCompare(b.ts)));
  const out = (piece: string) => {
    const dir = join(eRoot, "outputs", "lothus", "2026-10-07", piece);
    mkdirSync(dir, { recursive: true });
    return dir;
  };
  writeFileSync(join(out("P7"), "captions.json"), JSON.stringify({ tiktok: "Veja como funciona" }));
  writeFileSync(join(out("P8"), "captions.json"), JSON.stringify({ tiktok: "Voz gerada por IA. Veja como funciona" }));
  writeFileSync(join(out("P1"), "broll-licenses.json"), JSON.stringify({ passed: true }));
  writeFileSync(join(out("P3"), "broll-licenses.json"), JSON.stringify({ passed: false, items: [{ id: "b1", ok: false }] }));
  return { root, store };
}

test("each piece shows the seal of every gate with its reason, and a failing gate blocks the piece", async () => {
  const { root, store } = world();
  const view = await quality(ctxOf(root, store));
  const p = (id: string) => view.pieces.find((x) => x.piece_id === id)!;

  assert.deepEqual([p("P1").qa.state, p("P1").compliance.state, p("P1").watcher.state, p("P1").licenses.state, p("P1").approval.state, p("P1").ai_label.state], ["pass", "pass", "pass", "pass", "pass", "na"]);
  assert.equal(p("P1").blocked, false);

  assert.equal(p("P2").qa.state, "pass", "the latest QA run counts for the seal");
  assert.equal(p("P2").blocked, false);

  assert.equal(p("P3").compliance.state, "fail");
  assert.deepEqual(p("P3").compliance.reasons, ["medical-claim", "financial-claim"]);
  assert.equal(p("P3").compliance.detail, "2 violação(ões)");
  assert.deepEqual(p("P3").qa.reasons, ["aspect_ratio"]);
  assert.equal(p("P3").licenses.state, "fail");
  assert.deepEqual(p("P3").blocking.sort(), ["compliance", "licenses", "qa"]);

  assert.equal(p("P4").approval.state, "fail");
  assert.match(p("P4").approval.detail ?? "", /hash diferente do aprovado/);
  assert.deepEqual(p("P4").approval.reasons, ["approval_hash_mismatch"]);
  assert.equal(p("P4").blocked, true, "a piece whose file differs from the approved one is blocked");

  assert.equal(p("P5").watcher.state, "fail");
  assert.equal(p("P5").watcher.detail, "UNVERIFIED");
  assert.equal(p("P6").approval.state, "fail");
  assert.deepEqual(p("P6").approval.reasons, ["changes_requested"]);

  assert.equal(p("P7").ai_label.state, "fail", "AI voice without the label in the captions");
  assert.equal(p("P8").ai_label.state, "pass");
  assert.equal(p("P9").approval.state, "pending");
  assert.equal(p("P9").qa.state, "none", "a gate that did not run is sem dado, never a pass");
  assert.equal(p("P9").blocked, false);
  assert.equal(view.aggregate.blocked, view.pieces.filter((x) => x.blocked).length);
  assert.ok(view.pieces.slice(0, view.aggregate.blocked).every((x) => x.blocked), "blocked pieces come first");
});

test("QA reasons come from the reported rules or from the QA sheet limits applied to the numbers", () => {
  assert.deepEqual(qaReasons({ resolution: "720x1280", lufs: -20, freeze_s: 1.2 }), ["resolution", "loudness", "freeze"]);
  assert.deepEqual(qaReasons({ resolution: "1080×1920", lufs: -14.9, freeze_s: 0.5 }), [], "limits are inclusive: 540x960 or 1080x1920, -14 LUFS +-1, freeze up to 0.5 s");
  assert.deepEqual(qaReasons({ resolution: "540x960", lufs: -13, freeze_s: 0 }), []);
  assert.deepEqual(qaReasons({ lufs: -12.9 }), ["loudness"]);
  assert.deepEqual(qaReasons({ rules: ["aspect_ratio", "aspect_ratio"], freeze_s: 2 }), ["aspect_ratio", "freeze"]);
});

test("first-try pass rate, top reasons and weekly trend match the reference computation", async () => {
  const { root, store } = world();
  const view = await quality(ctxOf(root, store, "reasons=50"));
  assert.equal((await quality(ctxOf(root, store))).aggregate.top_reasons.length, 5, "the default list is the top five");
  const first = Object.fromEntries(view.aggregate.first_try.map((g) => [g.gate, g]));
  // QA first results: P1 pass, P2 fail, P3 fail, P7 pass, P8 pass, P10 fail -> 3 of 6
  assert.deepEqual([first.qa!.pieces, first.qa!.first_try_pass_pct], [6, 50]);
  // compliance first results: P1 pass, P3 fail -> 1 of 2
  assert.deepEqual([first.compliance!.pieces, first.compliance!.first_try_pass_pct], [2, 50]);
  // watcher first results: P1 pass, P5 fail
  assert.deepEqual([first.watcher!.pieces, first.watcher!.first_try_pass_pct], [2, 50]);

  const reasons = Object.fromEntries(view.aggregate.top_reasons.map((r) => [`${r.gate}:${r.reason}`, r.count]));
  assert.equal(reasons["qa:resolution"], 1, "P2's 720x1280 (P10 is 1080x1920)");
  assert.equal(reasons["qa:loudness"], 1, "P2 at -20 LUFS; P10 at -14.5 is inside the limit");
  assert.equal(reasons["qa:freeze"], 1);
  assert.equal(reasons["qa:aspect_ratio"], 1, "P3, from the tech-specs report");
  assert.equal(reasons["qa:unspecified"], 1, "P10 failed without a reason in its numbers");
  assert.equal(reasons["compliance:medical-claim"], 1);
  assert.equal(reasons["watcher:unverified"], 1);

  // Weekly trend: 7 day buckets aligned to the epoch (2026-10-01 is a bucket start); every fixture result is inside the last one.
  assert.equal(view.aggregate.trend.length, 8);
  const lastWeek = view.aggregate.trend.at(-1)!;
  assert.deepEqual([lastWeek.week_start, lastWeek.qa, lastWeek.compliance, lastWeek.watcher], ["2026-10-01", 50, 50, 50]);
  assert.ok(view.aggregate.trend.slice(0, -1).every((w) => w.qa === null && w.compliance === null && w.watcher === null), "weeks without results are sem dado");
});

test("filters narrow the pieces, the aggregates and the blocked list", async () => {
  const { root, store } = world();
  const blocked = await quality(ctxOf(root, store, "status=blocked"));
  assert.ok(blocked.pieces.length > 0 && blocked.pieces.every((p) => p.blocked));
  assert.ok(blocked.pieces.some((p) => p.piece_id === "P4"));
  const acme = await quality(ctxOf(root, store, "client=acme-us"));
  assert.deepEqual(acme.pieces.map((p) => p.piece_id), ["P10"]);
  assert.equal(acme.aggregate.first_try.find((g) => g.gate === "qa")!.first_try_pass_pct, 0, "the one piece of this client failed its first QA");
  assert.equal(acme.aggregate.first_try.find((g) => g.gate === "compliance")!.first_try_pass_pct, null, "no compliance result for this client: sem dado");
});

test("the gate reports reach the stream as rule ids only, never as the matched text", () => {
  const { eRoot, root } = emptyHost();
  const dir = join(eRoot, "outputs", "lothus", "2026-10-07", "P-RULES");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "compliance.json"), JSON.stringify({ pass: false, violations: [{ rule_id: "medical-claim", snippet: "cura o câncer, ligue 11 98888-7777" }, { rule_id: "medical-claim" }, { rule_id: "has spaces and free text" }, { rule_id: "financial-claim" }] }));
  writeFileSync(join(dir, "qa-tech-specs.json"), JSON.stringify({ pass: false, per_platform: { tiktok: { violations: [{ rule: "aspect_ratio" }] }, instagram: { violations: [{ rule: "aspect_ratio" }, { rule: "duration" }] } } }));
  const events = fromManifests(root);
  const co = events.find((e) => e.kind === "marketing.compliance_result")!;
  const qa = events.find((e) => e.kind === "marketing.qa_result")!;
  assert.deepEqual(co.data.rules, ["medical-claim", "financial-claim"], "distinct, well-formed rule ids only");
  assert.equal(co.data.violations, 4);
  assert.deepEqual(qa.data.rules, ["aspect_ratio", "duration"]);
  assert.ok(!JSON.stringify(events).includes("cura o câncer"));
});
