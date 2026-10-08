import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromiumLaunchOptions } from "./support/browser";
import { emptyHost, run, startDashboard, type Running } from "./support/dashboard-host";
import { loadPlan } from "../lib/plan/content-plan";

test.use({ launchOptions: chromiumLaunchOptions(), viewport: { width: 1360, height: 900 } });

let root: string;
let dash: Running;
let october: Array<{ piece_id: string; network: string }>;
let winnerIds: string[];

test.beforeAll(async () => {
  test.setTimeout(180_000);
  root = emptyHost();
  expect(run(root, ["profile", "https://lothus.com.br", "--client", "lothus"]).status).toBe(0);
  expect(run(root, ["campaign", "--client", "lothus", "--days", "30", "--start", "2026-10-01", "--per-week", "3"]).status).toBe(0);
  october = loadPlan(root, "lothus").slots.filter((s) => s.publish_at.startsWith("2026-10"));
  // 12 posts measured on views (one standout), the first four also on likes; read an hour ago
  const polled = new Date(Date.now() - 3_600_000).toISOString();
  const rows = october.slice(0, 12).flatMap((s, i) => [
    { piece_id: s.piece_id, network: s.network, metric: "views", value: i === 5 ? 48_000 : 200 + i * 25, polled_at: polled },
    ...(i < 4 ? [{ piece_id: s.piece_id, network: s.network, metric: "likes", value: 10 + i, polled_at: polled }] : []),
  ]);
  const file = join(root, "views.json");
  writeFileSync(file, JSON.stringify(rows));
  expect(run(root, ["metrics", "import", "--client", "lothus", "--file", file]).status).toBe(0);
  const marked = JSON.parse(run(root, ["metrics", "winners", "--client", "lothus", "--month", "2026-10"]).stdout);
  winnerIds = marked.winners.map((w: { piece_id: string }) => w.piece_id);
  expect(winnerIds).toHaveLength(3);
  expect(run(root, ["campaign", "--client", "lothus", "--days", "30", "--start", "2026-11-01", "--winners", "2026-10"]).status).toBe(0);
  dash = await startDashboard(root);
});

test.afterAll(() => dash?.stop());

const open = (page: Page, hash: string): Promise<unknown> => page.goto(`http://127.0.0.1:${dash.port}/?token=${dash.token}${hash}`);

const shots = process.env.DASHBOARD_SCREENSHOTS === "1";
async function shot(page: Page, name: string): Promise<void> {
  if (!shots) return;
  const dir = resolve("docs/evidence/dashboard");
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

test("performance ranks the posts, marks the winners and links them to next month's variations, with sem dado where a metric is missing", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (r) => { if (r.url().startsWith(`http://127.0.0.1:${dash.port}`)) requests.push(`${r.method()} ${new URL(r.url()).pathname}`); });
  await open(page, "#/performance");
  await expect(page.getByRole("heading", { name: "Desempenho e vencedores", level: 1 })).toBeVisible();
  await expect(page.locator("nav a[aria-current=page]")).toHaveText("Desempenho");
  const rows = page.locator('[aria-label="Ranking de posts"] tbody tr');
  await expect(rows).toHaveCount(12, { timeout: 10_000 });
  await expect(rows.first()).toContainText(october[5]!.piece_id);
  await expect(rows.first()).toContainText("48.000");
  await expect(rows.first()).toContainText("Vencedor");
  // a post that never reported likes says so instead of showing 0
  await expect(rows.last()).toContainText("sem dado");
  await expect(page.locator('[aria-label="Ranking de posts"] thead')).toContainText("Retenção");

  const cards = page.locator("[data-winner-piece]");
  await expect(cards).toHaveCount(3);
  const top = page.locator(`[data-winner-piece="${october[5]!.piece_id}"]`);
  await expect(top).toContainText("2026-10");
  await expect(top.locator("li").first()).toContainText("2026-11");
  await expect(top.locator("li").first()).toContainText("planejada");
  await expect(top.locator("li").first()).toContainText("visualizações: sem dado");
  expect(await top.locator("li").count()).toBeGreaterThan(0);

  await expect(page.locator('[aria-label="Comparação por formato"] tbody tr').first()).toBeVisible();
  await expect(page.locator('[aria-label="Comparação por gancho"] tbody tr').first()).toBeVisible();
  const chart = page.locator('svg.chart[role="img"]');
  await expect(chart).toHaveCount(1);
  await expect(chart).toHaveAttribute("aria-label", /Visualizações acumuladas de lothus/);
  expect(await chart.locator("circle").count(), "a single day of readings is still drawn").toBeGreaterThan(0);
  await shot(page, "performance-light");

  // read-only: the only controls are the metric buttons and the piece links; every request was a read
  await expect(page.locator("main form, main input[type=submit]")).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText(/publicar agora|reagendar|gastar/i);
  await page.waitForTimeout(500);
  expect(requests.filter((r) => !r.startsWith("GET "))).toEqual([]);
});

test("the metric buttons re-rank the posts and a metric nobody reported has no ranking", async ({ page }) => {
  await open(page, "#/performance");
  await expect(page.locator('[aria-label="Ranking de posts"] tbody tr').first()).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Curtidas" }).click();
  await expect(page.getByRole("heading", { name: "Ranking por curtidas" })).toBeVisible();
  const rows = page.locator('[aria-label="Ranking de posts"] tbody tr');
  await expect(rows.first().locator("td").first()).toHaveText("1");
  await expect(rows.nth(3).locator("td").first()).toHaveText("4");
  await expect(rows.nth(4).locator("td").first()).toHaveText("—");
  await page.getByRole("button", { name: "Salvamentos" }).click();
  await expect(page.getByRole("heading", { name: "Ranking por salvamentos" })).toBeVisible();
  await expect(page.locator('[aria-label="Ranking de posts"] tbody tr td:first-child').first()).toHaveText("—");
  await expect(page.locator('[aria-label="Comparação por formato"] tbody tr').first()).toContainText("sem dado");
});
