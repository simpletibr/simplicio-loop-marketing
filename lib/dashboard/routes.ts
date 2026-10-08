/**
 * views.ts — registry of the read-only view routes served under `/api`.
 * Each dashboard view adds one entry; every handler is a pure read model.
 */

import type { SyncOptions } from "../observability/dashboard";
import type { EventStore } from "./store";

export interface DashboardAlert {
  key: string;
  rule: string;
  severity: "info" | "warn" | "error";
  client?: string;
  piece_id?: string;
  message: string;
  /** What a human has to do about it. */
  next_step?: string;
  since: string;
}

export interface ViewContext {
  root: string;
  store: EventStore;
  sources: Required<SyncOptions>;
  now: Date;
  query: URLSearchParams;
  /** Active alerts, for the views that show client health. */
  alerts: () => DashboardAlert[];
  /** Read-only Real Oficial window, present only when the operator enabled it. */
  ro?: import("./realoficial").ReadOnlyRo;
}

export interface ViewRoute {
  path: string;
  handle(ctx: ViewContext): Promise<unknown> | unknown;
}

import { alertsRoute } from "./views/alerts";
import { approvalsRoute } from "./views/approvals";
import { calendarRoute } from "./views/calendar";
import { cockpitRoute } from "./views/cockpit";
import { pipelineRoute } from "./views/pipeline";
import { creditsRoute } from "./views/credits";
import { qualityRoute } from "./views/quality";
import { statusRoute } from "./views/status";

export function buildViews(): ViewRoute[] {
  return [cockpitRoute, pipelineRoute, calendarRoute, statusRoute, qualityRoute, creditsRoute, approvalsRoute, alertsRoute];
}
