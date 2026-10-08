import { existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { readHbi, writeHbiAtomic } from "../formats/binary";

export interface DashboardState {
  pid: number;
  port: number;
  started_at: string;
  /** Session token: the state file is written with mode 0600 and never printed by `status`. */
  token: string;
}

export function statePath(root: string): string {
  return resolve(root, ".simplicio", "dashboard.hbi");
}

export function writeDashboardState(root: string, state: DashboardState): void {
  writeHbiAtomic(statePath(root), state);
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The running dashboard of this host, or null. A stale file (dead pid) is removed. */
export function readDashboardState(root: string): DashboardState | null {
  const path = statePath(root);
  if (!existsSync(path)) return null;
  try {
    const state = readHbi<DashboardState>(path);
    if (alive(state.pid)) return state;
  } catch {
    /* unreadable: treat as stale */
  }
  unlinkSync(path);
  return null;
}

export function clearDashboardState(root: string): void {
  const path = statePath(root);
  if (existsSync(path)) unlinkSync(path);
}
