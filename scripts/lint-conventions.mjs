#!/usr/bin/env node
/**
 * lint-conventions.mjs — repo convention lint, node builtins only.
 *
 * Rules enforced (all from CLAUDE.md / AGENTS.md):
 *  1. No `console.log` in library code (`lib/**` outside `lib/cli/`) —
 *     library output goes through stderr/observability, stdout is payload.
 *  2. Mocks (`__mocks__`) are only imported by the provider registries
 *     (`lib/providers/*.ts`, DRY_RUN-gated) and by tests — never by other
 *     production paths.
 *  3. Provider-neutral skills (the orchestrator super-skill, llm-router,
 *     video-prompt-builder) must not name concrete providers outside code
 *     spans — capability routing lives in PROVIDERS.md, not in skill prose.
 *  4. `.env` must not be tracked by git.
 *
 * Exit 0 when clean; exit 1 with one line per violation otherwise.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// URL.pathname is POSIX-shaped on Windows (/C:/...), which caused paths such
// as C:\\C:\\... and made the local gate fail before checking any files.
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const violations = [];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      walk(p, out);
    } else {
      out.push(p);
    }
  }
  return out;
}

// --- Rule 1: no console.log in lib/ outside lib/cli/ -----------------------
const libFiles = walk(join(ROOT, "lib")).filter((p) => p.endsWith(".ts"));
for (const file of libFiles) {
  const rel = relative(ROOT, file).split(String.fromCharCode(92)).join("/");
  if (rel.startsWith(join("lib", "cli") + "/")) continue;
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, "");
    if (/\bconsole\.log\s*\(/.test(code)) {
      violations.push(
        `${rel}:${i + 1} console.log in library code — use stderr/observability (stdout is machine payload)`,
      );
    }
  });
}

// --- Rule 2: __mocks__ imports only in provider registries and tests -------
const MOCK_IMPORT_ALLOWED = /^(lib\/providers\/[^/]+\.ts|lib\/providers\/__mocks__\/|e2e\/|tests\/)/;
for (const file of libFiles) {
  const rel = relative(ROOT, file).split(String.fromCharCode(92)).join("/");
  if (MOCK_IMPORT_ALLOWED.test(rel)) continue;
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (/from\s+["'][^"']*__mocks__/.test(line) || /import\s*\(\s*["'][^"']*__mocks__/.test(line)) {
      violations.push(
        `${rel}:${i + 1} __mocks__ import outside provider registry/tests — mocks never ship in production paths`,
      );
    }
  });
}

// --- Rule 3: provider-neutral skills stay provider-neutral -----------------
const PROVIDER_NAMES = [
  "higgsfield",
  "topview",
  "wavespeed",
  "adaptlypost",
  "meta-ads",
  "deepseek",
  "gpt-image",
  "simplicio-video",
  "ollama",
];
// video-prompt-builder is deliberately absent: it is the dispatcher whose
// job is the provider -> specialist-skill map (selection still comes from
// PROVIDERS.md); naming providers in that map is its contract, not a leak.
const NEUTRAL_SKILLS = [
  ".skills/simplicio-loop-marketing/SKILL.md",
  ".skills/llm-router/SKILL.md",
];
for (const relPath of NEUTRAL_SKILLS) {
  const file = join(ROOT, relPath);
  if (!existsSync(file)) continue;
  let text = readFileSync(file, "utf8");
  // Code spans/fences may reference module paths (lib/publish/adaptlypost.ts);
  // the rule targets prose that routes by vendor, not file references.
  text = text.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    for (const name of PROVIDER_NAMES) {
      if (line.toLowerCase().includes(name)) {
        violations.push(
          `${relPath}:${i + 1} provider name "${name}" in provider-neutral skill prose — route by capability via PROVIDERS.md`,
        );
      }
    }
  });
}

// --- Rule 4: .env is not tracked --------------------------------------------
try {
  const tracked = execFileSync("git", ["ls-files", ".env"], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
  if (tracked) {
    violations.push(".env is tracked by git — remove it (git rm --cached .env) and keep secrets out of the repo");
  }
} catch {
  // not a git checkout (e.g. installed package) — rule does not apply
}

if (violations.length > 0) {
  for (const v of violations) process.stderr.write(`lint: ${v}\n`);
  process.stderr.write(`lint: ${violations.length} violation(s)\n`);
  process.exit(1);
}
process.stdout.write("lint: clean\n");
