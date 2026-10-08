/**
 * by-format.ts — what each content format costs: Real Oficial credits and
 * voice (TTS) spend, per format, from the same sources the dashboard reads
 * (the credits ledger, voice events and the plan that says which slot is
 * which format). Cached voice (derived formats reuse the hero's) costs nothing.
 */

import { existsSync, readFileSync } from "node:fs";
import { creditsPath, type CreditRow } from "../observability/dashboard/billing";
import { FORMATS, type Format } from "../plan/formats";
import type { ContentPlan } from "../plan/content-plan";
import type { StoredEvent } from "../dashboard/store";

export interface FormatCost {
  format: Format | "unknown";
  pieces: number;
  credits: number;
  tts_usd: number;
  tts_requests: number;
  tts_cache_hits: number;
}

export function readCreditRows(root: string): CreditRow[] {
  const path = creditsPath(root);
  if (!existsSync(path)) return [];
  const rows: CreditRow[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as CreditRow;
      // A spend without a named approver is not a valid spend (same rule as the dashboard adapter).
      if (row.approved_by && Number.isFinite(row.credits)) rows.push(row);
    } catch {
      /* malformed line: skipped */
    }
  }
  return rows;
}

export function costByFormat(input: { credits: CreditRow[]; events: StoredEvent[]; plans: ContentPlan[]; client?: string }): FormatCost[] {
  const formatOf = new Map<string, Format>();
  for (const plan of input.plans) for (const slot of plan.slots) if (!input.client || plan.client === input.client) formatOf.set(slot.piece_id, slot.format);
  const out = new Map<string, FormatCost>();
  const bucket = (format: string): FormatCost => {
    let b = out.get(format);
    if (!b) {
      b = { format: (FORMATS as readonly string[]).includes(format) ? (format as Format) : "unknown", pieces: 0, credits: 0, tts_usd: 0, tts_requests: 0, tts_cache_hits: 0 };
      out.set(format, b);
    }
    return b;
  };
  const pieces = new Map<string, Set<string>>();
  const seen = (format: string, piece?: string): void => {
    if (!piece) return;
    const set = pieces.get(format) ?? new Set<string>();
    set.add(piece);
    pieces.set(format, set);
  };

  for (const row of input.credits) {
    if (input.client && row.client !== input.client) continue;
    const format = row.format ?? (row.piece_id ? formatOf.get(row.piece_id) : undefined) ?? "unknown";
    bucket(format).credits += row.credits;
    seen(format, row.piece_id);
  }
  for (const e of input.events) {
    if (e.kind !== "marketing.voice_rendered" || !e.piece_id) continue;
    if (input.client && e.client !== input.client) continue;
    const format = formatOf.get(e.piece_id) ?? "unknown";
    const b = bucket(format);
    seen(format, e.piece_id);
    if (e.data.cache_hit === true) b.tts_cache_hits++;
    else {
      b.tts_requests++;
      b.tts_usd += typeof e.data.cost_usd === "number" ? e.data.cost_usd : 0;
    }
  }
  for (const [format, set] of pieces) bucket(format).pieces = set.size;
  return [...out.values()].map((b) => ({ ...b, credits: Math.round(b.credits * 100) / 100, tts_usd: Math.round(b.tts_usd * 10_000) / 10_000 })).sort((a, b) => a.format.localeCompare(b.format));
}
