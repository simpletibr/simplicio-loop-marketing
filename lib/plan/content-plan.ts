/**
 * content-plan.ts — the 30-day plan of a client (`content-plan/v1`).
 *
 * The planner is a pure, deterministic function of its input: the same
 * profile, start date, cadence and mix always produce the same slots, so
 * re-running a month never invents new work. The plan is immutable; what has
 * happened to each slot (rendered, awaiting approval, scheduled, ...) is a
 * view computed from the render queue, the approval log and the receipt
 * ledger (`planStatus`), so it can never drift from them.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { clientDir, assertClientSlug } from "../clients/paths";
import { getChannel } from "../channels/registry";
import { readHbi, writeHbiAtomic } from "../formats/binary";
import { loadSchemaRegistry } from "../contracts/registry";
import { validateArtifact } from "../contracts/validate";
import type { BrandProfile } from "../profile/brand-profile";
import { NETWORKS, NETWORK_CHANNEL, MAX_SCHEDULE_DAYS, type Network } from "../publish/publisher";
import { FORMATS, routeForFormat, type Format, type Route } from "./formats";

export const PLAN_SCHEMA = "content-plan/v1";

export interface PlanSlot {
  slot_id: string;
  piece_id: string;
  network: Network;
  /** UTC instant of the post. */
  publish_at: string;
  /** The same instant in the client's timezone, `YYYY-MM-DD HH:mm`. */
  local_time: string;
  format: Format;
  route: Route;
  angle: string;
  hook: string;
  caption: string;
  language?: string;
  /** The winning piece this slot varies (set by the metrics loop). */
  variant_of?: string;
  window: "in_window" | "next_cycle";
}

export interface ContentPlan {
  schema: typeof PLAN_SCHEMA;
  plan_id: string;
  client: string;
  generated_at: string;
  timezone: string;
  start: string;
  days: number;
  window_days: number;
  networks: Network[];
  slots: PlanSlot[];
}

export type Mix = Partial<Record<Format, number>>;

export const DEFAULT_MIX: Required<Mix> = { hero: 0.2, cutdown: 0.35, hook_variant: 0.2, slideshow: 0.15, carousel: 0.1, long_cut: 0 };

const COUNTRY_TZ: Record<string, string> = {
  BR: "America/Sao_Paulo",
  US: "America/New_York",
  DE: "Europe/Berlin",
  CH: "Europe/Zurich",
  SG: "Asia/Singapore",
  AE: "Asia/Dubai",
};

/** Local posting hour per network. */
const POST_HOUR: Record<Network, number> = { tiktok: 18, ig_reels: 12, yt_shorts: 19 };

export function timezoneForCountry(country: string): string {
  return COUNTRY_TZ[country.toUpperCase()] ?? "America/Sao_Paulo";
}

function assertTimezone(tz: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    throw new Error(`plan: unknown timezone "${tz}"`);
  }
  return tz;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Intl formatters are expensive to build; one per timezone and shape is enough. */
function formatter(tz: string, locale: string, fields: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${tz}|${locale}|${Object.keys(fields).join(",")}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { timeZone: tz, hourCycle: "h23", ...fields });
    formatters.set(key, f);
  }
  return f;
}

function offsetMinutes(utcMs: number, tz: string): number {
  const parts = formatter(tz, "en-US", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(utcMs));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - utcMs) / 60_000);
}

/** The UTC instant at which a wall-clock time happens in a timezone (DST aware). */
export function zonedToUtc(year: number, month: number, day: number, hour: number, tz: string): Date {
  const naive = Date.UTC(year, month - 1, day, hour, 0, 0);
  const first = naive - offsetMinutes(naive, tz) * 60_000;
  return new Date(naive - offsetMinutes(first, tz) * 60_000);
}

export function formatLocal(date: Date, tz: string): string {
  return formatter(tz, "sv-SE", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date).replace(",", "");
}

function addDays(ymd: string, days: number): { y: number; m: number; d: number } {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/** Largest-remainder quotas, then a deficit round-robin so formats interleave evenly. */
export function assignFormats(count: number, mix: Mix): Format[] {
  const weights = FORMATS.map((f) => Math.max(0, mix[f] ?? 0));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) throw new Error("plan: the format mix must have a positive weight");
  const exact = weights.map((w) => (w / total) * count);
  const quota = exact.map(Math.floor);
  let rest = count - quota.reduce((a, b) => a + b, 0);
  exact
    .map((e, i) => ({ i, frac: e - Math.floor(e) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)
    .forEach(({ i }) => {
      if (rest > 0) {
        quota[i] = (quota[i] ?? 0) + 1;
        rest--;
      }
    });
  const given = FORMATS.map(() => 0);
  const out: Format[] = [];
  for (let n = 0; n < count; n++) {
    let best = -1;
    let bestDeficit = -Infinity;
    FORMATS.forEach((_f, i) => {
      if ((given[i] ?? 0) >= (quota[i] ?? 0)) return;
      const deficit = ((quota[i] ?? 0) * (n + 1)) / count - (given[i] ?? 0);
      if (deficit > bestDeficit) {
        best = i;
        bestDeficit = deficit;
      }
    });
    given[best] = (given[best] ?? 0) + 1;
    out.push(FORMATS[best] as Format);
  }
  return out;
}

/** A winning post of the previous month, as much as the planner needs to vary it. */
export interface WinnerRef {
  piece_id: string;
  hook: string;
  angle: string;
}

/** Variations of a winner rotate through these formats: the same idea, a new opening, length or shape. */
export const VARIATION_FORMATS: readonly Format[] = ["hook_variant", "cutdown", "slideshow"];

/** Share of the slots given to variations of winners when there are winners. */
export const DEFAULT_WINNER_SHARE = 0.4;

export interface PlanInput {
  client: string;
  profile: BrandProfile;
  /** First day, `YYYY-MM-DD`, read in the client's timezone. */
  start: string;
  days: number;
  timezone?: string;
  networks?: Network[];
  /** Posts per week on each network. */
  perWeek?: number;
  mix?: Mix;
  /** Winners of the previous month: part of the slots become variations of them. */
  winners?: WinnerRef[];
  winnerShare?: number;
  now?: Date;
}

/** Spreads `share` of the slots evenly over the month and turns each into a variation of a winner, round-robin. */
function applyVariations(slots: PlanSlot[], winners: WinnerRef[], share: number): void {
  const k = Math.min(slots.length, Math.round(slots.length * share));
  for (let j = 0; j < k; j++) {
    const slot = slots[Math.floor((j * slots.length) / k)] as PlanSlot;
    const winner = winners[j % winners.length] as WinnerRef;
    const format = VARIATION_FORMATS[Math.floor(j / winners.length) % VARIATION_FORMATS.length] as Format;
    slot.format = format;
    slot.route = routeForFormat(format);
    slot.angle = winner.angle;
    slot.hook = winner.hook;
    slot.caption = `${winner.hook}\n${winner.angle}`;
    slot.variant_of = winner.piece_id;
  }
}

function copyFor(profile: BrandProfile, index: number): { angle: string; hook: string; caption: string } {
  const angle = profile.pillars[index % profile.pillars.length] as string;
  const pain = profile.pains.length ? (profile.pains[index % profile.pains.length] as string) : "";
  const pt = profile.language.toLowerCase().startsWith("pt");
  const hook = pain ? (pt ? `${pain}? ${profile.name} resolve.` : `${pain}? ${profile.name} fixes that.`) : `${profile.name}: ${angle}`;
  return { angle, hook, caption: `${hook}\n${angle}` };
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function planContent(input: PlanInput): ContentPlan {
  assertClientSlug(input.client);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.start) || Number.isNaN(Date.parse(`${input.start}T00:00:00Z`))) throw new Error(`plan: invalid start date "${input.start}"`);
  if (!Number.isInteger(input.days) || input.days < 1 || input.days > 90) throw new Error("plan: days must be an integer from 1 to 90");
  const networks = input.networks ?? [...NETWORKS];
  if (networks.length === 0 || networks.some((n) => !NETWORKS.includes(n))) throw new Error("plan: networks must be a non-empty subset of tiktok, ig_reels, yt_shorts");
  const perWeek = input.perWeek ?? 3;
  if (!Number.isInteger(perWeek) || perWeek < 1 || perWeek > 7) throw new Error("plan: perWeek must be an integer from 1 to 7");
  for (const network of networks) {
    const limit = getChannel(NETWORK_CHANNEL[network])?.frequency_limit;
    if (limit && perWeek * (limit.window_days / 7) > limit.count) {
      throw new Error(`plan: ${perWeek} posts/week on ${network} exceeds the channel limit of ${limit.count} per ${limit.window_days} days`);
    }
  }
  const timezone = assertTimezone(input.timezone ?? timezoneForCountry(input.profile.country));
  const now = input.now ?? new Date();
  const horizon = now.getTime() + MAX_SCHEDULE_DAYS * 24 * 60 * 60 * 1000;

  const raw: Array<{ network: Network; at: Date }> = [];
  networks.forEach((network, ni) => {
    for (let d = 0; d < input.days; d++) {
      const k = d + ni;
      if (Math.floor(((k + 1) * perWeek) / 7) > Math.floor((k * perWeek) / 7)) {
        const { y, m, d: day } = addDays(input.start, d);
        raw.push({ network, at: zonedToUtc(y, m, day, POST_HOUR[network], timezone) });
      }
    }
  });
  raw.sort((a, b) => a.at.getTime() - b.at.getTime() || NETWORKS.indexOf(a.network) - NETWORKS.indexOf(b.network));
  const formats = assignFormats(raw.length, input.mix ?? DEFAULT_MIX);
  const compact = input.start.replace(/-/g, "");
  const slots: PlanSlot[] = raw.map(({ network, at }, i) => {
    const format = formats[i] as Format;
    const copy = copyFor(input.profile, i);
    const piece_id = `PIECE-${slug(input.client)}-${at.toISOString().slice(0, 10).replace(/-/g, "")}-${network}`;
    return {
      slot_id: `${compact}-${String(i + 1).padStart(3, "0")}`,
      piece_id,
      network,
      publish_at: at.toISOString(),
      local_time: formatLocal(at, timezone),
      format,
      route: routeForFormat(format),
      ...copy,
      language: input.profile.language,
      window: at.getTime() <= horizon ? "in_window" : "next_cycle",
    };
  });
  const share = input.winnerShare ?? DEFAULT_WINNER_SHARE;
  if (!(share >= 0 && share <= 1)) throw new Error("plan: winnerShare must be between 0 and 1");
  if (input.winners?.length) applyVariations(slots, input.winners, share);
  const plan: ContentPlan = {
    schema: PLAN_SCHEMA,
    plan_id: `${input.client}-${input.start}-${input.days}d`,
    client: input.client,
    generated_at: now.toISOString(),
    timezone,
    start: input.start,
    days: input.days,
    window_days: MAX_SCHEDULE_DAYS,
    networks,
    slots,
  };
  const valid = validateArtifact(plan, loadSchemaRegistry());
  if (!valid.ok) throw new Error(`plan: invalid content-plan/v1: ${valid.errors.join("; ")}`);
  return plan;
}

/** Posts per network inside any rolling window must respect the channel limit. */
export function frequencyViolations(plan: ContentPlan): string[] {
  const out: string[] = [];
  for (const network of plan.networks) {
    const limit = getChannel(NETWORK_CHANNEL[network])?.frequency_limit;
    if (!limit) continue;
    const times = plan.slots.filter((s) => s.network === network).map((s) => Date.parse(s.publish_at));
    const span = limit.window_days * 24 * 60 * 60 * 1000;
    for (let i = 0; i < times.length; i++) {
      const inWindow = times.filter((t) => t >= (times[i] as number) && t < (times[i] as number) + span).length;
      if (inWindow > limit.count) {
        out.push(`${network}: ${inWindow} posts in ${limit.window_days} days from ${new Date(times[i] as number).toISOString()} (limit ${limit.count})`);
        break;
      }
    }
  }
  return out;
}

// --- persistence ------------------------------------------------------------

export function plansDir(root: string, client: string): string {
  return join(clientDir(root, client), "plans");
}

export function savePlan(root: string, plan: ContentPlan): string {
  const path = join(plansDir(root, plan.client), `${plan.plan_id}.hbi`);
  writeHbiAtomic(path, plan);
  return path;
}

export function listPlanIds(root: string, client: string): string[] {
  const dir = plansDir(root, client);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".hbi"))
    .map((f) => f.slice(0, -4))
    .sort();
}

export function loadPlan(root: string, client: string, planId?: string): ContentPlan {
  const id = planId ?? listPlanIds(root, client).at(-1);
  if (!id) throw new Error(`plan: no plan for "${client}"; run \`marketing-engine campaign --client ${client} --days 30\``);
  const path = join(plansDir(root, client), `${id}.hbi`);
  if (!existsSync(path)) throw new Error(`plan: unknown plan "${id}"`);
  const plan = readHbi<ContentPlan>(path);
  const valid = validateArtifact(plan, loadSchemaRegistry());
  if (!valid.ok) throw new Error(`plan: stored plan is invalid: ${valid.errors.join("; ")}`);
  return plan;
}
