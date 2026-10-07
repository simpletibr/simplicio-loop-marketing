import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BRAND_PROFILE_SCHEMA,
  buildBrandProfile,
  collectProspect,
  fixtureCollection,
  profilePath,
  readBrandProfile,
  writeBrandProfile,
} from "../../lib/profile/brand-profile.ts";
import { loadSchemaRegistry } from "../../lib/contracts/registry.ts";
import { validateArtifact } from "../../lib/contracts/validate.ts";
import { assertClientSlug, clientDir } from "../../lib/clients/paths.ts";

const NOW = new Date("2026-10-07T12:00:00Z");

test("fixtureCollection is deterministic per host and labels its source", () => {
  const a = fixtureCollection("https://www.lothus.com.br/sobre");
  assert.deepEqual(a, fixtureCollection("https://lothus.com.br/outra"));
  assert.equal(a.name, "Lothus");
  assert.ok(a.facts.every((f) => f.source.startsWith("fixture:dry-run:")));
});

test("buildBrandProfile validates against brand-profile/v1 and stamps collected_at per fact", () => {
  const profile = buildBrandProfile(fixtureCollection("https://lothus.com.br"), {
    client: "lothus",
    url: "https://lothus.com.br",
    mode: "dry-run",
    now: NOW,
  });
  assert.equal(profile.schema, BRAND_PROFILE_SCHEMA);
  assert.deepEqual(validateArtifact(profile, loadSchemaRegistry()).errors, []);
  assert.ok(profile.facts.every((f) => f.collected_at === NOW.toISOString()));
  assert.equal(profile.collection.mode, "dry-run");
});

test("buildBrandProfile refuses PII, robots violations, unsourced facts, bad slug and bad URL", () => {
  const good = fixtureCollection("https://acme.com");
  const input = { client: "acme", url: "https://acme.com", mode: "dry-run" as const };
  assert.throws(() => buildBrandProfile({ ...good, pii_collected: true }, input), /PII/);
  assert.throws(() => buildBrandProfile({ ...good, robots_respected: false }, input), /robots/);
  assert.throws(() => buildBrandProfile({ ...good, facts: [{ field: "name", value: "x", source: "" }] }, input), /without a source/);
  assert.throws(() => buildBrandProfile(good, { ...input, client: "../etc" }), /invalid client slug/);
  assert.throws(() => buildBrandProfile(good, { ...input, url: "ftp://acme.com" }), /http\(s\)/);
  assert.throws(() => buildBrandProfile({ ...good, colors: [] }, input), /invalid brand-profile/);
});

test("collectProspect uses the fixture under DRY_RUN and demands the binary otherwise", async () => {
  const prev = { dry: process.env.DRY_RUN, bin: process.env.SIMPLICIO_VIDEO_BIN };
  try {
    process.env.DRY_RUN = "true";
    assert.equal((await collectProspect("https://acme.com")).mode, "dry-run");
    await assert.rejects(collectProspect("not a url"), /not a valid URL/);
    process.env.DRY_RUN = "false";
    delete process.env.SIMPLICIO_VIDEO_BIN;
    await assert.rejects(collectProspect("https://acme.com"), /SIMPLICIO_VIDEO_BIN missing/);
  } finally {
    if (prev.dry === undefined) delete process.env.DRY_RUN; else process.env.DRY_RUN = prev.dry;
    if (prev.bin === undefined) delete process.env.SIMPLICIO_VIDEO_BIN; else process.env.SIMPLICIO_VIDEO_BIN = prev.bin;
  }
});

test("brand profile round-trips through HBI and a missing profile names the fix", () => {
  const root = mkdtempSync(join(tmpdir(), "me-profile-"));
  assert.throws(() => readBrandProfile(root, "acme"), /marketing-engine profile/);
  const profile = buildBrandProfile(fixtureCollection("https://acme.com"), { client: "acme", url: "https://acme.com", mode: "dry-run", now: NOW });
  const path = writeBrandProfile(root, profile);
  assert.equal(path, profilePath(root, "acme"));
  assert.deepEqual(readBrandProfile(root, "acme"), profile);
});

test("client slugs are path-safe", () => {
  assert.equal(assertClientSlug("wjr-2"), "wjr-2");
  for (const bad of ["", "A", "a/b", "..", "-a", "a b"]) assert.throws(() => assertClientSlug(bad));
  assert.match(clientDir("/tmp/x", "acme"), /clients\/acme$/);
});

import { chmodSync, writeFileSync } from "node:fs";
import { buildPieceContract } from "../../lib/video/piece-contract.ts";

test("collectProspect live path calls the collector CLI and parses its last JSON line", async () => {
  const dir = mkdtempSync(join(tmpdir(), "me-collector-"));
  const bin = join(dir, "collector");
  const collection = { ...fixtureCollection("https://acme.com"), name: "Acme Live" };
  writeFileSync(bin, `#!${process.execPath}\nprocess.stdout.write("noise\\n" + JSON.stringify(${JSON.stringify(collection)}) + "\\n");\n`);
  chmodSync(bin, 0o755);
  const prev = { dry: process.env.DRY_RUN, bin: process.env.SIMPLICIO_VIDEO_BIN };
  try {
    process.env.DRY_RUN = "false";
    process.env.SIMPLICIO_VIDEO_BIN = bin;
    const live = await collectProspect("https://acme.com");
    assert.equal(live.mode, "live");
    assert.equal(live.collection.name, "Acme Live");

    writeFileSync(bin, `#!${process.execPath}\nprocess.stdout.write("not json\\n");\n`);
    await assert.rejects(collectProspect("https://acme.com"), /did not print a JSON result/);
  } finally {
    if (prev.dry === undefined) delete process.env.DRY_RUN; else process.env.DRY_RUN = prev.dry;
    if (prev.bin === undefined) delete process.env.SIMPLICIO_VIDEO_BIN; else process.env.SIMPLICIO_VIDEO_BIN = prev.bin;
  }
});

test("buildPieceContract adds the brand block only when the client has a profile", () => {
  const root = mkdtempSync(join(tmpdir(), "me-piece-contract-"));
  const piece = { id: "PIECE-Abc 01", client: "acme" };
  const plain = buildPieceContract(root, piece, "brief", { aspect: "9:16", duration_s: 30 });
  assert.equal(plain.slug, "piece-abc-01");
  assert.equal(plain.language, "pt-BR");
  assert.equal(plain.brand, undefined);

  const profile = buildBrandProfile(fixtureCollection("https://acme.com"), { client: "acme", url: "https://acme.com", mode: "dry-run", now: NOW });
  writeBrandProfile(root, profile);
  const branded = buildPieceContract(root, { ...piece, locale: "en" }, "brief", { aspect: "9:16", duration_s: 30 });
  assert.equal(branded.language, "en");
  assert.deepEqual(branded.brand, { name: profile.name, colors: profile.colors, tone: profile.tone, logo: profile.logo.ref });

  const unsafe = buildPieceContract(root, { id: "x", client: "../evil" }, "brief", { aspect: "9:16", duration_s: 30 });
  assert.equal(unsafe.brand, undefined);
});
