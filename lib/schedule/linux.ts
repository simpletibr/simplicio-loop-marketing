import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { readdirSync } from "node:fs";

const MARKER_BEGIN = "# >>> marketing-engine begin >>>";
const MARKER_END = "# <<< marketing-engine end <<<";

interface CronEntries {
  generateHour: number;
  promoteHour: number;
}

function defaultEntries(): CronEntries {
  return { generateHour: 22, promoteHour: 9 };
}

function configuredCrontabFile(): string | undefined {
  return process.env.MARKETING_ENGINE_SCHEDULE_CRONTAB_FILE;
}

function shellQuote(value: string): string {
  if (/[\r\n\0]/.test(value)) {
    throw new Error("schedule: command root contains unsupported control characters");
  }

  return `"${value.replace(/["\\$`]/g, "\\$&")}"`;
}

/** Clients that already have a brand profile get a monthly plan on day 25. */
function clientsWithProfile(cmdRoot: string): string[] {
  const dir = join(cmdRoot, ".marketing-engine", "clients");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => /^[a-z0-9][a-z0-9-]{0,63}$/.test(name) && existsSync(join(dir, name, "brand-profile.hbi")))
    .sort();
}

function cronBlock(cmdRoot: string, entries: CronEntries = defaultEntries()): string {
  const quotedRoot = shellQuote(cmdRoot);
  // Day 25: plan the next month, render it and queue the client approvals.
  // Sending the approval link and scheduling stay manual steps.
  const monthly = clientsWithProfile(cmdRoot).map(
    (client) =>
      `0 7 25 * * cd ${quotedRoot} && npx marketing-engine campaign --client ${client} --days 30 --start next-month >> .marketing-engine/data/cron.log 2>&1 && npx marketing-engine campaign render --client ${client} >> .marketing-engine/data/cron.log 2>&1 && npx marketing-engine campaign approvals --client ${client} >> .marketing-engine/data/cron.log 2>&1`,
  );
  return `${MARKER_BEGIN}
0 ${entries.generateHour} * * * cd ${quotedRoot} && npx marketing-engine generate >> .marketing-engine/data/cron.log 2>&1
0 ${entries.promoteHour} * * * cd ${quotedRoot} && npx marketing-engine promote >> .marketing-engine/data/cron.log 2>&1
${monthly.length ? `${monthly.join("\n")}\n` : ""}${MARKER_END}
`;
}

function readCurrentCrontab(): string {
  const crontabFile = configuredCrontabFile();
  if (crontabFile) {
    return existsSync(crontabFile) ? readFileSync(crontabFile, "utf8") : "";
  }

  try {
    return execFileSync("crontab", ["-l"], { encoding: "utf8" });
  } catch {
    return "";
  }
}

function writeCurrentCrontab(next: string): void {
  const crontabFile = configuredCrontabFile();
  if (crontabFile) {
    if (!existsSync(dirname(crontabFile))) {
      mkdirSync(dirname(crontabFile), { recursive: true });
    }
    writeFileSync(crontabFile, next, "utf8");
    return;
  }

  const tmpPath = join(homedir(), ".marketing-engine-cron.tmp");
  try {
    writeFileSync(tmpPath, next, "utf8");
    execFileSync("crontab", [tmpPath], { encoding: "utf8" });
  } finally {
    if (existsSync(tmpPath)) {
      unlinkSync(tmpPath);
    }
  }
}

export function showCronPlan(cmdRoot: string): string {
  return cronBlock(cmdRoot);
}

export function installCron(cmdRoot: string): { added: boolean; message: string } {
  const current = readCurrentCrontab();
  if (current.includes(MARKER_BEGIN)) {
    return { added: false, message: "marketing-engine block already installed in crontab." };
  }

  const block = cronBlock(cmdRoot);
  const next = `${current}${current && !current.endsWith("\n") ? "\n" : ""}${block}`;
  writeCurrentCrontab(next);
  return { added: true, message: "crontab updated." };
}

export function uninstallCron(): { removed: boolean; message: string } {
  const current = readCurrentCrontab();
  if (!current) {
    return { removed: false, message: "no crontab to modify." };
  }

  const re = new RegExp(`${MARKER_BEGIN}[\\s\\S]*?${MARKER_END}\\n?`, "g");
  if (!re.test(current)) {
    return { removed: false, message: "no marketing-engine block found." };
  }

  const next = current.replace(re, "");
  writeCurrentCrontab(next);
  return { removed: true, message: "crontab cleaned." };
}

export function statusCron(): string {
  const current = readCurrentCrontab();
  if (!current) {
    return "no crontab installed";
  }
  if (!current.includes(MARKER_BEGIN)) {
    return "marketing-engine block: NOT installed";
  }

  const match = new RegExp(`${MARKER_BEGIN}([\\s\\S]*?)${MARKER_END}`).exec(current);
  return `marketing-engine block: installed\n${match?.[1]?.trim() ?? ""}`;
}
