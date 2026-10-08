import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  VIDEO_CONTRACT_SCHEMA,
  cliArgs,
  serializeVideoContract,
  sha256File,
  verifyRenderManifest,
  type VideoContractInput,
} from "../../lib/video/contract.ts";

const base: VideoContractInput = {
  slug: "acme-001",
  client: "acme",
  language: "pt-BR",
  aspect: "9:16",
  duration_s: 30,
  script: 'Linha 1\nLinha "2": com aspas',
};

function manifestDir(content = "mp4-bytes", override: Record<string, unknown> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "me-render-"));
  writeFileSync(join(dir, "final.mp4"), content);
  const sha256 = createHash("sha256").update("mp4-bytes").digest("hex");
  const manifest = join(dir, "render.manifest.json");
  writeFileSync(manifest, JSON.stringify({ output: { path: "final.mp4", sha256, ...override } }));
  return { dir, manifest, sha256 };
}

test("serializeVideoContract is deterministic and quotes script text safely", () => {
  const a = serializeVideoContract(base);
  assert.equal(a, serializeVideoContract({ ...base }));
  assert.match(a, new RegExp(`^schema: "${VIDEO_CONTRACT_SCHEMA}"`));
  assert.ok(a.includes('script: "Linha 1\\nLinha \\"2\\": com aspas"'));
  assert.ok(a.includes("format:\n  aspect: \"9:16\"\n  duration_s: 30"));
  assert.ok(!a.includes("voice:"), "optional blocks are omitted when absent");
});

test("serializeVideoContract emits optional hook, template, seed, voice and brand blocks", () => {
  const out = serializeVideoContract({
    ...base,
    hook: "Pare de perder cliente",
    template: "broll-v2",
    seed: 7,
    voice: { provider: "default", name: "Aoede" },
    brand: { name: "Acme", colors: ["#111111", "#222222"], tone: "direto", logo: "logo.svg" },
  });
  for (const needle of ['hook: "Pare de perder cliente"', 'template: "broll-v2"', "seed: 7", '  name: "Aoede"', '    - "#222222"', '  logo: "logo.svg"']) {
    assert.ok(out.includes(needle), needle);
  }
});

test("cliArgs keeps the factory invocation in one place", () => {
  assert.deepEqual(cliArgs("c.yaml", "out"), ["run", "--json", "--contract", "c.yaml", "--out", "out"]);
});

test("verifyRenderManifest accepts a manifest whose hash matches the file", () => {
  const { manifest, sha256 } = manifestDir();
  const check = verifyRenderManifest(manifest);
  assert.equal(check.ok, true);
  assert.equal(check.manifest?.output.sha256, sha256);
  assert.equal(sha256File(check.mp4_path as string), sha256);
});

test("verifyRenderManifest fails closed on every malformed case", () => {
  assert.match(verifyRenderManifest("/nonexistent/render.manifest.json").reasons[0] as string, /missing/);

  const dir = mkdtempSync(join(tmpdir(), "me-render-bad-"));
  const notJson = join(dir, "a.json");
  writeFileSync(notJson, "{nope");
  assert.match(verifyRenderManifest(notJson).reasons[0] as string, /not valid JSON/);

  const shape = join(dir, "b.json");
  writeFileSync(shape, JSON.stringify({ output: { path: "x.mp4", sha256: "short" } }));
  assert.match(verifyRenderManifest(shape).reasons[0] as string, /64-hex/);

  const noFile = join(dir, "c.json");
  writeFileSync(noFile, JSON.stringify({ output: { path: "gone.mp4", sha256: "a".repeat(64) } }));
  assert.match(verifyRenderManifest(noFile).reasons[0] as string, /rendered file missing/);

  const tampered = manifestDir("tampered-bytes");
  const result = verifyRenderManifest(tampered.manifest);
  assert.equal(result.ok, false);
  assert.match(result.reasons[0] as string, /sha256 mismatch/);
});
