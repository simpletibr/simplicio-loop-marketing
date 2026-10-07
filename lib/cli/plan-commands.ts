import { readBrandProfile } from "../profile/brand-profile";
import { assertClientSlug } from "../clients/paths";
import { emitEvent } from "../observability/events";
import { NETWORKS, publisherFor, type Network } from "../publish/publisher";
import { requestApprovals, renderBatch, scheduleApproved, planStatus } from "../plan/batch";
import { DEFAULT_MIX, frequencyViolations, loadPlan, planContent, savePlan, timezoneForCountry, type ContentPlan, type Mix } from "../plan/content-plan";
import { FORMATS, type Format } from "../plan/formats";
import { statusCounts } from "../plan/calendar";

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function parseMix(raw: string | undefined): Mix {
  if (!raw) return DEFAULT_MIX;
  const mix: Mix = {};
  for (const pair of raw.split(",")) {
    const [key, value] = pair.split("=");
    if (!FORMATS.includes(key as Format) || !Number.isFinite(Number(value))) throw new Error(`campaign: invalid --mix entry "${pair}"`);
    mix[key as Format] = Number(value);
  }
  return mix;
}

function localDate(now: Date, tz: string): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** `YYYY-MM-DD`, `next-month` (first day of the next month) or today in the client's timezone. */
export function resolveStart(arg: string | undefined, now: Date, tz: string): string {
  if (arg && arg !== "next-month") return arg;
  const today = localDate(now, tz);
  if (!arg) return today;
  const [y, m] = today.split("-").map(Number) as [number, number];
  const next = new Date(Date.UTC(y, m, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function out(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

/** Handles `campaign --client ... --days N` and the render | approvals | schedule subcommands. Returns false when argv is not a plan command. */
export async function planCommand(argv: string[], root: string): Promise<boolean> {
  const sub = ["render", "approvals", "schedule"].includes(argv[0] ?? "") ? argv[0] : undefined;
  const client = flag(argv, "--client");
  if (!client) return false;
  assertClientSlug(client);
  if (!sub && !flag(argv, "--days")) return false;

  if (sub === "render" || sub === "approvals" || sub === "schedule") {
    const plan = loadPlan(root, client, flag(argv, "--plan"));
    if (sub === "render") out(await renderBatch({ root, plan }));
    else if (sub === "approvals") out({ requested: requestApprovals(root, plan) });
    else {
      const summary = await scheduleApproved({ root, plan, publisherFor: (network: Network) => publisherFor(network) });
      out({ ...summary, receipts: summary.receipts.map((r) => ({ piece_id: r.piece_id, network: r.network, verdict: r.verdict, failure_class: r.failure_class })) });
    }
    return true;
  }

  const profile = readBrandProfile(root, client);
  const now = new Date();
  const tz = flag(argv, "--tz") ?? timezoneForCountry(profile.country);
  const networks = flag(argv, "--networks")?.split(",").map((n) => n.trim()) as Network[] | undefined;
  if (networks?.some((n) => !NETWORKS.includes(n))) throw new Error("campaign: --networks accepts tiktok, ig_reels, yt_shorts");
  const plan: ContentPlan = planContent({
    client,
    profile,
    start: resolveStart(flag(argv, "--start"), now, tz),
    days: Number(flag(argv, "--days")),
    timezone: tz,
    networks,
    perWeek: flag(argv, "--per-week") ? Number(flag(argv, "--per-week")) : undefined,
    mix: parseMix(flag(argv, "--mix")),
    now,
  });
  const violations = frequencyViolations(plan);
  if (violations.length > 0) throw new Error(`campaign: plan breaks channel limits: ${violations.join("; ")}`);
  const path = savePlan(root, plan);
  emitEvent(root, { kind: "campaign_planned", phase: "campaign", client, data: { plan_id: plan.plan_id, slots: plan.slots.length } });
  const views = planStatus(root, plan);
  out({ plan_id: plan.plan_id, path, timezone: plan.timezone, slots: plan.slots.length, in_window: plan.slots.filter((s) => s.window === "in_window").length, next_cycle: plan.slots.filter((s) => s.window === "next_cycle").length, status: statusCounts(views) });
  return true;
}
