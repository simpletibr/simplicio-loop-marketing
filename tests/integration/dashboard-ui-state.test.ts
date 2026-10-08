import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { KPI_BETTER, SEAL_STATE, SLOT_LABEL, SLOT_STATE, kpiAttrs, slotState } from "../../lib/dashboard/ui/state.js";

/**
 * The page hands the kit a state word for every post, seal and KPI. The kit draws an unknown word as "pending", which would
 * show a new kind of post as waiting instead of failing loudly, so these tests tie each table to the source of its values.
 */

const quoted = (text: string): string[] => [...text.matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1] as string);
const read = (path: string): string => readFileSync(path, "utf8");

const KIT_STATES = [...(/export const STATES = Object\.freeze\(\{([\s\S]*?)\}\)/.exec(read("lib/dashboard/ui/kit/base.js"))?.[1] ?? "").matchAll(/^\s+([A-Z]+):/gm)].map((m) => m[1] as string);

test("the kit's state words are the ones the tables below use", () => {
  assert.deepEqual(KIT_STATES.sort(), ["BLOCKED", "ESTIMADO", "FAIL", "PASS", "PENDING", "RUNNING", "STALLED", "UNVERIFIED"]);
});

test("every post status the plan can produce has a label and a kit state, and nothing else does", () => {
  const union = /export type SlotStatus =([^;]+);/.exec(read("lib/plan/batch.ts"))?.[1] ?? "";
  const statuses = quoted(union);
  assert.ok(statuses.length >= 11, "the SlotStatus union was found");
  assert.deepEqual(Object.keys(SLOT_LABEL).sort(), [...statuses].sort());
  assert.deepEqual(Object.keys(SLOT_STATE).sort(), [...statuses].sort());
  for (const state of Object.values(SLOT_STATE)) assert.ok(KIT_STATES.includes(state), `${state} is a kit state`);
});

test("only a real schedule is drawn as passed: a simulation is an estimate and a queued post is waiting", () => {
  assert.equal(slotState({ status: "scheduled", simulated: false }), "PASS");
  assert.equal(slotState({ status: "scheduled", simulated: true }), "ESTIMADO");
  assert.equal(slotState({ status: "queued_next_cycle", simulated: false }), "PENDING");
  assert.equal(slotState({ status: "schedule_failed", simulated: false }), "FAIL");
  assert.equal(slotState({ status: "changes_requested", simulated: false }), "FAIL");
  const passed = Object.entries(SLOT_STATE).filter(([, state]) => state === "PASS").map(([status]) => status);
  assert.deepEqual(passed, ["scheduled"]);
});

test("every seal state the quality view can return maps to a kit state, except 'does not apply'", () => {
  const union = /export type SealState =([^;]+);/.exec(read("lib/dashboard/views/quality.ts"))?.[1] ?? "";
  const seals = quoted(union).filter((s) => s !== "na");
  assert.ok(seals.length >= 4, "the SealState union was found");
  assert.deepEqual(Object.keys(SEAL_STATE).sort(), [...seals].sort());
  for (const state of Object.values(SEAL_STATE)) assert.ok(KIT_STATES.includes(state), `${state} is a kit state`);
  assert.equal(SEAL_STATE.none, "UNVERIFIED", "a seal with no data is never drawn as passed");
});

test("every cockpit KPI either has a better side or is one of the two that has none", () => {
  const ids = [...read("lib/dashboard/views/cockpit.ts").matchAll(/\bkpi\("([a-z0-9_]+)"/g)].map((m) => m[1] as string);
  assert.ok(ids.length >= 11, "the KPI ids were found");
  for (const id of Object.keys(KPI_BETTER)) assert.ok(ids.includes(id), `${id} is a KPI`);
  assert.deepEqual(ids.filter((id) => !Object.hasOwn(KPI_BETTER, id)).sort(), ["pieces_in_funnel", "tts_quota"]);
  for (const side of Object.values(KPI_BETTER)) assert.ok(side === "up" || side === "down");
});

test("a KPI with a better side hands the kit a signed change and the side that is an improvement", () => {
  assert.deepEqual(kpiAttrs({ id: "scheduled_30d", label: "Agendadas", value: 7, delta: 7 }), { label: "Agendadas", value: "7", delta: "+7", good: "up", detail: "vs semana passada" });
  // failures that fall are the improvement: the kit gets a negative change and "down is good", and paints it as better
  assert.deepEqual(kpiAttrs({ id: "publish_failures", label: "Falhas", value: 1, delta: -2 }), { label: "Falhas", value: "1", delta: "-2", good: "down", detail: "vs semana passada" });
  assert.equal(kpiAttrs({ id: "mrr", label: "MRR", value: 1234.5, delta: 1.5, detail: { currency: "BRL" } }).delta, "+1,5");
  assert.equal(kpiAttrs({ id: "mrr", label: "MRR", value: 1234.5, delta: 1.5, detail: { currency: "BRL" } }).value, "1.234,5");
});

test("no change, no comparison and no better side are written as text, never as an improvement", () => {
  const flat = kpiAttrs({ id: "published_today", label: "Hoje", value: 0, delta: 0 });
  assert.equal(flat.delta, null);
  assert.equal(flat.detail, "= vs semana passada");
  const unknown = kpiAttrs({ id: "mrr", label: "MRR", value: null, delta: null });
  assert.equal(unknown.value, "sem dado", "no source is 'sem dado', never zero");
  assert.equal(unknown.delta, null);
  assert.equal(unknown.detail, "sem comparação");
  const funnel = kpiAttrs({ id: "pieces_in_funnel", label: "Peças no funil", value: 8, delta: 8, detail: { by_stage: { prospect: 8, script: 0, scheduled: 7 } } });
  assert.equal(funnel.delta, null, "the funnel has no better side");
  assert.match(funnel.detail, /Coleta 8 · Agendado 7 · ▲ \+8 vs semana passada/);
  assert.doesNotMatch(funnel.detail, /Roteiro/, "an empty stage is left out");
});

test("a KPI carries its source, its currency and its quota in the detail line", () => {
  assert.equal(kpiAttrs({ id: "credits_ro", label: "Créditos", value: null, delta: null, detail: { source: "leitura da Real Oficial desligada" } }).detail, "leitura da Real Oficial desligada · sem comparação");
  assert.match(kpiAttrs({ id: "sales_month", label: "Vendas", value: 3, delta: 1, detail: { currency: "BRL" } }).detail, /^BRL · vs semana passada$/);
  assert.match(kpiAttrs({ id: "tts_quota", label: "Cota", value: 10, delta: 2, detail: { limit: 100, blocked_until: "2026-10-09T03:00:00Z" } }).detail, /^limite 100 · volta 2026-10-09 03:00 · ▲ \+2 vs semana passada$/);
});
