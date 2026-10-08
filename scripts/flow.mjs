#!/usr/bin/env node
/**
 * flow.mjs — draws the whole flow of the project (input -> steps -> outputs).
 *
 * The only hand-kept file is docs/flow/simplicio-loop-marketing.flow.json
 * (`simplicio.flow/v1`: every node names the files and commands it comes from).
 * Everything else is derived from it, byte for byte the same on every run:
 *
 *   docs/flow/simplicio-loop-marketing.mmd                       Mermaid
 *   docs/flow/simplicio-loop-marketing.svg                       drawing (own layered layout, no dependency)
 *   docs/flow/simplicio-loop-marketing.png                       the drawing rasterised in the browser the repo already uses
 *   docs/flow/langflow/simplicio-loop-marketing.langflow.json    notes flow for Langflow
 *
 *   node scripts/flow.mjs            regenerate
 *   node scripts/flow.mjs --check    fail when a file is stale or the flow names a file or command that does not exist
 *
 * A missing PNG renderer is a stated block (exit 3), never a silent fallback.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "docs", "flow");
const NAME = "simplicio-loop-marketing";
const SOURCE = join(DIR, `${NAME}.flow.json`);
const OUT = { mmd: join(DIR, `${NAME}.mmd`), svg: join(DIR, `${NAME}.svg`), png: join(DIR, `${NAME}.png`), langflow: join(DIR, "langflow", `${NAME}.langflow.json`) };

export function loadFlow(path = SOURCE) {
  const flow = JSON.parse(readFileSync(path, "utf8"));
  if (flow.schema !== "simplicio.flow/v1") throw new Error(`flow: unexpected schema ${flow.schema}`);
  const ids = new Set(flow.nodes.map((n) => n.id));
  if (ids.size !== flow.nodes.length) throw new Error("flow: duplicate node id");
  for (const e of flow.edges) if (!ids.has(e.from) || !ids.has(e.to)) throw new Error(`flow: edge ${e.from} -> ${e.to} names an unknown node`);
  return flow;
}

/** The commands the CLI itself lists, so the flow cannot leave one out. */
export function cliCommands() {
  const r = spawnSync(process.execPath, [join(ROOT, "bin", "marketing-engine.mjs"), "help"], { encoding: "utf8" });
  const block = r.stdout.split("Commands:\n")[1]?.split("\nOptions:")[0] ?? "";
  return block.split("\n").map((l) => /^ {2}([a-z][a-z-]*) /.exec(l)?.[1]).filter((c) => c && c !== "help");
}

/** Problems that make the flow disagree with the code: a file that is gone, a command the CLI does not have or does not draw. */
export function drift(flow) {
  const problems = [];
  const commands = new Set(cliCommands());
  for (const n of flow.nodes) {
    if (!n.files?.length) problems.push(`${n.id}: no source file`);
    for (const f of n.files ?? []) if (!existsSync(join(ROOT, f))) problems.push(`${n.id}: file ${f} does not exist`);
    for (const c of n.commands ?? []) if (!commands.has(c)) problems.push(`${n.id}: command ${c} is not a marketing-engine command`);
  }
  const drawn = new Set(flow.nodes.flatMap((n) => n.commands ?? []));
  for (const c of commands) if (!drawn.has(c)) problems.push(`command ${c} is not in the flow`);
  const touched = new Set(flow.edges.flatMap((e) => [e.from, e.to]));
  for (const n of flow.nodes) if (!touched.has(n.id)) problems.push(`${n.id}: not connected`);
  if (!flow.nodes.some((n) => n.kind === "input") || !flow.nodes.some((n) => n.kind === "output" || n.kind === "effect")) problems.push("the flow has no input or no output");
  return problems;
}

// --- layout: columns by the longest path from the inputs, outputs in the last column ----------------------------------

const BOX = { w: 232, h: 62, gapX: 96, gapY: 18, pad: 28, head: 54 };
const KIND = { input: { fill: "#e3ecff", stroke: "#0a52e0", tag: "entrada" }, step: { fill: "#f1f3f6", stroke: "#4b5563", tag: "passo" }, output: { fill: "#e3f5ea", stroke: "#14663a", tag: "saída" }, effect: { fill: "#fff1d6", stroke: "#8a4b00", tag: "efeito externo" } };

export function layout(flow) {
  const forward = flow.edges.filter((e) => !e.feedback);
  const layer = new Map(flow.nodes.map((n) => [n.id, 0]));
  for (let i = 0; i < flow.nodes.length; i++) {
    let moved = false;
    for (const e of forward) if (layer.get(e.to) < layer.get(e.from) + 1) { layer.set(e.to, layer.get(e.from) + 1); moved = true; }
    if (!moved) break;
  }
  const last = Math.max(...flow.nodes.filter((n) => n.kind !== "output" && n.kind !== "effect").map((n) => layer.get(n.id))) + 1;
  for (const n of flow.nodes) if (n.kind === "output" || n.kind === "effect") layer.set(n.id, Math.max(last, layer.get(n.id)));
  for (const n of flow.nodes) if (n.kind === "input") layer.set(n.id, 0);
  const columns = [];
  for (const n of flow.nodes) (columns[layer.get(n.id)] ??= []).push(n);
  const row = new Map();
  columns.forEach((col, ci) => {
    if (!col) return;
    const score = (n) => { const preds = forward.filter((e) => e.to === n.id).map((e) => row.get(e.from)).filter((v) => v !== undefined); return preds.length ? preds.reduce((a, b) => a + b, 0) / preds.length : flow.nodes.indexOf(n); };
    col.sort((a, b) => score(a) - score(b) || a.id.localeCompare(b.id));
    col.forEach((n, i) => row.set(n.id, i));
    void ci;
  });
  const pos = new Map();
  columns.forEach((col, ci) => col?.forEach((n, i) => pos.set(n.id, { x: BOX.pad + ci * (BOX.w + BOX.gapX), y: BOX.pad + BOX.head + i * (BOX.h + BOX.gapY) })));
  const width = BOX.pad * 2 + columns.length * BOX.w + (columns.length - 1) * BOX.gapX;
  const height = BOX.pad * 2 + BOX.head + Math.max(...columns.map((c) => c?.length ?? 0)) * (BOX.h + BOX.gapY);
  return { pos, width, height, columns: columns.length };
}

const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function wrap(text, max) {
  const lines = [];
  let cur = "";
  for (const w of text.split(" ")) {
    if ((cur + " " + w).trim().length > max && cur) { lines.push(cur); cur = w; } else cur = (cur + " " + w).trim();
  }
  if (cur) lines.push(cur);
  return lines;
}

export function toSvg(flow) {
  const { pos, width, height } = layout(flow);
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="t d" font-family="DejaVu Sans, Verdana, sans-serif">`);
  out.push(`<title id="t">${esc(flow.title)}</title>`);
  out.push(`<desc id="d">${flow.nodes.length} nós e ${flow.edges.length} ligações, gerados de docs/flow/${NAME}.flow.json</desc>`);
  out.push(`<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#4b5563"/></marker></defs>`);
  out.push(`<rect width="${width}" height="${height}" fill="#ffffff"/>`);
  out.push(`<text x="${BOX.pad}" y="${BOX.pad + 14}" font-size="18" font-weight="700" fill="#111827">${esc(flow.title)}</text>`);
  out.push(`<text x="${BOX.pad}" y="${BOX.pad + 34}" font-size="12" fill="#4b5563">azul: entrada · cinza: passo · verde: saída · laranja: efeito externo · tracejado: realimentação</text>`);
  for (const e of flow.edges) {
    const a = pos.get(e.from), b = pos.get(e.to);
    const back = b.x <= a.x;
    const x1 = back ? a.x : a.x + BOX.w, y1 = a.y + BOX.h / 2, x2 = back ? b.x + BOX.w : b.x, y2 = b.y + BOX.h / 2;
    const dx = Math.max(40, Math.abs(x2 - x1) / 2);
    const c1 = back ? x1 - dx : x1 + dx, c2 = back ? x2 + dx : x2 - dx;
    out.push(`<path d="M${x1} ${y1} C${c1} ${y1} ${c2} ${y2} ${x2} ${y2}" fill="none" stroke="#4b5563" stroke-width="1.4"${e.feedback ? ' stroke-dasharray="6 4"' : ""} marker-end="url(#a)" opacity="0.8"/>`);
  }
  for (const n of flow.nodes) {
    const p = pos.get(n.id), k = KIND[n.kind];
    out.push(`<g><rect x="${p.x}" y="${p.y}" width="${BOX.w}" height="${BOX.h}" rx="9" fill="${k.fill}" stroke="${k.stroke}" stroke-width="1.5"/>`);
    out.push(`<text x="${p.x + 10}" y="${p.y + 15}" font-size="10" font-weight="700" fill="${k.stroke}">${esc(k.tag.toUpperCase())}</text>`);
    wrap(n.label, 33).slice(0, 3).forEach((line, i) => out.push(`<text x="${p.x + 10}" y="${p.y + 31 + i * 14}" font-size="11.5" fill="#111827">${esc(line)}</text>`));
    out.push("</g>");
  }
  out.push("</svg>");
  return out.join("\n") + "\n";
}

const mid = (id) => id.replace(/[^A-Za-z0-9]/g, "_");

export function toMermaid(flow) {
  const lines = ["%% generated by scripts/flow.mjs from docs/flow/simplicio-loop-marketing.flow.json; do not edit", "flowchart LR"];
  const groups = [["Entradas", (n) => n.kind === "input"], ["Passos", (n) => n.kind === "step"], ["Saídas", (n) => n.kind === "output" || n.kind === "effect"]];
  for (const [title, pick] of groups) {
    lines.push(`  subgraph ${title}`);
    for (const n of flow.nodes.filter(pick)) lines.push(`    ${mid(n.id)}["${n.label.replace(/"/g, "'")}"]`);
    lines.push("  end");
  }
  for (const e of flow.edges) lines.push(`  ${mid(e.from)} ${e.feedback ? "-.->" : "-->"} ${mid(e.to)}`);
  for (const n of flow.nodes) lines.push(`  class ${mid(n.id)} ${n.kind}`);
  lines.push("  classDef input fill:#e3ecff,stroke:#0a52e0", "  classDef step fill:#f1f3f6,stroke:#4b5563", "  classDef output fill:#e3f5ea,stroke:#14663a", "  classDef effect fill:#fff1d6,stroke:#8a4b00");
  return lines.join("\n") + "\n";
}

/** One sticky note per node (inputs, steps and outputs with their sources and what comes next), laid out like the drawing. */
export function toLangflow(flow) {
  const { pos } = layout(flow);
  const by = new Map(flow.nodes.map((n) => [n.id, n]));
  const idOf = (id) => `note-${createHash("sha256").update(id).digest("hex").slice(0, 8)}`;
  const nodes = flow.nodes.map((n) => {
    const next = flow.edges.filter((e) => e.from === n.id).map((e) => by.get(e.to).label);
    const text = [`${KIND[n.kind].tag.toUpperCase()}: ${n.label}`, `Fonte: ${n.files.join(", ")}`, ...(n.commands?.length ? [`Comandos: ${n.commands.map((c) => `marketing-engine ${c}`).join(", ")}`] : []), ...(next.length ? [`Segue para: ${next.join("; ")}`] : [])].join("\n");
    const p = pos.get(n.id);
    return { id: idOf(n.id), type: "noteNode", position: { x: p.x * 1.3, y: p.y * 2.2 }, width: 300, height: 190, selected: false, data: { id: idOf(n.id), type: "note", node: { description: text, display_name: "", documentation: "", template: { backgroundColor: n.kind === "input" ? "blue" : n.kind === "output" ? "emerald" : n.kind === "effect" ? "amber" : "neutral" } } } };
  });
  return JSON.stringify({ name: flow.project, description: flow.title, is_component: false, endpoint_name: null, tags: ["simplicio.flow/v1"], icon: null, data: { nodes, edges: [], viewport: { x: 0, y: 0, zoom: 0.5 } } }, null, 2) + "\n";
}

function sizeOfPng(buf) { return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }; }

async function renderPng(svgPath, pngPath, width, height) {
  let chromium;
  try { ({ chromium } = await import("playwright")); } catch { return "playwright is not installed"; }
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.MARKETING_ENGINE_CHROMIUM || undefined });
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.goto(`file://${svgPath}`);
    writeFileSync(pngPath, await page.screenshot({ type: "png", omitBackground: false }));
    return null;
  } catch (error) {
    return String(error.message ?? error).split("\n")[0];
  } finally {
    await browser?.close();
  }
}

export function build(flow) {
  return { mmd: toMermaid(flow), svg: toSvg(flow), langflow: toLangflow(flow) };
}

async function main() {
  const check = process.argv.includes("--check");
  const flow = loadFlow();
  const problems = drift(flow);
  const built = build(flow);
  if (check) {
    for (const key of ["mmd", "svg", "langflow"]) {
      if (!existsSync(OUT[key]) || readFileSync(OUT[key], "utf8") !== built[key]) problems.push(`${OUT[key].replace(`${ROOT}/`, "")} is stale: run node scripts/flow.mjs`);
    }
    if (!existsSync(OUT.png)) problems.push(`${OUT.png.replace(`${ROOT}/`, "")} is missing`);
    else {
      const size = sizeOfPng(readFileSync(OUT.png));
      const m = /width="(\d+)" height="(\d+)"/.exec(built.svg);
      if (size.w !== Number(m[1]) || size.h !== Number(m[2])) problems.push("the PNG does not match the size of the drawing: run node scripts/flow.mjs");
    }
    if (problems.length) { process.stderr.write(`flow: ${problems.length} problem(s)\n${problems.map((p) => `  - ${p}`).join("\n")}\n`); process.exit(1); }
    process.stdout.write(`flow: up to date (${flow.nodes.length} nodes, ${flow.edges.length} edges)\n`);
    return;
  }
  if (problems.length) { process.stderr.write(`flow: the flow disagrees with the code\n${problems.map((p) => `  - ${p}`).join("\n")}\n`); process.exit(1); }
  mkdirSync(dirname(OUT.langflow), { recursive: true });
  writeFileSync(OUT.mmd, built.mmd);
  writeFileSync(OUT.svg, built.svg);
  writeFileSync(OUT.langflow, built.langflow);
  const m = /width="(\d+)" height="(\d+)"/.exec(built.svg);
  const blocked = await renderPng(OUT.svg, OUT.png, Number(m[1]), Number(m[2]));
  if (blocked) { process.stderr.write(`flow: BLOCKED: the PNG was not produced (${blocked}). The Mermaid, SVG and Langflow files were written.\n`); process.exit(3); }
  process.stdout.write(`flow: wrote ${Object.values(OUT).map((p) => p.replace(`${ROOT}/`, "")).join(", ")}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
