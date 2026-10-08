import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadPlan } from "../lib/plan/content-plan";

const CLI = resolve("bin/marketing-engine.mjs");

function run(root: string, args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args, "--root", root], { encoding: "utf8", env: { ...process.env, DRY_RUN: "true", ...env }, maxBuffer: 16 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function host(): string {
  const root = mkdtempSync(join(tmpdir(), "me-metrics-e2e-"));
  mkdirSync(join(root, ".marketing-engine", "data"), { recursive: true });
  expect(run(root, ["profile", "https://lothus.com.br", "--client", "lothus"]).status).toBe(0);
  return root;
}

test("month 1 numbers pick the winners and the month 2 plan carries more variations of them", async () => {
  test.setTimeout(120_000);
  const root = host();
  const m1 = run(root, ["campaign", "--client", "lothus", "--days", "30", "--start", "2026-10-01", "--per-week", "3"]);
  expect(m1.status, m1.stderr).toBe(0);
  expect(JSON.parse(m1.stdout).variations_of_winners).toBe(0);
  const october = loadPlan(root, "lothus").slots.filter((s) => s.publish_at.startsWith("2026-10"));
  expect(october.length).toBeGreaterThan(10);

  // No numbers yet: nothing is marked and the next plan refuses to pretend otherwise.
  const none = JSON.parse(run(root, ["metrics", "winners", "--client", "lothus", "--month", "2026-10"]).stdout);
  expect(none.winners).toEqual([]);
  const refused = run(root, ["campaign", "--client", "lothus", "--days", "30", "--start", "2026-11-01", "--winners", "2026-10"]);
  expect(refused.status).not.toBe(0);
  expect(refused.stderr).toContain("no winners recorded");

  const rows = october.slice(0, 12).map((s, i) => ({ piece_id: s.piece_id, network: s.network, metric: "views", value: i === 5 ? 48_000 : 200 + i * 25, polled_at: "2026-10-31T00:00:00Z" }));
  const file = join(root, "views.json");
  writeFileSync(file, JSON.stringify(rows));
  expect(JSON.parse(run(root, ["metrics", "import", "--client", "lothus", "--file", file]).stdout).imported).toBe(12);

  const marked = JSON.parse(run(root, ["metrics", "winners", "--client", "lothus", "--month", "2026-10"]).stdout);
  expect(marked.winners[0]).toMatchObject({ piece_id: october[5]!.piece_id, views: 48_000 });
  expect(marked.winners).toHaveLength(3);

  const m2 = run(root, ["campaign", "--client", "lothus", "--days", "30", "--start", "2026-11-01", "--winners", "2026-10"]);
  expect(m2.status, m2.stderr).toBe(0);
  const summary = JSON.parse(m2.stdout);
  expect(summary.variations_of_winners).toBeGreaterThan(JSON.parse(m1.stdout).variations_of_winners);
  const plan2 = loadPlan(root, "lothus", "lothus-2026-11-01-30d");
  const winnerIds = new Set(marked.winners.map((w: { piece_id: string }) => w.piece_id));
  const variants = plan2.slots.filter((s) => s.variant_of);
  expect(variants.length).toBe(summary.variations_of_winners);
  expect(variants.every((s) => winnerIds.has(s.variant_of!))).toBe(true);
  expect(variants.some((s) => s.variant_of === october[5]!.piece_id)).toBe(true);
});

test("the monthly report is built without invented numbers, in markdown and PDF", async () => {
  const root = host();
  expect(run(root, ["campaign", "--client", "lothus", "--days", "30", "--start", "2026-10-01", "--per-week", "3"]).status).toBe(0);
  const october = loadPlan(root, "lothus").slots.filter((s) => s.publish_at.startsWith("2026-10"));
  const file = join(root, "views.json");
  writeFileSync(file, JSON.stringify([{ piece_id: october[0]!.piece_id, network: october[0]!.network, metric: "views", value: 1500 }, { piece_id: october[1]!.piece_id, network: october[1]!.network, metric: "likes", value: 40 }]));
  expect(run(root, ["metrics", "import", "--client", "lothus", "--file", file]).status).toBe(0);

  const built = run(root, ["metrics", "report", "--client", "lothus", "--month", "2026-10", "--pdf"]);
  expect(built.status, built.stderr).toBe(0);
  const out = JSON.parse(built.stdout);
  expect(out.measured).toBe(1);
  const md = readFileSync(out.markdown, "utf8");
  expect(md).toContain("Visualizações: 1.500 (soma de 1 de 2 posts com dado)");
  expect(md).toContain("Compartilhamentos: sem dado");
  expect(md).toContain("sem dado: são necessários pelo menos 3 posts");
  expect(existsSync(out.pdf)).toBe(true);
  expect(readFileSync(out.pdf).subarray(0, 8).toString("latin1")).toBe("%PDF-1.4");

  const dryCollect = JSON.parse(run(root, ["metrics", "collect", "--client", "lothus"]).stdout);
  expect(dryCollect).toMatchObject({ dry_run: true, snapshots: 0 });
  expect(run(root, ["metrics", "import", "--client", "lothus", "--file", file.replace("views", "missing")]).status).not.toBe(0);
  expect(run(root, ["metrics", "winners", "--client", "lothus"]).status).not.toBe(0);
  expect(run(root, ["metrics"]).status).toBe(2);
});
