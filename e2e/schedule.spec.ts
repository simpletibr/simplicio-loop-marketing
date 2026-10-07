import { test, expect } from "@playwright/test";
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const CLI = resolve(__filename, "..", "..", "bin", "marketing-engine.mjs");

function run(
  args: string[],
  cwd: string,
  env?: Record<string, string>,
) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, DRY_RUN: "true", ...env },
  });
}

test("schedule install/status/uninstall round-trip works on linux tmp crontab", () => {
  const host = mkdtempSync(join(tmpdir(), "me-schedule-linux-"));
  const schedulerDir = join(host, "scheduler");
  mkdirSync(schedulerDir, { recursive: true });
  const crontabFile = join(schedulerDir, "crontab.txt");
  writeFileSync(crontabFile, "# existing entry\n15 6 * * * echo keep-me\n", "utf8");

  const env = {
    MARKETING_ENGINE_SCHEDULE_PLATFORM: "linux",
    MARKETING_ENGINE_SCHEDULE_CRONTAB_FILE: crontabFile,
  };

  const preview = run(["schedule", "install"], host, env);
  expect(preview.status).toBe(0);
  expect(preview.stdout).toContain("Plan");
  expect(preview.stdout).toContain('0 22 * * * cd');
  expect(readFileSync(crontabFile, "utf8")).toContain("keep-me");
  expect(readFileSync(crontabFile, "utf8")).not.toContain("marketing-engine generate");

  const install = run(["schedule", "install", "--yes"], host, env);
  expect(install.status).toBe(0);
  const installed = readFileSync(crontabFile, "utf8");
  expect(installed).toContain("keep-me");
  expect(installed).toContain('0 22 * * * cd');
  expect(installed).toContain('0 9 * * * cd');

  const status = run(["schedule", "status"], host, env);
  expect(status.status).toBe(0);
  expect(status.stdout).toContain("marketing-engine block: installed");
  expect(status.stdout).toContain("generate");
  expect(status.stdout).toContain("promote");

  const uninstall = run(["schedule", "uninstall"], host, env);
  expect(uninstall.status).toBe(0);
  const cleaned = readFileSync(crontabFile, "utf8");
  expect(cleaned).toContain("keep-me");
  expect(cleaned).not.toContain("marketing-engine generate");
  expect(cleaned).not.toContain("marketing-engine promote");
});

test("schedule install/status/uninstall round-trip works on macOS tmp launch agents", () => {
  const host = mkdtempSync(join(tmpdir(), "me-schedule-mac-"));
  const schedulerDir = join(host, "scheduler");
  const launchAgentsDir = join(schedulerDir, "LaunchAgents");
  const launchctlLog = join(schedulerDir, "launchctl.log");
  mkdirSync(launchAgentsDir, { recursive: true });

  const env = {
    MARKETING_ENGINE_SCHEDULE_PLATFORM: "darwin",
    MARKETING_ENGINE_SCHEDULE_LAUNCH_AGENTS_DIR: launchAgentsDir,
    MARKETING_ENGINE_SCHEDULE_LAUNCHCTL_LOG: launchctlLog,
    MARKETING_ENGINE_SCHEDULE_UID: "501",
  };

  const preview = run(["schedule", "install"], host, env);
  expect(preview.status).toBe(0);
  expect(preview.stdout).toContain("com.marketing-engine.generate.plist");
  expect(preview.stdout).toContain("<plist version=\"1.0\">");
  expect(existsSync(join(launchAgentsDir, "com.marketing-engine.generate.plist"))).toBe(false);

  const install = run(["schedule", "install", "--yes"], host, env);
  expect(install.status).toBe(0);
  const generatePath = join(launchAgentsDir, "com.marketing-engine.generate.plist");
  const promotePath = join(launchAgentsDir, "com.marketing-engine.promote.plist");
  expect(existsSync(generatePath)).toBe(true);
  expect(existsSync(promotePath)).toBe(true);
  expect(readFileSync(generatePath, "utf8")).toContain("<integer>22</integer>");
  expect(readFileSync(promotePath, "utf8")).toContain("<integer>9</integer>");
  expect(readFileSync(launchctlLog, "utf8")).toContain(`bootstrap gui/501 ${generatePath}`);
  expect(readFileSync(launchctlLog, "utf8")).toContain(`bootstrap gui/501 ${promotePath}`);

  const status = run(["schedule", "status"], host, env);
  expect(status.status).toBe(0);
  expect(status.stdout).toContain("launchd plists: installed");
  expect(status.stdout).toContain(generatePath);
  expect(status.stdout).toContain(promotePath);

  const uninstall = run(["schedule", "uninstall"], host, env);
  expect(uninstall.status).toBe(0);
  expect(existsSync(generatePath)).toBe(false);
  expect(existsSync(promotePath)).toBe(false);
  const launchctlLines = readFileSync(launchctlLog, "utf8");
  expect(launchctlLines).toContain(`bootout gui/501 ${generatePath}`);
  expect(launchctlLines).toContain(`bootout gui/501 ${promotePath}`);
});

test("schedule install on Windows surfaces manual Task Scheduler guidance", () => {
  const host = mkdtempSync(join(tmpdir(), "me-schedule-win-"));
  const result = run(["schedule", "install", "--yes"], host, {
    MARKETING_ENGINE_SCHEDULE_PLATFORM: "win32",
  });
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("Task Scheduler manually");
});

test("schedule install adds a day-25 monthly plan for each client with a brand profile", () => {
  const host = mkdtempSync(join(tmpdir(), "me-schedule-monthly-"));
  mkdirSync(join(host, ".marketing-engine", "clients", "lothus"), { recursive: true });
  mkdirSync(join(host, ".marketing-engine", "clients", "no-profile"), { recursive: true });
  writeFileSync(join(host, ".marketing-engine", "clients", "lothus", "brand-profile.hbi"), "x");
  const crontabFile = join(host, "crontab.txt");
  const env = { MARKETING_ENGINE_SCHEDULE_PLATFORM: "linux", MARKETING_ENGINE_SCHEDULE_CRONTAB_FILE: crontabFile };
  expect(run(["schedule", "install", "--yes"], host, env).status).toBe(0);
  const cron = readFileSync(crontabFile, "utf8");
  expect(cron).toContain("0 7 25 * * cd");
  expect(cron).toContain("campaign --client lothus --days 30 --start next-month");
  expect(cron).toContain("campaign render --client lothus");
  expect(cron).toContain("campaign approvals --client lothus");
  expect(cron).not.toContain("no-profile");
});
