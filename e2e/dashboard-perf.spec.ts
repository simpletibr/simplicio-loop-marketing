import { test, expect, type Page } from "@playwright/test";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromiumLaunchOptions } from "./support/browser";
import { prepareHost, startDashboard, type PreparedHost, type Running } from "./support/dashboard-host";

/**
 * Performance of the panel (issue #185), measured in a real browser against the server the CLI starts:
 * the largest contentful paint of every section stays under 1.5 s, and a long session that keeps refreshing does not grow the page
 * (DOM nodes, event listeners and the JS heap come back to where they started).
 */
test.use({ launchOptions: chromiumLaunchOptions(), viewport: { width: 1360, height: 900 } });

const VIEWS = ["cockpit", "pipeline", "calendar", "status", "quality", "credits", "funnel", "performance", "approvals", "alerts"] as const;
const LCP_BUDGET_MS = 1500;

let host: PreparedHost;
let dash: Running;

test.beforeAll(async () => {
  test.setTimeout(300_000);
  // 30 days on three networks every day: about 90 pieces rendered, approved and scheduled
  host = prepareHost("lothus", { days: 30, perWeek: 7 });
  dash = await startDashboard(host.root);
});

test.afterAll(() => dash?.stop());

const open = (page: Page, hash: string): Promise<unknown> => page.goto(`http://127.0.0.1:${dash.port}/?token=${dash.token}${hash}`);

test("the largest contentful paint of every section is under 1.5 s", async ({ browser }) => {
  const results: Record<string, number> = {};
  for (const view of VIEWS) {
    const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    const page = await context.newPage();
    await page.addInitScript(() => {
      const w = globalThis as unknown as { __lcp: number };
      w.__lcp = 0;
      const Observer = (globalThis as unknown as { PerformanceObserver: new (cb: (list: { getEntries(): Array<{ startTime: number }> }) => void) => { observe(init: unknown): void } }).PerformanceObserver;
      new Observer((list) => { for (const entry of list.getEntries()) w.__lcp = entry.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
    });
    await open(page, `#/${view}`);
    await expect(page.locator("main h1")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(600);
    results[view] = Math.round(await page.evaluate(() => (globalThis as unknown as { __lcp: number }).__lcp));
    await context.close();
  }
  const line = Object.entries(results).map(([k, v]) => `${k} ${v} ms`).join(", ");
  test.info().annotations.push({ type: "lcp", description: line });
  process.stdout.write(`LCP: ${line}\n`);
  for (const [view, ms] of Object.entries(results)) {
    expect(ms, `${view} LCP`).toBeGreaterThan(0);
    expect(ms, `${view} LCP ${ms} ms against ${LCP_BUDGET_MS} ms`).toBeLessThan(LCP_BUDGET_MS);
  }
});

test("a session that keeps refreshing does not grow the page: nodes, listeners and heap return to where they started", async ({ page }) => {
  test.setTimeout(120_000);
  await open(page, "#/cockpit");
  await expect(page.locator("#conn")).toHaveAttribute("data-state", "open");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const measure = async (): Promise<{ nodes: number; listeners: number; heapMb: number }> => {
    await cdp.send("HeapProfiler.collectGarbage");
    const counters = (await cdp.send("Memory.getDOMCounters")) as { nodes: number; jsEventListeners: number };
    const metrics = (await cdp.send("Performance.getMetrics")) as { metrics: Array<{ name: string; value: number }> };
    return { nodes: counters.nodes, listeners: counters.jsEventListeners, heapMb: (metrics.metrics.find((m) => m.name === "JSHeapUsedSize")?.value ?? 0) / 1_048_576 };
  };
  await page.waitForTimeout(1500);
  const before = await measure();
  const file = join(host.root, ".marketing-engine", "data", "credits.jsonl");
  mkdirSync(join(host.root, ".marketing-engine", "data"), { recursive: true });
  const ROUNDS = 25;
  for (let i = 0; i < ROUNDS; i++) {
    appendFileSync(file, `${JSON.stringify({ ts: new Date().toISOString(), client: host.client, piece_id: host.pieces[i % host.pieces.length]!.piece_id, provider: "realoficial", credits: 1, purpose: "cortes", approved_by: "wesley" })}\n`);
    await page.waitForTimeout(900);
  }
  await page.waitForTimeout(2000);
  const after = await measure();
  const note = `nodes ${before.nodes} -> ${after.nodes}, listeners ${before.listeners} -> ${after.listeners}, heap ${before.heapMb.toFixed(1)} -> ${after.heapMb.toFixed(1)} MB over ${ROUNDS} live refreshes`;
  test.info().annotations.push({ type: "soak", description: note });
  process.stdout.write(`SOAK: ${note}\n`);
  expect(after.nodes, note).toBeLessThanOrEqual(before.nodes * 1.1 + 50);
  expect(after.listeners, note).toBeLessThanOrEqual(before.listeners + 30);
  expect(after.heapMb - before.heapMb, note).toBeLessThan(5);
});
