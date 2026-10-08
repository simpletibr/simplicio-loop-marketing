import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { appendRunLog } from "../data/runs";
import { writeManifest, type ManifestPayload } from "../data/manifest";
import { pushStatus } from "../calendar/notion";
import { runAudit } from "../compliance/loader";
import {
  listPieces,
  pieceFilePath,
  readPiece,
  transitionStatus,
} from "../pieces/store";
import { parsePiece, serializePiece, type PieceFrontmatter } from "../pieces/frontmatter";
import { logUsage, runWithFallback } from "../router";
import { estimateTokenDetails } from "../providers/cost";
import { getLLMProviderByName } from "../providers/llm";
import { getImageProviderByName } from "../providers/image";
import { getVideoProviderByName } from "../providers/video";
import { buildPieceContract } from "../video/piece-contract";
import { llmRow, imageRow, videoRow, loadProviderMatrix } from "../providers/matrix";
import type { ImageTask, LLMTask, VideoTask } from "../providers/types";
import {
  validate as validateTechSpecs,
  type Platform as TechSpecsPlatform,
} from "../qa/tech-specs";
import { runGate, writeWatcherReport } from "../gate/watcher-gate";
import { encodeToon } from "../format/toon";
import { emitEvent } from "../observability/events";
import { readLearningsForBrief } from "../learning/retrospective";
import { assertDoctorHealthy } from "./doctor";
import { gateEvidence } from "../gate/evidence";
import { buildPlatformCaptions, type CaptionPlatform } from "../content/captions";

export interface GenerateOptions {
  root: string;
  piecesDir?: string;
  outputsDir?: string;
  maxIter?: number;
  matrixPath?: string;
  evidenceGate?: typeof gateEvidence;
}

interface GenerateSummary {
  inspected: number;
  advanced: number;
  blocked: number;
  skipped: number;
  failures: number;
}

interface GeneratedAsset {
  kind: "image" | "video";
  path: string;
  platforms: TechSpecsPlatform[];
}

function engineRoot(root: string): string {
  const nested = resolve(root, ".marketing-engine");
  return existsSync(nested) ? nested : root;
}

function piecesRootFor(opts: GenerateOptions): string {
  return opts.piecesDir ?? resolve(engineRoot(opts.root), "pieces");
}

function dataRootFor(opts: GenerateOptions): string {
  return resolve(engineRoot(opts.root), "data");
}

function typeToTasks(type: string): {
  copy: LLMTask;
  image?: ImageTask;
  video?: VideoTask;
} {
  switch (type.toLowerCase()) {
    case "reel":
    case "shorts":
    case "story":
      return { copy: "script", video: "cinematic-reel" };
    case "carousel":
      return { copy: "script", image: "carousel" };
    case "quote-card":
    case "static":
      return { copy: "caption", image: "quote-card" };
    case "ugc":
      return { copy: "caption", video: "ugc-product" };
    default:
      return { copy: "caption", image: "quote-card" };
  }
}

/**
 * Structured piece metadata (client, type, pillar, platforms, ...) that
 * gives the LLM prompt context about the piece it's writing copy for.
 * Encoded as TOON (not JSON.stringify) before it lands in PROMPT CONTENT —
 * TOON's tabular/inline-list rules cut tokens vs raw JSON on this kind of
 * small, mostly-scalar structured payload. This is unrelated to the
 * JSON.stringify(body) calls in lib/providers/llm.ts, which serialize the
 * outbound HTTP request envelope (the wire protocol) and must stay JSON.
 */
function pieceContext(fm: PieceFrontmatter): Record<string, unknown> {
  const ctx: Record<string, unknown> = {
    id: fm.id,
    client: fm.client,
    type: fm.type,
    pillar: fm.pillar,
    platforms: fm.platforms,
  };
  if (fm.campaign) ctx.campaign = fm.campaign;
  if (fm.locale) ctx.locale = fm.locale;
  return ctx;
}

function stableClientSystemContext(root: string, client: string): string | undefined {
  const dir = resolve(engineRoot(root), "clients", client);
  const files = ["BRAND.md", "COMPLIANCE.md", "CHANNELS.md", "PERSONAS.md", "PILLARS.md", "SPECS.md"];
  const sections = files.filter((name) => existsSync(join(dir, name))).map((name) => `## ${name}\n${readFileSync(join(dir, name), "utf8").slice(0, 12000)}`);
  return sections.length > 0 ? sections.join("\n\n") : undefined;
}

function outputsRootFor(opts: GenerateOptions): string {
  return opts.outputsDir ?? resolve(engineRoot(opts.root), "outputs");
}

function pieceOutputDir(
  opts: GenerateOptions,
  client: string,
  date: string,
  id: string,
): string {
  return resolve(outputsRootFor(opts), client, date, id);
}

function isReelLike(type: string): boolean {
  return ["reel", "shorts", "story", "ugc"].includes(type.toLowerCase());
}

function techSpecTargetsFor(
  fm: PieceFrontmatter,
  kind: GeneratedAsset["kind"],
): TechSpecsPlatform[] {
  const targets = new Set<TechSpecsPlatform>();
  const type = fm.type.toLowerCase();
  for (const platform of fm.platforms) {
    switch (platform.toLowerCase()) {
      case "instagram":
        if (kind === "video") {
          targets.add(type === "story" ? "ig_story" : "ig_reel");
        } else {
          targets.add(type === "carousel" ? "ig_carousel" : "ig_feed");
        }
        break;
      case "tiktok":
        targets.add("tiktok");
        break;
      case "youtube":
      case "youtube-shorts":
      case "yt_shorts":
        if (kind === "video") {
          targets.add(isReelLike(type) ? "yt_shorts" : "yt_long");
        }
        break;
      case "facebook":
        targets.add(kind === "video" && isReelLike(type) ? "fb_reels" : "fb_feed");
        break;
      case "linkedin":
        targets.add("linkedin");
        break;
      default:
        break;
    }
  }
  return Array.from(targets);
}

export async function runGenerateLoop(
  opts: GenerateOptions,
): Promise<GenerateSummary> {
  process.env.DRY_RUN = process.env.DRY_RUN ?? "true";
  if (process.env.DRY_RUN !== "true") assertDoctorHealthy(opts.root);
  if (opts.matrixPath) {
    process.env.PROVIDERS_MATRIX_PATH = opts.matrixPath;
  }
  loadProviderMatrix(opts.matrixPath);

  const pieces = listPieces({
    piecesDir: piecesRootFor(opts),
    status: "draft",
  });
  const max = opts.maxIter ?? pieces.length;
  const summary: GenerateSummary = {
    inspected: pieces.length,
    advanced: 0,
    blocked: 0,
    skipped: 0,
    failures: 0,
  };

  for (let i = 0; i < Math.min(pieces.length, max); i++) {
    const piece = pieces[i];
    const fm = piece.frontmatter;
    emitEvent(opts.root, {
      kind: "piece_start",
      piece_id: fm.id,
      client: fm.client,
      phase: "generate",
    });
    try {
      await processPiece(piece, opts);
      summary.advanced++;
      emitEvent(opts.root, {
        kind: "piece_advanced",
        piece_id: fm.id,
        client: fm.client,
        phase: "generate",
        verdict: "scheduled",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.startsWith("compliance-block:") || msg.startsWith("tech-specs-block:") || msg.startsWith("evidence-block:")) {
        summary.blocked++;
        emitEvent(opts.root, {
          kind: "gate_fail",
          level: "warn",
          piece_id: fm.id,
          client: fm.client,
          phase: "generate",
          verdict: msg.split(":")[0],
        });
      } else {
        summary.failures++;
        process.stderr.write(`[generate] piece ${fm.id} failed: ${msg}\n`);
        emitEvent(opts.root, {
          kind: "piece_failed",
          level: "error",
          piece_id: fm.id,
          client: fm.client,
          phase: "generate",
          data: { message: msg.slice(0, 500) },
        });
      }
    }
  }
  return summary;
}

export async function processPiece(
  piece: { frontmatter: PieceFrontmatter; body: string },
  opts: GenerateOptions,
): Promise<void> {
  const fm = piece.frontmatter;
  const tasks = typeToTasks(fm.type);
  const dateStr = fm.date.slice(0, 10);
  const pieceDir = pieceOutputDir(opts, fm.client, dateStr, fm.id);
  if (!existsSync(pieceDir)) mkdirSync(pieceDir, { recursive: true });

  const usageLogPath = resolve(dataRootFor(opts), "llm-usage.jsonl");
  const llmOverride = fm.provider_override?.llm_text ?? undefined;
  const imageOverride = fm.provider_override?.image ?? undefined;
  const videoOverride = fm.provider_override?.video ?? undefined;

  const matrix = loadProviderMatrix(opts.matrixPath);
  const copyRow = llmRow(tasks.copy, matrix);
  const primaryLLM = llmOverride ?? copyRow.default;
  const fallbackLLM = copyRow.fallback;
  const stableSystem = stableClientSystemContext(opts.root, fm.client);

  const lessons = readLearningsForBrief(opts.root, fm.client);
  const brief = `${piece.body.slice(0, 800)}${lessons.length ? "\\n\\nDurable measured learnings to avoid:\\n" + lessons.map((lesson) => `- ${lesson}`).join("\\n") : ""}`;
  // Structured piece metadata goes into the prompt as TOON, not JSON — same
  // information, fewer tokens on the wire to the LLM.
  const scriptPrompt = `${encodeToon(pieceContext(fm))}\n\n${brief}`;

  const copy = await runWithFallback({
    piece_id: fm.id,
    prompt_format: "toon",
    task: tasks.copy,
    primaryName: primaryLLM,
    fallbackName: fallbackLLM,
    log_path: usageLogPath,
    primary: () =>
      getLLMProviderByName(primaryLLM).generate(scriptPrompt, { task: tasks.copy, system: stableSystem }),
    fallback: fallbackLLM
      ? () =>
          getLLMProviderByName(fallbackLLM).generate(scriptPrompt, {
            task: tasks.copy,
            system: stableSystem,
          })
      : undefined,
  });

  writeFileSync(
    join(pieceDir, "script.md"),
    `# Script for ${fm.id}\n\nProvider: ${copy.provider_used}\n\n${copy.result.output ?? ""}\n`,
  );

  const captionResult = await runWithFallback({
    piece_id: fm.id,
    prompt_format: "json",
    task: "caption",
    primaryName: llmOverride ?? llmRow("caption", matrix).default,
    fallbackName: llmRow("caption", matrix).fallback,
    log_path: usageLogPath,
    primary: () =>
      getLLMProviderByName(llmOverride ?? llmRow("caption", matrix).default).generate(
        `Caption for: ${brief.slice(0, 200)}`,
        { task: "caption", system: stableSystem },
      ),
    fallback: llmRow("caption", matrix).fallback
      ? () =>
          getLLMProviderByName(
            llmRow("caption", matrix).fallback ?? "claude",
          ).generate(`Caption for: ${brief.slice(0, 200)}`, {
            task: "caption",
            system: stableSystem,
          })
      : undefined,
  });

  const captionText = captionResult.result.output ?? "";
  const captionPrompt = `Caption for: ${brief.slice(0, 200)}`;
  // The evidence contract is intentionally stable across campaigns: every
  // piece carries the four canonical review variants, even when publishing
  // is currently limited to a subset of channels.
  const platformCaptions = buildPlatformCaptions(captionText, fm.pillar);
  writeFileSync(
    join(pieceDir, "captions.json"),
    JSON.stringify(platformCaptions, null, 2),
  );

  const outputs: string[] = [
    join(pieceDir, "script.md"),
    join(pieceDir, "captions.json"),
  ];
  const generatedAssets: GeneratedAsset[] = [];

  let imageUsed: string | undefined;
  let videoUsed: string | undefined;
  let renderManifestPath: string | undefined;
  let renderSha256: string | undefined;
  let totalCost = (copy.result.cost_usd ?? 0) + (captionResult.result.cost_usd ?? 0);

  if (tasks.image) {
    const row = imageRow(tasks.image, matrix);
    const provider = imageOverride ?? row.default;
    imageUsed = provider;
    const r = await getImageProviderByName(provider).generate(brief, {
      task: tasks.image,
      aspect: fm.platforms.includes("instagram") ? "4:5" : "9:16",
      n: 1,
      output_dir: pieceDir,
    });
    if (r.output) {
      outputs.push(...r.output);
      for (const path of r.output) {
        generatedAssets.push({
          kind: "image",
          path,
          platforms: techSpecTargetsFor(fm, "image"),
        });
      }
    }
    totalCost += r.cost_usd ?? 0;
    logUsage({ task: tasks.image, stage: "creative", correlation_id: fm.id, piece_id: fm.id, provider, tokens: r.tokens ?? 0, source: "provider", cost_usd: r.cost_usd ?? 0, ok: r.ok }, usageLogPath);
  }
  if (tasks.video) {
    const row = videoRow(tasks.video, matrix);
    const provider = videoOverride ?? row.default;
    videoUsed = provider;
    const r = await getVideoProviderByName(provider).generate(brief, {
      task: tasks.video,
      aspect: "9:16",
      duration_s: 30,
      output_dir: pieceDir,
      contract: buildPieceContract(opts.root, fm, brief, { aspect: "9:16", duration_s: 30 }),
    });
    renderManifestPath = r.render_manifest_path;
    renderSha256 = r.output_sha256;
    if (r.render_manifest_path) outputs.push(r.render_manifest_path);
    if (r.output) {
      const videoOutputs = Array.isArray(r.output) ? r.output : [r.output];
      outputs.push(...videoOutputs);
      for (const path of videoOutputs) {
        generatedAssets.push({
          kind: "video",
          path,
          platforms: techSpecTargetsFor(fm, "video"),
        });
      }
    }
    totalCost += r.cost_usd ?? 0;
    logUsage({ task: tasks.video, stage: "creative", correlation_id: fm.id, piece_id: fm.id, provider, tokens: r.tokens ?? 0, source: "provider", cost_usd: r.cost_usd ?? 0, ok: r.ok }, usageLogPath);
  }

  let qaReportPath: string | undefined;
  if (generatedAssets.length > 0) {
    const qaReport = {
      piece_id: fm.id,
      pass: true,
      assets: generatedAssets
        .filter((asset) => asset.platforms.length > 0)
        .map((asset) => ({
          kind: asset.kind,
          path: asset.path,
          target_platforms: asset.platforms,
          report: validateTechSpecs(asset.path, asset.platforms),
        })),
    };
    qaReport.pass = qaReport.assets.every((asset) => asset.report.pass);
    qaReportPath = join(pieceDir, "qa-tech-specs.json");
    writeFileSync(qaReportPath, JSON.stringify(qaReport, null, 2));
    outputs.push(qaReportPath);
    if (!qaReport.pass) {
      transitionStatus(fm.id, "draft", "review", {
        piecesDir: piecesRootFor(opts),
      });
      appendRunLog(
        {
          piece_id: fm.id,
          client: fm.client,
          providers_used: [copy.provider_used, imageUsed, videoUsed].filter(
            (p): p is string => Boolean(p),
          ),
          cost_estimate_usd: totalCost,
          status: "blocked",
          notes: "qa-tech-specs violations",
        },
        engineRoot(opts.root),
      );
      throw new Error(`tech-specs-block:${fm.id}`);
    }
  }

  const complianceResult = await runAudit({
    root: opts.root,
    piece_id: fm.id,
    text: `${captionText}\n${copy.result.output ?? ""}\n${piece.body}`,
    client: fm.client,
  });
  const compliance = complianceResult.report;
  const complianceMeasurement = estimateTokenDetails(`${captionText}\n${copy.result.output ?? ""}\n${piece.body}`);
  logUsage({ task: "compliance", stage: "compliance", correlation_id: fm.id, piece_id: fm.id, provider: "local", tokens: complianceMeasurement.tokens, source: complianceMeasurement.fallback_reason?.startsWith("tokenizer_failed") ? "unavailable" : "tokenizer", encoding: complianceMeasurement.encoding, fallback_reason: complianceMeasurement.fallback_reason, cost_usd: 0, ok: true }, usageLogPath);
  const compliancePath = join(pieceDir, "compliance.json");
  writeFileSync(
    compliancePath,
    JSON.stringify(compliance, null, 2),
  );
  outputs.push(compliancePath);

  if (!compliance.pass) {
    appendRunLog(
      {
        piece_id: fm.id,
        client: fm.client,
        providers_used: [copy.provider_used, imageUsed, videoUsed].filter(
          (p): p is string => Boolean(p),
        ),
        cost_estimate_usd: totalCost,
        status: "blocked",
        notes: `compliance violations: ${compliance.violations.length}`,
      },
      engineRoot(opts.root),
    );
    const path = pieceFilePath(fm.id, {
      piecesDir: piecesRootFor(opts),
    });
    const cur = parsePiece(readFileSync(path, "utf8"));
    cur.frontmatter.compliance_block = compliance.violations;
    cur.frontmatter.compliance_report = complianceResult.report_path;
    writeFileSync(path, serializePiece(cur.frontmatter, cur.body));
    throw new Error(`compliance-block:${fm.id}`);
  }

  // === WATCHER GATE (N-Nest style) ===
  // Agent produced the output above; now the watcher independently verifies.
  // The gate checks the caption that will actually ship (the per-platform
  // variant, which carries the pillar hashtag), not the raw LLM output.
  const primaryPlatform = fm.platforms[0] ?? "instagram";
  const primaryCaption = Object.hasOwn(platformCaptions, primaryPlatform)
    ? platformCaptions[primaryPlatform as CaptionPlatform]
    : captionText;
  const watcherInput = {
    piece_id: fm.id,
    script: copy.result.output ?? "",
    caption: primaryCaption,
    brief,
    platform: primaryPlatform,
    pillar: fm.pillar,
  };
  const watcherReport = runGate(watcherInput);
  const watcherReportPath = writeWatcherReport(
    engineRoot(opts.root),
    watcherReport,
  );
  emitEvent(opts.root, {
    kind: watcherReport.passed ? "gate_pass" : "gate_fail",
    level: watcherReport.passed ? "info" : "warn",
    piece_id: fm.id,
    client: fm.client,
    phase: "watcher-gate",
    verdict: watcherReport.tag,
  });

  if (!watcherReport.passed) {
    // Watcher found discrepancies → route to review
    transitionStatus(fm.id, "draft", "review", {
      piecesDir: piecesRootFor(opts),
    });
    const cur = readPiece(fm.id, {
      piecesDir: piecesRootFor(opts),
    });
    cur.frontmatter.claims_tag = watcherReport.tag;
    cur.frontmatter.watcher_report_path = watcherReportPath;
    writeFileSync(
      pieceFilePath(fm.id, { piecesDir: piecesRootFor(opts) }),
      serializePiece(cur.frontmatter, cur.body),
    );
    appendRunLog(
      {
        piece_id: fm.id,
        client: fm.client,
        providers_used: [copy.provider_used, imageUsed, videoUsed].filter(
          (p): p is string => Boolean(p),
        ),
        cost_estimate_usd: totalCost,
        status: "blocked",
        notes: `watcher-gate: ${watcherReport.tag} — ${watcherReport.checked.filter((c) => !c.match).length} check(s) failed`,
      },
      engineRoot(opts.root),
    );
    throw new Error(`tech-specs-block:${fm.id}`);
  }

  // Gate passed — write manifest with watcher report path
  const manifest: ManifestPayload = {
    piece_id: fm.id,
    client: fm.client,
    date: dateStr,
    providers: {
      llm: copy.provider_used,
      image: imageUsed,
      video: videoUsed,
    },
    prompts: {
      script: scriptPrompt,
      caption: captionPrompt,
      image: tasks.image ? brief : undefined,
      video: tasks.video ? brief : undefined,
    },
    cost_estimate_usd: totalCost,
    tokens_in: (copy.result.tokens_in ?? 0) + (captionResult.result.tokens_in ?? 0),
    tokens_out: (copy.result.tokens_out ?? 0) + (captionResult.result.tokens_out ?? 0),
    compliance_report_path: complianceResult.report_path,
    qa_report_path: qaReportPath,
    watcher_report_path: watcherReportPath,
    outputs,
    fallback_used: copy.fallback_triggered || captionResult.fallback_triggered,
    ...(renderManifestPath ? { render_manifest_path: renderManifestPath } : {}),
    ...(renderSha256 ? { render_sha256: renderSha256 } : {}),
  };
  writeManifest(join(pieceDir, "manifest.hbi"), manifest);
  emitEvent(opts.root, {
    kind: "manifest_written",
    piece_id: fm.id,
    client: fm.client,
    phase: "generate",
    provider: copy.provider_used,
    data: { manifest_path: join(pieceDir, "manifest.hbi") },
  });

  // Persist the evidence references while still in draft; the shared evidence
  // gate must pass before the state transition is allowed.
  const pending = readPiece(fm.id, { piecesDir: piecesRootFor(opts) });
  pending.frontmatter.compliance_report = complianceResult.report_path;
  pending.frontmatter.claims_tag = watcherReport.tag;
  pending.frontmatter.watcher_report_path = watcherReportPath;
  writeFileSync(
    pieceFilePath(fm.id, {
      piecesDir: piecesRootFor(opts),
    }),
    serializePiece(pending.frontmatter, pending.body),
  );
  appendRunLog(
    {
      piece_id: fm.id,
      client: fm.client,
      providers_used: [copy.provider_used, imageUsed, videoUsed].filter(
        (p): p is string => Boolean(p),
      ),
      cost_estimate_usd: totalCost,
      status: "success",
    },
    engineRoot(opts.root),
  );

  const evidence = (opts.evidenceGate ?? gateEvidence)(opts.root, fm.id, {
    outputsDir: outputsRootFor(opts),
    piecesDir: piecesRootFor(opts),
  });
  if (!evidence.pass) {
    appendRunLog(
      { piece_id: fm.id, client: fm.client, providers_used: [copy.provider_used, imageUsed, videoUsed].filter((p): p is string => Boolean(p)), cost_estimate_usd: totalCost, status: "blocked", notes: `evidence-gate: ${evidence.missing.join(", ")}` },
      engineRoot(opts.root),
    );
    throw new Error(`evidence-block:${fm.id}: ${evidence.missing.join(", ")}`);
  }

  transitionStatus(fm.id, "draft", "scheduled", { piecesDir: piecesRootFor(opts) });
  if (fm.notion_page_id && process.env.NOTION_TOKEN) {
    await pushStatus(fm.id, "scheduled", { root: opts.root });
  }
}

export async function cliEntry(argv: string[]): Promise<void> {
  const root = process.cwd();
  let maxIter: number | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--max-iter" && argv[i + 1]) {
      maxIter = Number(argv[++i]);
    }
  }
  const envMaxIter = process.env.MAX_ITER ? Number(process.env.MAX_ITER) : undefined;
  const piecesEnv = process.env.MARKETING_ENGINE_PIECES_DIR;
  const outputsEnv = process.env.MARKETING_ENGINE_OUTPUTS_DIR;
  const summary = await runGenerateLoop({
    root,
    piecesDir: piecesEnv,
    outputsDir: outputsEnv,
    maxIter: maxIter ?? (Number.isFinite(envMaxIter) ? envMaxIter : undefined),
  });
  const line = `generate: inspected=${summary.inspected} advanced=${summary.advanced} blocked=${summary.blocked} failures=${summary.failures}`;
  process.stdout.write(`${line}\n`);
  if (summary.failures > 0 && summary.advanced === 0) {
    process.exit(2);
  }
}

void dirname;

if (
  import.meta.url ===
  `file://${process.argv[1]?.replace(/\\/g, "/")}`.replace(/^file:\/\/\/\//, "file:///")
) {
  cliEntry(process.argv.slice(2)).catch((err) => {
    process.stderr.write(`generate failed: ${String(err)}\n`);
    process.exit(1);
  });
}
