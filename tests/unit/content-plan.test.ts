import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_MIX,
  assignFormats,
  formatLocal,
  frequencyViolations,
  listPlanIds,
  loadPlan,
  planContent,
  savePlan,
  timezoneForCountry,
  zonedToUtc,
  type ContentPlan,
} from "../../lib/plan/content-plan.ts";
import { FORMATS, monthlyMix, pieceTypeFor, routeForFormat } from "../../lib/plan/formats.ts";
import { renderCalendar, statusCounts } from "../../lib/plan/calendar.ts";
import { resolveStart } from "../../lib/cli/plan-commands.ts";
import { buildBrandProfile, fixtureCollection } from "../../lib/profile/brand-profile.ts";
import { loadSchemaRegistry } from "../../lib/contracts/registry.ts";
import { validateArtifact } from "../../lib/contracts/validate.ts";
import type { SlotView } from "../../lib/plan/batch.ts";

const NOW = new Date("2026-10-07T12:00:00Z");
const profile = buildBrandProfile(fixtureCollection("https://lothus.com.br"), { client: "lothus", url: "https://lothus.com.br", mode: "dry-run", now: NOW });
const base = { client: "lothus", profile, start: "2026-10-08", days: 30, now: NOW };

test("zonedToUtc is DST aware in the client's timezone", () => {
  assert.equal(zonedToUtc(2026, 10, 20, 18, "America/Sao_Paulo").toISOString(), "2026-10-20T21:00:00.000Z");
  assert.equal(zonedToUtc(2026, 10, 20, 18, "America/New_York").toISOString(), "2026-10-20T22:00:00.000Z", "EDT is UTC-4");
  assert.equal(zonedToUtc(2026, 11, 5, 18, "America/New_York").toISOString(), "2026-11-05T23:00:00.000Z", "EST is UTC-5 after DST ends");
  assert.equal(zonedToUtc(2026, 10, 20, 19, "Asia/Singapore").toISOString(), "2026-10-20T11:00:00.000Z");
  assert.equal(formatLocal(new Date("2026-10-20T22:00:00Z"), "America/New_York"), "2026-10-20 18:00");
  assert.equal(timezoneForCountry("ch"), "Europe/Zurich");
  assert.equal(timezoneForCountry("XX"), "America/Sao_Paulo");
});

test("the plan is deterministic, valid and respects cadence and channel limits", () => {
  const today = { ...base, start: "2026-10-07" };
  const a = planContent({ ...today, perWeek: 3 });
  assert.deepEqual(a, planContent({ ...today, perWeek: 3 }));
  assert.deepEqual(validateArtifact(a, loadSchemaRegistry()).errors, []);
  assert.equal(a.plan_id, "lothus-2026-10-07-30d");
  assert.equal(a.timezone, "America/Sao_Paulo");
  for (const network of a.networks) {
    const n = a.slots.filter((s) => s.network === network).length;
    assert.ok(n === 12 || n === 13, `${network}: ${n} posts in 30 days at 3/week`);
  }
  assert.equal(new Set(a.slots.map((s) => s.piece_id)).size, a.slots.length, "piece ids are unique");
  assert.deepEqual(a.slots.map((s) => s.publish_at), [...a.slots.map((s) => s.publish_at)].sort());
  assert.deepEqual(frequencyViolations(a), []);
  assert.ok(a.slots.every((s) => s.window === "in_window"));
  assert.ok(a.slots.every((s) => s.route.lane !== "realoficial-clips"), "long cuts are opt-in");
});

test("format quotas follow the mix and interleave", () => {
  const plan = planContent({ ...base, perWeek: 3 });
  const counts = Object.fromEntries(FORMATS.map((f) => [f, plan.slots.filter((s) => s.format === f).length]));
  const total = plan.slots.length;
  for (const f of FORMATS) {
    const expected = DEFAULT_MIX[f] * total;
    assert.ok(Math.abs((counts[f] as number) - expected) <= 1, `${f}: ${counts[f]} vs ${expected.toFixed(1)}`);
  }
  assert.ok(!plan.slots.slice(0, 5).every((s) => s.format === plan.slots[0]?.format), "formats interleave from the start");
  const heroOnly = planContent({ ...base, perWeek: 2, mix: { hero: 1 } });
  assert.ok(heroOnly.slots.every((s) => s.format === "hero"));
  assert.equal(assignFormats(0, DEFAULT_MIX).length, 0);
  assert.deepEqual(assignFormats(3, { cutdown: 1 }), ["cutdown", "cutdown", "cutdown"]);
  assert.throws(() => assignFormats(3, {}), /positive weight/);
  assert.equal(routeForFormat("long_cut").spends_credits, true);
  assert.equal(routeForFormat("hero").spends_credits, false);
  assert.equal(pieceTypeFor("carousel"), "carousel");
  assert.equal(pieceTypeFor("slideshow"), "reel");
});

test("slots beyond 30 days are marked for the next cycle", () => {
  const plan = planContent({ ...base, days: 45, perWeek: 2 });
  const horizon = NOW.getTime() + 30 * 86_400_000;
  assert.ok(plan.slots.some((s) => s.window === "next_cycle"));
  for (const s of plan.slots) assert.equal(s.window, Date.parse(s.publish_at) <= horizon ? "in_window" : "next_cycle");
});

test("slots land at the right wall-clock time in each client timezone", () => {
  for (const [tz, expectedTikTokHour] of [["America/Sao_Paulo", "18:00"], ["America/New_York", "18:00"], ["Asia/Singapore", "18:00"]] as const) {
    const plan = planContent({ ...base, timezone: tz, perWeek: 7, networks: ["tiktok"], days: 7 });
    assert.equal(plan.slots.length, 7);
    assert.ok(plan.slots.every((s) => s.local_time.endsWith(expectedTikTokHour)), `${tz}: ${plan.slots[0]?.local_time}`);
  }
  const sg = planContent({ ...base, timezone: "Asia/Singapore", perWeek: 7, networks: ["tiktok"], days: 1 });
  assert.equal(sg.slots[0]?.publish_at, "2026-10-08T10:00:00.000Z");
});

test("invalid input is rejected with a clear message", () => {
  assert.throws(() => planContent({ ...base, days: 0 }), /days must be/);
  assert.throws(() => planContent({ ...base, days: 91 }), /days must be/);
  assert.throws(() => planContent({ ...base, start: "10/08/2026" }), /invalid start date/);
  assert.throws(() => planContent({ ...base, start: "2026-13-45" }), /invalid start date/);
  assert.throws(() => planContent({ ...base, perWeek: 0 }), /perWeek/);
  assert.throws(() => planContent({ ...base, perWeek: 8 }), /perWeek/);
  assert.throws(() => planContent({ ...base, networks: [] }), /non-empty subset/);
  assert.throws(() => planContent({ ...base, networks: ["linkedin" as never] }), /non-empty subset/);
  assert.throws(() => planContent({ ...base, timezone: "Mars/Olympus" }), /unknown timezone/);
  assert.throws(() => planContent({ ...base, client: "../x" }), /invalid client slug/);
});

test("frequencyViolations flags a window over the channel limit", () => {
  const plan = planContent({ ...base, perWeek: 3, networks: ["tiktok"], days: 7 });
  const crowded: ContentPlan = { ...plan, slots: Array.from({ length: 9 }, (_, i) => ({ ...(plan.slots[0] as ContentPlan["slots"][number]), slot_id: `s${i}`, publish_at: new Date(Date.parse("2026-10-08T21:00:00Z") + i * 3_600_000).toISOString() })) };
  assert.match(frequencyViolations(crowded)[0] as string, /tiktok: 9 posts in 7 days/);
});

test("plans round-trip through storage and the latest plan is the default", () => {
  const root = mkdtempSync(join(tmpdir(), "me-plan-"));
  assert.throws(() => loadPlan(root, "lothus"), /no plan for "lothus"/);
  const a = planContent({ ...base, perWeek: 2 });
  const b = planContent({ ...base, start: "2026-11-08", perWeek: 2 });
  savePlan(root, a);
  savePlan(root, b);
  assert.deepEqual(listPlanIds(root, "lothus"), [a.plan_id, b.plan_id]);
  assert.deepEqual(loadPlan(root, "lothus"), b);
  assert.deepEqual(loadPlan(root, "lothus", a.plan_id), a);
  assert.throws(() => loadPlan(root, "lothus", "nope"), /unknown plan/);
  assert.deepEqual(listPlanIds(root, "other"), []);
});

test("resolveStart handles explicit dates, today and next-month in the client's timezone", () => {
  assert.equal(resolveStart("2026-12-01", NOW, "America/Sao_Paulo"), "2026-12-01");
  assert.equal(resolveStart(undefined, NOW, "America/Sao_Paulo"), "2026-10-07");
  assert.equal(resolveStart("next-month", NOW, "America/Sao_Paulo"), "2026-11-01");
  assert.equal(resolveStart("next-month", new Date("2026-12-25T10:00:00Z"), "Asia/Singapore"), "2027-01-01");
});

test("calendar renders a table and markdown with BRT and the next-cycle note", () => {
  const plan = planContent({ ...base, days: 45, perWeek: 1, networks: ["tiktok"], timezone: "America/New_York" });
  const views: SlotView[] = plan.slots.map((slot) => ({ slot, status: slot.window === "next_cycle" ? "queued_next_cycle" : "planned" }));
  const table = renderCalendar(plan, views);
  assert.match(table, /^local\s+BRT\s+network/);
  assert.ok(table.includes("19:00 BRT"), "18:00 New York (EDT) is 19:00 in Sao Paulo");
  const md = renderCalendar(plan, views, "markdown");
  assert.match(md, /^# Calendário lothus/);
  assert.match(md, /\| local \| BRT \| network/);
  assert.match(md, /fila do próximo ciclo/);
  const counts = statusCounts(views);
  assert.equal((counts.planned ?? 0) + (counts.queued_next_cycle ?? 0), plan.slots.length);
});

test("the monthly mix asks for 4 hero videos, 10 derivatives, 6 slideshows or carousels, and long cuts only with a long video", () => {
  const tally = (formats: string[]) => Object.fromEntries(FORMATS.map((f) => [f, formats.filter((x) => x === f).length]));
  assert.deepEqual(tally(assignFormats(20, monthlyMix({ hasLongVideo: false }))), { hero: 4, cutdown: 6, hook_variant: 4, slideshow: 3, carousel: 3, long_cut: 0 });
  assert.deepEqual(tally(assignFormats(24, monthlyMix({ hasLongVideo: true }))), { hero: 4, cutdown: 6, hook_variant: 4, slideshow: 3, carousel: 3, long_cut: 4 });
  const plan = planContent({ ...base, mix: monthlyMix({ hasLongVideo: true }) });
  const longCuts = plan.slots.filter((s) => s.format === "long_cut");
  assert.ok(longCuts.length > 0);
  assert.ok(longCuts.every((s) => s.route.lane === "realoficial-clips" && s.route.spends_credits));
  assert.ok(plan.slots.filter((s) => s.format !== "long_cut").every((s) => !s.route.spends_credits), "only the long-cut lane spends credits");
});
