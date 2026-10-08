import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ImageTask, LLMTask, VideoTask } from "./types";

export interface MatrixRow {
  task: string;
  default: string;
  fallback?: string;
  reason?: string;
}

export interface ProviderMatrix {
  llm: Record<string, MatrixRow>;
  image: Record<string, MatrixRow>;
  video: Record<string, MatrixRow>;
}

const EMBEDDED_DEFAULTS: ProviderMatrix = {
  llm: {
    orchestration: { task: "orchestration", default: "claude", fallback: "codex" },
    code: { task: "code", default: "claude", fallback: "codex" },
    caption: { task: "caption", default: "deepseek", fallback: "claude" },
    script: { task: "script", default: "claude", fallback: "codex" },
    compliance: { task: "compliance", default: "claude", fallback: "codex" },
    translation: { task: "translation", default: "deepseek", fallback: "claude" },
    humanization: { task: "humanization", default: "claude", fallback: "codex" },
  },
  image: {
    "quote-card": { task: "quote-card", default: "gpt-image" },
    "ugc-ad": { task: "ugc-ad", default: "topview" },
    cinematic: { task: "cinematic", default: "higgsfield" },
    carousel: { task: "carousel", default: "gpt-image" },
    "batch-ab": { task: "batch-ab", default: "wavespeed" },
    inpaint: { task: "inpaint", default: "gpt-image" },
    "face-swap": { task: "face-swap", default: "topview" },
    "before-after": { task: "before-after", default: "gpt-image" },
  },
  video: {
    "cinematic-reel": { task: "cinematic-reel", default: "higgsfield" },
    "motion-control": { task: "motion-control", default: "higgsfield" },
    "ugc-product": { task: "ugc-product", default: "topview" },
    "product-demo": { task: "product-demo", default: "topview" },
    "talking-head": { task: "talking-head", default: "topview" },
    "batch-hooks": { task: "batch-hooks", default: "wavespeed" },
    "motion-typography": { task: "motion-typography", default: "simplicio-video" },
    "data-viz-reel": { task: "data-viz-reel", default: "simplicio-video" },
    "programmatic-short": { task: "programmatic-short", default: "simplicio-video" },
  },
};

const TASK_LABEL_MAP: Record<string, string> = {
  "copy short (caption)": "caption",
  "copy long (script)": "script",
  "code generation": "code",
  "compliance check": "compliance",
  "quote card / typography": "quote-card",
  "ugc ad with avatar": "ugc-ad",
  "cinematic / editorial": "cinematic",
  "carousel slides": "carousel",
  "batch a/b": "batch-ab",
  "inpaint / local edit": "inpaint",
  "face swap / try-on": "face-swap",
  "before/after consulting": "before-after",
  "cinematic reel": "cinematic-reel",
  "motion control": "motion-control",
  "ugc product holder": "ugc-product",
  "product demo (url)": "product-demo",
  "talking head": "talking-head",
  "batch hook test": "batch-hooks",
  "motion typography": "motion-typography",
  "kinetic typography": "motion-typography",
  "data viz reel": "data-viz-reel",
  "data-viz reel": "data-viz-reel",
  "programmatic short": "programmatic-short",
  "parametrized short": "programmatic-short",
};

function normalizeTaskLabel(raw: string): string {
  const lower = raw.trim().toLowerCase();
  return TASK_LABEL_MAP[lower] ?? lower.replace(/\s+/g, "-");
}

interface ParseState {
  section: "llm" | "image" | "video" | null;
  matrix: ProviderMatrix;
}

function parseRow(line: string): string[] {
  const cells = line.split("|").map((c) => c.trim());
  if (cells.length && cells[0] === "") cells.shift();
  if (cells.length && cells[cells.length - 1] === "") cells.pop();
  return cells;
}

function isSeparator(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^[-:\s]+$/.test(c));
}

export function parseProvidersMarkdown(text: string): ProviderMatrix {
  const state: ParseState = {
    section: null,
    matrix: { llm: {}, image: {}, video: {} },
  };
  const lines = text.split(/\r?\n/);
  let headerSeen = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^##\s+LLM\b/i.test(trimmed)) {
      state.section = "llm";
      headerSeen = false;
      continue;
    }
    if (/^##\s+Image\b/i.test(trimmed)) {
      state.section = "image";
      headerSeen = false;
      continue;
    }
    if (/^##\s+Video\b/i.test(trimmed)) {
      state.section = "video";
      headerSeen = false;
      continue;
    }
    if (/^##\s/.test(trimmed)) {
      state.section = null;
      continue;
    }
    if (state.section === null) continue;
    if (!trimmed.startsWith("|")) continue;

    const cells = parseRow(trimmed);
    if (cells.length === 0) continue;
    if (isSeparator(cells)) {
      headerSeen = true;
      continue;
    }
    if (!headerSeen) continue;

    const task = normalizeTaskLabel(cells[0] ?? "");
    if (state.section === "llm") {
      const [, def, fb, reason] = cells;
      if (!def) continue;
      state.matrix.llm[task] = {
        task,
        default: def.toLowerCase(),
        fallback: fb && fb !== "-" ? fb.toLowerCase() : undefined,
        reason,
      };
    } else {
      const [, provider, reason] = cells;
      if (!provider) continue;
      const layer = state.section;
      state.matrix[layer][task] = {
        task,
        default: provider.toLowerCase(),
        reason,
      };
    }
  }

  return state.matrix;
}

let cached: ProviderMatrix | null = null;
let cachedPath: string | null = null;
let warnedFor: string | null = null;

export function loadProviderMatrix(forcePath?: string): ProviderMatrix {
  const path =
    forcePath ?? resolve(process.cwd(), ".specs", "architecture", "PROVIDERS.md");
  if (cached && cachedPath === path) return cached;
  if (!existsSync(path)) {
    if (warnedFor !== path) {
      process.stderr.write(
        `[matrix] WARN: ${path} not found; using embedded defaults\n`,
      );
      warnedFor = path;
    }
    cached = EMBEDDED_DEFAULTS;
    cachedPath = path;
    return cached;
  }
  try {
    const text = readFileSync(path, "utf8");
    const parsed = parseProvidersMarkdown(text);
    const merged: ProviderMatrix = {
      llm: { ...EMBEDDED_DEFAULTS.llm, ...parsed.llm },
      image: { ...EMBEDDED_DEFAULTS.image, ...parsed.image },
      video: { ...EMBEDDED_DEFAULTS.video, ...parsed.video },
    };
    cached = merged;
    cachedPath = path;
    return cached;
  } catch (err) {
    if (warnedFor !== path) {
      process.stderr.write(
        `[matrix] WARN: parse error for ${path}: ${String(err)}; using embedded defaults\n`,
      );
      warnedFor = path;
    }
    cached = EMBEDDED_DEFAULTS;
    cachedPath = path;
    return cached;
  }
}

export function resetMatrixCache(): void {
  cached = null;
  cachedPath = null;
  warnedFor = null;
}

export function llmRow(task: LLMTask | string, matrix?: ProviderMatrix): MatrixRow {
  const m = matrix ?? loadProviderMatrix();
  return m.llm[task] ?? { task: String(task), default: "claude" };
}

export function imageRow(
  task: ImageTask | string,
  matrix?: ProviderMatrix,
): MatrixRow {
  const m = matrix ?? loadProviderMatrix();
  return m.image[task] ?? { task: String(task), default: "gpt-image" };
}

export function videoRow(
  task: VideoTask | string,
  matrix?: ProviderMatrix,
): MatrixRow {
  const m = matrix ?? loadProviderMatrix();
  return m.video[task] ?? { task: String(task), default: "higgsfield" };
}
