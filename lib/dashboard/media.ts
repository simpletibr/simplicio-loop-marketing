/**
 * media.ts — previews and final renders for the panel.
 *
 * Files are served only from inside the allowed folders (piece outputs and the
 * video factory's output folder), after resolving symlinks. The panel only
 * shows what exists: it never triggers a render.
 */

import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { engineRoot } from "../clients/paths";
import { listRequests } from "../approval/store";

export type Variant = "preview" | "final";

const TYPES: Record<string, string> = { ".mp4": "video/mp4", ".webm": "video/webm", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

export function contentTypeOf(path: string): string | null {
  return TYPES[extname(path).toLowerCase()] ?? null;
}

export function allowedRoots(root: string, videosDir: string): string[] {
  return [resolve(engineRoot(root), "outputs"), resolve(videosDir)].filter((d) => existsSync(d)).map((d) => realpathSync(d));
}

/** The resolved real path if `candidate` is a servable file inside an allowed folder, otherwise null. */
export function safeFile(candidate: string, roots: string[]): string | null {
  let real: string;
  try {
    real = realpathSync(candidate);
  } catch {
    return null;
  }
  if (!statSync(real).isFile() || !contentTypeOf(real)) return null;
  return roots.some((r) => real === r || real.startsWith(r + sep)) ? real : null;
}

function dirsOf(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

/** `outputs/<client>/<date>/<piece>/` of a piece, or null. */
export function pieceOutputDir(root: string, pieceId: string): string | null {
  const outputs = resolve(engineRoot(root), "outputs");
  for (const client of dirsOf(outputs)) {
    for (const date of dirsOf(join(outputs, client))) {
      const candidate = join(outputs, client, date, pieceId);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function firstMedia(dir: string, pattern: RegExp): string | null {
  try {
    const hit = readdirSync(dir).sort().find((f) => pattern.test(f));
    return hit ? join(dir, hit) : null;
  } catch {
    return null;
  }
}

/** Candidate file for a piece and variant; existence and location are checked by `safeFile`. */
export function mediaCandidate(root: string, videosDir: string, pieceId: string, variant: Variant): string | null {
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(pieceId)) return null;
  const factory = join(videosDir, pieceId);
  if (variant === "preview") {
    const request = listRequests(root).find((r) => r.piece_id === pieceId);
    if (request && existsSync(request.preview)) return request.preview;
    const fromFactory = join(factory, "preview.mp4");
    if (existsSync(fromFactory)) return fromFactory;
  }
  if (variant === "final") {
    const fromFactory = join(factory, "final", "final.mp4");
    if (existsSync(fromFactory)) return fromFactory;
  }
  const dir = pieceOutputDir(root, pieceId);
  return dir ? firstMedia(dir, /\.mp4$/i) ?? firstMedia(dir, /\.(png|jpe?g|webp)$/i) : null;
}

export interface ByteRange {
  start: number;
  end: number;
}

/** Parses a single `bytes=` range; null when absent, "invalid" when it cannot be satisfied. */
export function parseRange(header: string | undefined, size: number): ByteRange | null | "invalid" {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return "invalid";
  let start: number;
  let end: number;
  if (m[1] === "") {
    const suffix = Number(m[2]);
    start = Math.max(size - suffix, 0);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  return start > end || start >= size ? "invalid" : { start, end };
}
