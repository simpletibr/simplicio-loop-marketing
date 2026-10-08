#!/usr/bin/env node
// marketing-engine — provider-agnostic AI marketing engine CLI
// Pure ESM, Node built-ins only (node:fs, node:path, node:url, node:child_process).

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, appendFileSync, writeSync } from "node:fs";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { constants as osConstants } from "node:os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_ROOT = resolve(__dirname, "..");

const USAGE = `marketing-engine - provider-agnostic AI marketing engine

Usage:
  marketing-engine <command> [options]

Commands:
  init        Scaffold .marketing-engine/ in current host project
  scan        Re-scan host project to refresh draft specs
  check       Validate provider env keys
  generate    Run generation loop (DRY_RUN-safe)
  promote     Run promotion loop
  loop        Autonomous loop: drain the piece backlog with attempt memory
              (journal, stall skip) then publish-verify and promote; DRY_RUN-safe
  doctor      Self-diagnostic: env keys, event stream, savings chain, loop
              journal, operator hooks (human on stderr, JSON on stdout)
  evidence    evidence gate <piece-id> (JSON, fail-closed)
  report      report build <piece-id> [--require-evidence] (mechanical markdown)
  findings    findings list|report|reconcile|doctor (Loop receipt projections)
  campaign    Plan a piece queue from a CAMPAIGN.md brief, or review one
  reference   Ingest or transcribe an authorized reference
  dashboard   Local read-only panel of the distribution loop (--client --campaign --port --no-browser --stop --status --json --snapshot --present)
  clips       Cut a client's long video into its long_cut slots (clips --client <slug> --url <url> [--estimate] [--approved-by-wesley]); DRY_RUN-safe, live spend needs the owner's OK
  dubbing     Language versions of a piece (dubbing estimate|dub|list|matrix --client <slug> ...); dub needs --approved-by-wesley
  metrics     Per-post performance loop (metrics link|collect|import|winners|report --client <slug>); winners feed the next month's plan (campaign --winners YYYY-MM)
  calendar    Show the month of a client (calendar --client <slug> [--format table|markdown])
  approval    Client approval link: request | page | record | serve | adjustments
  profile     Build the brand-profile/v1 of a client from its URL (profile <url> --client <slug>)
  low-ticket  Plan the complete Low Ticket lifecycle (dry-run)
  anchor      Freeze/check/gate a campaign anchor with durable AC receipts
  new-piece   Create a new piece markdown from the template
  status      Show pipeline state (counts + recent runs + 24h cost)
  logs        Tail data/llm-usage.jsonl
  cost        Aggregate llm-usage.jsonl over a window (cost --by-format [--client <slug>]: credits and voice per content format)
  ab-report   Join llm-usage + analytics; per-(task,provider) ROI
  alerts      Tail recent failures from runs + usage logs
  sync        Pull pieces from Notion calendar
  schedule    Install/uninstall cron / launchd entries
  watcher     Run one fail-closed self-paced campaign wake
  retrospective Mine deduped durable lessons from campaign evidence
  autoresearch  Run a fixed-judge, compliance-gated copy optimization loop (DRY_RUN only)
  operator    operator doctor --json (extension/core compatibility probe)
  help        Show this message

Options:
  --force         Overwrite existing files during init
  --root          Override host project root (default: cwd)
  --max-iter <N>  Cap iterations on generate / promote / loop
  --window <Nd>   Window for promote / cost / ab-report (default 7d)
  --mode <m>      loop mode: drain (default) or converge
  --client <slug> loop: only process pieces for this client

Docs: https://github.com/wesleysimplicio/marketing-engine
`;

function parseArgs(argv) {
  const args = {
    _: [],
    force: false,
    root: null,
    maxIter: null,
    window: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--force") {
      args.force = true;
    } else if (a === "--root") {
      args.root = argv[++i] ?? null;
    } else if (a.startsWith("--root=")) {
      args.root = a.slice("--root=".length);
    } else if (a === "--max-iter") {
      args.maxIter = Number(argv[++i]);
    } else if (a.startsWith("--max-iter=")) {
      args.maxIter = Number(a.slice("--max-iter=".length));
    } else if (a === "--window") {
      args.window = argv[++i] ?? null;
    } else if (a.startsWith("--window=")) {
      args.window = a.slice("--window=".length);
    } else {
      args._.push(a);
    }
  }
  return args;
}

function resolveHostRoot(args) {
  return args.root ? resolve(args.root) : process.cwd();
}

function ensureDir(path) {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

function writeIfMissing(path, content, force) {
  if (existsSync(path) && !force) {
    return false;
  }
  ensureDir(dirname(path));
  writeFileSync(path, content, "utf8");
  return true;
}

function safeReadJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function safeReadText(path, maxLines) {
  try {
    const txt = readFileSync(path, "utf8");
    if (typeof maxLines === "number") {
      return txt.split(/\r?\n/).slice(0, maxLines).join("\n");
    }
    return txt;
  } catch {
    return null;
  }
}

function detectStack(hostRoot) {
  const signals = [];
  if (existsSync(join(hostRoot, "package.json"))) signals.push("node");
  if (existsSync(join(hostRoot, "composer.json"))) signals.push("php");
  if (existsSync(join(hostRoot, "pyproject.toml"))) signals.push("python");
  if (existsSync(join(hostRoot, "Cargo.toml"))) signals.push("rust");
  if (existsSync(join(hostRoot, "pubspec.yaml"))) signals.push("dart");
  if (existsSync(join(hostRoot, "go.mod"))) signals.push("go");
  try {
    const entries = readdirSync(hostRoot);
    if (entries.some((e) => e.endsWith(".csproj") || e.endsWith(".sln"))) signals.push("dotnet");
  } catch {}
  return signals;
}

function detectVoiceSources(hostRoot) {
  const candidates = ["marketing", "brand", "docs/brand", "docs/marketing", "content"];
  const found = [];
  for (const rel of candidates) {
    const full = join(hostRoot, rel);
    if (existsSync(full)) {
      try {
        const st = statSync(full);
        if (st.isDirectory()) found.push(rel);
      } catch {}
    }
  }
  return found;
}

function scanHostProject(hostRoot) {
  const pkg = safeReadJson(join(hostRoot, "package.json")) || {};
  const readme = safeReadText(join(hostRoot, "README.md"), 200) || "";
  const stack = detectStack(hostRoot);
  const voiceSources = detectVoiceSources(hostRoot);
  return {
    name: pkg.name || basename(hostRoot),
    description: pkg.description || "",
    keywords: Array.isArray(pkg.keywords) ? pkg.keywords : [],
    homepage: pkg.homepage || "",
    repository:
      typeof pkg.repository === "string"
        ? pkg.repository
        : pkg.repository && pkg.repository.url
          ? pkg.repository.url
          : "",
    readme,
    stack,
    voiceSources,
  };
}

function brandDraft(scan) {
  const stackLine = scan.stack.length ? scan.stack.join(", ") : "(unknown)";
  const kw = scan.keywords.length ? scan.keywords.join(", ") : "(none)";
  return `# BRAND.md (DRAFT)

> Auto-generated by \`marketing-engine scan\`. Review, edit, then rename to \`BRAND.md\`.

## Product

- Name: ${scan.name}
- Description: ${scan.description || "(fill in)"}
- Homepage: ${scan.homepage || "(fill in)"}
- Repository: ${scan.repository || "(fill in)"}
- Detected stack: ${stackLine}
- Keywords: ${kw}

## Mission

(One-sentence mission. What does this product do, for whom, and what change does it cause?)

## Voice & Tone

(Pick three adjectives. Examples: confident, warm, technical, irreverent, calm, bold.)

## Forbidden language

(List phrases or claims that must never appear in marketing copy.)

## Visual identity

- Primary color:
- Accent color:
- Typography:
- Logo usage notes:
`;
}

function pillarsDraft(scan) {
  return `# PILLARS.md (DRAFT)

> Auto-generated by \`marketing-engine scan\`. Review, edit, then rename to \`PILLARS.md\`.

Pillars are the 3-5 recurring themes your content always returns to. Each pillar should be specific enough to suggest a piece, broad enough to power a quarter.

## Pillar 1 - (name)

- Why it matters:
- Audience pain it answers:
- Example pieces:

## Pillar 2 - (name)

- Why it matters:
- Audience pain it answers:
- Example pieces:

## Pillar 3 - (name)

- Why it matters:
- Audience pain it answers:
- Example pieces:

## Source signals from host project

- Product: ${scan.name}
- Description: ${scan.description || "(none)"}
- Keywords: ${scan.keywords.length ? scan.keywords.join(", ") : "(none)"}
`;
}

function personasDraft(scan) {
  const readmeSnippet = scan.readme ? scan.readme.slice(0, 600) : "(no README found)";
  return `# PERSONAS.md (DRAFT)

> Auto-generated by \`marketing-engine scan\`. Review, edit, then rename to \`PERSONAS.md\`.

## Persona A - (name)

- Role / context:
- Top jobs-to-be-done:
- Top objections:
- Where they hang out:
- Voice cues that resonate:

## Persona B - (name)

- Role / context:
- Top jobs-to-be-done:
- Top objections:
- Where they hang out:
- Voice cues that resonate:

## Source signals from host project

\`\`\`
${readmeSnippet}
\`\`\`
`;
}

function complianceDraft(scan) {
  return `# COMPLIANCE.md (DRAFT)

> Auto-generated by \`marketing-engine scan\`. Review, edit, then rename to \`COMPLIANCE.md\`.

## Forbidden claims

(List claims that legal, ethics, or brand policy disallow. Examples: "guaranteed results", medical diagnoses, unverifiable percentages.)

## Required disclaimers

(List disclaimers that must appear on certain piece types. Examples: paid partnership, individual experience, before/after.)

## Reviewer

- Primary: (name + email)
- Backup: (name + email)
- SLA: (turnaround time for compliance approval)

## Detected stack hints

- Stack: ${scan.stack.length ? scan.stack.join(", ") : "(unknown)"}
- Voice sources discovered: ${scan.voiceSources.length ? scan.voiceSources.join(", ") : "(none)"}
`;
}

function channelsDraft(scan) {
  return `# CHANNELS.md (DRAFT)

> Auto-generated by \`marketing-engine scan\`. Review, edit, then rename to \`CHANNELS.md\`.

## Active channels

- [ ] Instagram
- [ ] TikTok
- [ ] LinkedIn
- [ ] X / Twitter
- [ ] YouTube
- [ ] Newsletter / Email
- [ ] Blog
- [ ] Other:

## Per-channel notes

### Instagram

- Cadence:
- Formats: reel, carousel, story
- Voice deltas:

### TikTok

- Cadence:
- Formats:
- Voice deltas:

### LinkedIn

- Cadence:
- Formats:
- Voice deltas:

### X / Twitter

- Cadence:
- Formats:
- Voice deltas:

## Source

- Product: ${scan.name}
- Repository: ${scan.repository || "(none)"}
`;
}

function readmeContent() {
  return `# .marketing-engine/

This folder is managed by the \`marketing-engine\` CLI. Edit specs here.

## Files

- \`BRAND.md\` - brand voice, tone, forbidden language, visual identity.
- \`PILLARS.md\` - recurring content pillars.
- \`PERSONAS.md\` - target audiences.
- \`COMPLIANCE.md\` - forbidden claims, required disclaimers.
- \`CHANNELS.md\` - active channels and per-channel rules.
- \`pieces/\` - individual content pieces (one folder per piece).
- \`outputs/\` - generated artefacts (gitignored).
- \`data/\` - runtime data: usage logs, run logs (gitignored).
- \`.env\` - provider credentials (gitignored). Copy from \`.env.example\`.

## Workflow

1. Run \`npx marketing-engine scan\` to refresh draft specs from your host project.
2. Review \`*.draft.md\` files and rename to the final names above.
3. Run \`npx marketing-engine check\` to validate provider credentials.
4. Run \`npx marketing-engine generate\` to produce pieces.
5. Run \`npx marketing-engine promote\` to schedule publishing.
`;
}

function ensureGitignoreEntries(hostRoot) {
  const entries = [
    ".marketing-engine/.env",
    ".marketing-engine/outputs/*",
    ".marketing-engine/data/*",
  ];
  const path = join(hostRoot, ".gitignore");
  let current = "";
  if (existsSync(path)) {
    current = readFileSync(path, "utf8");
  }
  const lines = current.split(/\r?\n/);
  const toAdd = entries.filter((e) => !lines.includes(e));
  if (toAdd.length === 0) {
    return { added: [], created: !existsSync(path) };
  }
  const prefix = current && !current.endsWith("\n") ? "\n" : "";
  const block = (current ? prefix : "") + toAdd.join("\n") + "\n";
  if (!existsSync(path)) {
    writeFileSync(path, block, "utf8");
  } else {
    appendFileSync(path, block, "utf8");
  }
  return { added: toAdd, created: !current };
}

function commandInit(args) {
  const hostRoot = resolveHostRoot(args);
  const force = args.force;
  const target = join(hostRoot, ".marketing-engine");
  ensureDir(target);
  ensureDir(join(target, "pieces"));
  ensureDir(join(target, "outputs"));
  ensureDir(join(target, "data"));

  const scan = scanHostProject(hostRoot);

  const writes = [];
  const skipped = [];
  function tryWrite(rel, content) {
    const full = join(target, rel);
    const wrote = writeIfMissing(full, content, force);
    if (wrote) writes.push(rel);
    else skipped.push(rel);
  }

  tryWrite("BRAND.md", brandDraft(scan));
  tryWrite("PILLARS.md", pillarsDraft(scan));
  tryWrite("PERSONAS.md", personasDraft(scan));
  tryWrite("COMPLIANCE.md", complianceDraft(scan));
  tryWrite("CHANNELS.md", channelsDraft(scan));
  tryWrite("README.md", readmeContent());
  tryWrite("pieces/.gitkeep", "");
  tryWrite("outputs/.gitkeep", "");
  tryWrite("data/.gitkeep", "");

  const envExamplePath = join(PACKAGE_ROOT, ".env.example");
  if (existsSync(envExamplePath)) {
    const envText = readFileSync(envExamplePath, "utf8");
    tryWrite(".env.example", envText);
  }

  const gi = ensureGitignoreEntries(hostRoot);

  console.log(`Initialized .marketing-engine/ at ${target}`);
  console.log(`Wrote ${writes.length} file(s).`);
  if (skipped.length > 0) {
    console.log(`Skipped ${skipped.length} existing file(s) (use --force to overwrite):`);
    for (const s of skipped) console.log(`  - ${s}`);
  }
  if (gi.added.length > 0) {
    console.log(`Updated ${join(hostRoot, ".gitignore")} with: ${gi.added.join(", ")}`);
  } else {
    console.log(".gitignore already contains the required entries.");
  }
  console.log("Next: edit specs, then run `npx marketing-engine scan` or `npx marketing-engine check`.");
}

function commandScan(args) {
  const hostRoot = resolveHostRoot(args);
  const target = join(hostRoot, ".marketing-engine");
  if (!existsSync(target)) {
    console.error("ERROR: .marketing-engine/ not found. Run `marketing-engine init` first.");
    process.exit(1);
  }
  const scan = scanHostProject(hostRoot);

  const drafts = [
    ["BRAND.draft.md", brandDraft(scan)],
    ["PILLARS.draft.md", pillarsDraft(scan)],
    ["PERSONAS.draft.md", personasDraft(scan)],
    ["COMPLIANCE.draft.md", complianceDraft(scan)],
    ["CHANNELS.draft.md", channelsDraft(scan)],
  ];

  for (const [name, content] of drafts) {
    const full = join(target, name);
    writeFileSync(full, content, "utf8");
  }

  console.log(
    `Detected: name=${scan.name}, stack=${scan.stack.length ? scan.stack.join("+") : "unknown"}, ` +
      `voice signals from ${scan.voiceSources.length} source(s).`,
  );
  if (scan.voiceSources.length > 0) {
    console.log(`Voice sources: ${scan.voiceSources.join(", ")}`);
  }
  console.log(`Drafts written to ${target}/ (5 files).`);
  console.log("Review each `*.draft.md` and rename to the final name when ready.");
}

function parseDotenv(text) {
  const result = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function commandCheck(args) {
  const hostRoot = resolveHostRoot(args);
  const script = join(PACKAGE_ROOT, ".ralph", "provider-check.sh");
  if (!existsSync(script)) {
    console.error(`ERROR: provider-check.sh not found at ${script}`);
    process.exit(1);
  }

  const hostEnv = join(hostRoot, ".marketing-engine", ".env");
  const hostRootEnv = join(hostRoot, ".env");
  const packageEnv = join(PACKAGE_ROOT, ".env");

  let envFile = null;
  if (existsSync(hostEnv)) envFile = hostEnv;
  else if (existsSync(hostRootEnv)) envFile = hostRootEnv;
  else if (existsSync(packageEnv)) envFile = packageEnv;

  if (!envFile) {
    console.error("ERROR: no .env found. Looked at:");
    console.error(`  - ${hostEnv}`);
    console.error(`  - ${hostRootEnv}`);
    console.error(`  - ${packageEnv}`);
    console.error("Copy from .env.example and try again.");
    process.exit(1);
  }

  // Replicate provider-check.sh logic in JS so we can target the chosen .env.
  // Avoids shell-injection paths and lets us pick host-side env over package env.
  // The original script lives at .ralph/provider-check.sh and is preserved for
  // direct shell use; we keep parity with its checks below.
  const envContent = readFileSync(envFile, "utf8");
  const env = parseDotenv(envContent);

  let exitCode = 0;
  function check(varName, label, critical) {
    const val = env[varName];
    if (!val) {
      if (critical) {
        console.log(`FAIL  ${label}  (${varName} unset)`);
        exitCode = 1;
      } else {
        console.log(`WARN  ${label}  (${varName} unset, optional)`);
      }
    } else {
      console.log(`OK    ${label}  (${varName} set)`);
    }
  }

  console.log(`Using env file: ${envFile}`);
  console.log("== LLM providers ==");
  check("ANTHROPIC_API_KEY", "Claude (ANTHROPIC_API_KEY)", true);
  check("OPENAI_API_KEY", "OpenAI/Codex (OPENAI_API_KEY)", false);
  check("DEEPSEEK_API_KEY", "DeepSeek", false);
  console.log("== Image providers ==");
  check("OPENAI_API_KEY", "gpt-image (OPENAI_API_KEY)", false);
  check("TOPVIEW_API_KEY", "Topview", false);
  check("WAVESPEED_API_KEY", "Wavespeed", false);
  console.log("== Publish ==");
  check("ADAPTLYPOST_API_KEY", "AdaptlyPost", false);
  console.log("== Calendar ==");
  check("NOTION_TOKEN", "Notion", false);
  check("NOTION_CALENDAR_DB_ID", "Notion DB id", false);
  console.log("");
  if (exitCode === 0) {
    console.log("Provider check: PASS (defaults configured; warnings OK for opt-in providers)");
  } else {
    console.log("Provider check: FAIL (critical providers missing)");
  }
  process.exit(exitCode);
}

function runShellCheck() {
  // Reserved for a future flag (e.g. --shell) that defers to the original
  // provider-check.sh. Implementing here keeps spawnSync available without
  // an unused-import warning if we wire it in later.
  const script = join(PACKAGE_ROOT, ".ralph", "provider-check.sh");
  return spawnSync("bash", [script], { stdio: "inherit" });
}
void runShellCheck;

function resolveTsx() {
  const candidates = [
    join(PACKAGE_ROOT, "node_modules", "tsx", "dist", "cli.mjs"),
    join(PACKAGE_ROOT, "node_modules", ".bin", "tsx"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

function exitForSignal(signal) {
  const signalNumber = osConstants.signals?.[signal];
  return typeof signalNumber === "number" ? 128 + signalNumber : 1;
}

function replayOutput(fd, text) {
  if (!text) return;
  writeSync(fd, text);
}

function spawnTsx(scriptPath, extraArgs, hostRoot, options = {}) {
  const tsx = resolveTsx();
  if (!tsx) {
    console.error(
      "ERROR: tsx not found. Run `npm install` inside the marketing-engine package.",
    );
    process.exit(2);
  }
  const env = { ...process.env };
  const hostEnv = join(hostRoot, ".marketing-engine", ".env");
  const hostRootEnv = join(hostRoot, ".env");
  const packageEnv = join(PACKAGE_ROOT, ".env");
  let envFile = null;
  if (existsSync(hostEnv)) envFile = hostEnv;
  else if (existsSync(hostRootEnv)) envFile = hostRootEnv;
  else if (existsSync(packageEnv)) envFile = packageEnv;
  if (envFile) {
    const parsed = parseDotenv(readFileSync(envFile, "utf8"));
    for (const [k, v] of Object.entries(parsed)) {
      if (env[k] === undefined) env[k] = v;
    }
  }
  // The CLI scripts assume process.cwd() is the host root.
  // When running scripts inside lib/, package context is the marketing-engine repo,
  // so propagate host paths via env to keep `lib/` provider-agnostic.
  env.MARKETING_ENGINE_HOST_ROOT = hostRoot;
  // Default to DRY_RUN=true unless explicitly set in .env or shell.
  if (env.DRY_RUN === undefined) env.DRY_RUN = "true";
  // Run Node with the package's ESM loader directly. The tsx CLI's eval mode
  // opens a local IPC pipe, which is unavailable in restricted containers;
  // direct loader mode preserves the same TypeScript execution without it.
  const loader = resolve(join(PACKAGE_ROOT, "node_modules", "tsx", "dist", "esm", "index.mjs"));
  const childArgs = ["--import", loader, scriptPath, ...extraArgs];
  // Long-running commands (the loop) stream in real time via stdio:
  // "inherit"; short commands keep the buffered replay (default) so their
  // output ordering is stable.
  const result = spawnSync(process.execPath, childArgs, {
    cwd: hostRoot,
    env,
    ...(options.stdio === "inherit"
      ? { stdio: "inherit" }
      : { encoding: "utf8" }),
  });
  replayOutput(process.stdout.fd, result.stdout);
  replayOutput(process.stderr.fd, result.stderr);
  if (result.error) {
    process.stderr.write(`ERROR: failed to spawn tsx: ${result.error.message}\n`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = result.signal ? exitForSignal(result.signal) : (result.status ?? 1);
}

function commandGenerate(args) {
  const hostRoot = resolveHostRoot(args);
  const script = join(PACKAGE_ROOT, "lib", "cli", "generate.ts");
  const extra = [];
  if (args.maxIter !== null && args.maxIter !== undefined) {
    extra.push("--max-iter", String(args.maxIter));
  }
  spawnTsx(script, extra, hostRoot);
}

function commandPromote(args) {
  const hostRoot = resolveHostRoot(args);
  const script = join(PACKAGE_ROOT, "lib", "cli", "promote.ts");
  const extra = args._.slice(1);
  if (args.window) extra.push("--window", args.window);
  spawnTsx(script, extra, hostRoot);
}

function commandDoctor(args) {
  const hostRoot = resolveHostRoot(args);
  const script = join(PACKAGE_ROOT, "lib", "cli", "doctor.ts");
  spawnTsx(script, args._.slice(1), hostRoot);
}

function commandEvidence(args) {
  const hostRoot = resolveHostRoot(args);
  const script = join(PACKAGE_ROOT, "lib", "cli", "evidence.ts");
  spawnTsx(script, args._.slice(2), hostRoot);
}

function commandReport(args) {
  const hostRoot = resolveHostRoot(args);
  const script = join(PACKAGE_ROOT, "lib", "cli", "report.ts");
  spawnTsx(script, args._.slice(2), hostRoot);
}

function commandFindings(args) {
  const script = join(PACKAGE_ROOT, "lib", "cli", "findings.ts");
  spawnTsx(script, args._.slice(1), resolveHostRoot(args));
}

function commandLoop(args) {
  const hostRoot = resolveHostRoot(args);
  const script = join(PACKAGE_ROOT, "lib", "cli", "loop.ts");
  // --mode / --client are loop-local flags: they flow through args._ so the
  // global parser never swallows flags other subcommands (new-piece) own.
  const extra = [...args._.slice(1)];
  if (args.maxIter !== null && args.maxIter !== undefined) {
    extra.push("--max-iter", String(args.maxIter));
  }
  spawnTsx(script, extra, hostRoot, { stdio: "inherit" });
}

function commandCampaign(args) {
  const hostRoot = resolveHostRoot(args);
  const script = join(PACKAGE_ROOT, "lib", "cli", "campaign.ts");
  spawnTsx(script, args._.slice(1), hostRoot);
}

function commandReference(args) {
  const hostRoot = resolveHostRoot(args);
  const script = join(PACKAGE_ROOT, "lib", "cli", "reference.ts");
  spawnTsx(script, args._.slice(1), hostRoot);
}

function commandLowTicket(args) {
  const hostRoot = resolveHostRoot(args);
  const script = join(PACKAGE_ROOT, "lib", "cli", "low-ticket.ts");
  spawnTsx(script, args._.slice(1), hostRoot);
}

function commandProfile(args) {
  const hostRoot = resolveHostRoot(args);
  const script = join(PACKAGE_ROOT, "lib", "cli", "profile.ts");
  spawnTsx(script, args._.slice(1), hostRoot);
}

function commandDashboard(args) {
  const hostRoot = resolveHostRoot(args);
  const script = join(PACKAGE_ROOT, "lib", "cli", "dashboard.ts");
  spawnTsx(script, args._.slice(1), hostRoot, { stdio: "inherit" });
}

function commandClips(args) {
  const hostRoot = resolveHostRoot(args);
  const script = join(PACKAGE_ROOT, "lib", "cli", "clips.ts");
  spawnTsx(script, args._.slice(1), hostRoot, { stdio: "inherit" });
}

function commandDubbing(args) {
  const hostRoot = resolveHostRoot(args);
  const script = join(PACKAGE_ROOT, "lib", "cli", "dubbing.ts");
  spawnTsx(script, args._.slice(1), hostRoot, { stdio: "inherit" });
}

function commandMetrics(args) {
  const hostRoot = resolveHostRoot(args);
  const script = join(PACKAGE_ROOT, "lib", "cli", "metrics.ts");
  spawnTsx(script, args._.slice(1), hostRoot, { stdio: "inherit" });
}

function commandCalendar(args) {
  const hostRoot = resolveHostRoot(args);
  const script = join(PACKAGE_ROOT, "lib", "cli", "calendar.ts");
  spawnTsx(script, args._.slice(1), hostRoot);
}

function commandApproval(args) {
  const hostRoot = resolveHostRoot(args);
  const script = join(PACKAGE_ROOT, "lib", "cli", "approval.ts");
  spawnTsx(script, args._.slice(1), hostRoot, { stdio: "inherit" });
}

function commandAnchor(args) {
  const hostRoot = resolveHostRoot(args);
  const script = join(PACKAGE_ROOT, "lib", "cli", "anchor.ts");
  spawnTsx(script, args._.slice(1), hostRoot, { stdio: "inherit" });
}

function commandNewPiece(args) {
  const hostRoot = resolveHostRoot(args);
  const script = join(PACKAGE_ROOT, "lib", "cli", "new-piece.ts");
  spawnTsx(script, args._.slice(1), hostRoot);
}

function commandStatus(args) {
  const hostRoot = resolveHostRoot(args);
  const script = join(PACKAGE_ROOT, "lib", "cli", "status.ts");
  spawnTsx(script, [], hostRoot);
}

function commandLogs(args) {
  const hostRoot = resolveHostRoot(args);
  const script = join(PACKAGE_ROOT, "lib", "cli", "logs.ts");
  spawnTsx(script, args._.slice(1), hostRoot);
}

function commandCost(args) {
  const hostRoot = resolveHostRoot(args);
  const script = join(PACKAGE_ROOT, "lib", "cli", "cost.ts");
  const extra = args._.slice(1);
  if (args.window) extra.push("--window", args.window);
  spawnTsx(script, extra, hostRoot);
}

function commandAbReport(args) {
  const hostRoot = resolveHostRoot(args);
  const script = join(PACKAGE_ROOT, "lib", "cli", "ab-report.ts");
  spawnTsx(script, args._.slice(1), hostRoot);
}

function commandAlerts(args) {
  const hostRoot = resolveHostRoot(args);
  const script = join(PACKAGE_ROOT, "lib", "cli", "alerts.ts");
  spawnTsx(script, args._.slice(1), hostRoot);
}

function commandSync(args) {
  const hostRoot = resolveHostRoot(args);
  const script = join(PACKAGE_ROOT, "lib", "cli", "sync.ts");
  spawnTsx(script, args._.slice(1), hostRoot);
}

function commandSchedule(args) {
  const hostRoot = resolveHostRoot(args);
  const script = join(PACKAGE_ROOT, "lib", "cli", "schedule.ts");
  spawnTsx(script, args._.slice(1), hostRoot);
}

function commandWatcher(args) {
  const script = join(PACKAGE_ROOT, "lib", "cli", "watcher.ts");
  spawnTsx(script, args._.slice(1), resolveHostRoot(args), { stdio: "inherit" });
}

function commandRetrospective(args) {
  const script = join(PACKAGE_ROOT, "lib", "cli", "retrospective.ts");
  spawnTsx(script, args._.slice(1), resolveHostRoot(args), { stdio: "inherit" });
}

function commandAutoresearch(args) {
  const hostRoot = resolveHostRoot(args);
  const script = join(PACKAGE_ROOT, "lib", "cli", "autoresearch.ts");
  spawnTsx(script, args._.slice(1), hostRoot, { stdio: "inherit" });
}

function commandOperator(args) {
  const script = join(PACKAGE_ROOT, "lib", "cli", "operator.ts");
  spawnTsx(script, [...args._.slice(1), "--package-root", PACKAGE_ROOT], resolveHostRoot(args));
}

function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const cmd = args._[0];

  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    process.stdout.write(USAGE);
    process.exit(0);
  }

  switch (cmd) {
    case "init":
      commandInit(args);
      return;
    case "scan":
      commandScan(args);
      return;
    case "check":
      commandCheck(args);
      return;
    case "generate":
      commandGenerate(args);
      return;
    case "promote":
      commandPromote(args);
      return;
    case "loop":
      commandLoop(args);
      return;
    case "doctor":
      commandDoctor(args);
      return;
    case "evidence":
      commandEvidence(args);
      return;
    case "report":
      commandReport(args);
      return;
    case "findings":
      commandFindings(args);
      return;
    case "campaign":
      commandCampaign(args);
      return;
    case "reference":
      commandReference(args);
      return;
    case "profile":
      commandProfile(args);
      return;
    case "approval":
      commandApproval(args);
      return;
    case "calendar":
      commandCalendar(args);
      return;
    case "clips":
      commandClips(args);
      return;
    case "dubbing":
      commandDubbing(args);
      return;
    case "metrics":
      commandMetrics(args);
      return;
    case "dashboard":
      commandDashboard(args);
      return;
    case "low-ticket":
      commandLowTicket(args);
      return;
    case "anchor":
      commandAnchor(args);
      return;
    case "new-piece":
      commandNewPiece(args);
      return;
    case "status":
      commandStatus(args);
      return;
    case "logs":
      commandLogs(args);
      return;
    case "cost":
      commandCost(args);
      return;
    case "ab-report":
      commandAbReport(args);
      return;
    case "alerts":
      commandAlerts(args);
      return;
    case "sync":
      commandSync(args);
      return;
    case "schedule":
      commandSchedule(args);
      return;
    case "watcher":
      commandWatcher(args);
      return;
    case "retrospective":
      commandRetrospective(args);
      return;
    case "autoresearch":
      commandAutoresearch(args);
      return;
    case "operator":
      commandOperator(args);
      return;
    default:
      console.error(`Unknown command: ${cmd}`);
      process.stderr.write(USAGE);
      process.exit(1);
  }
}

main();
