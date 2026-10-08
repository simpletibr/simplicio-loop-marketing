import { test, expect } from "@playwright/test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromiumLaunchOptions } from "./support/browser";

test.use({ launchOptions: chromiumLaunchOptions() });

const CLI = resolve("bin/marketing-engine.mjs");
const START = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const MONTH = START.slice(0, 7);

function run(root: string, args: string[]) {
  const r = spawnSync(process.execPath, [CLI, ...args, "--root", root], { encoding: "utf8", env: { ...process.env, DRY_RUN: "true" }, maxBuffer: 16 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function host(): string {
  const root = mkdtempSync(join(tmpdir(), "me-dashcli-"));
  mkdirSync(join(root, ".marketing-engine", "pieces"), { recursive: true });
  mkdirSync(join(root, ".marketing-engine", "data"), { recursive: true });
  return root;
}

interface Running {
  child: ChildProcess;
  url: string;
  port: number;
  token: string;
  exited: Promise<number | null>;
}

async function start(root: string, extra: string[] = []): Promise<Running> {
  const child = spawn(process.execPath, [CLI, "dashboard", "--port", "0", "--no-browser", "--json", "--root", root, ...extra], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, DRY_RUN: "true" } });
  const exited = new Promise<number | null>((done) => child.on("exit", (code) => done(code)));
  const line = await new Promise<string>((done, fail) => {
    let buf = "";
    child.stdout!.on("data", (d: Buffer) => {
      buf += d.toString();
      const nl = buf.indexOf("\n");
      if (nl !== -1) done(buf.slice(0, nl));
    });
    child.on("exit", () => fail(new Error(`dashboard exited early: ${buf}`)));
    setTimeout(() => fail(new Error("dashboard did not start")), 20_000);
  });
  const info = JSON.parse(line) as { url: string; port: number; token: string };
  return { child, ...info, exited };
}

const api = (r: Running, path: string) => fetch(`http://127.0.0.1:${r.port}${path}`, { headers: { authorization: `Bearer ${r.token}` } });

test("dashboard CLI: start, status, status line, second start, stop, stale state", async () => {
  test.setTimeout(60_000);
  const root = host();
  const d = await start(root, ["--client", "lothus", "--campaign", "lothus-plan", "--present"]);
  try {
    expect(d.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?token=[a-f0-9]+#client=lothus&campaign=lothus-plan&present=1$/);
    expect((await api(d, "/api/health")).status).toBe(200);

    const status = run(root, ["dashboard", "--status", "--json"]);
    expect(status.status).toBe(0);
    expect(JSON.parse(status.stdout)).toMatchObject({ running: true, port: d.port, url: `http://127.0.0.1:${d.port}` });
    expect(status.stdout).not.toContain(d.token);
    expect(run(root, ["dashboard", "--status"]).stdout).toContain(`http://127.0.0.1:${d.port}`);

    mkdirSync(join(root, ".marketing-engine", "pieces"), { recursive: true });
    const line = run(root, ["status"]);
    expect(line.stdout).toContain("== Dashboard ==");
    expect(line.stdout).toContain(`http://127.0.0.1:${d.port}`);

    const again = JSON.parse(run(root, ["dashboard", "--json", "--no-browser"]).stdout);
    expect(again).toMatchObject({ already_running: true, port: d.port });

    const stop = run(root, ["dashboard", "--stop", "--json"]);
    expect(JSON.parse(stop.stdout)).toMatchObject({ stopped: true });
    expect(await d.exited).toBe(0);
    const after = run(root, ["dashboard", "--status", "--json"]);
    expect(after.status).toBe(1);
    expect(JSON.parse(after.stdout)).toEqual({ running: false });
    expect(JSON.parse(run(root, ["dashboard", "--stop", "--json"]).stdout)).toMatchObject({ stopped: false });
    expect(run(root, ["dashboard", "--stop"]).stdout).toContain("not running");
    expect(run(root, ["status"]).stdout).not.toContain("== Dashboard ==");
  } finally {
    d.child.kill("SIGKILL");
  }
});

test("dashboard CLI: bad flags fail clearly", () => {
  const root = host();
  const port = run(root, ["dashboard", "--port", "99999"]);
  expect(port.status).toBe(1);
  expect(port.stderr).toContain("--port must be 0-65535");
  const snap = run(root, ["dashboard", "--snapshot", "x.html"]);
  expect(snap.status).toBe(2);
  expect(snap.stderr).toContain("--snapshot <out.html> needs --client");
  const month = run(root, ["dashboard", "--snapshot", "x.html", "--client", "lothus", "--month", "2026-13"]);
  expect(month.status).toBe(1);
  expect(month.stderr).toContain("--month must be YYYY-MM");
});

test("a new line in the events log reaches an SSE client in under 500 ms (p95) through the CLI-started server", async () => {
  test.setTimeout(90_000);
  const root = host();
  const d = await start(root);
  const waiters = new Map<string, (t: number) => void>();
  const controller = new AbortController();
  try {
    const res = await fetch(`http://127.0.0.1:${d.port}/api/events?token=${d.token}`, { signal: controller.signal });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    void (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return;
          const arrived = performance.now();
          buffer += decoder.decode(value, { stream: true });
          for (;;) {
            const end = buffer.indexOf("\n\n");
            if (end === -1) break;
            const frame = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const piece = /"piece_id":"([^"]+)"/.exec(frame)?.[1];
            if (piece) waiters.get(piece)?.(arrived);
          }
        }
      } catch {
        /* aborted */
      }
    })();
    await new Promise((r) => setTimeout(r, 300));
    const log = join(root, ".simplicio", "events.jsonl");
    mkdirSync(join(root, ".simplicio"), { recursive: true });
    const samples: number[] = [];
    for (let i = 0; i < 25; i++) {
      const id = `PIECE-sse-${i}`;
      const seen = new Promise<number>((done) => waiters.set(id, done));
      appendFileSync(log, `${JSON.stringify({ schema: "marketing-event/v1", ts: new Date().toISOString(), run_id: "r", kind: "piece_start", level: "info", piece_id: id, client: "acme", phase: "generate" })}\n`);
      const t0 = performance.now();
      const t1 = await Promise.race([seen, new Promise<number>((done) => setTimeout(() => done(Infinity), 3000))]);
      samples.push(t1 - t0);
      await new Promise((r) => setTimeout(r, 30 + (i % 5) * 40));
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.ceil(samples.length * 0.95) - 1] as number;
    test.info().annotations.push({ type: "sse-latency-ms", description: `p50=${samples[Math.floor(samples.length / 2)]?.toFixed(0)} p95=${p95.toFixed(0)} max=${samples.at(-1)?.toFixed(0)}` });
    expect(Number.isFinite(p95)).toBe(true);
    expect(p95).toBeLessThan(500);
  } finally {
    controller.abort();
    run(root, ["dashboard", "--stop"]);
    d.child.kill("SIGKILL");
  }
});

test("snapshot: a client-safe month page that opens offline, labels simulations and hides internals", async ({ page, context }) => {
  test.setTimeout(120_000);
  const root = host();
  expect(run(root, ["profile", "https://lothus.com.br", "--client", "lothus"]).status).toBe(0);
  expect(run(root, ["profile", "https://outro-cliente.com.br", "--client", "outro-cliente"]).status).toBe(0);
  const planned = JSON.parse(run(root, ["campaign", "--client", "lothus", "--days", "14", "--start", START, "--per-week", "2", "--networks", "tiktok,ig_reels"]).stdout);
  expect(planned.slots).toBeGreaterThanOrEqual(4);
  JSON.parse(run(root, ["campaign", "render", "--client", "lothus"]).stdout);
  JSON.parse(run(root, ["campaign", "approvals", "--client", "lothus"]).stdout);
  const requests = JSON.parse(run(root, ["approval", "list", "--client", "lothus"]).stdout) as Array<{ piece_id: string; media_sha256: string }>;
  for (const [i, r] of requests.entries()) {
    if (i === requests.length - 1) continue; // one stays in approval
    expect(run(root, ["approval", "record", "--client", "lothus", "--piece", r.piece_id, "--media-sha256", r.media_sha256, "--decision", "approved", "--by", "client:Ana"]).status).toBe(0);
  }
  JSON.parse(run(root, ["campaign", "schedule", "--client", "lothus"]).stdout);
  const live = requests[0]!.piece_id;
  appendFileSync(join(root, ".marketing-engine", "data", "analytics-snapshots.jsonl"), `${JSON.stringify({ piece_id: live, channel_id: "tiktok", metric: "views", value: 4321, polled_at: new Date().toISOString() })}\n`);

  const out = join(root, "snapshots", "lothus.html");
  const made = run(root, ["dashboard", "--snapshot", "snapshots/lothus.html", "--client", "lothus", "--month", MONTH]);
  expect(made.status, made.stderr).toBe(0);
  expect(JSON.parse(made.stdout)).toMatchObject({ simulated: true });
  const html = readFileSync(out, "utf8");

  for (const internal of [/cost/i, /usd/i, /credit/i, /token/i, /sha256/i, /approved_by/i, /decided_by/i, /publisher/i, /dry_run/i, /outro-cliente/i, /Outro Cliente/i, /<script/i, /llm/i]) {
    expect(html, String(internal)).not.toMatch(internal);
  }
  expect(html).toContain("Rascunho: parte destas datas é uma simulação");
  expect(html).toContain("agendado (simulação)");
  expect(html).toContain("Lothus");

  // offline: only the file itself may load
  const blocked: string[] = [];
  await context.route("**/*", (route) => {
    if (route.request().url().startsWith("file://")) return route.continue();
    blocked.push(route.request().url());
    return route.abort();
  });
  await page.goto(`file://${out}`);
  await expect(page.locator("h1")).toContainText("Lothus");
  const rows = page.locator("tbody tr");
  expect(await rows.count()).toBeGreaterThanOrEqual(4);
  await expect(page.locator("tbody")).toContainText("sem dado");
  await expect(page.locator("tbody")).toContainText("4321");
  await expect(page.locator("tbody")).toContainText("publicado");
  await expect(page.locator("tbody")).toContainText("em aprovação");
  expect(blocked).toEqual([]);

  const present = run(root, ["dashboard", "--snapshot", "snapshots/present.html", "--client", "lothus", "--month", MONTH, "--present"]);
  expect(present.status).toBe(0);
  const masked = readFileSync(join(root, "snapshots", "present.html"), "utf8");
  expect(masked).toContain("— Cliente");
  expect(masked).not.toContain("Lothus");

  const empty = run(root, ["dashboard", "--snapshot", "snapshots/empty.html", "--client", "outro-cliente", "--month", MONTH]);
  expect(JSON.parse(empty.stdout).posts).toBe(0);
  expect(readFileSync(join(root, "snapshots", "empty.html"), "utf8")).toContain("Nenhum post planejado");
  expect(existsSync(out)).toBe(true);
  writeFileSync(join(root, "x"), "");
});
