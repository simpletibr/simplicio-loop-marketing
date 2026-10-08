import { test, expect } from "@playwright/test";
import { get as httpGet } from "node:http";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDashboard } from "../lib/dashboard/server";
import { emitEvent } from "../lib/observability/events";

test("a new line in the events log reaches an SSE client in under 500 ms (p95), with the default poll", async () => {
  test.setTimeout(60_000);
  process.env.SIMPLICIO_DISABLE_RUN_LOG = "";
  const root = mkdtempSync(join(tmpdir(), "me-sse-e2e-"));
  mkdirSync(join(root, ".marketing-engine", "data"), { recursive: true });
  const server = await startDashboard({ root });
  const waiters = new Map<string, (t: number) => void>();
  const req = httpGet({ host: "127.0.0.1", port: server.port, path: `/api/events?token=${server.token}`, headers: { accept: "text/event-stream" } });
  const connected = new Promise<void>((done) => req.on("response", (res) => {
    let buffer = "";
    res.setEncoding("utf8");
    res.on("data", (chunk: string) => {
      const arrived = performance.now();
      buffer += chunk;
      for (;;) {
        const end = buffer.indexOf("\n\n");
        if (end === -1) break;
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const piece = /"piece_id":"([^"]+)"/.exec(frame)?.[1];
        if (piece) waiters.get(piece)?.(arrived);
      }
    });
    done();
  }));
  await connected;
  try {
    const samples: number[] = [];
    for (let i = 0; i < 25; i++) {
      const id = `PIECE-sse-${i}`;
      const seen = new Promise<number>((done) => waiters.set(id, done));
      emitEvent(root, { kind: "piece_start", piece_id: id, client: "acme", phase: "generate" });
      const t0 = performance.now();
      const t1 = await Promise.race([seen, new Promise<number>((done) => setTimeout(() => done(Infinity), 3000))]);
      samples.push(t1 - t0);
      await new Promise((r) => setTimeout(r, 30 + (i % 5) * 40)); // decorrelate from the poll phase
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.ceil(samples.length * 0.95) - 1] as number;
    test.info().annotations.push({ type: "sse-latency-ms", description: `p50=${samples[Math.floor(samples.length / 2)]?.toFixed(0)} p95=${p95.toFixed(0)} max=${samples.at(-1)?.toFixed(0)}` });
    expect(Number.isFinite(p95)).toBe(true);
    expect(p95).toBeLessThan(500);
  } finally {
    req.destroy();
    await server.close();
  }
});
