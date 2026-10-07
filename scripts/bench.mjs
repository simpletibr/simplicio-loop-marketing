#!/usr/bin/env node
// scripts/bench.mjs — lightweight benchmark for hot paths in the pipeline.
//
// Two hot paths are timed:
//  1. TOON encode/decode of a representative piece-batch payload — this runs
//     on every LLM call that uses `prompt_format: "toon"` (see lib/router.ts
//     UsageEntry.prompt_format), so it sits directly on the request latency
//     path.
//  2. CLI dispatch (`marketing-engine help`) — the cold-start path every
//     invocation of the tool pays once.
//
// Produces a measured number (ops/sec + mean ms) for each; run with
// `npm run bench`. Not a strict pass/fail gate — CI can wire a budget once a
// baseline is established, mirroring scripts/token-budget.mjs.

import { performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { encodeToon, decodeToon } from "../lib/format/toon.ts";
import { estimateTokens } from "../lib/providers/cost.ts";
import { fanOutCaptions } from "../lib/content/captions.ts";
import { selectConstrainedProvider } from "../lib/providers/constraints.ts";
import { IMAGE_PROVIDER_CAPABILITIES } from "../lib/providers/image.ts";
import { serializeVideoContract, verifyRenderManifest } from "../lib/video/contract.ts";
import { createHash } from "node:crypto";
import { recordDecision, requestApproval, verifyApproval } from "../lib/approval/store.ts";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

function timeit(label, fn, iterations) {
  // Warm up (JIT + first-call overhead) before the measured loop.
  for (let i = 0; i < Math.min(50, iterations); i++) fn();
  const t0 = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const t1 = performance.now();
  const totalMs = t1 - t0;
  const meanMs = totalMs / iterations;
  const opsPerSec = 1000 / meanMs;
  console.log(
    `${label}: ${iterations} iterations in ${totalMs.toFixed(1)}ms ` +
      `(mean ${meanMs.toFixed(4)}ms/op, ${opsPerSec.toFixed(0)} ops/sec)`,
  );
  return { label, iterations, totalMs, meanMs, opsPerSec };
}

function makePayload() {
  const pieces = Array.from({ length: 25 }, (_, i) => ({
    id: `piece-${i}`,
    status: i % 3 === 0 ? "ready" : "draft",
    score: Math.round(Math.random() * 1000) / 1000,
    platform: ["instagram", "tiktok", "linkedin"][i % 3],
  }));
  return { pieces, tags: ["q3", "launch", "asolaria"] };
}

const payload = makePayload();
const encoded = encodeToon(payload);

const results = [];
results.push(timeit("toon.encode (25-piece batch)", () => encodeToon(payload), 2000));
results.push(timeit("toon.decode (25-piece batch)", () => decodeToon(encoded), 2000));
results.push(timeit("tokenizer.bpe (PT-BR caption)", () => estimateTokens("Olá 👋🏽 — conteúdo final para Instagram com ação e transparência.", "gpt-4o"), 500));
results.push(timeit("caption.fan-out (4 platforms)", () => fanOutCaptions("Uma atualização técnica com evidência. ".repeat(20), ["instagram", "tiktok", "linkedin", "x", "ig"]), 10_000));
results.push(timeit("provider.constraint-selection", () => selectConstrainedProvider("wavespeed", Object.keys(IMAGE_PROVIDER_CAPABILITIES), IMAGE_PROVIDER_CAPABILITIES, { brand_strict: true, quality_min: "high" }), 25_000));

const contractInput = { slug: "bench-001", client: "acme", language: "pt-BR", aspect: "9:16", duration_s: 30, script: "Pare de perder cliente por falta de constância. ".repeat(8), voice: { provider: "default" }, brand: { name: "Acme", colors: ["#111111", "#222222"], tone: "direto" } };
results.push(timeit("video.contract-serialize", () => serializeVideoContract(contractInput), 20_000));
const benchDir = mkdtempSync(join(tmpdir(), "me-bench-"));
writeFileSync(join(benchDir, "final.mp4"), "x".repeat(256 * 1024));
writeFileSync(join(benchDir, "render.manifest.json"), JSON.stringify({ output: { path: "final.mp4", sha256: createHash("sha256").update("x".repeat(256 * 1024)).digest("hex") } }));
results.push(timeit("video.render-manifest-verify (256 KiB mp4)", () => { if (!verifyRenderManifest(join(benchDir, "render.manifest.json")).ok) throw new Error("bench manifest rejected"); }, 500));

const approvalRoot = mkdtempSync(join(tmpdir(), "me-bench-approval-"));
for (let i = 0; i < 200; i++) {
  const sha = createHash("sha256").update(`m${i}`).digest("hex");
  requestApproval(approvalRoot, { client: "acme", pieceId: `P-${i}`, month: "2026-10", mediaSha256: sha, preview: "p.mp4", captions: {} });
  recordDecision(approvalRoot, { client: "acme", pieceId: `P-${i}`, mediaSha256: sha, decision: "approved", decidedBy: "bench" });
}
const lastSha = createHash("sha256").update("m199").digest("hex");
const lastRef = (await import("../lib/approval/store.ts")).findApproval(approvalRoot, "P-199", lastSha).approval_id;
results.push(timeit("approval.verify (200-piece log)", () => { if (!verifyApproval(approvalRoot, { pieceId: "P-199", mediaSha256: lastSha, approvalRef: lastRef }).ok) throw new Error("bench approval rejected"); }, 300));

results.push(
  timeit(
    "cli.dispatch (marketing-engine help)",
    () => {
      const r = spawnSync(process.execPath, [resolve(ROOT, "bin", "marketing-engine.mjs"), "help"], {
        cwd: ROOT,
        encoding: "utf8",
      });
      if (r.status !== 0) throw new Error(`cli help exited ${r.status}: ${r.stderr}`);
    },
    10,
  ),
);

console.log("\nbench: summary (measured numbers above, no fixed budget enforced yet)");
for (const r of results) {
  console.log(`- ${r.label}: ${r.opsPerSec.toFixed(0)} ops/sec, mean ${r.meanMs.toFixed(4)}ms`);
}
