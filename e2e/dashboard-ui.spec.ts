import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromiumLaunchOptions } from "./support/browser";
import { prepareHost, run, startDashboard, type PreparedHost, type Running } from "./support/dashboard-host";

test.use({ launchOptions: chromiumLaunchOptions(), viewport: { width: 1360, height: 900 } });

let host: PreparedHost;
let dash: Running;

test.beforeAll(async () => {
  test.setTimeout(180_000);
  host = prepareHost("lothus");
  dash = await startDashboard(host.root);
});

test.afterAll(() => dash?.stop());

/** Opens the panel the way the printed URL does: the token is traded for a cookie, the hash selects the view. */
const open = (page: import("@playwright/test").Page, hash = ""): Promise<unknown> => page.goto(`http://127.0.0.1:${dash.port}/?token=${dash.token}${hash}`);

const shots = process.env.DASHBOARD_SCREENSHOTS === "1";
async function shot(page: import("@playwright/test").Page, name: string, fullPage = true): Promise<void> {
  if (!shots) return;
  const dir = resolve("docs/evidence/dashboard");
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage });
}

test("cockpit shows KPIs, the river, the live feed and the client grid", async ({ page }) => {
  await open(page);
  await expect(page).toHaveTitle(/Cockpit/);
  await expect(page.getByRole("heading", { name: "Cockpit", level: 1 })).toBeVisible();
  await expect(page.locator(".kpi")).toHaveCount(11);
  await expect(page.locator(".kpi", { hasText: "Peças no funil" })).toBeVisible();
  await expect(page.locator("svg.river title")).toHaveText("Rio do pipeline");
  await expect(page.locator(".feed li").first()).toBeVisible();
  await expect(page.locator("#conn")).toHaveAttribute("status", "live");
  await expect(page.locator("#clients-h")).toBeVisible();
  await expect(page.locator("article", { hasText: "Lothus" }).first()).toBeVisible();
  const funnel = await page.locator(".kpi", { hasText: "Peças no funil" }).locator(".value").textContent();
  expect(Number(funnel?.replace(/\D/g, ""))).toBeGreaterThan(0);
  await shot(page, "cockpit-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "cockpit-dark");
});

test("the feed updates live when something happens", async ({ page }) => {
  await open(page);
  await expect(page.locator("#conn")).toHaveAttribute("status", "live");
  const before = await page.locator(".feed li").count();
  const pending = host.pieces.at(-1)!;
  expect(run(host.root, ["approval", "record", "--client", host.client, "--piece", pending.piece_id, "--media-sha256", pending.media_sha256, "--decision", "changes_requested", "--note", "mais curto", "--by", "client:Ana"]).status).toBe(0);
  await expect(page.locator(".feed")).toContainText("ajuste pedido", { timeout: 8000 });
  expect(await page.locator(".feed li").count()).toBeGreaterThanOrEqual(Math.min(before, 30));
});

test("pipeline board has every column, opens a piece with its preview and filters by network", async ({ page }) => {
  await open(page, "#/pipeline");
  await expect(page.getByRole("heading", { name: "Pipeline", level: 1 })).toBeVisible();
  await expect(page.locator(".col")).toHaveCount(11);
  for (const name of ["Coleta", "Roteiro", "Voz", "Prévia", "QA", "Compliance", "Aprovação", "Render final", "Agendado", "Publicado", "Métricas"]) {
    await expect(page.locator(".col h2 span").filter({ hasText: new RegExp(`^${name}$`) }).first()).toBeVisible();
  }
  const total = await page.locator("button.piece").count();
  expect(total).toBe(host.pieces.length);
  await shot(page, "pipeline-light");
  await page.locator('[role="region"][aria-label^="Quadro"]').evaluate((el: { scrollLeft: number; scrollWidth: number }) => {
    el.scrollLeft = el.scrollWidth;
  });
  await shot(page, "pipeline-light-right", false);

  await page.locator("button.piece").first().click();
  await expect(page.locator("#drawer")).toBeVisible();
  await expect(page.locator("#drawer video")).toBeVisible();
  await expect(page.locator("#drawer-body")).toContainText("Histórico de eventos");
  await expect(page.locator("#drawer-body")).toContainText("Aprovações");
  await shot(page, "piece-drawer");
  await page.keyboard.press("Escape");
  await expect(page.locator("#drawer")).toBeHidden();

  await page.locator('select[name="network"]').selectOption("tiktok");
  await expect(page).toHaveURL(/network=tiktok/);
  await expect.poll(() => page.locator("button.piece").count()).toBeLessThan(total);
  expect(await page.locator("button.piece").count()).toBeGreaterThan(0);
  await expect(page.locator("button.piece .meta").filter({ hasText: "Reels" })).toHaveCount(0);
});

test("calendar: month grid, keyboard navigation, time zones and the list view", async ({ page }) => {
  const month = host.start.slice(0, 7);
  await open(page, `#/calendar?month=${month}`);
  await expect(page.getByRole("heading", { name: "Calendário", level: 1 })).toBeVisible();
  // the month grid is the kit's <sl-calendar>: a date grid whose cells are the days, with one list item per post
  const withPosts = page.locator("sl-calendar td:has(li)");
  expect(await withPosts.count()).toBeGreaterThan(0);
  await expect(page.locator("sl-calendar li").first()).toBeVisible();
  await expect(page.locator("ul.muted").first()).toContainText("30 dias");
  await shot(page, "calendar-light");

  const days = page.locator("sl-calendar td[data-date]:not([data-out])");
  await days.first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(days.nth(1)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(days.nth(8)).toBeFocused();

  await withPosts.first().focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#drawer")).toBeVisible();
  await expect(page.locator("#drawer-body")).toContainText("BRT");
  await page.keyboard.press("Escape");

  const before = await page.locator("sl-calendar li").first().textContent();
  await page.getByLabel("Fuso").selectOption("Asia/Singapore");
  await expect(page).toHaveURL(/zone=Asia/);
  await expect.poll(async () => page.locator("sl-calendar li").first().textContent()).not.toBe(before);

  await page.getByLabel("Visão").selectOption("list");
  await expect(page.locator("table tbody tr").first()).toBeVisible();
  await expect(page.locator("table")).toContainText("agendado");
});

test("presentation mode hides client names everywhere on screen", async ({ page }) => {
  await open(page);
  await expect(page.locator("body")).toContainText("Lothus");
  await page.getByRole("button", { name: "Apresentação" }).click();
  await expect(page.getByRole("button", { name: "Apresentação" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("main")).not.toContainText("Lothus");
  await expect(page.locator("main")).not.toContainText("lothus");
  await expect(page.locator("main")).toContainText("Cliente");
  await open(page, "#/pipeline?present=1");
  await expect(page.locator("main")).not.toContainText(/lothus/i);
});

test("the command palette finds sections, clients and pieces from the keyboard", async ({ page }) => {
  await open(page);
  await page.keyboard.press("Control+K");
  await expect(page.locator("#palette")).toBeVisible();
  await page.locator("#palette-input").fill("calend");
  await expect(page.locator("#palette-results li").first()).toContainText("Calendário");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Calendário", level: 1 })).toBeVisible();
});

test("an invalid session shows how to recover instead of a blank page", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${dash.port}/`);
  await expect(page.getByRole("alert")).toContainText("Sessão inválida");
  await context.close();
});
