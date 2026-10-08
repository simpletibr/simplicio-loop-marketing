import { test } from "node:test";
import assert from "node:assert/strict";
import { costByFormat } from "../../lib/cost/by-format.ts";
import { makeEvent } from "../../lib/dashboard/events.ts";
import type { StoredEvent } from "../../lib/dashboard/store.ts";
import type { ContentPlan } from "../../lib/plan/content-plan.ts";

const plan = {
  client: "lothus",
  slots: [
    { piece_id: "P-HERO", format: "hero" },
    { piece_id: "P-CUT", format: "cutdown" },
    { piece_id: "P-LONG", format: "long_cut" },
  ],
} as unknown as ContentPlan;

function voice(piece_id: string, cache_hit: boolean, cost_usd: number, client = "lothus"): StoredEvent {
  return { ...makeEvent({ source: "t", key: `${piece_id}${cache_hit}${cost_usd}`, ts: "2026-10-01T00:00:00Z", kind: "voice_rendered", client, piece_id, data: { cache_hit, cost_usd } }), seq: 1 };
}

test("credits and voice spend are summed per format; cached voice costs nothing", () => {
  const rows = costByFormat({
    plans: [plan],
    credits: [
      { ts: "2026-10-01T00:00:00Z", client: "lothus", piece_id: "P-LONG", provider: "realoficial", credits: 12, purpose: "cortes", approved_by: "wesley", format: "long_cut" },
      { ts: "2026-10-01T00:00:00Z", client: "lothus", piece_id: "P-LONG", provider: "realoficial", credits: 24, purpose: "cortes", approved_by: "wesley" },
      { ts: "2026-10-01T00:00:00Z", client: "other", piece_id: "P-X", provider: "realoficial", credits: 99, purpose: "cortes", approved_by: "wesley" },
    ],
    events: [voice("P-HERO", false, 0.0123), voice("P-CUT", true, 0.0123), voice("P-CUT", true, 0.0123), voice("P-GHOST", false, 0.5)],
    client: "lothus",
  });
  const by = Object.fromEntries(rows.map((r) => [r.format, r]));
  assert.equal(by.long_cut?.credits, 36, "the row without a format takes it from the plan");
  assert.equal(by.long_cut?.pieces, 1);
  assert.equal(by.hero?.tts_usd, 0.0123);
  assert.equal(by.hero?.tts_requests, 1);
  assert.equal(by.cutdown?.tts_usd, 0);
  assert.equal(by.cutdown?.tts_cache_hits, 2);
  assert.equal(by.unknown?.tts_usd, 0.5, "a piece outside any plan is reported, not dropped");
  assert.equal(rows.some((r) => r.credits === 99), false, "other clients are excluded");
});
