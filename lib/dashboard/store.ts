/**
 * store.ts — the append-only, idempotent log behind the dashboard.
 *
 * Records are `{ seq, ...event }` in an HBP file. `seq` is the SSE event id,
 * so `Last-Event-ID` replays exactly what a reconnecting client missed. The
 * log is a derived index of the real sources: deleting it and syncing again
 * rebuilds the same events (ids come from the sources).
 */

import { EventEmitter } from "node:events";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { engineRoot } from "../clients/paths";
import { loadSchemaRegistry } from "../contracts/registry";
import { validateArtifact } from "../contracts/validate";
import { appendHbp, readHbp } from "../formats/binary";
import type { DashboardEvent } from "./events";

export interface StoredEvent extends DashboardEvent {
  seq: number;
}

export function eventsLogPath(root: string): string {
  return resolve(engineRoot(root), "data", "dashboard-events.hbp");
}

export class EventStore {
  readonly bus = new EventEmitter();
  private events: StoredEvent[] = [];
  private ids = new Set<string>();
  private loadedSize = -1;

  constructor(private readonly root: string) {
    this.bus.setMaxListeners(0);
    this.reload();
  }

  private reload(): void {
    const path = eventsLogPath(this.root);
    const size = existsSync(path) ? statSync(path).size : 0;
    if (size === this.loadedSize) return;
    this.events = readHbp<StoredEvent>(path);
    this.ids = new Set(this.events.map((e) => e.event_id));
    this.loadedSize = size;
  }

  get lastSeq(): number {
    return this.events.at(-1)?.seq ?? 0;
  }

  get size(): number {
    return this.events.length;
  }

  /** Appends the events that are new; returns them. Invalid events are rejected, never stored. */
  ingest(incoming: DashboardEvent[]): StoredEvent[] {
    this.reload();
    const registry = loadSchemaRegistry();
    const added: StoredEvent[] = [];
    for (const event of incoming) {
      if (this.ids.has(event.event_id)) continue;
      const valid = validateArtifact(event, registry);
      if (!valid.ok) throw new Error(`dashboard: invalid event ${event.event_id}: ${valid.errors.join("; ")}`);
      const stored: StoredEvent = { seq: this.lastSeq + 1, ...event };
      appendHbp(eventsLogPath(this.root), stored);
      this.events.push(stored);
      this.ids.add(event.event_id);
      added.push(stored);
    }
    if (added.length > 0) {
      this.loadedSize = statSync(eventsLogPath(this.root)).size;
      for (const e of added) this.bus.emit("event", e);
    }
    return added;
  }

  query(filter: { afterSeq?: number; client?: string; campaign_id?: string; piece_id?: string; kinds?: string[]; limit?: number } = {}): StoredEvent[] {
    const out = this.events.filter(
      (e) =>
        e.seq > (filter.afterSeq ?? 0) &&
        (!filter.client || e.client === filter.client) &&
        (!filter.campaign_id || e.campaign_id === filter.campaign_id) &&
        (!filter.piece_id || e.piece_id === filter.piece_id) &&
        (!filter.kinds || filter.kinds.includes(e.kind)),
    );
    return filter.limit ? out.slice(-filter.limit) : out;
  }

  all(): StoredEvent[] {
    return this.events;
  }
}
