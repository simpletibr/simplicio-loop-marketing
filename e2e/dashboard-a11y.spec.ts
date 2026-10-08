import { test, expect, type Page } from "@playwright/test";
import { appendFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { chromiumLaunchOptions } from "./support/browser";
import { prepareHost, run, startDashboard, type PreparedHost, type Running } from "./support/dashboard-host";
import { loadPlan } from "../lib/plan/content-plan";
import { requestApproval } from "../lib/approval/store";
import { writeTuple } from "../lib/yool/board";

/**
 * Accessibility, keyboard and security-visible behaviour of the whole panel (issue #185): axe-core with the WCAG 2.2 AA rule
 * tags on every section in both themes, with a drawer and the palette open, and in presentation mode; reflow at phone
 * width; no inline style or script blocked by the CSP; the preview of a piece is only requested when it is opened.
 */
test.use({ launchOptions: chromiumLaunchOptions(), viewport: { width: 1360, height: 900 } });

const VIEWS = ["cockpit", "pipeline", "calendar", "status", "quality", "credits", "funnel", "performance", "approvals", "alerts"] as const;
const AXE = resolve("node_modules/axe-core/axe.min.js");
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

let host: PreparedHost;
let dash: Running;
const data = (): string => join(host.root, ".marketing-engine", "data");

test.beforeAll(async () => {
  test.setTimeout(240_000);
  host = prepareHost("lothus", { days: 14, perWeek: 3 });
  const row = { ts: new Date().toISOString(), client: host.client, piece_id: host.pieces[0]!.piece_id, provider: "realoficial", credits: 25, purpose: "cortes", approved_by: "wesley" };
  appendFileSync(join(data(), "credits.jsonl"), `${JSON.stringify(row)}\n`);
  // money and prospects, so that the funnel has something to show
  writeFileSync(join(data(), "controle-prospects.csv"), ["slug,country,batch,status,updated_at", "br-01,BR,lote-1,respondeu,2026-09-01T10:00:00Z", "ch-01,CH,lote-1,enviada,2026-09-01T10:00:00Z"].join("\n") + "\n");
  const secs = (d: number): number => Math.floor((Date.now() - d * 86_400_000) / 1000);
  writeFileSync(join(data(), "stripe-webhooks.jsonl"), [
    { id: "evt_a1", type: "checkout.session.completed", created: secs(40), data: { object: { amount_total: 35600, currency: "usd", payment_status: "paid", metadata: { client: "ch-01" } } } },
    { id: "evt_a2", type: "customer.subscription.created", created: secs(40), data: { object: { status: "active", current_period_end: secs(-20), metadata: { client: "ch-01", plan: "pacote-4" }, items: { data: [{ quantity: 1, price: { id: "p4", unit_amount: 35600, currency: "usd", recurring: { interval: "month" } } }] } } } },
  ].map((l) => JSON.stringify(l)).join("\n") + "\n");
  // approvals and alerts
  requestApproval(host.root, { client: host.client, pieceId: "URGENT-1", month: "2026-10", mediaSha256: createHash("sha256").update("urgent").digest("hex"), preview: "p.mp4", captions: {}, publishAt: new Date(Date.now() + 10 * 3_600_000).toISOString() });
  writeTuple(join(host.root, ".marketing-engine"), { id: "human.approval_required", class: "human.approval_required", status: "pending", payload: { request: "Gastar créditos em cortes longos", credit_estimate: 80, impact: "Vídeo de sexta" } });
  writeFileSync(join(data(), "tts-bloqueado-ate.txt"), new Date(Date.now() + 5 * 3_600_000).toISOString());
  // metrics: views for the first pieces, so that the ranking, the winners and the curve have data
  const slots = loadPlan(host.root, "lothus").slots.slice(0, 8);
  const polled = new Date(Date.now() - 3_600_000).toISOString();
  const rows = slots.flatMap((s, i) => [{ piece_id: s.piece_id, network: s.network, metric: "views", value: 300 + i * 40, polled_at: polled }, ...(i < 3 ? [{ piece_id: s.piece_id, network: s.network, metric: "likes", value: 20 + i, polled_at: polled }] : [])]);
  const file = join(host.root, "views.json");
  writeFileSync(file, JSON.stringify(rows));
  run(host.root, ["metrics", "import", "--client", "lothus", "--file", file]);
  run(host.root, ["metrics", "winners", "--client", "lothus", "--month", (slots[0]!.publish_at).slice(0, 7)]);
  dash = await startDashboard(host.root);
});

test.afterAll(() => dash?.stop());

const open = (page: Page, hash: string): Promise<unknown> => page.goto(`http://127.0.0.1:${dash.port}/?token=${dash.token}${hash}`);

interface Violation { id: string; impact: string | null; help: string; nodes: Array<{ target: unknown[]; html: string }> }

async function audit(page: Page): Promise<Violation[]> {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(
    async ({ tags }) => {
      const w = globalThis as unknown as { document: unknown; axe: { run(ctx: unknown, opts: unknown): Promise<{ violations: Violation[] }> } };
      return (await w.axe.run(w.document, { runOnly: { type: "tag", values: tags }, resultTypes: ["violations"] })).violations;
    },
    { tags: TAGS },
  );
}

const describe = (v: Violation[]): string => v.map((x) => `${x.id} (${x.impact}): ${x.help}\n${x.nodes.slice(0, 3).map((n) => `    ${JSON.stringify(n.target)} ${n.html.slice(0, 140)}`).join("\n")}`).join("\n");

async function settled(page: Page, view: string): Promise<void> {
  await expect(page.locator("nav a[aria-current=page]")).toBeVisible();
  await expect(page.locator("main h1")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("main")).not.toContainText("Carregando");
  void view;
  await page.waitForTimeout(400);
}

// The panel's own policy refuses an injected script (as it should), so the audit runs with the policy bypassed; the policy itself is checked below.
test.describe("axe-core", () => {
  test.use({ bypassCSP: true });

  for (const theme of ["light", "dark"] as const) {
    for (const view of VIEWS) {
      test(`${view} has no WCAG 2.2 AA violation (${theme})`, async ({ page }) => {
        await page.addInitScript((t) => { try { (globalThis as unknown as { localStorage: { setItem(k: string, v: string): void } }).localStorage.setItem("sl-theme", t); } catch { /* blocked */ } }, theme);
        await open(page, `#/${view}`);
        await settled(page, view);
        const violations = await audit(page);
        expect(violations, describe(violations)).toEqual([]);
      });
    }
  }

  test("the piece drawer, the command palette and presentation mode have no violation", async ({ page }) => {
    await open(page, "#/pipeline");
    await settled(page, "pipeline");
    await page.locator(".piece").first().click();
    await expect(page.locator("#drawer")).toBeVisible();
    let violations = await audit(page);
    expect(violations, describe(violations)).toEqual([]);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+k");
    await expect(page.locator("#palette")).toBeVisible();
    violations = await audit(page);
    expect(violations, describe(violations)).toEqual([]);
    await page.keyboard.press("Escape");
    await open(page, "#/cockpit?present=1");
    await settled(page, "cockpit");
    violations = await audit(page);
    expect(violations, describe(violations)).toEqual([]);
  });
});

test.describe("phone width", () => {
  test.use({ viewport: { width: 360, height: 740 } });
  for (const view of VIEWS) {
    test(`reflow: ${view} does not scroll the page sideways at 360 px`, async ({ page }) => {
      await open(page, `#/${view}`);
      await settled(page, view);
      const overflow = await page.evaluate(() => {
        const w = globalThis as unknown as { document: { documentElement: { scrollWidth: number } }; innerWidth: number };
        return { scroll: w.document.documentElement.scrollWidth, inner: w.innerWidth };
      });
      expect(overflow.scroll, `scrollWidth ${overflow.scroll} against ${overflow.inner}`).toBeLessThanOrEqual(overflow.inner);
    });
  }
});

test("the CSP blocks nothing the panel needs: no violation in any section, and no inline style or script", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) problems.push(m.text()); });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  for (const view of VIEWS) {
    await open(page, `#/${view}`);
    await settled(page, view);
  }
  expect(problems).toEqual([]);
  expect(await page.locator("[style]").count(), "inline style attributes are blocked by the CSP").toBe(0);
  expect(await page.locator("script:not([src])").count()).toBe(0);
});

test("previews are requested only when a piece is opened", async ({ page }) => {
  const media: string[] = [];
  page.on("request", (r) => { if (new URL(r.url()).pathname.startsWith("/api/media/")) media.push(new URL(r.url()).pathname); });
  await open(page, "#/pipeline");
  await settled(page, "pipeline");
  await page.waitForTimeout(800);
  expect(media, "the board loads no preview by itself").toEqual([]);
  await page.locator(".piece").first().click();
  await expect(page.locator("#drawer")).toBeVisible();
  await page.waitForTimeout(500);
  await page.keyboard.press("Escape");
});

test("focus order: the skip link is first and lands on the content, a section change moves focus to it, and Escape closes the dialogs", async ({ page }) => {
  await open(page, "#/cockpit");
  await settled(page, "cockpit");
  // the skip link is the first thing a keyboard reaches in the page, and it lands on the content
  const first = await page.evaluate(() => {
    const w = globalThis as unknown as { document: { querySelector(s: string): { className: string } | null } };
    return w.document.querySelector('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')?.className;
  });
  expect(first).toBe("skip");
  await page.locator("a.skip").focus();
  await expect(page.locator("a.skip")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
  await expect(page.locator("nav a[aria-current=page]")).toHaveText("Cockpit");
  // on another section the skip link must not send the person back to the first one
  await open(page, "#/status");
  await settled(page, "status");
  await page.locator("a.skip").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
  await page.waitForTimeout(500);
  await expect(page.locator("nav a[aria-current=page]")).toHaveText("Status por rede");
  await page.locator("nav a", { hasText: "Alertas" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("nav a[aria-current=page]")).toContainText("Alertas");
  await expect(page.locator("#main")).toBeFocused();
  await page.keyboard.press("Control+k");
  await expect(page.locator("#palette")).toBeVisible();
  await expect(page.locator("#palette-input")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("#palette")).toBeHidden();
});
