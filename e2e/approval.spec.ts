import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { createApprovalHandler } from "../lib/approval/webhook";
import { findApproval, listDecisions, mediaSha256Of, verifyApproval } from "../lib/approval/store";
import { assertActionAllowed } from "../lib/gate/action-gate";
import { chromiumLaunchOptions } from "./support/browser";

const CLI = resolve("bin/marketing-engine.mjs");

function run(root: string, args: string[]) {
  return spawnSync(process.execPath, [CLI, ...args, "--root", root], { encoding: "utf8", env: { ...process.env, DRY_RUN: "true" } });
}

function seedRequest(root: string, piece: string, finalBytes: string) {
  const media = join(root, `${piece}.final.mp4`);
  const preview = join(root, `${piece}.preview.mp4`);
  writeFileSync(media, finalBytes);
  writeFileSync(preview, "small preview");
  const r = run(root, ["approval", "request", "--client", "acme", "--piece", piece, "--month", "2026-10", "--media", media, "--preview", preview, "--publish-at", "2026-10-20T18:00:00.000Z", "--caption", "tiktok=Legenda do TikTok", "--caption", "ig_reels=Legenda do Reels"]);
  expect(r.status, r.stderr).toBe(0);
  return { media, sha: mediaSha256Of(media), request: JSON.parse(r.stdout) };
}

test.use({ viewport: { width: 390, height: 844 }, launchOptions: chromiumLaunchOptions() });

test("page loads light previews, fits the phone, and records a change request that returns to the queue", async ({ page }) => {
  const root = mkdtempSync(join(tmpdir(), "me-approval-e2e-"));
  const a = seedRequest(root, "PIECE-a", "final render A");
  seedRequest(root, "PIECE-b", "final render B");

  const server = createServer((req, res) => void createApprovalHandler(root)(req, res));
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const port = (server.address() as AddressInfo).port;
  try {
    const out = join(root, "site");
    const built = run(root, ["approval", "page", "--client", "acme", "--month", "2026-10", "--out", out, "--action-url", `http://127.0.0.1:${port}/decide`, "--name", "Acme"]);
    expect(built.status, built.stderr).toBe(0);
    const { page: file, pieces } = JSON.parse(built.stdout);
    expect(pieces).toBe(2);

    const html = readFileSync(file, "utf8");
    expect(html).not.toContain("final.mp4");
    expect(html).not.toMatch(/<script/i);

    await page.goto(`file://${file}`);
    await expect(page.locator("article.card")).toHaveCount(2);
    const overflow = (await page.evaluate("document.documentElement.scrollWidth - window.innerWidth")) as number;
    expect(overflow).toBeLessThanOrEqual(0);
    const video = page.locator("article.card").first().locator("video");
    await expect(video).toHaveAttribute("preload", "none");
    await expect(video).toHaveAttribute("src", /^previews\/PIECE-[ab]\.mp4$/);
    const box = await video.boundingBox();
    expect(Math.round((box?.height ?? 0) / (box?.width ?? 1) * 100)).toBeGreaterThanOrEqual(175); // 9:16 portrait

    const card = page.locator("article.card", { hasText: "PIECE-a" });
    await card.getByLabel("Seu nome").fill("Ana");
    await card.getByLabel(/Pedir ajuste \(descreva/).fill("Trocar a música do final");
    await card.getByRole("button", { name: "Pedir ajuste" }).click();
    await expect(page.locator("body")).toContainText("Pedido de ajuste registrado");

    const decisions = listDecisions(root, { client: "acme" });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ piece_id: "PIECE-a", decision: "changes_requested", note: "Trocar a música do final", decided_by: "client:Ana" });

    const queue = JSON.parse(run(root, ["approval", "adjustments", "--client", "acme"]).stdout);
    expect(queue).toEqual([expect.objectContaining({ piece_id: "PIECE-a", note: "Trocar a música do final" })]);
    expect(findApproval(root, "PIECE-a", a.sha)).toBeNull();
  } finally {
    server.close();
  }
});

test("action-gate blocks scheduling without approval and with a different media hash", () => {
  const root = mkdtempSync(join(tmpdir(), "me-approval-gate-"));
  mkdirSync(join(root, "data"), { recursive: true });
  const a = seedRequest(root, "PIECE-g", "approved bytes");
  const input = { root, action: "schedule" as const, pieceId: "PIECE-g", mediaSha256: a.sha };

  expect(() => assertActionAllowed({ ...input, approvalRef: "none" })).toThrow(/approval_missing/);

  const rec = run(root, ["approval", "record", "--client", "acme", "--piece", "PIECE-g", "--media-sha256", a.sha, "--decision", "approved", "--by", "ana"]);
  expect(rec.status, rec.stderr).toBe(0);
  const approval = JSON.parse(rec.stdout);
  process.env.DRY_RUN = "true";
  expect(() => assertActionAllowed({ ...input, approvalRef: approval.approval_id })).not.toThrow();

  // The render changed after approval: same approval id, different hash.
  const changed = "c".repeat(64);
  expect(() => assertActionAllowed({ ...input, mediaSha256: changed, approvalRef: approval.approval_id })).toThrow(/approval_hash_mismatch/);
  expect(verifyApproval(root, { pieceId: "PIECE-g", mediaSha256: changed, approvalRef: approval.approval_id }).ok).toBe(false);
});

test("approval CLI rejects bad input and prints usage", () => {
  const root = mkdtempSync(join(tmpdir(), "me-approval-cli-"));
  expect(run(root, ["approval"]).status).toBe(2);
  const missing = run(root, ["approval", "request", "--client", "acme", "--piece", "p", "--month", "2026-10", "--media", join(root, "nope.mp4"), "--preview", join(root, "nope.mp4")]);
  expect(missing.status).toBe(1);
  expect(missing.stderr).toContain("media not found");
  const hash = run(root, ["approval", "record", "--client", "acme", "--piece", "p", "--media-sha256", "a".repeat(64), "--decision", "approved", "--by", "x"]);
  expect(hash.status).toBe(1);
  expect(hash.stderr).toContain("no request");
  const page = run(root, ["approval", "page", "--client", "acme", "--month", "2026-10", "--out", join(root, "o"), "--action-url", "/d"]);
  expect(JSON.parse(page.stdout).pieces).toBe(0);
});
