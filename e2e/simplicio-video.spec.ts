import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runGenerateLoop } from "../lib/cli/generate";
import { serializePiece } from "../lib/pieces/frontmatter";
import { publishVerified } from "../lib/publish/verify-pipeline";
import { readBrandProfile } from "../lib/profile/brand-profile";
import { readHbi } from "../lib/formats/binary";
import { loadSchemaRegistry } from "../lib/contracts/registry";
import { validateArtifact } from "../lib/contracts/validate";
import type { PublishClient, PublishPiece, PublishResult } from "../lib/publish/adaptlypost";

const CLI = resolve("bin/marketing-engine.mjs");

class OkClient implements PublishClient {
  readonly name = "ok-test";
  calls = 0;
  async schedule(piece: PublishPiece): Promise<PublishResult> {
    this.calls++;
    return { ok: true, draft_url: `https://ok.test/${piece.id}` };
  }
}

function host(): string {
  const dir = mkdtempSync(join(tmpdir(), "me-svideo-"));
  mkdirSync(join(dir, ".marketing-engine", "pieces"), { recursive: true });
  mkdirSync(join(dir, ".marketing-engine", "data"), { recursive: true });
  return dir;
}

test("profile builds and stores brand-profile/v1 under DRY_RUN with sourced facts", () => {
  const dir = host();
  const r = spawnSync(process.execPath, [CLI, "profile", "https://www.lothus.com.br", "--client", "lothus", "--root", dir], {
    encoding: "utf8",
    env: { ...process.env, DRY_RUN: "true" },
  });
  expect(r.status).toBe(0);
  const profile = JSON.parse(r.stdout);
  expect(validateArtifact(profile, loadSchemaRegistry()).errors).toEqual([]);
  expect(profile.collection.mode).toBe("dry-run");
  expect(profile.facts.every((f: { source: string }) => f.source.length > 0)).toBe(true);
  expect(readBrandProfile(dir, "lothus")).toEqual(profile);
});

test("profile rejects missing arguments and unsafe slugs", () => {
  const dir = host();
  const usage = spawnSync(process.execPath, [CLI, "profile", "--root", dir], { encoding: "utf8" });
  expect(usage.status).toBe(2);
  expect(usage.stderr).toContain("usage: marketing-engine profile");
  const bad = spawnSync(process.execPath, [CLI, "profile", "https://acme.com", "--client", "../evil", "--root", dir], {
    encoding: "utf8",
    env: { ...process.env, DRY_RUN: "true" },
  });
  expect(bad.status).toBe(1);
  expect(bad.stderr).toContain("invalid client slug");
});

test("render manifest from the video factory becomes publish evidence and tampering blocks publish", async () => {
  process.env.DRY_RUN = "true";
  const dir = host();
  const ws = join(dir, ".marketing-engine");
  writeFileSync(
    join(ws, "pieces", "PIECE-sv-001.md"),
    serializePiece(
      {
        id: "PIECE-sv-001",
        client: "acme",
        date: "2026-05-08",
        status: "draft",
        type: "reel",
        pillar: "education",
        platforms: ["instagram"],
        locale: "en",
        provider_override: { video: "simplicio-video" },
      },
      "# Brief\n\nLaunch our new product.\n",
    ),
  );
  const prev = process.cwd();
  process.chdir(dir);
  try {
    const summary = await runGenerateLoop({ root: dir });
    expect(summary.advanced).toBe(1);
  } finally {
    process.chdir(prev);
  }
  const outDir = join(ws, "outputs", "acme", "2026-05-08", "PIECE-sv-001");
  const manifest = readHbi<Record<string, unknown>>(join(outDir, "manifest.hbi"));
  expect(typeof manifest.render_manifest_path).toBe("string");
  expect(manifest.render_sha256).toMatch(/^[a-f0-9]{64}$/);
  expect((manifest.outputs as string[]).includes(manifest.render_manifest_path as string)).toBe(true);

  const client = new OkClient();
  const receipt = await publishVerified("PIECE-sv-001", { root: dir, publishClient: client });
  expect(receipt.verdict).toBe("published");
  expect(receipt.stages.map((s) => s.stage)).toEqual(["manifest_valid", "render_manifest", "claims_gate", "compliance", "publish"]);

  // Tamper with the rendered file: the manifest hash no longer vouches for it.
  const mp4 = (readFileSync(manifest.render_manifest_path as string, "utf8").match(/"path":"([^"]+)"/) as RegExpMatchArray)[1] as string;
  expect(existsSync(mp4)).toBe(true);
  writeFileSync(mp4, "tampered");
  writeFileSync(join(outDir, "publish-receipt.json"), "{}");
  const blocked = await publishVerified("PIECE-sv-001", { root: dir, publishClient: client });
  expect(blocked.verdict).toBe("blocked");
  expect(blocked.failure_class).toBe("render_evidence_blocked");
  expect(client.calls).toBe(1);
});
