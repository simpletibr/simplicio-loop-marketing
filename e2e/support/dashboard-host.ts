import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect } from "@playwright/test";

/**
 * Drives the real CLI only (no library imports), so the specs that use it
 * exercise exactly what an operator runs and add no module to the coverage
 * merge twice.
 */
export const CLI = resolve("bin/marketing-engine.mjs");

export function run(root: string, args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args, "--root", root], { encoding: "utf8", env: { ...process.env, DRY_RUN: "true", ...env }, maxBuffer: 32 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

export function emptyHost(): string {
  const root = mkdtempSync(join(tmpdir(), "me-dashui-"));
  mkdirSync(join(root, ".marketing-engine", "pieces"), { recursive: true });
  mkdirSync(join(root, ".marketing-engine", "data"), { recursive: true });
  return root;
}

export const tomorrow = (): string => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

export interface PreparedHost {
  root: string;
  client: string;
  planId: string;
  start: string;
  pieces: Array<{ request_id: string; piece_id: string; media_sha256: string; status: string }>;
}

/** profile -> 14 day plan -> batch render -> approval requests -> approve all but one -> schedule (dry-run). */
export function prepareHost(client = "lothus", opts: { days?: number; perWeek?: number } = {}): PreparedHost {
  const root = emptyHost();
  const start = tomorrow();
  expect(run(root, ["profile", `https://${client}.com.br`, "--client", client]).status).toBe(0);
  const plan = JSON.parse(run(root, ["campaign", "--client", client, "--days", String(opts.days ?? 14), "--start", start, "--per-week", String(opts.perWeek ?? 2), "--networks", "tiktok,ig_reels"]).stdout);
  JSON.parse(run(root, ["campaign", "render", "--client", client]).stdout);
  JSON.parse(run(root, ["campaign", "approvals", "--client", client]).stdout);
  const pieces = JSON.parse(run(root, ["approval", "list", "--client", client]).stdout) as PreparedHost["pieces"];
  pieces.forEach((p, i) => {
    if (i === pieces.length - 1) return;
    expect(run(root, ["approval", "record", "--client", client, "--piece", p.piece_id, "--media-sha256", p.media_sha256, "--decision", "approved", "--by", "client:Ana"]).status).toBe(0);
  });
  JSON.parse(run(root, ["campaign", "schedule", "--client", client]).stdout);
  return { root, client, planId: plan.plan_id, start, pieces };
}

export interface Running {
  child: ChildProcess;
  url: string;
  port: number;
  token: string;
  stop(): void;
}

export async function startDashboard(root: string, extra: string[] = []): Promise<Running> {
  const child = spawn(process.execPath, [CLI, "dashboard", "--port", "0", "--no-browser", "--json", "--root", root, ...extra], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, DRY_RUN: "true" } });
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
  return {
    child,
    ...info,
    stop() {
      run(root, ["dashboard", "--stop"]);
      child.kill("SIGKILL");
    },
  };
}
