/**
 * model.ts — the derived model the dashboard views share: for each piece, the
 * state of every pipeline stage, computed from the event stream plus the plan
 * (format, network, language). Pure functions of their inputs, so a view of
 * "as of last week" is the same code run on the events up to that instant.
 */

import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { engineRoot } from "../clients/paths";
import { listPlanIds, loadPlan, type ContentPlan, type PlanSlot } from "../plan/content-plan";
import type { StoredEvent } from "./store";

export const STAGES = ["prospect", "script", "voice", "preview", "qa", "compliance", "approval", "final", "scheduled", "published", "metrics"] as const;
export type Stage = (typeof STAGES)[number];

export type StageStatus = "pending" | "active" | "done" | "failed";

export interface StageState {
  state: StageStatus;
  /** When the state last changed. */
  at?: string;
  /** How many results the stage has produced (retries show up here). */
  attempts: number;
}

export interface PieceModel {
  piece_id: string;
  client?: string;
  campaign_id?: string;
  network?: string;
  format?: string;
  language?: string;
  variant_of?: string;
  stages: Record<Stage, StageState>;
  /** The furthest stage with any activity; where the card sits on the board. */
  current: Stage | null;
  current_state: StageStatus;
  last_event_at?: string;
  events: number;
}

function blank(): Record<Stage, StageState> {
  return Object.fromEntries(STAGES.map((s) => [s, { state: "pending", attempts: 0 } satisfies StageState])) as Record<Stage, StageState>;
}

export function allPlans(root: string): ContentPlan[] {
  const dir = resolve(engineRoot(root), "clients");
  if (!existsSync(dir)) return [];
  const out: ContentPlan[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(e.name)) continue;
    for (const id of listPlanIds(root, e.name)) out.push(loadPlan(root, e.name, id));
  }
  return out;
}

export function slotIndex(plans: ContentPlan[]): Map<string, PlanSlot & { client: string; plan_id: string }> {
  const index = new Map<string, PlanSlot & { client: string; plan_id: string }>();
  for (const plan of plans) for (const slot of plan.slots) index.set(slot.piece_id, { ...slot, client: plan.client, plan_id: plan.plan_id });
  return index;
}

function mark(state: StageState, status: StageStatus, at: string): void {
  state.state = status;
  state.at = at;
  state.attempts++;
}

/** Folds events (oldest first) into one model per piece. */
export function buildPieceModels(events: StoredEvent[], plans: ContentPlan[] = []): Map<string, PieceModel> {
  const slots = slotIndex(plans);
  const models = new Map<string, PieceModel>();
  const modelOf = (e: StoredEvent): PieceModel => {
    const id = e.piece_id as string;
    let m = models.get(id);
    if (!m) {
      const slot = slots.get(id);
      m = { piece_id: id, stages: blank(), current: null, current_state: "pending", events: 0, ...(slot ? { client: slot.client, campaign_id: slot.plan_id, network: slot.network, format: slot.format, language: slot.language, variant_of: slot.variant_of } : {}) };
      models.set(id, m);
    }
    m.client ??= e.client;
    m.campaign_id ??= e.campaign_id;
    m.network ??= e.network;
    m.events++;
    m.last_event_at = e.ts;
    return m;
  };

  for (const e of events) {
    if (!e.piece_id) continue;
    const m = modelOf(e);
    const s = m.stages;
    const d = e.data;
    switch (e.kind) {
      case "marketing.prospect_collected":
        mark(s.prospect, "done", e.ts);
        break;
      case "marketing.script_ready":
        mark(s.script, "done", e.ts);
        break;
      case "marketing.voice_rendered":
        mark(s.voice, "done", e.ts);
        break;
      case "marketing.render_started":
        if (s.final.state === "pending") {
          s.final.state = "active";
          s.final.at = e.ts;
        }
        break;
      case "marketing.render_finished":
        if (d.stage === "preview") mark(s.preview, d.ok === false ? "failed" : "done", e.ts);
        else mark(s.final, d.ok === false ? "failed" : "done", e.ts);
        break;
      case "marketing.qa_result":
        mark(s.qa, d.passed === true ? "done" : "failed", e.ts);
        break;
      case "marketing.compliance_result":
        mark(s.compliance, d.pass === true ? "done" : "failed", e.ts);
        break;
      case "marketing.approval_requested":
        // A request is the stage waiting, not a result: only decisions count as attempts.
        if (s.approval.state !== "done") {
          s.approval.state = "active";
          s.approval.at = e.ts;
        }
        break;
      case "marketing.approval_decided":
        mark(s.approval, d.decision === "approved" ? "done" : "failed", e.ts);
        break;
      case "marketing.scheduled":
        mark(s.scheduled, "done", e.ts);
        break;
      case "marketing.publish_failed":
        mark(s.scheduled, "failed", e.ts);
        break;
      case "marketing.published":
        mark(s.published, "done", e.ts);
        break;
      case "marketing.metrics_snapshot":
        mark(s.metrics, "done", e.ts);
        if (s.published.state !== "done") mark(s.published, "done", e.ts);
        break;
      default:
        break;
    }
  }

  for (const m of models.values()) {
    for (let i = STAGES.length - 1; i >= 0; i--) {
      const st = m.stages[STAGES[i] as Stage];
      if (st.state !== "pending") {
        m.current = STAGES[i] as Stage;
        m.current_state = st.state;
        break;
      }
    }
  }
  return models;
}

export function maskAlias(index: number): string {
  return `Cliente ${String.fromCharCode(65 + (index % 26))}${index >= 26 ? Math.floor(index / 26) : ""}`;
}
