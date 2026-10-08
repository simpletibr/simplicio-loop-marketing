import { test, expect } from "@playwright/test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validate, validateArtifact } from "../lib/contracts/validate";
import { fixturesDir, loadSchemaRegistry } from "../lib/contracts/registry";
import { emitEvent } from "../lib/observability/events";
import { appendSavingsEvent } from "../lib/observability/savings";
import { writeManifest } from "../lib/data/manifest";

test("every shipped schema has an $id and loads into the registry", () => {
  const registry = loadSchemaRegistry();
  const ids = Object.keys(registry);
  expect(ids).toEqual(
    expect.arrayContaining([
      "marketing-event/v1",
      "marketing-manifest/v1",
      "simplicio.savings-event/v1",
      "marketing-loop-state/v1",
      "marketing-publish-receipt/v1",
      "brand-profile/v1",
      "approval/v1",
      "content-plan/v1",
      "simplicio.dashboard-event/v1",
    ]),
  );
});

test("committed fixtures validate against their schemas (drift gate, side A)", () => {
  const registry = loadSchemaRegistry();
  const files = readdirSync(fixturesDir()).filter((f) => f.endsWith(".json"));
  expect(files.length).toBeGreaterThanOrEqual(3);
  for (const file of files) {
    const artifact = JSON.parse(readFileSync(join(fixturesDir(), file), "utf8"));
    const result = validateArtifact(artifact, registry);
    expect(result.skipped, `${file} must carry a known schema id`).toBeFalsy();
    expect(result.errors, `${file}: ${result.errors.join("; ")}`).toEqual([]);
  }
});

test("fresh producer output validates against the schemas (drift gate, side B)", async () => {
  const registry = loadSchemaRegistry();
  const root = mkdtempSync(join(tmpdir(), "me-contracts-"));

  const ev = emitEvent(root, {
    kind: "gate_pass",
    piece_id: "PIECE-ct-001",
    client: "acme",
    phase: "watcher-gate",
    verdict: "MEASURED",
  });
  expect(validateArtifact(ev, registry).errors).toEqual([]);

  const sv = appendSavingsEvent(root, {
    source: "loop:journal-skip",
    surfaces: ["generate"],
    tokens: { baseline_total: 100, actual_total: 10 },
    methodology: "test",
  });
  expect(sv).not.toBeNull();
  expect(validateArtifact(sv, registry).errors).toEqual([]);

  const outDir = join(root, "outputs");
  mkdirSync(outDir, { recursive: true });
  const doc = writeManifest(join(outDir, "manifest.hbi"), {
    piece_id: "PIECE-ct-001",
    client: "acme",
    date: "2026-01-01",
    providers: { llm: "claude" },
    prompts: { script: "s" },
    cost_estimate_usd: 0.1,
    compliance_report_path: join(root, "compliance.json"),
    outputs: [],
  });
  expect(validateArtifact(doc, registry).errors).toEqual([]);
});

test("validator catches missing required, wrong type, bad enum — and allows additive fields", () => {
  const registry = loadSchemaRegistry();
  const eventSchema = registry["marketing-event/v1"];

  const missing = validate({ schema: "marketing-event/v1", ts: "t" }, eventSchema);
  expect(missing.ok).toBe(false);
  expect(missing.errors.join(" ")).toContain("run_id");

  const badEnum = validate(
    { schema: "marketing-event/v1", ts: "t", run_id: "r", kind: "k", level: "loud" },
    eventSchema,
  );
  expect(badEnum.ok).toBe(false);
  expect(badEnum.errors.join(" ")).toContain("enum");

  const badType = validate(
    { schema: "marketing-event/v1", ts: 42, run_id: "r", kind: "k", level: "info" },
    eventSchema,
  );
  expect(badType.ok).toBe(false);

  const additive = validate(
    {
      schema: "marketing-event/v1",
      ts: "t",
      run_id: "r",
      kind: "k",
      level: "info",
      brand_new_field: { anything: true },
    },
    eventSchema,
  );
  expect(additive.ok).toBe(true);
});

test("unknown schema ids are skipped, not failed (mapper contract semantics)", () => {
  const registry = loadSchemaRegistry();
  const result = validateArtifact({ schema: "somebody-elses/v9", x: 1 }, registry);
  expect(result.ok).toBe(true);
  expect(result.skipped).toBe(true);
});
