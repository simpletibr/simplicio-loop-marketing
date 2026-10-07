import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Hermetic upstream: a minimal public-contract double that accepts any manifest
// but exposes only `extension_manifest.validate`, so the probe must report the
// remaining required capabilities as missing. No checkout outside the temp dir.
function fakeUpstream(): string {
  const root = mkdtempSync(join(tmpdir(), "me-fake-loop-core-"));
  const pkg = join(root, "simplicio_loop");
  mkdirSync(pkg, { recursive: true });
  writeFileSync(join(pkg, "__init__.py"), "");
  writeFileSync(join(pkg, "extension_manifest.py"), "def validate_manifest(manifest):\n    return []\n");
  return root;
}

test("operator doctor returns machine JSON and blocks missing critical core capabilities", () => {
  const result = spawnSync(process.execPath, [resolve("bin/marketing-engine.mjs"), "operator", "doctor", "--json"], {
    cwd: process.cwd(), encoding: "utf8", env: { ...process.env, SIMPLICIO_LOOP_ROOT: fakeUpstream() },
  });
  expect(result.status).toBe(2);
  const report = JSON.parse(result.stdout);
  expect(report.schema).toBe("loop.marketing-operator-doctor/v1");
  expect(report.probe.status).toBe("BLOCKED");
  expect(report.probe.reason_code).toBe("REQUIRED_CAPABILITY_MISSING");
  expect(report.probe.manifest_sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(report.probe.corrective_action).toContain("extension_reconcile");
});
