import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_DUBBING_MATRIX, DryRunDubbing, RealOficialDubbing, dubReceiptId, dubbingFor, listDubReceipts, routeFor, type DubRequest } from "../../lib/dubbing/dubbing.ts";
import { loadSchemaRegistry } from "../../lib/contracts/registry.ts";
import { validateArtifact } from "../../lib/contracts/validate.ts";
import { makeEvent } from "../../lib/dashboard/events.ts";
import { fromDubbing } from "../../lib/observability/dashboard/internal.ts";
import { ReplayTransport } from "../helpers/ro-transport.ts";

const NOW = new Date("2026-10-07T12:00:00Z");
const REQ: DubRequest = { client: "lothus", pieceId: "PIECE-1", language: "ar", projectId: "01HZXQ3M8K2V5N7P9R1S4T6W8Y", clipId: "01HZXQ3M8K2V5N7P9R1S4T6W01", approvedByWesley: true };

function host(): string {
  process.env.DRY_RUN = "false";
  const root = mkdtempSync(join(tmpdir(), "me-dub-"));
  mkdirSync(join(root, "data"), { recursive: true });
  return root;
}

test("the language matrix picks the lane and a client overrides it", () => {
  assert.equal(routeFor("en-US"), "tts");
  assert.equal(routeFor("de-CH"), "tts");
  assert.equal(routeFor("ar"), "realoficial-dub");
  assert.equal(routeFor("sv"), "realoficial-dub", "unlisted languages go to Real Oficial");
  assert.equal(routeFor("ar", { voice_routes: { ar: "subtitle-only" } }), "subtitle-only");
  assert.equal(routeFor("en-GB", { voice_routes: { "en-GB": "realoficial-dub" } }), "realoficial-dub", "an exact tag beats the base language");
  assert.equal(routeFor("en", { voice_routes: { en: "not-a-lane" } }), "tts", "an invalid override is ignored");
  assert.ok(Object.values(DEFAULT_DUBBING_MATRIX).every((r) => ["tts", "realoficial-dub", "subtitle-only"].includes(r)));
});

test("estimate never calls Real Oficial and costs nothing", async () => {
  const t = new ReplayTransport({});
  const d = new RealOficialDubbing(host(), t, NOW);
  const est = await d.estimate(REQ);
  assert.equal(est.route, "realoficial-dub");
  assert.equal(est.spends, false);
  assert.equal(est.credits, 0);
  assert.equal(est.needs_voice_rights_consent, true);
  assert.equal((await d.estimate({ ...REQ, language: "en" })).needs_voice_rights_consent, false);
  assert.equal(t.calls.length, 0);
});

test("dub without approvedByWesley fails closed: blocked receipt, no remote call", async () => {
  const root = host();
  const t = new ReplayTransport({ ro_dub_clip: "dub-started" });
  const r = await new RealOficialDubbing(root, t, NOW).dub({ ...REQ, approvedByWesley: undefined });
  assert.equal(r.verdict, "blocked");
  assert.equal(r.failure_class, "approval_missing");
  assert.equal(t.calls.length, 0);
  assert.equal(listDubReceipts(root).length, 1, "the refusal is on the ledger");
  const false_ = await new RealOficialDubbing(root, t, NOW).dub({ ...REQ, approvedByWesley: false });
  assert.equal(false_.failure_class, "approval_missing");
});

test("a Real Oficial dub runs dub, wait and render, and is labelled as AI voice", async () => {
  const root = host();
  const t = new ReplayTransport({ ro_dub_clip: "dub-started", ro_list_translations_and_dubs: "dubs-completed", ro_render_clip: "render-clip" });
  const r = await new RealOficialDubbing(root, t, NOW).dub(REQ);
  assert.equal(r.verdict, "dubbed");
  assert.equal(r.implementation, "realoficial");
  assert.equal(r.ai_generated_voice, true);
  assert.equal(r.credits_spent, 0);
  assert.equal(r.dub_id, "01HZXQ3M8K2V5N7P9R1S4T6D01", "the arb dub matches the ar request");
  assert.equal(r.render_id, "01HZXQ3M8K2V5N7P9R1S4T6R01");
  assert.deepEqual(t.tools, ["ro_dub_clip", "ro_list_translations_and_dubs", "ro_render_clip"]);
  assert.deepEqual(t.calls[0]?.args, { project_id: REQ.projectId, clip_id: REQ.clipId, language: "ar" });
  assert.deepEqual(t.calls[2]?.args, { project_id: REQ.projectId, clip_id: REQ.clipId, dub_id: "01HZXQ3M8K2V5N7P9R1S4T6D01" });
  const valid = validateArtifact(r, loadSchemaRegistry());
  assert.equal(valid.ok, true, valid.errors.join("; "));

  const again = await new RealOficialDubbing(root, t, NOW).dub(REQ);
  assert.equal(again.receipt_id, r.receipt_id);
  assert.equal(t.tools.filter((x) => x === "ro_dub_clip").length, 1, "the same language is never dubbed twice");
});

test("the voice-rights consent is never given on the owner's behalf", async () => {
  const t = new ReplayTransport({ ro_dub_clip: "dub-consent-required" });
  const r = await new RealOficialDubbing(host(), t, NOW).dub(REQ);
  assert.equal(r.verdict, "blocked");
  assert.equal(r.failure_class, "consent_required");
  assert.deepEqual(t.tools, ["ro_dub_clip"]);
  assert.ok(!JSON.stringify(r).includes("consent/voice-rights"), "the consent link is not stored");
});

test("a dub that is still processing is blocked as not ready and can be re-run", async () => {
  const root = host();
  const t = new ReplayTransport({ ro_dub_clip: "dub-started", ro_list_translations_and_dubs: ["dubs-processing", "dubs-completed"], ro_render_clip: "render-clip" });
  const first = await new RealOficialDubbing(root, t, NOW).dub(REQ);
  assert.equal(first.failure_class, "not_ready");
  assert.ok(!t.tools.includes("ro_render_clip"));
  const second = await new RealOficialDubbing(root, t, NOW).dub(REQ);
  assert.equal(second.verdict, "dubbed");
});

test("subtitle-only translates the captions and renders with the translation", async () => {
  const t = new ReplayTransport({ ro_translate_clips: "translate-started", ro_list_translations_and_dubs: "dubs-completed", ro_render_clip: "render-clip" });
  const r = await new RealOficialDubbing(host(), t, NOW).dub({ ...REQ, language: "de", route: "subtitle-only" });
  assert.equal(r.verdict, "dubbed");
  assert.equal(r.ai_generated_voice, false);
  assert.equal(r.translation_id, "01HZXQ3M8K2V5N7P9R1S4T6T01");
  assert.ok(!t.tools.includes("ro_dub_clip"));
  assert.deepEqual(t.calls.at(-1)?.args, { project_id: REQ.projectId, clip_id: REQ.clipId, subtitle_translation_id: "01HZXQ3M8K2V5N7P9R1S4T6T01" });
});

test("the tts lane hands the piece to the voice provider and never calls Real Oficial", async () => {
  const t = new ReplayTransport({});
  const r = await new RealOficialDubbing(host(), t, NOW).dub({ ...REQ, language: "en", projectId: undefined, clipId: undefined });
  assert.equal(r.verdict, "handoff");
  assert.equal(r.route, "tts");
  assert.equal(r.ai_generated_voice, false);
  assert.equal(t.calls.length, 0);
});

test("invalid requests, a missing clip and a missing transport are refused", async () => {
  const root = host();
  const d = new RealOficialDubbing(root, undefined, NOW);
  assert.equal((await d.dub({ ...REQ, language: "not a tag" })).failure_class, "invalid_request");
  assert.equal((await d.dub({ ...REQ, clipId: undefined })).failure_class, "invalid_request");
  assert.equal((await d.dub(REQ)).failure_class, "driver_unavailable");
  const t = new ReplayTransport({});
  const remote = await new RealOficialDubbing(root, t, NOW).dub({ ...REQ, pieceId: "PIECE-2" });
  assert.equal(remote.failure_class, "remote_error", "an unexpected tool failure is a failed receipt, not an exception");
});

test("dry-run dubbing walks the whole flow with canned answers", async () => {
  process.env.DRY_RUN = "true";
  const root = mkdtempSync(join(tmpdir(), "me-dub-dry-"));
  const d = dubbingFor(root);
  assert.ok(d instanceof DryRunDubbing);
  const blocked = await d.dub({ client: "lothus", pieceId: "P-1", language: "ar" });
  assert.equal(blocked.failure_class, "approval_missing");
  const r = await d.dub({ client: "lothus", pieceId: "P-1", language: "ar", approvedByWesley: true });
  assert.equal(r.verdict, "dubbed");
  assert.equal(r.dry_run, true);
  assert.equal(r.implementation, "dry-run");
  assert.equal(r.credits_spent, 0);
  assert.equal(validateArtifact(r, loadSchemaRegistry()).ok, true);
  const live = dubbingFor(root);
  assert.ok(live instanceof DryRunDubbing);
  process.env.DRY_RUN = "false";
  assert.ok(dubbingFor(root) instanceof RealOficialDubbing);
  assert.equal(dubReceiptId({ client: "a", pieceId: "b", language: "EN" }), dubReceiptId({ client: "a", pieceId: "b", language: "en" }));
});

test("receipts reach the dashboard as dubbing_requested and dubbing_finished", async () => {
  const root = host();
  const t = new ReplayTransport({ ro_dub_clip: "dub-started", ro_list_translations_and_dubs: "dubs-completed", ro_render_clip: "render-clip" });
  await new RealOficialDubbing(root, t, NOW).dub(REQ);
  await new RealOficialDubbing(root, t, NOW).dub({ ...REQ, pieceId: "PIECE-9", approvedByWesley: false });
  const events = fromDubbing(root);
  assert.deepEqual(events.map((e) => e.kind).sort(), ["marketing.dubbing_finished", "marketing.dubbing_finished", "marketing.dubbing_requested", "marketing.dubbing_requested"]);
  const blocked = events.find((e) => e.piece_id === "PIECE-9" && e.kind === "marketing.dubbing_finished");
  assert.equal(blocked?.severity, "warn");
  assert.equal(blocked?.data.failure_class, "approval_missing");
  assert.equal(makeEvent({ source: "x", key: "k", ts: NOW.toISOString(), kind: "dubbing_requested" }).kind, "marketing.dubbing_requested");
});
