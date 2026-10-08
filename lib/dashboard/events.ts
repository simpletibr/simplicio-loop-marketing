/**
 * events.ts — the `marketing.*` event stream of the distribution dashboard.
 *
 * Every source (events log, journal, yool board, receipts, the video
 * factory's output folders, billing webhooks, ...) is turned into the same
 * envelope, `simplicio.dashboard-event/v1`, with ids that follow the
 * hierarchy client -> campaign -> piece -> network.
 *
 * `event_id` is derived from the source and the source's own key, so
 * re-reading a source can never duplicate an event. Free text in `data` is
 * scrubbed of e-mails and phone numbers before it enters the stream (LGPD):
 * the stream never carries contact data.
 */

import { createHash } from "node:crypto";

export const DASHBOARD_EVENT_SCHEMA = "simplicio.dashboard-event/v1";

export const MARKETING_KINDS = [
  // production
  "prospect_collected",
  "script_ready",
  "voice_rendered",
  "render_started",
  "render_finished",
  "qa_result",
  "compliance_result",
  "watcher_gate",
  // approval and publishing
  "approval_requested",
  "approval_decided",
  "scheduled",
  "published",
  "publish_failed",
  "dubbing_requested",
  "dubbing_finished",
  // metrics and money
  "metrics_snapshot",
  "winner_marked",
  "credit_spent",
  "tts_quota",
  "payment_received",
  "subscription_changed",
] as const;

export type MarketingKind = (typeof MARKETING_KINDS)[number];

export type Severity = "info" | "warn" | "error";

export interface DashboardEvent {
  schema: typeof DASHBOARD_EVENT_SCHEMA;
  event_id: string;
  ts: string;
  kind: `marketing.${MarketingKind}`;
  source: string;
  client?: string;
  campaign_id?: string;
  piece_id?: string;
  network?: string;
  severity: Severity;
  data: Record<string, unknown>;
}

export interface EventInput {
  source: string;
  /** The source's own identity for this occurrence (a line number, a tuple version, a file hash, ...). */
  key: string;
  ts: string;
  kind: MarketingKind;
  client?: string;
  campaign_id?: string;
  piece_id?: string;
  network?: string;
  severity?: Severity;
  data?: Record<string, unknown>;
}

export function eventIdOf(source: string, key: string): string {
  return createHash("sha256").update(`${source}\u0000${key}`).digest("hex").slice(0, 24);
}

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
// 8+ digits with the usual phone separators; ids and timestamps are far shorter or have no spaces/plus.
const PHONE = /(?<![\w.])\+?\(?\d[\d\s().-]{7,}\d(?![\w])/g;

/** A phone has 10+ digits, or 8+ when written with an international `+`; dates and ids stay readable. */
export function scrubPii(text: string): string {
  return text.replace(EMAIL, "[email]").replace(PHONE, (m) => {
    const digits = m.replace(/\D/g, "").length;
    return digits >= 10 || (m.trim().startsWith("+") && digits >= 8) ? "[phone]" : m;
  });
}

function scrub(value: unknown): unknown {
  if (typeof value === "string") return scrubPii(value);
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrub(v)]));
  return value;
}

export function makeEvent(input: EventInput): DashboardEvent {
  if (!MARKETING_KINDS.includes(input.kind)) throw new Error(`dashboard: unknown kind "${input.kind}"`);
  const ts = Number.isNaN(Date.parse(input.ts)) ? new Date(0).toISOString() : new Date(input.ts).toISOString();
  return {
    schema: DASHBOARD_EVENT_SCHEMA,
    event_id: eventIdOf(input.source, input.key),
    ts,
    kind: `marketing.${input.kind}`,
    source: input.source,
    ...(input.client ? { client: input.client } : {}),
    ...(input.campaign_id ? { campaign_id: input.campaign_id } : {}),
    ...(input.piece_id ? { piece_id: input.piece_id } : {}),
    ...(input.network ? { network: input.network } : {}),
    severity: input.severity ?? "info",
    data: scrub(input.data ?? {}) as Record<string, unknown>,
  };
}

export function shortKind(event: DashboardEvent): MarketingKind {
  return event.kind.slice("marketing.".length) as MarketingKind;
}
