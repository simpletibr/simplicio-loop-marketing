import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { engineRoot } from "../clients/paths";
import type { SyncOptions } from "../observability/dashboard";
import { defaultSources } from "../observability/dashboard";

const STATE_FILES = ["events.jsonl", "loop/journal.hbp"];
const DATA_FILES = ["schedule.hbp", "approvals.hbp", "stripe-webhooks.jsonl", "credits.jsonl", "tts-bloqueado-ate.txt", "tts-usage.jsonl", "analytics-snapshots.jsonl", "yool/tuples.jsonl"];
const WATCHED = /\.(json|jsonl|hbi|hbp|csv|txt)$/i;

function stat(path: string): string {
  try {
    const s = statSync(path);
    return `${path}:${s.size}:${Math.floor(s.mtimeMs)}`;
  } catch {
    return `${path}:-`;
  }
}

function walk(dir: string, depth: number, out: string[]): void {
  if (depth < 0 || !existsSync(dir)) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return;
  }
  for (const e of entries) {
    const path = join(dir, e.name);
    if (e.isDirectory()) walk(path, depth - 1, out);
    else if (WATCHED.test(e.name)) out.push(stat(path));
  }
}

/**
 * A cheap fingerprint of every file the adapters read (size + mtime, never
 * contents). When it changes, the panel runs a sync; media files are not
 * statted, so large renders cost nothing here.
 */
export function sourceSignature(root: string, sources: SyncOptions = {}): string {
  const { videosDir, controlCsv } = { ...defaultSources(root), ...sources };
  const parts: string[] = [];
  for (const f of STATE_FILES) parts.push(stat(resolve(root, ".simplicio", f)));
  const data = resolve(engineRoot(root), "data");
  for (const f of DATA_FILES) parts.push(stat(join(data, f)));
  parts.push(stat(controlCsv));
  walk(resolve(engineRoot(root), "outputs"), 4, parts);
  walk(videosDir, 3, parts);
  return parts.join("|");
}
