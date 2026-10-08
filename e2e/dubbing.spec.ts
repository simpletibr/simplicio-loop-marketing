import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { listDubReceipts } from "../lib/dubbing/dubbing";
import { loadSchemaRegistry } from "../lib/contracts/registry";
import { validateArtifact } from "../lib/contracts/validate";

const CLI = resolve("bin/marketing-engine.mjs");

function run(root: string, args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args, "--root", root], { encoding: "utf8", env: { ...process.env, DRY_RUN: "true", ...env }, maxBuffer: 16 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function host(): string {
  const root = mkdtempSync(join(tmpdir(), "me-dubbing-e2e-"));
  mkdirSync(join(root, ".marketing-engine", "data"), { recursive: true });
  expect(run(root, ["profile", "https://lothus.com.br", "--client", "lothus"]).status).toBe(0);
  return root;
}

test("the language matrix and the estimate need no approval and change nothing", async () => {
  const root = host();
  const matrix = JSON.parse(run(root, ["dubbing", "matrix", "--client", "lothus"]).stdout);
  expect(matrix).toMatchObject({ en: "tts", de: "tts", ar: "realoficial-dub", zh: "realoficial-dub" });
  const est = JSON.parse(run(root, ["dubbing", "estimate", "--client", "lothus", "--piece", "P-1", "--language", "ar"]).stdout);
  expect(est).toMatchObject({ route: "realoficial-dub", spends: false, credits: 0, needs_voice_rights_consent: true });
  expect(listDubReceipts(root)).toHaveLength(0);
});

test("dub fails closed without the owner's OK, then runs in DRY_RUN and leaves a valid receipt", async () => {
  const root = host();
  const blocked = run(root, ["dubbing", "dub", "--client", "lothus", "--piece", "P-1", "--language", "ar"]);
  expect(blocked.status).toBe(1);
  expect(JSON.parse(blocked.stdout)).toMatchObject({ verdict: "blocked", failure_class: "approval_missing" });

  const ok = run(root, ["dubbing", "dub", "--client", "lothus", "--piece", "P-1", "--language", "ar", "--approved-by-wesley"]);
  expect(ok.status, ok.stderr).toBe(0);
  const receipt = JSON.parse(ok.stdout);
  expect(receipt).toMatchObject({ verdict: "dubbed", dry_run: true, route: "realoficial-dub", ai_generated_voice: true, credits_spent: 0 });
  expect(validateArtifact(receipt, loadSchemaRegistry()).errors).toEqual([]);
  const listed = JSON.parse(run(root, ["dubbing", "list", "--client", "lothus", "--piece", "P-1"]).stdout);
  expect(listed).toHaveLength(1);

  const tts = JSON.parse(run(root, ["dubbing", "dub", "--client", "lothus", "--piece", "P-2", "--language", "en-US", "--approved-by-wesley"]).stdout);
  expect(tts).toMatchObject({ verdict: "handoff", route: "tts", ai_generated_voice: false });
});

test("a live dub needs a Real Oficial transport and the CLI never provides one", async () => {
  const root = host();
  const live = run(root, ["dubbing", "dub", "--client", "lothus", "--piece", "P-3", "--language", "ar", "--project", "01HZXQ3M8K2V5N7P9R1S4T6W8Y", "--clip", "01HZXQ3M8K2V5N7P9R1S4T6W01", "--approved-by-wesley"], { DRY_RUN: "false" });
  expect(live.status).toBe(1);
  expect(JSON.parse(live.stdout)).toMatchObject({ verdict: "failed", failure_class: "driver_unavailable", credits_spent: 0 });
  expect(run(root, ["dubbing", "dub", "--client", "lothus"]).status).toBe(2);
});
