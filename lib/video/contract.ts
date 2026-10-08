/**
 * contract.ts — the boundary with the external video factory.
 *
 * This repo never renders video itself: it writes a `simplicio.video-contract/v1`
 * document derived from a piece, hands it to the factory CLI, and consumes the
 * MP4 plus a render manifest that carries the SHA-256 of the file. The manifest
 * becomes publish evidence (see lib/publish/verify-pipeline.ts).
 *
 * The factory lives in its own repository and is never modified from here.
 */

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const VIDEO_CONTRACT_SCHEMA = "simplicio.video-contract/v1";

export interface VideoContractInput {
  slug: string;
  client: string;
  language: string;
  aspect: string;
  duration_s: number;
  script: string;
  hook?: string;
  template?: string;
  voice?: { provider: string; name?: string };
  brand?: { name: string; colors: string[]; tone: string; logo?: string };
  seed?: number;
}

/** JSON string literals are valid YAML double-quoted scalars. */
function scalar(value: string | number | boolean): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

/** Deterministic YAML emission: fixed key order, no external dependency. */
export function serializeVideoContract(input: VideoContractInput): string {
  const lines: string[] = [
    `schema: ${scalar(VIDEO_CONTRACT_SCHEMA)}`,
    `slug: ${scalar(input.slug)}`,
    `client: ${scalar(input.client)}`,
    `language: ${scalar(input.language)}`,
    "format:",
    `  aspect: ${scalar(input.aspect)}`,
    `  duration_s: ${scalar(input.duration_s)}`,
    `script: ${scalar(input.script)}`,
  ];
  if (input.hook) lines.push(`hook: ${scalar(input.hook)}`);
  if (input.template) lines.push(`template: ${scalar(input.template)}`);
  if (input.seed !== undefined) lines.push(`seed: ${scalar(input.seed)}`);
  if (input.voice) {
    lines.push("voice:", `  provider: ${scalar(input.voice.provider)}`);
    if (input.voice.name) lines.push(`  name: ${scalar(input.voice.name)}`);
  }
  if (input.brand) {
    lines.push("brand:", `  name: ${scalar(input.brand.name)}`, `  tone: ${scalar(input.brand.tone)}`, "  colors:");
    for (const color of input.brand.colors) lines.push(`    - ${scalar(color)}`);
    if (input.brand.logo) lines.push(`  logo: ${scalar(input.brand.logo)}`);
  }
  return `${lines.join("\n")}\n`;
}

export interface RenderManifest {
  output: { path: string; sha256: string; bytes?: number; duration_s?: number };
  voice?: { provider: string; seconds: number; cost_usd: number; cache_hit: boolean };
  qa?: { passed: boolean; notes?: string };
}

export interface RenderManifestCheck {
  ok: boolean;
  reasons: string[];
  manifest?: RenderManifest;
  mp4_path?: string;
}

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Fail-closed check: manifest parses, has the strict shape, and the file hash matches. */
export function verifyRenderManifest(manifestPath: string): RenderManifestCheck {
  if (!existsSync(manifestPath)) return { ok: false, reasons: [`render manifest missing: ${manifestPath}`] };
  let parsed: Partial<RenderManifest>;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as Partial<RenderManifest>;
  } catch {
    return { ok: false, reasons: ["render manifest is not valid JSON"] };
  }
  const out = parsed.output;
  if (!out || typeof out.path !== "string" || typeof out.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(out.sha256)) {
    return { ok: false, reasons: ["render manifest lacks output.path and a 64-hex output.sha256"] };
  }
  const mp4 = isAbsolute(out.path) ? out.path : resolve(dirname(manifestPath), out.path);
  if (!existsSync(mp4)) return { ok: false, reasons: [`rendered file missing: ${mp4}`] };
  const actual = sha256File(mp4);
  if (actual !== out.sha256) {
    return { ok: false, reasons: [`sha256 mismatch for ${mp4}: manifest ${out.sha256}, file ${actual}`] };
  }
  return { ok: true, reasons: [], manifest: parsed as RenderManifest, mp4_path: mp4 };
}

export interface SimplicioVideoRun {
  mp4: string;
  manifest: string;
}

export interface RunOptions {
  bin: string;
  contractPath: string;
  outDir: string;
  timeoutMs?: number;
}

/** Arguments of the factory CLI; kept in one place so a CLI change touches one line. */
export function cliArgs(contractPath: string, outDir: string): string[] {
  return ["run", "--json", "--contract", contractPath, "--out", outDir];
}

/** Runs the factory CLI (no shell) and returns the MP4 and manifest paths it reports. */
export async function runSimplicioVideo(opts: RunOptions): Promise<SimplicioVideoRun> {
  const { stdout } = await execFileAsync(opts.bin, cliArgs(opts.contractPath, opts.outDir), {
    timeout: opts.timeoutMs ?? 5 * 60_000,
    maxBuffer: 8 * 1024 * 1024,
    env: process.env,
  });
  const last = stdout.trim().split("\n").filter(Boolean).pop() ?? "";
  let payload: { ok?: boolean; mp4?: string; manifest?: string; error?: string };
  try {
    payload = JSON.parse(last);
  } catch {
    throw new Error("simplicio-video: CLI did not print a JSON result on its last stdout line");
  }
  if (payload.ok !== true || !payload.mp4 || !payload.manifest) {
    throw new Error(`simplicio-video: run failed${payload.error ? `: ${payload.error}` : ""}`);
  }
  return { mp4: payload.mp4, manifest: payload.manifest };
}

export function writeContractFile(dir: string, input: VideoContractInput): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "contract.yaml");
  writeFileSync(path, serializeVideoContract(input));
  return path;
}
