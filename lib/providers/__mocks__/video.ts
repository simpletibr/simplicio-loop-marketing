import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { GenerationResult } from "../types";
import type { VideoGenerateOptions, VideoProvider } from "../video";

function aspectToDims(aspect: string): { width: number; height: number } {
  switch (aspect) {
    case "16:9":
      return { width: 1920, height: 1080 };
    case "1:1":
      return { width: 1080, height: 1080 };
    default:
      return { width: 1080, height: 1920 };
  }
}

abstract class BaseMockVideo implements VideoProvider {
  abstract readonly name: string;

  async generate(
    brief: string,
    opts: VideoGenerateOptions,
  ): Promise<GenerationResult<string | string[]>> {
    const ts = Date.now();
    const outputDir = opts.output_dir ?? resolve(process.cwd(), "outputs");
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }
    const { width, height } = aspectToDims(opts.aspect);
    const output = resolve(outputDir, `mock-${this.name}-${width}x${height}-${ts}.mp4`);
    writeFileSync(output, `mock video ${brief}`);
    return {
      ok: true,
      provider: this.name,
      task: opts.task,
      output,
      tokens: 0,
      cost_usd: 0.05 * opts.duration_s,
      latency_ms: 5000,
    };
  }
}

export class MockHiggsfieldVideoProvider extends BaseMockVideo {
  readonly name = "higgsfield";
}
export class MockTopviewVideoProvider extends BaseMockVideo {
  readonly name = "topview";
}
export class MockWavespeedVideoProvider extends BaseMockVideo {
  readonly name = "wavespeed";
}
/** Writes a fixture MP4 plus a render manifest with the real file hash. */
export class MockSimplicioVideoProvider extends BaseMockVideo {
  readonly name = "simplicio-video";

  async generate(
    brief: string,
    opts: VideoGenerateOptions,
  ): Promise<GenerationResult<string | string[]>> {
    const result = await super.generate(brief, opts);
    const mp4 = String(result.output);
    const sha256 = createHash("sha256").update(`mock video ${brief}`).digest("hex");
    const manifestPath = `${mp4}.render.manifest.json`;
    writeFileSync(
      manifestPath,
      JSON.stringify({
        output: { path: mp4, sha256, bytes: `mock video ${brief}`.length, duration_s: opts.duration_s },
        voice: { provider: "mock-tts", seconds: opts.duration_s, cost_usd: 0, cache_hit: true },
        qa: { passed: true, notes: "dry-run fixture" },
      }),
    );
    return { ...result, render_manifest_path: manifestPath, output_sha256: sha256 };
  }
}

export const MOCK_VIDEO_REGISTRY: Record<string, () => VideoProvider> = {
  higgsfield: () => new MockHiggsfieldVideoProvider(),
  topview: () => new MockTopviewVideoProvider(),
  wavespeed: () => new MockWavespeedVideoProvider(),
  "simplicio-video": () => new MockSimplicioVideoProvider(),
};
