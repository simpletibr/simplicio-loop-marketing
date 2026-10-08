import { test, expect, type Page } from "@playwright/test";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { chromiumLaunchOptions } from "./support/browser";
import { prepareHost, startDashboard, type PreparedHost, type Running } from "./support/dashboard-host";
import { requestApproval } from "../lib/approval/store";
import { writeTuple } from "../lib/yool/board";

test.use({ launchOptions: chromiumLaunchOptions(), viewport: { width: 1360, height: 900 } });

let host: PreparedHost;
let dash: Running;
const data = (): string => join(host.root, ".marketing-engine", "data");

test.beforeAll(async () => {
  test.setTimeout(180_000);
  host = prepareHost("lothus");
  dash = await startDashboard(host.root);
  // a piece 10 h from its post that the client never answered, and one decision only the owner can take
  requestApproval(host.root, { client: host.client, pieceId: "URGENT-1", month: "2026-10", mediaSha256: createHash("sha256").update("urgent").digest("hex"), preview: "p.mp4", captions: {}, publishAt: new Date(Date.now() + 10 * 3_600_000).toISOString() });
  writeTuple(join(host.root, ".marketing-engine"), { id: "human.approval_required", class: "human.approval_required", status: "pending", payload: { request: "Gastar créditos em cortes longos", credit_estimate: 80, impact: "Vídeo de sexta" } });
  // the voice quota is out for five more hours
  writeFileSync(join(data(), "tts-bloqueado-ate.txt"), new Date(Date.now() + 5 * 3_600_000).toISOString());
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

test("approvals: the red piece comes first, the owner's decision is listed, and the only control is to copy", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (r) => { if (r.url().startsWith(`http://127.0.0.1:${dash.port}`)) requests.push(`${r.method()} ${new URL(r.url()).pathname}`); });
  await open(page, "#/approvals");
  await expect(page.getByRole("heading", { name: "Fila de aprovações", level: 1 })).toBeVisible();
  await expect(page.locator("nav a[aria-current=page]")).toHaveText("Aprovações");
  const rows = page.locator('[role="region"][aria-label="Aprovações do cliente"] tbody tr');
  await expect(rows.first()).toContainText("URGENT-1", { timeout: 10_000 });
  await expect(rows.first()).toHaveAttribute("data-sla", "red");
  await expect(rows.first()).toContainText("Vermelho");
  expect(await rows.count()).toBeGreaterThanOrEqual(2);
  const owner = page.locator('[role="region"][aria-label="Decisões do Wesley"]');
  await expect(owner).toContainText("Gastar créditos em cortes longos", { timeout: 10_000 });
  await expect(owner).toContainText("80 créditos");
  await expect(owner).toContainText("Vídeo de sexta");
  await shot(page, "approvals-light");

  // v1 is read-only: no decision control, only "copy" and the piece links, and every request was a read
  const labels = await page.locator("main button").allTextContents();
  expect(labels.length).toBeGreaterThan(0);
  for (const label of labels) expect(label).toMatch(/^(Copiar (link|comando)|[A-Za-z0-9._-]+)$/);
  await expect(page.locator("main form, main input[type=submit]")).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText(/\b(aprovar agora|rejeitar|recusar|enviar prévia)\b/i);
  await expect(rows.first().getByRole("button", { name: "Copiar comando" })).toBeVisible();
  await page.waitForTimeout(500);
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.filter((r) => !r.startsWith("GET "))).toEqual([]);
});

test("alerts: the centre lists what threatens a post, a toast announces it, and a new alert arrives live", async ({ page }) => {
  await open(page, "#/alerts");
  await expect(page.getByRole("heading", { name: "Alertas", level: 1 })).toBeVisible();
  await expect(page.locator(".toast")).toContainText("alerta(s) ativo(s)", { timeout: 10_000 });
  const list = page.locator("ul.alerts");
  await expect(list.locator('[data-rule="approval_due"]').first()).toContainText("URGENT-1", { timeout: 10_000 });
  await expect(list.locator('[data-rule="approval_due"]').first()).toHaveAttribute("data-severity", "error");
  await expect(list.locator('[data-rule="tts_exhausted"]')).toContainText("A cota de voz do dia acabou");
  await expect(list.locator('[data-rule="tts_exhausted"]')).toContainText("Próximo passo");
  await expect(page.locator("main")).toContainText("Envio externo desligado");
  await expect(page.locator("nav a[data-view=alerts]")).toHaveText(/^Alertas \(\d+\)$/);
  await shot(page, "alerts-light");
  const before = await page.locator("ul.alerts > li").count();

  // a payment arrives and no delivery starts: the alert appears by itself, with a toast, without reloading
  const created = Math.floor((Date.now() - 2 * 3_600_000) / 1000);
  appendFileSync(join(data(), "stripe-webhooks.jsonl"), `${JSON.stringify({ id: "evt_alert_1", type: "checkout.session.completed", created, data: { object: { amount_total: 35600, currency: "brl", payment_status: "paid", metadata: { client: "novo-cliente" } } } })}\n`);
  await expect(page.locator(".toast", { hasText: "novo-cliente pagou" })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('ul.alerts [data-rule="payment_without_delivery"]')).toContainText("novo-cliente pagou", { timeout: 15_000 });
  expect(await page.locator("ul.alerts > li").count()).toBe(before + 1);
  await expect(page.locator("nav a[data-view=alerts]")).toHaveText(`Alertas (${before + 1})`);
});

test("alerts: desktop notifications are opt-in and only new alerts reach them", async ({ page }) => {
  await page.addInitScript(() => {
    const w = globalThis as unknown as { __notes: Array<{ title: string; body?: string; tag?: string }>; Notification: unknown };
    w.__notes = [];
    class Fake {
      static permission = "default";
      static async requestPermission(): Promise<string> { Fake.permission = "granted"; return "granted"; }
      constructor(title: string, options?: { body?: string; tag?: string }) { w.__notes.push({ title, body: options?.body, tag: options?.tag }); }
    }
    w.Notification = Fake;
  });
  const notes = (): Promise<Array<{ title: string; body?: string; tag?: string }>> => page.evaluate(() => (globalThis as unknown as { __notes: Array<{ title: string; body?: string; tag?: string }> }).__notes);
  await open(page, "#/alerts");
  // the alerts that are already active must all be on the page before the opt-in, or a late one would count as new
  await expect(page.locator('ul.alerts [data-rule="approval_due"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('ul.alerts [data-rule="tts_exhausted"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('ul.alerts [data-rule="month_underfilled"]')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1500);
  const toggle = page.getByRole("button", { name: /Notificações do navegador/ });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(toggle).toContainText("desligadas");
  expect(await notes()).toEqual([]);
  await toggle.click();
  await expect(page.getByRole("button", { name: /Notificações do navegador/ })).toHaveAttribute("aria-pressed", "true", { timeout: 10_000 });
  await expect(page.getByRole("button", { name: /Notificações do navegador/ })).toContainText("ligadas");
  expect(await notes(), "alerts that were already active do not notify").toEqual([]);

  const created = Math.floor((Date.now() - 3 * 3_600_000) / 1000);
  appendFileSync(join(data(), "stripe-webhooks.jsonl"), `${JSON.stringify({ id: "evt_alert_2", type: "invoice.paid", created, data: { object: { amount_paid: 9900, currency: "brl", subscription_details: { metadata: { client: "outro-cliente" } } } } })}\n`);
  await expect.poll(async () => (await notes()).length, { timeout: 15_000 }).toBe(1);
  const [note] = await notes();
  expect(note?.title).toBe("Novo alerta de distribuição");
  expect(note?.body).toContain("outro-cliente pagou");
  expect(note?.tag).toMatch(/^payment_without_delivery:outro-cliente:/);
  await page.waitForTimeout(1500);
  expect((await notes()).length, "the same alert never notifies twice").toBe(1);

  // and it can be turned off again
  await page.getByRole("button", { name: /Notificações do navegador/ }).click();
  await expect(page.getByRole("button", { name: /Notificações do navegador/ })).toHaveAttribute("aria-pressed", "false");
});

test("approvals and alerts are reachable by keyboard from the navigation", async ({ page }) => {
  await open(page, "#/cockpit");
  for (const label of ["Aprovações", /^Alertas/]) {
    const link = page.locator("nav a", { hasText: label });
    await expect(link).toBeVisible();
    await link.focus();
    await expect(link).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("nav a[aria-current=page]")).toHaveText(label);
    await expect(page.locator("#main")).toBeFocused();
    await expect(page.locator("main h1")).toBeVisible();
  }
});
