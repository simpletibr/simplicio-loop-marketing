import { test, expect, type Page } from "@playwright/test";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromiumLaunchOptions } from "./support/browser";
import { emptyHost, startDashboard, type Running } from "./support/dashboard-host";

test.use({ launchOptions: chromiumLaunchOptions(), viewport: { width: 1360, height: 900 } });

let root: string;
let dash: Running;
const data = (): string => join(root, ".marketing-engine", "data");
const secs = (daysAgo: number): number => Math.floor((Date.now() - daysAgo * 86_400_000) / 1000);

test.beforeAll(async () => {
  test.setTimeout(120_000);
  root = emptyHost();
  mkdirSync(join(data(), "prospects", "br-01"), { recursive: true });
  // the control spreadsheet export: 6 prospects in 3 countries
  writeFileSync(join(data(), "controle-prospects.csv"), [
    "slug,country,batch,status,updated_at",
    "br-01,BR,lote-1,respondeu,2026-09-01T10:00:00Z",
    "br-02,BR,lote-1,enviada,2026-09-01T10:00:00Z",
    "br-03,BR,lote-1,previa,2026-09-01T10:00:00Z",
    "br-04,BR,lote-1,coletado,2026-09-01T10:00:00Z",
    "ch-01,CH,lote-1,respondeu,2026-09-01T10:00:00Z",
    "us-01,US,lote-1,coletado,2026-09-01T10:00:00Z",
  ].join("\n") + "\n");
  // a Brazilian sale through the factory's venda.json, delivered
  writeFileSync(join(data(), "prospects", "br-01", "venda.json"), JSON.stringify({ status: "entregue", amount: 356, currency: "BRL", processor: "abacatepay", paid_at: new Date(Date.now() - 3 * 86_400_000).toISOString() }));
  // a Stripe sale and its subscription, from the recorded webhook log
  const lines = [
    { id: "evt_f1", type: "checkout.session.completed", created: secs(40), data: { object: { amount_total: 35600, currency: "usd", payment_status: "paid", metadata: { client: "ch-01" } } } },
    { id: "evt_f2", type: "customer.subscription.created", created: secs(40), data: { object: { status: "active", current_period_end: secs(-20), metadata: { client: "ch-01", plan: "pacote-4" }, items: { data: [{ quantity: 1, price: { id: "price_pacote4", unit_amount: 35600, currency: "usd", recurring: { interval: "month" } } }] } } } },
  ];
  writeFileSync(join(data(), "stripe-webhooks.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
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

test("funnel and revenue: counts, conversion against the reference, money in the original currency, and nothing that can charge", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (r) => { if (r.url().startsWith(`http://127.0.0.1:${dash.port}`)) requests.push(`${r.method()} ${new URL(r.url()).pathname}`); });
  await open(page, "#/funnel");
  await expect(page.getByRole("heading", { name: "Funil e receita", level: 1 })).toBeVisible();
  await expect(page.locator("nav a[aria-current=page]")).toHaveText("Funil e receita");
  const bars = page.locator('ul[aria-label="Funil comercial"] > li');
  await expect(bars).toHaveCount(6);
  // 6 prospects; 4 got a preview, 3 were sent, 2 replied (the 2 sales), 2 sales, 1 active subscription
  await expect(bars.nth(0)).toContainText("Prospects coletados: 6", { timeout: 10_000 });
  await expect(bars.nth(1)).toContainText("Prévias renderizadas: 4");
  await expect(bars.nth(2)).toContainText("Prévias enviadas: 3");
  await expect(bars.nth(3)).toContainText("Respostas: 2");
  await expect(bars.nth(4)).toContainText("Vendas: 2");
  await expect(bars.nth(5)).toContainText("Assinaturas ativas: 1");
  await expect(bars.nth(5)).toContainText("50% da etapa anterior");
  const fn = page.locator("#fn-h").locator("xpath=..");
  await expect(fn).toContainText("Prospect para venda33,3%");
  await expect(fn).toContainText("cerca de 2%");

  const rev = page.locator("#rev-h").locator("xpath=..");
  await expect(rev).toContainText("US$ 356");
  await expect(rev).toContainText("R$ 356");
  await expect(rev).toContainText("Stripe (exterior)");
  await expect(rev).toContainText("AbacatePay (BR)");
  await expect(rev).toContainText("sem dado", { timeout: 5_000 });
  await expect(page.locator("#sub-h").locator("xpath=..")).toContainText("pacote-4: 1 ativa(s)");

  const groups = page.locator('[aria-label="Funil por país e lote"] tbody tr');
  await expect(groups).toHaveCount(3);
  const clients = page.locator('[aria-label="Clientes com venda"] tbody tr');
  await expect(clients).toHaveCount(2);
  await expect(clients.filter({ hasText: "br-01" })).toContainText("entregue");
  await expect(clients.filter({ hasText: "ch-01" })).toContainText("active");
  await shot(page, "funnel-light");

  // read-only: no control inside the content, and every request was a read
  await expect(page.locator("main button, main form, main input[type=submit]")).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText(/criar cobrança|reembolsar|cobrar agora/i);
  await page.waitForTimeout(500);
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.filter((r) => !r.startsWith("GET "))).toEqual([]);
});

test("presentation mode hides every per-client value and keeps the totals", async ({ page }) => {
  await open(page, "#/funnel");
  await expect(page.locator('[aria-label="Clientes com venda"]')).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Apresentação" }).click();
  await expect(page.locator("main")).toContainText("Modo apresentação: os valores por cliente estão ocultos.");
  await expect(page.locator("main")).toContainText("Oculto no modo apresentação.");
  await expect(page.locator('[aria-label="Clientes com venda"]')).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText(/br-01|ch-01/);
  await expect(page.locator('ul[aria-label="Funil comercial"] > li').first()).toContainText("Prospects coletados: 6");
  await expect(page.locator("#rev-h").locator("xpath=..")).toContainText("US$ 356");
  await shot(page, "funnel-present");
});

test("a sale that arrives while the page is open moves the funnel without a reload", async ({ page }) => {
  await open(page, "#/funnel");
  const bars = page.locator('ul[aria-label="Funil comercial"] > li');
  await expect(bars.nth(4)).toContainText("Vendas: 2", { timeout: 10_000 });
  appendFileSync(join(data(), "stripe-webhooks.jsonl"), `${JSON.stringify({ id: "evt_f3", type: "checkout.session.completed", created: secs(0), data: { object: { amount_total: 9900, currency: "usd", payment_status: "paid", metadata: { client: "us-01" } } } })}\n`);
  await expect(bars.nth(4)).toContainText("Vendas: 3", { timeout: 15_000 });
  await expect(bars.nth(0)).toContainText("Prospects coletados: 6");
});
