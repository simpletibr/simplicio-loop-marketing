/**
 * billing.ts — money and quota sources: verified Stripe webhooks stored as
 * JSONL, the Real Oficial credit ledger, the Gemini TTS quota files and the
 * metric snapshots. Reads only; nothing here can create a charge or spend a
 * credit.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { engineRoot } from "../../clients/paths";
import { readSnapshots } from "../../analytics/score";
import { makeEvent, type DashboardEvent } from "../../dashboard/events";
import { parseJson, readLinesFrom } from "./jsonl";

interface StripeObject {
  amount_total?: number;
  amount_paid?: number;
  currency?: string;
  payment_status?: string;
  status?: string;
  metadata?: { client?: string; plan?: string };
  subscription_details?: { metadata?: { client?: string; plan?: string } };
  items?: { data?: Array<{ quantity?: number; price?: { id?: string; unit_amount?: number; currency?: string; recurring?: { interval?: string } } }> };
}

interface StripeEvent {
  id: string;
  type: string;
  created: number;
  data: { object: StripeObject };
}

export function stripeLogPath(root: string): string {
  return resolve(engineRoot(root), "data", "stripe-webhooks.jsonl");
}

function brl(amount: number, currency: string): { amount_brl?: number; fx?: string } {
  if (currency === "BRL") return { amount_brl: amount, fx: "native" };
  const rate = Number(process.env.PTAX_USD_BRL);
  return currency === "USD" && rate > 0 ? { amount_brl: Math.round(amount * rate * 100) / 100, fx: "estimate:env PTAX_USD_BRL" } : {};
}

export function mapStripeEvent(ev: StripeEvent): DashboardEvent | null {
  const o = ev.data.object;
  const client = o.metadata?.client ?? o.subscription_details?.metadata?.client;
  const ts = new Date(ev.created * 1000).toISOString();
  const common = { source: "stripe-webhook", key: ev.id, ts, client, piece_id: undefined } as const;
  if (ev.type === "checkout.session.completed" && o.payment_status === "paid") {
    const currency = (o.currency ?? "usd").toUpperCase();
    const amount = (o.amount_total ?? 0) / 100;
    return makeEvent({ ...common, kind: "payment_received", data: { amount, currency, processor: "stripe", event_type: ev.type, ...brl(amount, currency) } });
  }
  if (ev.type === "invoice.paid") {
    const currency = (o.currency ?? "usd").toUpperCase();
    const amount = (o.amount_paid ?? 0) / 100;
    return makeEvent({ ...common, kind: "payment_received", data: { amount, currency, processor: "stripe", event_type: ev.type, ...brl(amount, currency) } });
  }
  if (ev.type.startsWith("customer.subscription.")) {
    const item = o.items?.data?.[0];
    const currency = (item?.price?.currency ?? "usd").toUpperCase();
    const monthly = item?.price?.recurring?.interval === "month" ? ((item.price.unit_amount ?? 0) * (item.quantity ?? 1)) / 100 : undefined;
    const status = ev.type.endsWith(".deleted") ? "canceled" : (o.status ?? "unknown");
    return makeEvent({ ...common, kind: "subscription_changed", severity: status === "canceled" || status === "past_due" ? "warn" : "info", data: { status, plan: o.metadata?.plan ?? item?.price?.id, currency, ...(monthly !== undefined && status !== "canceled" ? { mrr: monthly, ...brl(monthly, currency) } : {}), event_type: ev.type } });
  }
  return null;
}

export function fromStripeLog(root: string, cursor: number): { events: DashboardEvent[]; next: number } {
  const { lines, next } = readLinesFrom(stripeLogPath(root), cursor);
  const events: DashboardEvent[] = [];
  for (const line of lines) {
    const ev = parseJson<StripeEvent>(line.text);
    const mapped = ev?.id && ev.data?.object ? mapStripeEvent(ev) : null;
    if (mapped) events.push(mapped);
  }
  return { events, next };
}

export interface CreditRow {
  ts: string;
  client?: string;
  piece_id?: string;
  provider: string;
  credits: number;
  purpose: string;
  approved_by?: string;
}

export function creditsPath(root: string): string {
  return resolve(engineRoot(root), "data", "credits.jsonl");
}

/** Every spend must name who approved it; a row without `approved_by` is counted and dropped. */
export function fromCredits(root: string, cursor: number): { events: DashboardEvent[]; next: number; rejected: number } {
  const { lines, next } = readLinesFrom(creditsPath(root), cursor);
  const events: DashboardEvent[] = [];
  let rejected = 0;
  for (const line of lines) {
    const row = parseJson<CreditRow>(line.text);
    if (!row || !row.approved_by || !Number.isFinite(row.credits)) {
      rejected++;
      continue;
    }
    events.push(makeEvent({ source: "credits-ledger", key: String(line.offset), ts: row.ts, kind: "credit_spent", client: row.client, piece_id: row.piece_id, data: { provider: row.provider, credits: row.credits, purpose: row.purpose, approved_by: row.approved_by } }));
  }
  return { events, next, rejected };
}

/** `tts-bloqueado-ate.txt` holds the ISO time until which the Gemini TTS quota is exhausted. */
export function fromTtsQuota(root: string): DashboardEvent[] {
  const dir = resolve(engineRoot(root), "data");
  const out: DashboardEvent[] = [];
  const blocked = resolve(dir, "tts-bloqueado-ate.txt");
  if (existsSync(blocked)) {
    const text = readFileSync(blocked, "utf8").trim();
    const until = Date.parse(text);
    if (!Number.isNaN(until)) {
      out.push(makeEvent({ source: "tts-quota", key: `blocked|${text}`, ts: statSync(blocked).mtime.toISOString(), kind: "tts_quota", severity: "warn", data: { blocked_until: new Date(until).toISOString(), exhausted: true } }));
    }
  }
  return out;
}

export function fromTtsUsage(root: string, cursor: number): { events: DashboardEvent[]; next: number } {
  const path = resolve(engineRoot(root), "data", "tts-usage.jsonl");
  const { lines, next } = readLinesFrom(path, cursor);
  const events: DashboardEvent[] = [];
  for (const line of lines) {
    const row = parseJson<{ ts: string; requests: number; limit: number }>(line.text);
    if (!row || !Number.isFinite(row.requests) || !Number.isFinite(row.limit)) continue;
    events.push(makeEvent({ source: "tts-usage", key: String(line.offset), ts: row.ts, kind: "tts_quota", severity: row.requests >= row.limit ? "warn" : "info", data: { requests: row.requests, limit: row.limit, exhausted: row.requests >= row.limit } }));
  }
  return { events, next };
}

export function fromMetricSnapshots(root: string): DashboardEvent[] {
  return readSnapshots(root).map((s, i) =>
    makeEvent({ source: "analytics-snapshots", key: `${s.piece_id}|${s.channel_id}|${s.metric}|${s.polled_at}|${i}`, ts: s.polled_at, kind: "metrics_snapshot", piece_id: s.piece_id, network: s.channel_id, data: { metric: s.metric, value: s.value, source: s.source ?? "api" } }),
  );
}
