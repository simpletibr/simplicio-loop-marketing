/**
 * internal.ts — adapters for what this repo itself writes: the events log,
 * the loop journal, the yool board, publish receipts, approvals and piece
 * manifests. Each adapter is a pure read that returns events; ids come from
 * the source's own keys, so running it twice adds nothing.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { engineRoot } from "../../clients/paths";
import { listDecisions, listRequests } from "../../approval/store";
import { makeEvent, type DashboardEvent, type MarketingKind } from "../../dashboard/events";
import { readHbi } from "../../formats/binary";
import { readJournal } from "../../loop/journal";
import { eventsPath, type MarketingEvent } from "../events";
import { listWinners } from "../../analytics/winners";
import { listDubReceipts } from "../../dubbing/dubbing";
import { listReceipts } from "../../publish/publisher";
import { readBoard } from "../../yool/board";
import { verifyRenderManifest } from "../../video/contract";
import { parseJson, readLinesFrom } from "./jsonl";

const SRC = {
  events: "marketing-event/v1",
  journal: "marketing-loop-state/v1",
  yool: "yool-board",
  receipts: "marketing-publish-receipt/v1",
  approvals: "approval/v1",
  dubbing: "dubbing-receipt/v1",
  winners: "winners-ledger",
  manifests: "marketing-manifest/v1",
};

/**
 * Maps one `marketing-event/v1` line. Only the kinds that no artifact on disk
 * owns come from here; scheduling, approvals, gates and renders are read from
 * their own source of truth so one occurrence is never counted twice.
 */
/** Distinct rule ids of a gate report, so the dashboard can rank the reasons pieces fail; free text is never copied. */
function ruleIds(rules: Array<string | undefined> | undefined): string[] {
  return [...new Set((rules ?? []).filter((r): r is string => typeof r === "string" && /^[\w.:-]{1,64}$/.test(r)))].slice(0, 10);
}

export function mapMarketingEvent(ev: MarketingEvent, key: string): DashboardEvent | null {
  const base = { source: SRC.events, key, ts: ev.ts, client: ev.client, piece_id: ev.piece_id } as const;
  const data = { ...(ev.data ?? {}), ...(ev.verdict ? { verdict: ev.verdict } : {}), ...(ev.provider ? { provider: ev.provider } : {}) };
  switch (ev.kind) {
    case "profile_built":
      return makeEvent({ ...base, kind: "prospect_collected", data: { ...data, status: "profile" } });
    case "piece_start":
      return makeEvent({ ...base, kind: "render_started", data });
    case "render_failed":
      return makeEvent({ ...base, kind: "render_finished", severity: "warn", data: { ...data, stage: "final", ok: false } });
    case "publish_verified":
      return makeEvent({ ...base, kind: "published", data });
    default:
      return null;
  }
}

export function fromMarketingEvents(root: string, cursor: number): { events: DashboardEvent[]; next: number } {
  const { lines, next } = readLinesFrom(eventsPath(root), cursor);
  const events: DashboardEvent[] = [];
  for (const line of lines) {
    const ev = parseJson<MarketingEvent>(line.text);
    const mapped = ev ? mapMarketingEvent(ev, String(line.offset)) : null;
    if (mapped) events.push(mapped);
  }
  return { events, next };
}

/** The loop journal owns "the script is ready"; its gate stages are read from the artifacts instead. */
export function fromJournal(root: string): DashboardEvent[] {
  const out: DashboardEvent[] = [];
  for (const r of readJournal(root)) {
    if (r.stage !== "copy" || r.gate !== "pass") continue;
    out.push(makeEvent({ source: SRC.journal, key: `${r.item_id}|${r.attempt}|${r.ts}|copy`, kind: "script_ready", ts: r.ts, client: r.client, campaign_id: r.campaign, piece_id: r.item_id, data: { attempt: r.attempt } }));
  }
  return out;
}

const TUPLE_KIND: Partial<Record<string, MarketingKind>> = {
  "winner.promote": "winner_marked",
  "human.approval_required": "approval_requested",
};

export function fromYoolBoard(root: string): DashboardEvent[] {
  const out: DashboardEvent[] = [];
  for (const t of readBoard(engineRoot(root))) {
    const kind = TUPLE_KIND[t.class];
    if (!kind) continue;
    if (kind === "winner_marked" && t.status !== "done") continue;
    const pieceId = t.id.includes(":") ? t.id.split(":").slice(1).join(":") : undefined;
    out.push(
      makeEvent({
        source: SRC.yool,
        key: `${t.id}|${t.status}|${t.updated_at}`,
        ts: t.updated_at,
        kind,
        piece_id: pieceId,
        severity: t.status === "blocked" ? "warn" : "info",
        data: { tuple_class: t.class, status: t.status, ...(kind === "approval_requested" ? { queue: "operator" } : {}), ...(t.payload ?? {}), tuple_id: t.id },
      }),
    );
  }
  return out;
}

export function fromReceipts(root: string): DashboardEvent[] {
  const out: DashboardEvent[] = [];
  for (const r of listReceipts(root)) {
    const common = { source: SRC.receipts, key: `${r.receipt_id}|${r.verdict}|${r.ts}`, ts: r.ts, client: r.client, campaign_id: undefined, piece_id: r.piece_id, network: r.network } as const;
    if (r.verdict === "scheduled") {
      out.push(makeEvent({ ...common, kind: "scheduled", data: { publish_at: r.publish_at, publisher: r.publisher, receipt_id: r.receipt_id, dry_run: r.dry_run, post_ref: r.post_ref } }));
    } else if (r.verdict === "blocked" || r.verdict === "failed") {
      out.push(makeEvent({ ...common, kind: "publish_failed", severity: "warn", data: { failure_class: r.failure_class, publisher: r.publisher, receipt_id: r.receipt_id, publish_at: r.publish_at, dry_run: r.dry_run } }));
    }
  }
  return out;
}

/** Winners the metrics loop marked: the post that earned the next month's variations. */
export function fromWinners(root: string): DashboardEvent[] {
  return listWinners(root).map((w) =>
    makeEvent({ source: SRC.winners, key: `${w.client}|${w.month}|${w.piece_id}`, ts: w.marked_at, kind: "winner_marked", client: w.client, piece_id: w.piece_id, network: w.network, data: { month: w.month, metric: "views", value: w.views, format: w.format, hook: w.hook } }),
  );
}

/** A dubbing receipt is the final state of one request: it opens and (when it ended) closes the dubbing. */
export function fromDubbing(root: string): DashboardEvent[] {
  const out: DashboardEvent[] = [];
  for (const r of listDubReceipts(root)) {
    const common = { source: SRC.dubbing, ts: r.ts, client: r.client, piece_id: r.piece_id } as const;
    const data = { language: r.language, route: r.route, receipt_id: r.receipt_id, dry_run: r.dry_run, ai_generated_voice: r.ai_generated_voice };
    out.push(makeEvent({ ...common, key: `${r.receipt_id}|requested`, kind: "dubbing_requested", data }));
    if (r.verdict === "dubbed" || r.verdict === "handoff") out.push(makeEvent({ ...common, key: `${r.receipt_id}|${r.verdict}|${r.ts}`, kind: "dubbing_finished", data: { ...data, verdict: r.verdict } }));
    else if (r.verdict === "failed" || r.verdict === "blocked") out.push(makeEvent({ ...common, key: `${r.receipt_id}|${r.verdict}|${r.ts}`, kind: "dubbing_finished", severity: "warn", data: { ...data, verdict: r.verdict, failure_class: r.failure_class } }));
  }
  return out;
}

export function fromApprovals(root: string): DashboardEvent[] {
  const out: DashboardEvent[] = [];
  for (const q of listRequests(root)) {
    out.push(makeEvent({ source: SRC.approvals, key: `req|${q.request_id}`, ts: q.created_at, kind: "approval_requested", client: q.client, piece_id: q.piece_id, data: { queue: "client", request_id: q.request_id, media_sha256: q.media_sha256, month: q.month, publish_at: q.publish_at } }));
  }
  for (const d of listDecisions(root)) {
    out.push(makeEvent({ source: SRC.approvals, key: `dec|${d.approval_id}`, ts: d.decided_at, kind: "approval_decided", client: d.client, piece_id: d.piece_id, severity: d.decision === "approved" ? "info" : "warn", data: { decision: d.decision, decided_by_role: d.decided_by.startsWith("client:") ? "client" : "operator", media_sha256: d.media_sha256, note: d.note } }));
  }
  return out;
}

function readText(path: string): string | null {
  try {
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  } catch {
    return null;
  }
}

function digest(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/**
 * The per-piece artifacts are the source of truth for the gates and the final
 * render: the voice and the final render (manifest.hbi + render manifest),
 * compliance.json, qa-tech-specs.json and the watcher report.
 */
export function fromManifests(root: string): DashboardEvent[] {
  const out: DashboardEvent[] = [];
  const outputs = resolve(engineRoot(root), "outputs");
  if (!existsSync(outputs)) return out;
  for (const client of safeDirs(outputs)) {
    for (const date of safeDirs(join(outputs, client))) {
      for (const piece of safeDirs(join(outputs, client, date))) {
        const dir = join(outputs, client, date, piece);
        const manifestPath = join(dir, "manifest.hbi");
        let manifest: { generated_at?: string; render_manifest_path?: string; render_sha256?: string; cost_estimate_usd?: number; watcher_report_path?: string } | null = null;
        if (existsSync(manifestPath)) {
          try {
            manifest = readHbi(manifestPath);
          } catch {
            manifest = null;
          }
        }
        const stamp = manifest?.generated_at ?? new Date(0).toISOString();
        const common = { source: SRC.manifests, client, piece_id: piece } as const;

        const compliance = readText(join(dir, "compliance.json"));
        if (compliance) {
          const raw = parseJson<{ pass?: boolean; violations?: Array<{ rule_id?: string }> }>(compliance) ?? {};
          out.push(makeEvent({ ...common, key: `${piece}|compliance|${digest(compliance)}`, ts: stamp, kind: "compliance_result", severity: raw.pass === true ? "info" : "warn", data: { pass: raw.pass === true, violations: raw.violations?.length ?? 0, rules: ruleIds(raw.violations?.map((v) => v.rule_id)) } }));
        }
        const qa = readText(join(dir, "qa-tech-specs.json"));
        if (qa) {
          const raw = parseJson<{ pass?: boolean; per_platform?: Record<string, { violations?: Array<{ rule?: string }> }> }>(qa) ?? {};
          const rules = ruleIds(Object.values(raw.per_platform ?? {}).flatMap((p) => (p.violations ?? []).map((v) => v.rule)));
          out.push(makeEvent({ ...common, key: `${piece}|qa|${digest(qa)}`, ts: stamp, kind: "qa_result", severity: raw.pass === true ? "info" : "warn", data: { passed: raw.pass === true, kind: "tech-specs", rules } }));
        }
        if (!manifest) continue;
        const watcher = readText(manifest.watcher_report_path ?? join(engineRoot(root), "data", "gate", `${piece}.json`));
        if (watcher) {
          const raw = parseJson<{ tag?: string; passed?: boolean }>(watcher) ?? {};
          out.push(makeEvent({ ...common, key: `${piece}|watcher|${digest(watcher)}`, ts: stamp, kind: "watcher_gate", severity: raw.passed === true ? "info" : "warn", data: { passed: raw.passed === true, tag: raw.tag } }));
        }
        if (manifest.render_manifest_path) {
          const voice = verifyRenderManifest(manifest.render_manifest_path).manifest?.voice;
          if (voice) out.push(makeEvent({ ...common, key: `${piece}|voice`, ts: stamp, kind: "voice_rendered", data: { provider: voice.provider, seconds: voice.seconds, cost_usd: voice.cost_usd, cache_hit: voice.cache_hit } }));
        }
        out.push(makeEvent({ ...common, key: `${piece}|manifest`, ts: stamp, kind: "render_finished", data: { stage: "final", ok: true, sha256: manifest.render_sha256, cost_usd: manifest.cost_estimate_usd } }));
      }
    }
  }
  return out;
}

function safeDirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

