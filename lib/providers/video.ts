import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { GenerationResult, ProviderConstraint, VideoTask } from "./types";
import { selectConstrainedProvider, type ProviderCapabilities } from "./constraints";
import { loadProviderMatrix, videoRow } from "./matrix";
import { MOCK_VIDEO_REGISTRY } from "./__mocks__/video";
import { withRetry } from "./policy";
import {
  runSimplicioVideo,
  verifyRenderManifest,
  writeContractFile,
  type VideoContractInput,
} from "../video/contract";

export interface VideoGenerateOptions {
  task: VideoTask;
  aspect: string;
  duration_s: number;
  output_dir?: string;
  seed?: number;
  model?: "wan-video";
  count_per_variant?: number;
  cost_cap_usd?: number;
  variant_axis?: {
    field: string;
    values: string[];
  };
  /** Factory contract derived from the piece; built from the brief when absent. */
  contract?: VideoContractInput;
}

export interface VideoProvider {
  name: string;
  generate(
    brief: string,
    opts: VideoGenerateOptions,
  ): Promise<GenerationResult<string | string[]>>;
}

function isDryRun(): boolean {
  const v = process.env.DRY_RUN;
  return v === undefined || v === "" || v === "true";
}

abstract class RealVideoBase implements VideoProvider {
  abstract readonly name: string;
  abstract realGenerate(
    brief: string,
    opts: VideoGenerateOptions,
  ): Promise<GenerationResult<string | string[]>>;

  async generate(
    brief: string,
    opts: VideoGenerateOptions,
  ): Promise<GenerationResult<string | string[]>> {
    return withRetry(() => this.realGenerate(brief, opts), {
      retries: 1,
      backoffMs: 4000,
      timeoutMs: 5 * 60_000,
    });
  }
}

interface VariantPrompt {
  prompt: string;
  label: string;
  seed?: number;
}

function sanitizeLabel(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "variant";
}

function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

function expandVariantPrompts(
  brief: string,
  opts: Pick<VideoGenerateOptions, "variant_axis" | "seed">,
): VariantPrompt[] {
  const axis = opts.variant_axis;
  if (!axis || axis.values.length === 0) {
    return [{ prompt: brief, label: "base", seed: opts.seed }];
  }
  const placeholder = new RegExp(`\\{\\s*${axis.field}\\s*\\}`, "g");
  if (!placeholder.test(brief)) {
    throw new Error(
      `wavespeed batch: missing placeholder { ${axis.field} } in prompt`,
    );
  }
  placeholder.lastIndex = 0;
  return axis.values.map((value, index) => ({
    prompt: brief.replace(placeholder, value),
    label: sanitizeLabel(value),
    seed: opts.seed === undefined ? undefined : opts.seed + index,
  }));
}

async function runLimited<T, U>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<U>,
): Promise<U[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 5);
  const results: U[] = new Array(items.length);
  let next = 0;
  async function loop(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(safeLimit, items.length) }, () => loop()),
  );
  return results;
}

async function downloadToFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`asset download failed: HTTP ${res.status}`);
  }
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

const WAVESPEED_VIDEO_PRICE = 0.05;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

export class HiggsfieldVideoProvider extends RealVideoBase {
  readonly name = "higgsfield";
  async realGenerate(
    _brief: string,
    _opts: VideoGenerateOptions,
  ): Promise<GenerationResult<string | string[]>> {
    if (process.env.HIGGSFIELD_MCP_ACTIVE !== "true") {
      throw new Error("higgsfield: HIGGSFIELD_MCP_ACTIVE not true");
    }
    throw new Error(
      "higgsfield video: MCP transport required in caller context; stub. " +
        "Use DRY_RUN=true for tests.",
    );
  }
}

export class TopviewVideoProvider extends RealVideoBase {
  readonly name = "topview";
  async realGenerate(
    _brief: string,
    _opts: VideoGenerateOptions,
  ): Promise<GenerationResult<string | string[]>> {
    const apiKey = process.env.TOPVIEW_API_KEY;
    if (!apiKey) throw new Error("topview: TOPVIEW_API_KEY missing");
    throw new Error(
      "topview video: MCP transport required in caller context; stub. " +
        "Use DRY_RUN=true for tests.",
    );
  }
}

export class SimplicioVideoProvider extends RealVideoBase {
  readonly name = "simplicio-video";
  async realGenerate(
    brief: string,
    opts: VideoGenerateOptions,
  ): Promise<GenerationResult<string | string[]>> {
    const bin = process.env.SIMPLICIO_VIDEO_BIN;
    if (!bin) throw new Error("simplicio-video: SIMPLICIO_VIDEO_BIN missing");
    if ((process.env.SIMPLICIO_VIDEO_MODE ?? "cli") !== "cli") {
      throw new Error(
        "simplicio-video: MCP transport required in caller context; " +
          "set SIMPLICIO_VIDEO_MODE=cli or use DRY_RUN=true for tests.",
      );
    }
    const t0 = Date.now();
    const contract = opts.contract ?? defaultContract(brief, opts);
    const outDir = resolve(opts.output_dir ?? resolve(process.cwd(), "outputs"), contract.slug);
    ensureDir(outDir);
    const contractPath = writeContractFile(outDir, contract);
    const run = await runSimplicioVideo({ bin, contractPath, outDir });
    const check = verifyRenderManifest(resolve(outDir, run.manifest));
    if (!check.ok || !check.manifest || !check.mp4_path) {
      throw new Error(`simplicio-video: render evidence rejected: ${check.reasons.join("; ")}`);
    }
    return {
      ok: true,
      provider: this.name,
      task: opts.task,
      output: check.mp4_path,
      tokens: 0,
      cost_usd: check.manifest.voice?.cost_usd ?? 0,
      latency_ms: Date.now() - t0,
      render_manifest_path: resolve(outDir, run.manifest),
      output_sha256: check.manifest.output.sha256,
    };
  }
}

export function defaultContract(brief: string, opts: VideoGenerateOptions): VideoContractInput {
  const slug = `${sanitizeLabel(brief)}-${createHash("sha256").update(brief).digest("hex").slice(0, 8)}`;
  return {
    slug,
    client: "unknown",
    language: "pt-BR",
    aspect: opts.aspect,
    duration_s: opts.duration_s,
    script: brief,
    ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
  };
}

export class WavespeedVideoProvider extends RealVideoBase {
  readonly name = "wavespeed";
  async realGenerate(
    brief: string,
    opts: VideoGenerateOptions,
  ): Promise<GenerationResult<string | string[]>> {
    const apiKey = process.env.WAVESPEED_API_KEY;
    if (!apiKey) throw new Error("wavespeed: WAVESPEED_API_KEY missing");
    const t0 = Date.now();
    const outputDir = opts.output_dir ?? resolve(process.cwd(), "outputs");
    ensureDir(outputDir);
    const variants = expandVariantPrompts(brief, opts);
    const count = opts.task === "batch-hooks"
      ? opts.count_per_variant ?? 1
      : 1;
    const runnable: VariantPrompt[] = [];
    let estimatedCost = 0;
    for (const variant of variants) {
      const nextCost = WAVESPEED_VIDEO_PRICE * count;
      if (
        opts.cost_cap_usd !== undefined &&
        runnable.length > 0 &&
        estimatedCost + nextCost > opts.cost_cap_usd
      ) {
        break;
      }
      estimatedCost += nextCost;
      runnable.push(variant);
    }
    const files = await runLimited(runnable, 5, async (variant, index) => {
      const createRes = await fetch("https://api.wavespeed.ai/api/v3/predictions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: opts.model ?? "wan-video",
          input: {
            prompt: variant.prompt,
            num_outputs: count,
            duration_s: opts.duration_s,
            aspect_ratio: opts.aspect,
            seed: variant.seed,
          },
        }),
      });
      if (!createRes.ok) {
        throw new Error(`wavespeed: HTTP ${createRes.status}: ${await createRes.text()}`);
      }
      let job = (await createRes.json()) as {
        id?: string;
        status?: string;
        output?: string[] | string;
        error?: string;
      };
      if (!job.id && !job.output) {
        throw new Error("wavespeed video: missing job id");
      }
      if (job.id) {
        for (let attempt = 0; attempt < 20; attempt++) {
          if (job.status === "completed" && job.output) break;
          if (job.status === "failed" || job.status === "canceled") {
            throw new Error(`wavespeed video: ${job.error ?? job.status}`);
          }
          await sleep(50);
          const pollRes = await fetch(
            `https://api.wavespeed.ai/api/v3/predictions/${job.id}`,
            {
              headers: {
                authorization: `Bearer ${apiKey}`,
              },
            },
          );
          if (!pollRes.ok) {
            throw new Error(`wavespeed: poll HTTP ${pollRes.status}: ${await pollRes.text()}`);
          }
          job = (await pollRes.json()) as typeof job;
        }
      }
      const outputs = Array.isArray(job.output)
        ? job.output
        : job.output
          ? [job.output]
          : [];
      if (outputs.length === 0) {
        throw new Error("wavespeed video: completed without output");
      }
      const filesForVariant: string[] = [];
      const ts = Date.now();
      for (let i = 0; i < outputs.length; i++) {
        const dest = resolve(
          outputDir,
          `wavespeed-wan-video-${variant.label}-${index + 1}-${ts}-${i + 1}.mp4`,
        );
        await downloadToFile(outputs[i], dest);
        filesForVariant.push(dest);
      }
      return filesForVariant;
    });
    const output = files.flat();
    return {
      ok: true,
      provider: this.name,
      task: opts.task,
      output: opts.task === "batch-hooks" ? output : output[0],
      tokens: 0,
      cost_usd: estimatedCost,
      latency_ms: Date.now() - t0,
    };
  }
}

const REAL_VIDEO_REGISTRY: Record<string, () => VideoProvider> = {
  higgsfield: () => new HiggsfieldVideoProvider(),
  topview: () => new TopviewVideoProvider(),
  wavespeed: () => new WavespeedVideoProvider(),
  "simplicio-video": () => new SimplicioVideoProvider(),
};

export const VIDEO_PROVIDER_CAPABILITIES: Readonly<Record<string, ProviderCapabilities>> = {
  higgsfield: { brand_strict: true, estimated_cost_usd: 0.12, estimated_latency_ms: 60_000, quality: "high" },
  topview: { brand_strict: false, estimated_cost_usd: 0.06, estimated_latency_ms: 45_000, quality: "medium" },
  wavespeed: { brand_strict: false, estimated_cost_usd: 0.04, estimated_latency_ms: 25_000, quality: "medium" },
  // Render-only estimate: local deterministic render. Voice cost is recorded
  // afterwards from the render manifest, not predicted here.
  "simplicio-video": { brand_strict: true, estimated_cost_usd: 0, estimated_latency_ms: 90_000, quality: "high" },
};

export interface VideoFactoryOptions {
  override?: string;
  constraints?: ProviderConstraint;
}

export function getVideoProvider(
  task: VideoTask,
  opts?: VideoFactoryOptions,
): VideoProvider {
  const override = opts?.override;
  const fromMatrix = videoRow(task, loadProviderMatrix()).default;
  const preferred = override ?? fromMatrix ?? "higgsfield";
  const registry = isDryRun() ? MOCK_VIDEO_REGISTRY : REAL_VIDEO_REGISTRY;
  const candidate = selectConstrainedProvider(
    preferred,
    Object.keys(registry),
    VIDEO_PROVIDER_CAPABILITIES,
    opts?.constraints,
  );
  if (!candidate) throw new Error("video provider: no adapter satisfies declared constraints");
  const factory = registry[candidate] ?? registry["higgsfield"];
  if (!factory) {
    return (isDryRun() ? MOCK_VIDEO_REGISTRY : REAL_VIDEO_REGISTRY)["higgsfield"]();
  }
  return factory();
}

export function getVideoProviderByName(name: string): VideoProvider {
  const registry = isDryRun() ? MOCK_VIDEO_REGISTRY : REAL_VIDEO_REGISTRY;
  const factory = registry[name] ?? registry["higgsfield"];
  return factory();
}
