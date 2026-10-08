/**
 * views.ts — registry of the read-only view routes served under `/api`.
 * Each dashboard view adds one entry; every handler is a pure read model.
 */

import type { SyncOptions } from "../observability/dashboard";
import type { EventStore } from "./store";

export interface ViewContext {
  root: string;
  store: EventStore;
  sources: Required<SyncOptions>;
  now: Date;
  query: URLSearchParams;
}

export interface ViewRoute {
  path: string;
  handle(ctx: ViewContext): Promise<unknown> | unknown;
}

export function buildViews(): ViewRoute[] {
  return [];
}
