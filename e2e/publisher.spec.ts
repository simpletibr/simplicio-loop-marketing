import { test, expect } from "@playwright/test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runGenerateLoop } from "../lib/cli/generate";
import { serializePiece } from "../lib/pieces/frontmatter";
import { readHbi } from "../lib/formats/binary";
import { recordDecision, requestApproval } from "../lib/approval/store";
import { DryRunPublisher, listReceipts, scheduleVerified, type ScheduleRequest } from "../lib/publish/publisher";
import { RealOficialBrowserPublisher } from "../lib/publish/realoficial-browser";
import { FixtureBrowserDriver } from "../lib/providers/__mocks__/realoficial-browser";
import { loadSchemaRegistry } from "../lib/contracts/registry";
import { validateArtifact } from "../lib/contracts/validate";

const FIXTURES = resolve("tests/fixtures/realoficial");
const NOW = new Date("2026-10-07T12:00:00Z");

async function generatedPiece(): Promise<{ host: string; req: ScheduleRequest }> {
  process.env.DRY_RUN = "true";
  const host = mkdtempSync(join(tmpdir(), "me-publisher-e2e-"));
  const ws = join(host, ".marketing-engine");
  mkdirSync(join(ws, "pieces"), { recursive: true });
  mkdirSync(join(ws, "data"), { recursive: true });
  writeFileSync(
    join(ws, "pieces", "PIECE-sch-1.md"),
    serializePiece(
      { id: "PIECE-sch-1", client: "acme", date: "2026-10-08", status: "draft", type: "reel", pillar: "education", platforms: ["instagram"], locale: "en", provider_override: { video: "simplicio-video" } },
      "# Brief\n\nLaunch our new product.\n",
    ),
  );
  const prev = process.cwd();
  process.chdir(host);
  try {
    expect((await runGenerateLoop({ root: host })).advanced).toBe(1);
  } finally {
    process.chdir(prev);
  }
  const manifest = readHbi<{ outputs: string[]; render_sha256: string }>(join(ws, "outputs", "acme", "2026-10-08", "PIECE-sch-1", "manifest.hbi"));
  const mediaPath = manifest.outputs.find((o) => o.endsWith(".mp4")) as string;
  requestApproval(host, { client: "acme", pieceId: "PIECE-sch-1", month: "2026-10", mediaSha256: manifest.render_sha256, preview: mediaPath, captions: { tiktok: "Legenda" } });
  const approval = recordDecision(host, { client: "acme", pieceId: "PIECE-sch-1", mediaSha256: manifest.render_sha256, decision: "approved", decidedBy: "client:Ana" });
  return {
    host,
    req: { clientSlug: "acme", pieceId: "PIECE-sch-1", mediaPath, mediaSha256: manifest.render_sha256, caption: "Legenda", network: "tiktok", publishAt: "2026-10-20T18:00:00.000Z", approvalRef: approval.approval_id },
  };
}

test("a generated, approved piece is scheduled once per network through the publisher seam", async () => {
  const { host, req } = await generatedPiece();
  const dry = await scheduleVerified(req, { root: host, publisher: new DryRunPublisher(), now: NOW });
  expect(dry.verdict).toBe("scheduled");
  expect(validateArtifact(dry, loadSchemaRegistry()).errors).toEqual([]);

  const driver = new FixtureBrowserDriver(FIXTURES, { onOpen: ["schedule"], onSubmit: "scheduled" });
  const viaBrowser = await scheduleVerified({ ...req, network: "ig_reels" }, { root: host, publisher: new RealOficialBrowserPublisher(driver, host), now: NOW });
  expect(viaBrowser.verdict).toBe("scheduled");
  expect(viaBrowser.post_ref).toBe("realoficial://scheduled/ro-98765");
  expect(viaBrowser.evidence?.screenshot).toBeTruthy();

  const again = await scheduleVerified({ ...req, network: "ig_reels" }, { root: host, publisher: new RealOficialBrowserPublisher(driver, host), now: NOW });
  expect(again.receipt_id).toBe(viaBrowser.receipt_id);
  expect(driver.opened).toHaveLength(1);
  expect(listReceipts(host).map((r) => r.network).sort()).toEqual(["ig_reels", "tiktok"]);
});

test("changing the rendered media after approval blocks the schedule", async () => {
  const { host, req } = await generatedPiece();
  const blocked = await scheduleVerified({ ...req, mediaSha256: "9".repeat(64) }, { root: host, publisher: new DryRunPublisher(), now: NOW });
  expect(blocked.verdict).toBe("blocked");
  expect(blocked.failure_class).toBe("approval_hash_mismatch");
  expect(listReceipts(host)).toHaveLength(1);
});
