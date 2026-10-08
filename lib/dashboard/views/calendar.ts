/**
 * calendar.ts — each client's month: what is scheduled, where and when, and
 * the holes. Read-only; moving a post would have to go through the publisher,
 * the client approval and the action-gate.
 */

import { listReceipts } from "../../publish/publisher";
import { planStatus } from "../../plan/batch";
import { formatLocal } from "../../plan/content-plan";
import { allPlans } from "../model";
import { DAY_MS } from "./common";
import type { ViewContext, ViewRoute } from "../routes";

const BRT = "America/Sao_Paulo";
const DEFAULT_ZONES = [BRT, "America/New_York", "Asia/Singapore"];

function validZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function calendar(ctx: ViewContext) {
  const { root, now, query } = ctx;
  const zones = (query.get("tz")?.split(",").map((z) => z.trim()).filter(validZone) ?? []).slice(0, 5);
  const shown = zones.length ? zones : DEFAULT_ZONES;
  const from = query.get("from") ? Date.parse(`${query.get("from")}T00:00:00Z`) : now.getTime() - 7 * DAY_MS;
  const to = query.get("to") ? Date.parse(`${query.get("to")}T23:59:59Z`) : now.getTime() + 35 * DAY_MS;
  const network = query.get("network");
  const clientFilter = query.get("client");

  const entries = allPlans(root)
    .filter((p) => !clientFilter || p.client === clientFilter)
    .flatMap((plan) => planStatus(root, plan).map((view) => ({ plan, view })))
    .filter(({ view }) => !network || view.slot.network === network)
    .filter(({ view }) => {
      const at = Date.parse(view.slot.publish_at);
      return at >= from && at <= to;
    })
    .sort((a, b) => a.view.slot.publish_at.localeCompare(b.view.slot.publish_at))
    .map(({ plan, view }) => {
      const at = new Date(view.slot.publish_at);
      return {
        client: plan.client,
        campaign_id: plan.plan_id,
        piece_id: view.slot.piece_id,
        network: view.slot.network,
        format: view.slot.format,
        publish_at: view.slot.publish_at,
        client_time: { timezone: plan.timezone, local: view.slot.local_time },
        brt: formatLocal(at, BRT),
        zones: Object.fromEntries(shown.map((z) => [z, formatLocal(at, z)])),
        status: view.status,
        /** Only a receipt in the ledger makes a post "scheduled"; the next cycle never does. */
        scheduled_on_realoficial: view.status === "scheduled" && view.receipt?.dry_run === false,
        simulated: view.status === "scheduled" && view.receipt?.dry_run === true,
        window: view.slot.window,
        next_cycle_note: view.slot.window === "next_cycle" ? "na fila do próximo ciclo" : null,
      };
    });

  // cadence: posts per client per day, and the empty days inside each client's planned span
  const cadence = new Map<string, Map<string, number>>();
  for (const e of entries) {
    const days = cadence.get(e.client) ?? new Map<string, number>();
    const day = e.client_time.local.slice(0, 10);
    days.set(day, (days.get(day) ?? 0) + 1);
    cadence.set(e.client, days);
  }
  const plans = allPlans(root);
  const heatmap = [...cadence.entries()].map(([client, days]) => {
    const mine = plans.filter((p) => p.client === client);
    const slots = mine.flatMap((p) => p.slots);
    const weeks = Math.max(mine.reduce((n, p) => n + p.days, 0) / 7, 1);
    const sorted = [...days.keys()].sort();
    const gaps: string[] = [];
    if (sorted.length > 1) {
      for (let t = Date.parse(`${sorted[0]}T00:00:00Z`); t <= Date.parse(`${sorted.at(-1)}T00:00:00Z`); t += DAY_MS) {
        const day = new Date(t).toISOString().slice(0, 10);
        if (!days.has(day)) gaps.push(day);
      }
    }
    return { client, days: Object.fromEntries([...days.entries()].sort()), weekly_goal: Math.round((slots.length / weeks) * 10) / 10, empty_days: gaps };
  });

  const conflicts: Array<{ type: string; client: string; piece_id: string; network: string; publish_at: string; detail: string }> = [];
  const seen = new Map<string, string>();
  for (const e of entries) {
    const key = `${e.client}|${e.network}|${e.publish_at}`;
    if (seen.has(key)) conflicts.push({ type: "same_network_same_time", client: e.client, piece_id: e.piece_id, network: e.network, publish_at: e.publish_at, detail: `also ${seen.get(key)}` });
    else seen.set(key, e.piece_id);
    const soon = Date.parse(e.publish_at) - now.getTime() < DAY_MS && Date.parse(e.publish_at) > now.getTime();
    if (soon && ["planned", "rendering", "rendered", "awaiting_approval", "changes_requested"].includes(e.status)) {
      conflicts.push({ type: "without_approval", client: e.client, piece_id: e.piece_id, network: e.network, publish_at: e.publish_at, detail: `status ${e.status} less than 24 h before the post` });
    }
  }
  // A receipt that points further than the window allows should be impossible; if it ever happens it must be loud.
  for (const r of listReceipts(root).filter((x) => x.verdict === "scheduled")) {
    if (Date.parse(r.publish_at) - Date.parse(r.ts) > 31 * DAY_MS) conflicts.push({ type: "outside_window", client: r.client, piece_id: r.piece_id, network: r.network, publish_at: r.publish_at, detail: "scheduled further than the 30 day window" });
  }

  return { generated_at: now.toISOString(), from: new Date(from).toISOString(), to: new Date(to).toISOString(), zones: shown, window_days: 30, entries, heatmap, conflicts };
}

export const calendarRoute: ViewRoute = { path: "/api/calendar", handle: calendar };
