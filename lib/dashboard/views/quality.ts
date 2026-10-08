/**
 * quality.ts — why a piece can or cannot go on: the seals of every gate per
 * piece (technical QA, compliance, watcher, B-roll licenses, approval, AI
 * label), the share that pass each gate at the first try, the top reasons
 * pieces fail and the weekly trend. Read-only: a gate that has not run is
 * "sem dado", never a pass.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { engineRoot } from "../../clients/paths";
import { allPlans, buildPieceModels } from "../model";
import { scrubPii } from "../events";
import type { StoredEvent } from "../store";
import { DAY_MS, round } from "./common";
import type { ViewContext, ViewRoute } from "../routes";

export type SealState = "pass" | "fail" | "pending" | "na" | "none";

export interface Seal {
  state: SealState;
  at?: string;
  detail?: string;
  reasons?: string[];
}

export interface PieceGates {
  piece_id: string;
  client: string | null;
  network: string | null;
  format: string | null;
  qa: Seal;
  compliance: Seal;
  watcher: Seal;
  licenses: Seal;
  approval: Seal;
  ai_label: Seal;
  blocked: boolean;
  blocking: string[];
}

const NONE: Seal = { state: "none" };
const AI_LABEL = /\b(IA|AI|inteligência artificial|artificial intelligence|AI-generated|gerad[oa] por IA)\b/i;

/** Why a technical QA run failed: the rules it reported, or the limits of the QA sheet applied to its numbers. */
export function qaReasons(d: Record<string, unknown>): string[] {
  const out: string[] = Array.isArray(d.rules) ? d.rules.filter((r): r is string => typeof r === "string") : [];
  if (typeof d.resolution === "string" && !["540x960", "1080x1920"].includes(d.resolution.replace("×", "x"))) out.push("resolution");
  if (typeof d.lufs === "number" && Math.abs(d.lufs + 14) > 1) out.push("loudness");
  if (typeof d.freeze_s === "number" && d.freeze_s > 0.5) out.push("freeze");
  return [...new Set(out)];
}

function complianceReasons(d: Record<string, unknown>): string[] {
  return Array.isArray(d.rules) && d.rules.length > 0 ? (d.rules as string[]) : ["compliance"];
}

/** `outputs/<client>/<date>/<piece>/` of every piece, found once per request. */
function outputIndex(root: string): Map<string, string> {
  const index = new Map<string, string>();
  const base = resolve(engineRoot(root), "outputs");
  const dirs = (p: string): string[] => {
    try {
      return readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return [];
    }
  };
  for (const client of dirs(base)) for (const date of dirs(join(base, client))) for (const piece of dirs(join(base, client, date))) index.set(piece, join(base, client, date, piece));
  return index;
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const last = (events: StoredEvent[], kind: string): StoredEvent | undefined => events.filter((e) => e.kind === kind).at(-1);

function gatesOf(pieceId: string, events: StoredEvent[], dirs: Map<string, string>, factory: string, meta: { client: string | null; network: string | null; format: string | null }): PieceGates {
  const qaEv = last(events, "marketing.qa_result");
  const coEv = last(events, "marketing.compliance_result");
  const wEv = last(events, "marketing.watcher_gate");
  const qa: Seal = qaEv ? { state: qaEv.data.passed === true ? "pass" : "fail", at: qaEv.ts, ...(qaEv.data.passed === true ? {} : { reasons: qaReasons(qaEv.data) }) } : NONE;
  const compliance: Seal = coEv ? { state: coEv.data.pass === true ? "pass" : "fail", at: coEv.ts, ...(coEv.data.pass === true ? {} : { reasons: complianceReasons(coEv.data), detail: `${String(coEv.data.violations ?? 0)} violação(ões)` }) } : NONE;
  const watcher: Seal = wEv ? { state: wEv.data.passed === true ? "pass" : "fail", at: wEv.ts, detail: String(wEv.data.tag ?? "UNVERIFIED"), ...(wEv.data.passed === true ? {} : { reasons: ["unverified"] }) } : NONE;

  const dir = dirs.get(pieceId);
  const lic = readJson(join(dir ?? "", "broll-licenses.json")) ?? readJson(join(factory, pieceId, "broll-licenses.json"));
  const licenses: Seal = lic ? { state: lic.passed === true ? "pass" : "fail", ...(lic.passed === true ? {} : { reasons: ["license"] }) } : NONE;

  // Approval is valid only for the exact media that will be posted: the latest render.
  const decided = last(events, "marketing.approval_decided");
  const requested = last(events, "marketing.approval_requested");
  const renders = events.filter((e) => e.kind === "marketing.render_finished" && typeof e.data.sha256 === "string" && e.data.ok !== false);
  const latestRender = renders.filter((e) => e.data.stage === "final").at(-1) ?? renders.at(-1);
  let approval: Seal = NONE;
  if (decided) {
    const approved = decided.data.decision === "approved";
    if (!approved) approval = { state: "fail", at: decided.ts, detail: "o cliente pediu ajustes", reasons: ["changes_requested"] };
    else if (!latestRender) approval = { state: "pending", at: decided.ts, detail: "sem hash de render para comparar" };
    else if (decided.data.media_sha256 === latestRender.data.sha256) approval = { state: "pass", at: decided.ts };
    else approval = { state: "fail", at: decided.ts, detail: "a mídia mudou depois de aprovada: hash diferente do aprovado", reasons: ["approval_hash_mismatch"] };
  } else if (requested) approval = { state: "pending", at: requested.ts, detail: "aguardando o cliente" };

  const dubbed = events.some((e) => e.kind === "marketing.dubbing_finished" && e.data.ai_generated_voice === true && e.data.verdict === "dubbed");
  let ai_label: Seal = { state: "na" };
  if (dubbed) {
    const captions = readJson(join(dir ?? "", "captions.json"));
    ai_label = captions === null ? { state: "pending", detail: "voz de IA: legendas ainda não geradas" } : AI_LABEL.test(JSON.stringify(captions)) ? { state: "pass" } : { state: "fail", detail: "voz de IA sem rótulo nas legendas", reasons: ["ai_label_missing"] };
  }

  const seals = { qa, compliance, watcher, licenses, approval, ai_label } as const;
  const blocking = Object.entries(seals).filter(([, s]) => s.state === "fail").map(([name]) => name);
  return { piece_id: pieceId, ...meta, ...seals, blocked: blocking.length > 0, blocking };
}

interface FirstTry {
  gate: string;
  piece: string;
  passed: boolean;
  at: number;
  reasons: string[];
}

const GATES: Array<{ gate: string; kind: string; ok: (d: Record<string, unknown>) => boolean; why: (d: Record<string, unknown>) => string[] }> = [
  { gate: "qa", kind: "marketing.qa_result", ok: (d) => d.passed === true, why: (d) => (qaReasons(d).length > 0 ? qaReasons(d) : ["unspecified"]) },
  { gate: "compliance", kind: "marketing.compliance_result", ok: (d) => d.pass === true, why: complianceReasons },
  { gate: "watcher", kind: "marketing.watcher_gate", ok: (d) => d.passed === true, why: () => ["unverified"] },
];

export async function quality(ctx: ViewContext) {
  const { root, store, now, query } = ctx;
  const events = store.all().filter((e) => Date.parse(e.ts) <= now.getTime());
  const models = buildPieceModels(events, allPlans(root));
  const dirs = outputIndex(root);
  const byPiece = new Map<string, StoredEvent[]>();
  for (const e of events) if (e.piece_id) byPiece.set(e.piece_id, [...(byPiece.get(e.piece_id) ?? []), e]);

  const all: PieceGates[] = [...byPiece.entries()].map(([id, evs]) => {
    const m = models.get(id);
    return gatesOf(id, evs, dirs, ctx.sources.videosDir, { client: m?.client ?? evs[0]?.client ?? null, network: m?.network ?? null, format: m?.format ?? null });
  });
  const client = query.get("client");
  const status = query.get("status");
  const pieces = all
    .filter((p) => (!client || p.client === client) && (status !== "blocked" || p.blocked))
    .filter((p) => p.qa.state !== "none" || p.compliance.state !== "none" || p.watcher.state !== "none" || p.approval.state !== "none")
    .sort((a, b) => Number(b.blocked) - Number(a.blocked) || a.piece_id.localeCompare(b.piece_id));

  // First try: the first result of each gate on each piece.
  const ids = new Set(pieces.map((p) => p.piece_id));
  const results: FirstTry[] = [];
  for (const [id, evs] of byPiece) {
    if (!ids.has(id)) continue;
    for (const g of GATES) {
      const own = evs.filter((e) => e.kind === g.kind);
      for (const e of own) if (!g.ok(e.data)) results.push({ gate: g.gate, piece: id, passed: false, at: Date.parse(e.ts), reasons: g.why(e.data) });
      const first = own[0];
      if (first) results.push({ gate: `${g.gate}:first`, piece: id, passed: g.ok(first.data), at: Date.parse(first.ts), reasons: [] });
    }
  }
  const firstPass = GATES.map((g) => {
    const firsts = results.filter((r) => r.gate === `${g.gate}:first`);
    return { gate: g.gate, pieces: firsts.length, first_try_pass_pct: firsts.length === 0 ? null : round((firsts.filter((r) => r.passed).length / firsts.length) * 100, 1) };
  });
  const reasons = new Map<string, number>();
  for (const r of results.filter((x) => !x.gate.endsWith(":first"))) for (const why of r.reasons) reasons.set(`${r.gate}:${why}`, (reasons.get(`${r.gate}:${why}`) ?? 0) + 1);
  const top_reasons = [...reasons.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, Math.min(Number(query.get("reasons")) || 5, 50)).map(([key, count]) => ({ gate: key.split(":")[0] as string, reason: scrubPii(key.slice(key.indexOf(":") + 1)), count }));

  const weekStart = (t: number): number => Math.floor(t / (7 * DAY_MS)) * 7 * DAY_MS;
  const thisWeek = weekStart(now.getTime());
  const trend = Array.from({ length: 8 }, (_, i) => {
    const start = thisWeek - (7 - i) * 7 * DAY_MS;
    const row: Record<string, unknown> = { week_start: new Date(start).toISOString().slice(0, 10) };
    for (const g of GATES) {
      const inWeek = results.filter((r) => r.gate === `${g.gate}:first` && r.at >= start && r.at < start + 7 * DAY_MS);
      row[g.gate] = inWeek.length === 0 ? null : round((inWeek.filter((r) => r.passed).length / inWeek.length) * 100, 1);
    }
    return row;
  });

  return { generated_at: now.toISOString(), pieces, aggregate: { first_try: firstPass, top_reasons, trend, blocked: pieces.filter((p) => p.blocked).length, total: pieces.length } };
}

export const qualityRoute: ViewRoute = { path: "/api/quality", handle: quality };
