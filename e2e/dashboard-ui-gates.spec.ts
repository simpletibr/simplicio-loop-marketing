import { test, expect } from "@playwright/test";
import { appendFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromiumLaunchOptions } from "./support/browser";
import { prepareHost, startDashboard, type PreparedHost, type Running } from "./support/dashboard-host";

test.use({ launchOptions: chromiumLaunchOptions(), viewport: { width: 1360, height: 900 } });

let host: PreparedHost;
let dash: Running;

test.beforeAll(async () => {
  test.setTimeout(180_000);
  host = prepareHost("lothus");
  dash = await startDashboard(host.root);
});

test.afterAll(() => dash?.stop());

const open = (page: import("@playwright/test").Page, hash: string): Promise<unknown> => page.goto(`http://127.0.0.1:${dash.port}/?token=${dash.token}${hash}`);

const shots = process.env.DASHBOARD_SCREENSHOTS === "1";
async function shot(page: import("@playwright/test").Page, name: string): Promise<void> {
  if (!shots) return;
  const dir = resolve("docs/evidence/dashboard");
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

/** Resolves true when the page receives its next live event (the panel re-dispatches each SSE frame as `marketing-event`). */
const nextLiveEvent = (page: import("@playwright/test").Page): Promise<boolean> =>
  page.evaluate(
    () =>
      new Promise<boolean>((done) => {
        const w = globalThis as unknown as { addEventListener(type: string, fn: () => void, opts: { once: boolean }): void };
        w.addEventListener("marketing-event", () => done(true), { once: true });
        setTimeout(() => done(false), 10_000);
      }),
  );

test("status shows the client by network matrix, the publisher health and the receipts, and opens a receipt", async ({ page }) => {
  await open(page, "#/status");
  await expect(page.getByRole("heading", { name: "Status por rede", level: 1 })).toBeVisible();
  await expect(page.locator("nav a[aria-current=page]")).toHaveText("Status por rede");
  const matrix = page.locator('[role="region"][aria-label="Matriz cliente por rede"] tbody tr');
  await expect(matrix).toHaveCount(3);
  await expect(page.locator("#health-h")).toBeVisible();
  await expect(page.locator("#health-h").locator("xpath=..")).toContainText("Sessão sem dado");
  await expect(page.locator("#cap-h").locator("xpath=..")).toContainText("Sem dado: a leitura da Real Oficial está desligada");
  const receipts = page.locator('[role="region"][aria-label="Recibos"] tbody tr');
  expect(await receipts.count()).toBeGreaterThan(0);
  await shot(page, "status-light");
  await receipts.first().locator("button").click();
  await expect(page.locator("#drawer")).toBeVisible();
  await expect(page.locator("#drawer-title")).toContainText("Recibo");
  await expect(page.locator("#drawer-body")).toContainText("Etapas");
  await expect(page.locator("#drawer-body")).toContainText("simulação");
  await page.keyboard.press("Escape");
  await expect(page.locator("#drawer")).toBeHidden();
});

test("quality lists the seal of every gate per piece and the first-try rates", async ({ page }) => {
  await open(page, "#/quality");
  await expect(page.getByRole("heading", { name: "Qualidade e compliance", level: 1 })).toBeVisible();
  await expect(page.locator(".kpi")).toHaveCount(3);
  await expect(page.locator("sl-donut")).toHaveCount(1);
  await expect(page.locator(".kpi", { hasText: "QA técnico: aprovadas de primeira" })).toBeVisible();
  const headers = page.locator('[aria-label="Selos por peça"] thead th');
  await expect(headers).toHaveText(["Peça", "QA técnico", "Compliance", "Watcher", "Licenças B-roll", "Aprovação", "Rótulo de IA", "Pode seguir?"]);
  const rows = page.locator('[aria-label="Selos por peça"] tbody tr');
  expect(await rows.count()).toBeGreaterThanOrEqual(host.pieces.length - 1);
  await expect(page.locator('[aria-label="Selos por peça"]')).toContainText("sem dado");
  await shot(page, "quality-light");
  await rows.first().locator("button").click();
  await expect(page.locator("#drawer")).toBeVisible();
  await expect(page.locator("#drawer-body")).toContainText("Histórico de eventos");
  await page.keyboard.press("Escape");
});

test("credits shows the approved spend and has no control that can spend, buy or render", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (r) => { if (r.url().startsWith(`http://127.0.0.1:${dash.port}`)) requests.push(`${r.method()} ${new URL(r.url()).pathname}`); });
  const row = { ts: new Date().toISOString(), client: host.client, piece_id: host.pieces[0]!.piece_id, provider: "realoficial", credits: 25, purpose: "cortes", approved_by: "wesley" };
  mkdirSync(join(host.root, ".marketing-engine", "data"), { recursive: true });
  appendFileSync(join(host.root, ".marketing-engine", "data", "credits.jsonl"), `${JSON.stringify(row)}\n`);

  await open(page, "#/credits");
  await expect(page.getByRole("heading", { name: "Créditos e custos", level: 1 })).toBeVisible();
  await expect(page.locator("#ro-h").locator("xpath=..")).toContainText("leitura da Real Oficial desligada");
  await expect(page.locator("#ro-h").locator("xpath=..")).toContainText("25 créditos", { timeout: 10_000 });
  await expect(page.locator("#ro-h").locator("xpath=..")).toContainText("cortes: 25 créditos");
  await expect(page.locator('[aria-label="Custo por cliente"]')).toContainText("wesley");
  await expect(page.getByText("estimativas")).toBeVisible();
  await expect(page.locator("#ue-h").locator("xpath=..")).toContainText("Custo variável por prévia");
  await shot(page, "credits-light");

  // Nothing on the page can spend: no buttons or forms inside the content, and every request was a read.
  await expect(page.locator("main button, main form, main input[type=submit]")).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText(/comprar|confirmar gasto|renderizar|dublar/i);
  await page.waitForTimeout(500);
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.filter((r) => !r.startsWith("GET "))).toEqual([]);
});

test("the three new sections are reachable by keyboard from the navigation", async ({ page }) => {
  await open(page, "#/cockpit");
  // the first render also hands the focus to the content; pressing Enter on a link before that moves it away
  await expect(page.locator("#main")).toBeFocused();
  for (const label of ["Status por rede", "Qualidade", "Créditos e custos"]) {
    const link = page.locator("nav a", { hasText: label });
    await expect(link).toBeVisible();
    await link.focus();
    await expect(link).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("nav a[aria-current=page]")).toHaveText(label);
    // the section has finished rendering when the content takes the focus; moving on earlier races that
    await expect(page.locator("#main")).toBeFocused();
    await expect(page.locator("main h1")).toBeVisible();
  }
});

test("a live update never takes the keyboard focus away from the navigation or the content", async ({ page }) => {
  await open(page, "#/cockpit");
  await expect(page.locator("#conn")).toHaveAttribute("status", "live");
  const link = page.locator("nav a", { hasText: "Qualidade" });
  await link.focus();
  await expect(link).toBeFocused();
  const arrived = nextLiveEvent(page);
  const row = { ts: new Date().toISOString(), client: host.client, piece_id: host.pieces[1]!.piece_id, provider: "realoficial", credits: 5, purpose: "dublagem", approved_by: "wesley" };
  appendFileSync(join(host.root, ".marketing-engine", "data", "credits.jsonl"), `${JSON.stringify(row)}\n`);
  expect(await arrived).toBe(true);
  await page.waitForTimeout(1500);
  await expect(link).toBeFocused();

  await link.press("Enter");
  await expect(page.locator("nav a[aria-current=page]")).toHaveText("Qualidade");
  const first = page.locator('[aria-label="Selos por peça"] tbody button').first();
  await first.focus();
  await expect(first).toBeFocused();
  const again = nextLiveEvent(page);
  appendFileSync(join(host.root, ".marketing-engine", "data", "credits.jsonl"), `${JSON.stringify({ ...row, credits: 6 })}\n`);
  expect(await again).toBe(true);
  await page.waitForTimeout(1500);
  await expect(first).toBeFocused();
});
