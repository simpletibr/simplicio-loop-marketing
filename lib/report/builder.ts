import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gateEvidence, type EvidenceGateResult } from "../gate/evidence";
import { readHbi } from "../formats/binary";

export interface ReportOptions { requireEvidence?: boolean; }
export class EvidenceRequiredError extends Error { exitCode = 3; }
function load(path: string): Record<string, unknown> { try { return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>; } catch { return {}; } }
function engineRoot(root: string): string { const nested = resolve(root, ".marketing-engine"); return existsSync(nested) ? nested : root; }
function loadHbi(path: string): Record<string, unknown> { try { return readHbi<Record<string, unknown>>(path); } catch { return {}; } }
function loadText(path: string): string { try { return readFileSync(path, "utf8"); } catch { return ""; } }

interface ChecklistItem {
  label: string;
  missing: string[];
}

const CHECKLIST: ChecklistItem[] = [
  { label: "manifest.hbi", missing: ["manifest.hbi"] },
  { label: "compliance.pass=true", missing: ["compliance.pass=true"] },
  { label: "qa-tech-specs.pass=true", missing: ["qa-tech-specs.json", "qa-tech-specs.pass=true"] },
  { label: "4-platform captions", missing: ["captions.json", "captions.instagram", "captions.tiktok", "captions.linkedin", "captions.x"] },
  { label: "watcher evidence", missing: ["watcher_report_path", "watcher_report.passed=true"] },
  { label: "run logs", missing: ["data/runs.hbp", "data/llm-usage.jsonl"] },
  { label: "embedded evidence artifact", missing: ["evidence artifact (Playwright/watcher)"] },
];

function pieceMeta(piece: string): { client?: string; date?: string } {
  const client = piece.match(/(?:^|\n)client:\s*(\S+)/)?.[1];
  const date = piece.match(/(?:^|\n)date:\s*(\S+)/)?.[1];
  return { client, date };
}

function checklistLines(gate: EvidenceGateResult): string[] {
  return CHECKLIST.map(({ label, missing }) => {
    const failed = missing.some((needle) => gate.missing.some((item) => item.startsWith(needle)));
    return `- [${failed ? " " : "x"}] ${label}`;
  });
}

function journalSummary(rows: string[]): string[] {
  const parsed = rows.slice(0, 5).map((row) => {
    try { return JSON.parse(row) as Record<string, unknown>; } catch { return null; }
  }).filter(Boolean) as Record<string, unknown>[];
  if (parsed.length === 0) return ["- attempts: 0"];
  return [
    `- attempts: ${rows.length}`,
    ...parsed.map((entry, index) => `- attempt ${index + 1}: action=${String(entry.action ?? "unknown")} gate=${String(entry.gate ?? "unknown")} hypothesis=${String(entry.hypothesis ?? "n/a")}`),
  ];
}

function manifestOutputLines(manifest: Record<string, unknown>): string[] {
  const outputs = Array.isArray(manifest.outputs) ? manifest.outputs.filter((value): value is string => typeof value === "string" && value.length > 0) : [];
  return outputs.length ? outputs.map((path) => `- ${path}`) : ["- none"];
}

function withPrTemplate(root: string, body: string): string {
  const templatePath = resolve(root, ".github", "PULL_REQUEST_TEMPLATE.md");
  const template = loadText(templatePath).trim();
  return template ? `${template}\n\n---\n\n${body}` : body;
}

export function buildReport(root: string, pieceId: string, opts: ReportOptions = {}): string {
  const base = engineRoot(root);
  const gate: EvidenceGateResult = gateEvidence(root, pieceId);
  const piece = loadText(resolve(base, "pieces", `${pieceId}.md`));
  const meta = pieceMeta(piece);
  const checklist = checklistLines(gate);
  if (opts.requireEvidence && (gate.evidence_paths.length === 0 || checklist.length === 0)) {
    throw new EvidenceRequiredError(`blocked: no checklist/evidence for ${pieceId}`);
  }
  const manifestPath = meta.client && meta.date ? resolve(base, "outputs", meta.client, meta.date.slice(0, 10), pieceId, "manifest.hbi") : "";
  const manifest = manifestPath ? loadHbi(manifestPath) : {};
  const claims: { tag?: string } = manifest.watcher_report_path ? load(String(manifest.watcher_report_path)) as { tag?: string } : {};
  const journalPath = manifestPath ? join(resolve(manifestPath, ".."), "journal.jsonl") : "";
  const journalRows = journalPath && existsSync(journalPath) ? readFileSync(journalPath, "utf8").split("\n").filter(Boolean) : [];
  const lines = [
    `# Evidence report: ${pieceId}`,
    "",
    `Verdict: **${gate.pass ? "PASS" : "BLOCKED"}**`,
    `Claims tag: **${claims.tag ?? "UNVERIFIED"}**`,
    "",
    "## Acceptance criteria",
    ...checklist,
    "",
    "## Evidence",
    ...(gate.evidence_paths.length ? gate.evidence_paths.map((p) => `- ${p}`) : ["- none"]),
    "",
    "## Output embeds",
    ...manifestOutputLines(manifest),
    "",
    "## Providers and cost",
    `- providers: ${JSON.stringify(manifest.providers ?? {})}`,
    `- cost_estimate_usd: ${String(manifest.cost_estimate_usd ?? "unknown")}`,
    "",
    "## Journal",
    ...journalSummary(journalRows),
  ];
  if (claims && claims.tag === "UNVERIFIED") lines.push("", "## CLAIMS GATE BLOCK", "This piece is **UNVERIFIED** and must not be promoted.");
  if (gate.missing.length) lines.push("", "## Missing", ...gate.missing.map((m) => `- ${m}`));
  return `${withPrTemplate(root, lines.join("\n"))}\n`;
}
