import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SimplicioVideoProvider, getVideoProvider } from "../../lib/providers/video.ts";
import { verifyRenderManifest } from "../../lib/video/contract.ts";

const NODE = process.execPath;

/** A fake factory CLI: reads the contract, writes an MP4 and a render manifest, prints the JSON result. */
function fakeCli(mode: "ok" | "bad-hash" | "no-json" | "fail" | "reported-error"): string {
  const dir = mkdtempSync(join(tmpdir(), "me-fake-cli-"));
  const script = join(dir, "simplicio-video");
  writeFileSync(
    script,
    `#!${NODE}
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const args = process.argv.slice(2);
const out = args[args.indexOf("--out") + 1];
const contract = fs.readFileSync(args[args.indexOf("--contract") + 1], "utf8");
fs.writeFileSync(path.join(out, "args.txt"), args.join(" "));
const mode = ${JSON.stringify(mode)};
if (mode === "fail") { process.stderr.write("boom"); process.exit(3); }
if (mode === "no-json") { process.stdout.write("rendering...\\n"); process.exit(0); }
if (mode === "reported-error") { process.stdout.write(JSON.stringify({ ok: false, error: "voice quota" }) + "\\n"); process.exit(0); }
const bytes = "mp4:" + contract.length;
fs.writeFileSync(path.join(out, "final.mp4"), bytes);
const sha = mode === "bad-hash" ? "0".repeat(64) : crypto.createHash("sha256").update(bytes).digest("hex");
fs.writeFileSync(path.join(out, "render.manifest.json"), JSON.stringify({ output: { path: "final.mp4", sha256: sha }, voice: { provider: "gemini", seconds: 28, cost_usd: 0.012, cache_hit: false } }));
process.stdout.write("log line\\n" + JSON.stringify({ ok: true, mp4: "final.mp4", manifest: "render.manifest.json" }) + "\\n");
`,
  );
  chmodSync(script, 0o755);
  return script;
}

function withEnv<T>(env: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  return fn().finally(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
}

const OPTS = { task: "programmatic-short" as const, aspect: "9:16", duration_s: 30 };

test("live path writes the contract, runs the CLI and verifies the render manifest", async () => {
  const out = mkdtempSync(join(tmpdir(), "me-video-out-"));
  await withEnv({ DRY_RUN: "false", SIMPLICIO_VIDEO_BIN: fakeCli("ok"), SIMPLICIO_VIDEO_MODE: undefined }, async () => {
    const result = await new SimplicioVideoProvider().realGenerate("Pare de perder cliente", { ...OPTS, output_dir: out });
    assert.equal(result.ok, true);
    assert.equal(result.provider, "simplicio-video");
    assert.equal(result.cost_usd, 0.012);
    const mp4 = result.output as string;
    assert.ok(existsSync(mp4));
    assert.equal(result.output_sha256, createHash("sha256").update(readFileSync(mp4)).digest("hex"));
    assert.equal(verifyRenderManifest(result.render_manifest_path as string).ok, true);
    const dir = mp4.slice(0, mp4.lastIndexOf("/"));
    assert.match(readFileSync(join(dir, "contract.yaml"), "utf8"), /^schema: "simplicio.video-contract\/v1"/);
    assert.match(readFileSync(join(dir, "args.txt"), "utf8"), /^run --json --contract .*contract\.yaml --out /);
  });
});

test("a render manifest whose hash disagrees with the file is rejected", async () => {
  await withEnv({ DRY_RUN: "false", SIMPLICIO_VIDEO_BIN: fakeCli("bad-hash") }, async () => {
    await assert.rejects(
      new SimplicioVideoProvider().realGenerate("x", { ...OPTS, output_dir: mkdtempSync(join(tmpdir(), "me-video-")) }),
      /render evidence rejected: sha256 mismatch/,
    );
  });
});

test("CLI failures surface instead of becoming success", async () => {
  const dir = () => mkdtempSync(join(tmpdir(), "me-video-"));
  await withEnv({ DRY_RUN: "false", SIMPLICIO_VIDEO_BIN: fakeCli("fail") }, async () => {
    await assert.rejects(new SimplicioVideoProvider().realGenerate("x", { ...OPTS, output_dir: dir() }));
  });
  await withEnv({ DRY_RUN: "false", SIMPLICIO_VIDEO_BIN: fakeCli("no-json") }, async () => {
    await assert.rejects(new SimplicioVideoProvider().realGenerate("x", { ...OPTS, output_dir: dir() }), /did not print a JSON result/);
  });
  await withEnv({ DRY_RUN: "false", SIMPLICIO_VIDEO_BIN: fakeCli("reported-error") }, async () => {
    await assert.rejects(new SimplicioVideoProvider().realGenerate("x", { ...OPTS, output_dir: dir() }), /voice quota/);
  });
});

test("missing binary and non-cli transport are explicit errors", async () => {
  await withEnv({ SIMPLICIO_VIDEO_BIN: undefined }, async () => {
    await assert.rejects(new SimplicioVideoProvider().realGenerate("x", OPTS), /SIMPLICIO_VIDEO_BIN missing/);
  });
  await withEnv({ SIMPLICIO_VIDEO_BIN: "/bin/true", SIMPLICIO_VIDEO_MODE: "mcp" }, async () => {
    await assert.rejects(new SimplicioVideoProvider().realGenerate("x", OPTS), /MCP transport required in caller context/);
  });
});

test("DRY_RUN routes to a mock that still produces a verifiable render manifest", async () => {
  await withEnv({ DRY_RUN: "true" }, async () => {
    const provider = getVideoProvider("programmatic-short");
    assert.equal(provider.name, "simplicio-video");
    const result = await provider.generate("fixture brief", { ...OPTS, output_dir: mkdtempSync(join(tmpdir(), "me-video-")) });
    const check = verifyRenderManifest(result.render_manifest_path as string);
    assert.equal(check.ok, true);
    assert.equal(check.manifest?.output.sha256, result.output_sha256);
  });
});
