import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build, cliCommands, drift, layout, loadFlow } from "../../scripts/flow.mjs";

const FLOW = resolve("docs/flow/simplicio-loop-marketing.flow.json");

test("the flow names only files and commands that exist, and leaves no command of the CLI out", () => {
  const flow = loadFlow(FLOW);
  assert.deepEqual(drift(flow), []);
  const commands = cliCommands();
  assert.ok(commands.length >= 30, `only ${commands.length} commands were read from the help`);
  const drawn = new Set(flow.nodes.flatMap((n: { commands?: string[] }) => n.commands ?? []));
  for (const c of commands) assert.ok(drawn.has(c), `${c} is not drawn`);
});

test("drift is reported: a file that is gone, a command that is not there, a command left out, a node with no link", () => {
  const flow = loadFlow(FLOW);
  const mutated = JSON.parse(JSON.stringify(flow));
  mutated.nodes[0].files = ["lib/does-not-exist.ts"];
  mutated.nodes[1].commands = ["not-a-command"];
  mutated.nodes.find((n: { id: string }) => n.id === "st.report").commands = [];
  mutated.nodes.push({ id: "st.orphan", kind: "step", label: "Sozinho", files: ["lib/router.ts"] });
  const problems = drift(mutated);
  assert.ok(problems.some((p: string) => p.includes("lib/does-not-exist.ts does not exist")));
  assert.ok(problems.some((p: string) => p.includes("not-a-command is not a marketing-engine command")));
  assert.ok(problems.some((p: string) => p.includes("command report is not in the flow")));
  assert.ok(problems.some((p: string) => p.includes("st.orphan: not connected")));
});

test("the generated files are byte for byte the same on every run and are the committed ones", () => {
  const flow = loadFlow(FLOW);
  const a = build(flow);
  const b = build(loadFlow(FLOW));
  assert.deepEqual(a, b);
  assert.equal(readFileSync(resolve("docs/flow/simplicio-loop-marketing.mmd"), "utf8"), a.mmd);
  assert.equal(readFileSync(resolve("docs/flow/simplicio-loop-marketing.svg"), "utf8"), a.svg);
  assert.equal(readFileSync(resolve("docs/flow/langflow/simplicio-loop-marketing.langflow.json"), "utf8"), a.langflow);
  const check = spawnSync(process.execPath, [resolve("scripts/flow.mjs"), "--check"], { encoding: "utf8" });
  assert.equal(check.status, 0, check.stderr);
  assert.match(check.stdout, /up to date/);
});

test("the drawing has every node and edge, inputs on the left and outputs on the right, and no box on another", () => {
  const flow = loadFlow(FLOW);
  const { svg, mmd, langflow } = build(flow);
  for (const n of flow.nodes) {
    assert.ok(mmd.includes(`["${n.label}"]`), `${n.id} is not in the Mermaid`);
    assert.ok(svg.includes(n.label.split(" ")[0]), `${n.id} is not in the SVG`);
  }
  assert.equal((mmd.match(/ --> | -\.-> /g) ?? []).length, flow.edges.length);
  assert.equal((svg.match(/<path d="M[0-9.]+ [0-9.]+ C/g) ?? []).length, flow.edges.length);
  assert.equal(JSON.parse(langflow).data.nodes.length, flow.nodes.length, "one note per node");
  const { pos } = layout(flow);
  const x = (id: string) => pos.get(id).x;
  for (const n of flow.nodes.filter((k: { kind: string }) => k.kind === "input")) assert.equal(x(n.id), x("in.cli"));
  const outputsX = Math.max(...flow.nodes.map((n: { id: string }) => x(n.id)));
  for (const n of flow.nodes.filter((k: { kind: string }) => k.kind === "output" || k.kind === "effect")) assert.equal(x(n.id), outputsX);
  const boxes = [...pos.values()] as Array<{ x: number; y: number }>;
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert.ok(boxes[i]!.x !== boxes[j]!.x || Math.abs(boxes[i]!.y - boxes[j]!.y) >= 62, "two boxes overlap");
});

test("the PNG is there and has the size of the drawing", () => {
  const png = resolve("docs/flow/simplicio-loop-marketing.png");
  assert.ok(existsSync(png));
  const buf = readFileSync(png);
  assert.equal(buf.subarray(1, 4).toString(), "PNG");
  const m = /width="(\d+)" height="(\d+)"/.exec(build(loadFlow(FLOW)).svg) as RegExpExecArray;
  assert.deepEqual([buf.readUInt32BE(16), buf.readUInt32BE(20)], [Number(m[1]), Number(m[2])]);
});
