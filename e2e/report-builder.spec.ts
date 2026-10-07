import { test, expect } from "@playwright/test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildReport, EvidenceRequiredError } from "../lib/report/builder";
import { appendHbp, writeHbiAtomic } from "../lib/formats/binary";
import { releaseIdentity } from "../lib/release-train/receipt";

test("require-evidence fails closed with exit code 3", () => {
  const root = mkdtempSync(join(tmpdir(), "me-report-empty-"));
  mkdirSync(join(root, ".marketing-engine", "pieces"), { recursive: true });
  writeFileSync(join(root, ".marketing-engine", "pieces", "empty.md"), "---\nid: empty\nclient: acme\ndate: 2026-05-08\nstatus: draft\ntype: reel\npillar: education\nplatforms: [instagram]\nlocale: en\n---\nbrief");
  expect(() => buildReport(root, "empty", { requireEvidence: true })).toThrow(EvidenceRequiredError);
  try { buildReport(root, "empty", { requireEvidence: true }); } catch (error) { expect((error as EvidenceRequiredError).exitCode).toBe(3); }
});

test("report mechanically exposes the claims-gate block", () => {
  const root = mkdtempSync(join(tmpdir(), "me-report-unverified-"));
  const ws = join(root, ".marketing-engine");
  mkdirSync(join(ws, "pieces"), { recursive: true });
  writeFileSync(join(ws, "pieces", "p.md"), "---\nid: p\nclient: acme\ndate: 2026-05-08\nstatus: draft\ntype: reel\npillar: education\nplatforms: [instagram]\nlocale: en\n---\nbrief");
  const out = join(ws, "outputs", "acme", "2026-05-08", "p");
  mkdirSync(out, { recursive: true });
  const watcher = join(ws, "data", "gate.json");
  mkdirSync(join(ws, "data"), { recursive: true });
  writeFileSync(watcher, JSON.stringify({ tag: "UNVERIFIED" }));
  writeHbiAtomic(join(out, "manifest.hbi"), { schema: "marketing-manifest/v1", piece_id: "p", client: "acme", date: "2026-05-08", providers: {}, prompts: {}, cost_estimate_usd: 0, compliance_report_path: "x", watcher_report_path: watcher, outputs: [], release_identity: releaseIdentity() });
  expect(buildReport(root, "p")).toContain("CLAIMS GATE BLOCK");
});

test("report includes every checklist item, embedded evidence, journal summary, and PR template", () => {
  const root = mkdtempSync(join(tmpdir(), "me-report-complete-"));
  const ws = join(root, ".marketing-engine");
  const out = join(ws, "outputs", "acme", "2026-05-08", "p2");
  const watcher = join(ws, "data", "gate.json");
  mkdirSync(join(ws, "pieces"), { recursive: true });
  mkdirSync(join(ws, "data"), { recursive: true });
  mkdirSync(join(root, ".github"), { recursive: true });
  mkdirSync(out, { recursive: true });
  writeFileSync(join(root, ".github", "PULL_REQUEST_TEMPLATE.md"), "## Summary\n\n## Changes");
  writeFileSync(join(ws, "pieces", "p2.md"), "---\nid: p2\nclient: acme\ndate: 2026-05-08\nstatus: draft\ntype: reel\npillar: education\nplatforms: [instagram]\nlocale: en\n---\nbrief");
  appendHbp(join(ws, "data", "runs.hbp"), { piece_id: "p2", status: "success" });
  writeFileSync(join(ws, "data", "llm-usage.jsonl"), "{\"kind\":\"llm\"}\n");
  writeFileSync(watcher, JSON.stringify({ tag: "MEASURED", passed: true }));
  writeFileSync(join(out, "compliance.json"), JSON.stringify({ pass: true }));
  writeFileSync(join(out, "qa-tech-specs.json"), JSON.stringify({ pass: true }));
  writeFileSync(join(out, "captions.json"), JSON.stringify({ instagram: "ig", tiktok: "tt", linkedin: "li", x: "xx" }));
  writeFileSync(join(out, "evidence.png"), "img");
  writeFileSync(join(out, "journal.jsonl"), `${JSON.stringify({ action: "generate", gate: "pass", hypothesis: "complete" })}\n`);
  writeHbiAtomic(join(out, "manifest.hbi"), {
    schema: "marketing-manifest/v1",
    generated_at: new Date().toISOString(),
    piece_id: "p2",
    client: "acme",
    date: "2026-05-08",
    providers: { llm: "claude" },
    prompts: {},
    cost_estimate_usd: 1.25,
    compliance_report_path: join(out, "compliance.json"),
    qa_report_path: join(out, "qa-tech-specs.json"),
    watcher_report_path: watcher,
    outputs: [join(out, "evidence.png")],
    release_identity: releaseIdentity(),
  });
  const report = buildReport(root, "p2", { requireEvidence: true });
  for (const item of ["manifest.hbi", "compliance.pass=true", "qa-tech-specs.pass=true", "4-platform captions", "watcher evidence", "run logs", "embedded evidence artifact"]) {
    expect(report).toContain(item);
  }
  expect(report).toContain(join(out, "evidence.png"));
  expect(report).toContain("attempt 1: action=generate gate=pass hypothesis=complete");
  expect(report).toContain("## Summary");
});

