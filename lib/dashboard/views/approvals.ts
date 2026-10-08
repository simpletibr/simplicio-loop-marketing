/**
 * approvals.ts — nothing stalls because an approval was forgotten.
 *
 * Two queues. The client's: pieces whose approval link still waits for an
 * answer, with the age, the time left before the scheduled post and the
 * client's own words for open change requests. The operator's: the decisions
 * only the owner can take (credit spend, add-on price, sending a preview, a
 * rule of the final command). The SLA colour follows the time to the post:
 * red under 24 h (or already late), yellow under 72 h, green otherwise.
 *
 * v1 is read-only. There is no approve or reject here: deciding goes through
 * `marketing-engine approval record` (an `approval/v1` record, with the
 * action gate). The panel only offers a link to copy, and never a token.
 */

import { openAdjustments, listRequests } from "../../approval/store";
import { listReceipts, type ScheduleReceipt } from "../../publish/publisher";
import { allPlans } from "../model";
import { scrubPii } from "../events";
import type { StoredEvent } from "../store";
import type { ContentPlan } from "../../plan/content-plan";
import { round } from "./common";
import type { ViewContext, ViewRoute } from "../routes";

const HOUR_MS = 3_600_000;
export const SLA_RED_HOURS = 24;
export const SLA_YELLOW_HOURS = 72;

export type Sla = "red" | "yellow" | "green" | "unknown";

export function slaOf(hoursToPost: number | null): Sla {
  if (hoursToPost === null) return "unknown";
  return hoursToPost < SLA_RED_HOURS ? "red" : hoursToPost < SLA_YELLOW_HOURS ? "yellow" : "green";
}

export interface ClientItem {
  request_id: string;
  client: string;
  piece_id: string;
  network: string | null;
  requested_at: string;
  age_hours: number;
  publish_at: string | null;
  hours_to_post: number | null;
  sla: Sla;
  /** Where the page of the month lives, when the operator told the panel (`MARKETING_APPROVAL_PAGE_URL`); never a token. */
  link: string | null;
  /** The command that regenerates the page of the month. */
  page_command: string;
}

export interface AdjustmentItem {
  client: string;
  piece_id: string;
  decided_by: string;
  decided_at: string;
  age_hours: number;
  /** The client's own words, with contact data removed. */
  note: string;
}

export interface OperatorItem {
  piece_id: string | null;
  requested_at: string;
  age_hours: number;
  status: string;
  /** What is being asked (the request tuple's own label), when it has one. */
  request: string | null;
  credit_estimate: number | null;
  impact: string | null;
  sla: Sla;
}

/** The slot of a piece in the plans: when it is due and on which network. */
function slotOf(plans: ContentPlan[], pieceId: string): { publish_at: string; network: string } | null {
  for (const plan of plans) {
    const slot = plan.slots.find((s) => s.piece_id === pieceId);
    if (slot) return { publish_at: slot.publish_at, network: slot.network };
  }
  return null;
}

/** Client requests with no decision yet for the same media; the latest request per piece wins. */
export function pendingClientApprovals(root: string, events: StoredEvent[], plans: ContentPlan[], receipts: ScheduleReceipt[], now: Date): ClientItem[] {
  const decided = new Set(events.filter((e) => e.kind === "marketing.approval_decided").map((e) => `${e.piece_id}|${e.data.media_sha256}`));
  const latest = new Map<string, ReturnType<typeof listRequests>[number]>();
  for (const r of listRequests(root).sort((a, b) => a.created_at.localeCompare(b.created_at))) latest.set(`${r.client}|${r.piece_id}`, r);
  const base = process.env.MARKETING_APPROVAL_PAGE_URL?.replace(/\/+$/, "");
  const out: ClientItem[] = [];
  for (const r of latest.values()) {
    if (decided.has(`${r.piece_id}|${r.media_sha256}`)) continue;
    const slot = slotOf(plans, r.piece_id);
    const receipt = receipts.find((x) => x.piece_id === r.piece_id && x.verdict === "scheduled");
    const publish_at = r.publish_at ?? receipt?.publish_at ?? slot?.publish_at ?? null;
    const hoursToPost = publish_at ? round((Date.parse(publish_at) - now.getTime()) / HOUR_MS, 1) : null;
    out.push({
      request_id: r.request_id,
      client: r.client,
      piece_id: r.piece_id,
      network: receipt?.network ?? slot?.network ?? null,
      requested_at: r.created_at,
      age_hours: round((now.getTime() - Date.parse(r.created_at)) / HOUR_MS, 1),
      publish_at,
      hours_to_post: hoursToPost,
      sla: slaOf(hoursToPost),
      link: base ? `${base}/aprovacao-${r.client}-${r.month}.html` : null,
      page_command: `marketing-engine approval page --client ${r.client} --month ${r.month} --out <pasta> --action-url <url>`,
    });
  }
  const rank: Record<Sla, number> = { red: 0, yellow: 1, unknown: 2, green: 3 };
  return out.sort((a, b) => rank[a.sla] - rank[b.sla] || (a.hours_to_post ?? Infinity) - (b.hours_to_post ?? Infinity) || a.piece_id.localeCompare(b.piece_id));
}

function operatorQueue(events: StoredEvent[], now: Date): OperatorItem[] {
  const latest = new Map<string, StoredEvent>();
  for (const e of events.filter((x) => x.kind === "marketing.approval_requested" && x.data.queue === "operator")) latest.set(String(e.data.tuple_id ?? e.piece_id ?? e.event_id), e);
  const out: OperatorItem[] = [];
  for (const e of latest.values()) {
    const status = String(e.data.status ?? "pending");
    if (status === "done") continue;
    const ageH = round((now.getTime() - Date.parse(e.ts)) / HOUR_MS, 1);
    const estimate = typeof e.data.credit_estimate === "number" ? e.data.credit_estimate : typeof e.data.credits === "number" ? e.data.credits : null;
    out.push({
      piece_id: e.piece_id ?? null,
      requested_at: e.ts,
      age_hours: ageH,
      status,
      request: typeof e.data.request === "string" ? scrubPii(e.data.request) : typeof e.data.reason === "string" ? scrubPii(e.data.reason) : null,
      credit_estimate: estimate,
      impact: typeof e.data.impact === "string" ? scrubPii(e.data.impact) : null,
      // No post date to count down to: the age decides (a day is yellow, three days red).
      sla: ageH >= SLA_YELLOW_HOURS ? "red" : ageH >= SLA_RED_HOURS ? "yellow" : "green",
    });
  }
  return out.sort((a, b) => b.age_hours - a.age_hours);
}

export async function approvals(ctx: ViewContext) {
  const { root, store, now } = ctx;
  const events = store.all().filter((e) => Date.parse(e.ts) <= now.getTime());
  const only = ctx.query.get("client");
  const client = pendingClientApprovals(root, events, allPlans(root), listReceipts(root), now).filter((i) => !only || i.client === only);
  const adjustments: AdjustmentItem[] = openAdjustments(root, only ?? undefined).map((a) => ({
    client: a.client,
    piece_id: a.piece_id,
    decided_by: scrubPii(a.decided_by.startsWith("client:") ? a.decided_by.slice("client:".length) : a.decided_by),
    decided_at: a.decided_at,
    age_hours: round((now.getTime() - Date.parse(a.decided_at)) / HOUR_MS, 1),
    note: scrubPii(a.note).slice(0, 1000),
  }));
  const operator = operatorQueue(events.filter((e) => !only || !e.client || e.client === only), now);
  const count = (items: Array<{ sla: Sla }>, sla: Sla): number => items.filter((i) => i.sla === sla).length;
  return {
    generated_at: now.toISOString(),
    read_only: true,
    sla_rule: { red_under_hours: SLA_RED_HOURS, yellow_under_hours: SLA_YELLOW_HOURS },
    client,
    adjustments,
    operator,
    summary: { client: client.length, adjustments: adjustments.length, operator: operator.length, red: count(client, "red") + count(operator, "red"), yellow: count(client, "yellow") + count(operator, "yellow") },
  };
}

export const approvalsRoute: ViewRoute = { path: "/api/approvals", handle: approvals };
