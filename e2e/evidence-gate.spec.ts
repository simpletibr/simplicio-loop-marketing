import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { serializePiece, type PieceFrontmatter } from "../lib/pieces/frontmatter";
import { gateEvidence } from "../lib/gate/evidence";
import { runGenerateLoop } from "../lib/cli/generate";
import { appendHbp, writeHbiAtomic } from "../lib/formats/binary";
import { releaseIdentity } from "../lib/release-train/receipt";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CLI = resolve(__dirname, "..", "bin", "marketing-engine.mjs");

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "me-evidence-"));
  const ws = join(root, ".marketing-engine");
  const id = "piece-evidence-1";
  const out = join(ws, "outputs", "acme", "2026-05-08", id);
  mkdirSync(join(ws, "pieces"), { recursive: true });
  mkdirSync(out, { recursive: true });
  const fm: PieceFrontmatter = { id, client: "acme", date: "2026-05-08", status: "draft", type: "reel", pillar: "education", platforms: ["instagram", "tiktok", "linkedin", "x"], locale: "en" };
  writeFileSync(join(ws, "pieces", `${id}.md`), serializePiece(fm, "brief"));
  const watcher = join(ws, "data", "gate", `${id}.json`);
  mkdirSync(join(ws, "data", "gate"), { recursive: true });
  writeFileSync(watcher, JSON.stringify({ piece_id: id, tag: "MEASURED", passed: true, checked: [], checked_at: new Date().toISOString() }));
  writeFileSync(join(out, "compliance.json"), JSON.stringify({ pass: true, violations: [] }));
  writeFileSync(join(out, "qa-tech-specs.json"), JSON.stringify({ pass: true, assets: [] }));
  writeFileSync(join(out, "captions.json"), JSON.stringify({ instagram: "a", tiktok: "b", linkedin: "c", x: "d" }));
  writeFileSync(join(out, "evidence.png"), "evidence");
  appendHbp(join(ws, "data", "runs.hbp"), { piece_id: id, status: "success" });
  writeFileSync(join(ws, "data", "llm-usage.jsonl"), JSON.stringify({ piece_id: id, ok: true }));
  writeHbiAtomic(join(out, "manifest.hbi"), { schema: "marketing-manifest/v1", generated_at: new Date().toISOString(), piece_id: id, client: "acme", date: "2026-05-08", providers: {}, prompts: {}, cost_estimate_usd: 0, compliance_report_path: join(out, "compliance.json"), qa_report_path: join(out, "qa-tech-specs.json"), watcher_report_path: watcher, outputs: [join(out, "evidence.png")], release_identity: releaseIdentity() });
  return { root, id, out };
}

test("evidence gate passes only with the complete artifact set", () => {
  const f = fixture();
  expect(gateEvidence(f.root, f.id)).toMatchObject({ piece_id: f.id, pass: true, missing: [] });
});

for (const [file, label] of [["manifest.hbi", "manifest.hbi"], ["compliance.json", "compliance.json"], ["qa-tech-specs.json", "qa-tech-specs.json"], ["captions.json", "captions.json"]] as const) {
  test(`missing ${file} is named by the gate`, () => {
    const f = fixture();
    rmSync(join(f.out, file));
    expect(gateEvidence(f.root, f.id).missing.some((m) => m.includes(label))).toBe(true);
  });
}

test("missing watcher report is named by the gate", () => {
  const f = fixture();
  rmSync(join(f.root, ".marketing-engine", "data", "gate", `${f.id}.json`));
  expect(gateEvidence(f.root, f.id).missing).toContain("watcher_report_path");
});

test("missing run logs are named by the gate", () => {
  const f = fixture();
  rmSync(join(f.root, ".marketing-engine", "data", "runs.hbp"));
  rmSync(join(f.root, ".marketing-engine", "data", "llm-usage.jsonl"));
  expect(gateEvidence(f.root, f.id).missing).toEqual(
    expect.arrayContaining(["data/runs.hbp", "data/llm-usage.jsonl"]),
  );
});

test("watcher json alone is not treated as a completion artifact", () => {
  const f = fixture();
  rmSync(join(f.out, "evidence.png"));
  const result = gateEvidence(f.root, f.id);
  expect(result.pass).toBe(false);
  expect(result.missing).toContain("evidence artifact (Playwright/watcher)");
});

test("evidence gate CLI prints JSON and exits non-zero on missing evidence", () => {
  const f = fixture();
  rmSync(join(f.out, "evidence.png"));
  const result = spawnSync(
    process.execPath,
    [CLI, "evidence", "gate", f.id, "--root", f.root],
    { encoding: "utf8" },
  );
  expect(result.status).toBe(3);
  const parsed = JSON.parse(result.stdout);
  expect(parsed).toMatchObject({
    piece_id: f.id,
    pass: false,
  });
  expect(parsed.missing).toContain("evidence artifact (Playwright/watcher)");
});

test("generate loop ignores completion claim when evidence gate fails", async () => {
  process.env.DRY_RUN = "true";
  const host = mkdtempSync(join(tmpdir(), "me-evidence-block-"));
  const workspaceRoot = join(host, ".marketing-engine");
  const piecesDir = join(workspaceRoot, "pieces");
  mkdirSync(piecesDir, { recursive: true });
  mkdirSync(join(workspaceRoot, "data"), { recursive: true });

  const fm: PieceFrontmatter = {
    id: "PIECE-evidence-block-001",
    client: "acme",
    date: "2026-05-08",
    status: "draft",
    type: "reel",
    pillar: "education",
    platforms: ["instagram", "tiktok"],
    locale: "en",
  };
  writeFileSync(
    join(piecesDir, `${fm.id}.md`),
    serializePiece(fm, "# Brief\n\nLaunch our new product.\n"),
  );

  const prevCwd = process.cwd();
  process.chdir(host);
  try {
    const summary = await runGenerateLoop({
      root: host,
      evidenceGate: () => ({
        piece_id: fm.id,
        pass: false,
        missing: ["evidence artifact (Playwright/watcher)"],
        evidence_paths: [],
      }),
    });
    expect(summary.blocked).toBeGreaterThanOrEqual(1);
    expect(summary.advanced).toBe(0);
    const updated = readFileSync(join(piecesDir, `${fm.id}.md`), "utf8");
    expect(updated).toMatch(/status: draft/);
    expect(updated).toMatch(/watcher_report_path:/);
  } finally {
    process.chdir(prevCwd);
  }
});
