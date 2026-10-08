import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { clearDashboardState, readDashboardState, writeDashboardState } from "../dashboard/state";
import { startDashboard } from "../dashboard/server";
import { buildSnapshot } from "../dashboard/snapshot";
import { buildViews } from "../dashboard/routes";

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

const has = (argv: string[], name: string): boolean => argv.includes(name);

function out(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function openBrowser(url: string): void {
  const [cmd, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try {
    const child = spawn(cmd as string, args as string[], { stdio: "ignore", detached: true });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    /* no browser available: the URL is printed anyway */
  }
}

export function viewHash(argv: string[]): string {
  const parts = [["client", flag(argv, "--client")], ["campaign", flag(argv, "--campaign")], ["present", has(argv, "--present") ? "1" : undefined]].filter(([, v]) => v);
  return parts.length ? `#${parts.map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`).join("&")}` : "";
}

export async function cliEntry(argv: string[]): Promise<void> {
  const root = process.env.MARKETING_ENGINE_HOST_ROOT ?? process.cwd();

  if (has(argv, "--snapshot")) {
    const file = flag(argv, "--snapshot");
    const client = flag(argv, "--client");
    const month = flag(argv, "--month");
    if (!file || !client || !month) {
      process.stderr.write("dashboard: --snapshot <out.html> needs --client <slug> and --month YYYY-MM\n");
      process.exitCode = 2;
      return;
    }
    const { html, posts, simulated } = buildSnapshot(root, { client, month, presentation: has(argv, "--present") });
    const target = resolve(root, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, html);
    out({ file: target, posts, simulated, note: "sending it to the client is a manual step" });
    return;
  }

  if (has(argv, "--status")) {
    const state = readDashboardState(root);
    const report = state ? { running: true, pid: state.pid, port: state.port, url: `http://127.0.0.1:${state.port}`, started_at: state.started_at } : { running: false };
    if (has(argv, "--json")) out(report);
    else process.stdout.write(state ? `dashboard running: ${report.running && "url" in report ? report.url : ""} (pid ${state.pid})\n` : "dashboard not running\n");
    process.exitCode = state ? 0 : 1;
    return;
  }

  if (has(argv, "--stop")) {
    const state = readDashboardState(root);
    if (!state) {
      if (has(argv, "--json")) out({ stopped: false, reason: "not running" });
      else process.stdout.write("dashboard not running\n");
      return;
    }
    process.kill(state.pid, "SIGTERM");
    for (let i = 0; i < 30 && readDashboardState(root); i++) await new Promise((r) => setTimeout(r, 100));
    if (has(argv, "--json")) out({ stopped: true, pid: state.pid });
    else process.stdout.write(`dashboard stopped (pid ${state.pid})\n`);
    return;
  }

  const running = readDashboardState(root);
  if (running) {
    const url = `http://127.0.0.1:${running.port}/?token=${running.token}${viewHash(argv)}`;
    if (has(argv, "--json")) out({ url, port: running.port, pid: running.pid, already_running: true });
    else process.stdout.write(`${url}\n`);
    return;
  }

  const port = flag(argv, "--port") === undefined ? 8787 : Number(flag(argv, "--port"));
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("dashboard: --port must be 0-65535");
  const server = await startDashboard({ root, port, views: buildViews() });
  writeDashboardState(root, { pid: process.pid, port: server.port, started_at: new Date().toISOString(), token: server.token });
  const url = `${server.url}/?token=${server.token}${viewHash(argv)}`;
  if (has(argv, "--json")) out({ url, port: server.port, pid: process.pid, token: server.token });
  else process.stdout.write(`${url}\n`);
  process.stderr.write(`dashboard: read-only, local only (${server.url}). Stop it with \`marketing-engine dashboard --stop\`.\n`);
  if (!has(argv, "--no-browser")) openBrowser(url);

  const shutdown = (): void => {
    clearDashboardState(root);
    void server.close().then(() => process.exit(0));
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`.replace(/^file:\/\/\/\//, "file:///")) {
  cliEntry(process.argv.slice(2)).catch((err) => {
    process.stderr.write(`dashboard failed: ${String(err)}\n`);
    process.exitCode = 1;
  });
}
