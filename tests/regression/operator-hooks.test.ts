import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const python = process.platform === "win32" ? "python" : "python3";
const hooks = resolve("hooks");
const env = { ...process.env, PYTHONPATH: "", PYTHONDONTWRITEBYTECODE: "1" };

function git(cwd: string, ...args: string[]) {
  const r = spawnSync("git", ["-c", "user.email=qa@example.invalid", "-c", "user.name=qa", ...args], { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
}

function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "operator-hooks-"));
  git(dir, "init", "-q");
  git(dir, "commit", "-q", "--allow-empty", "-m", "init");
  return dir;
}

test("regression PR #170: UserPromptSubmit is not registered while the core adapter is unshipped", () => {
  const config = JSON.parse(readFileSync(join(hooks, "hooks.claude.json"), "utf8"));
  assert.equal("UserPromptSubmit" in config.hooks, false);
});

test("regression PR #170: user_prompt_submit.py degrades explicitly instead of crashing", () => {
  const r = spawnSync(python, [join(hooks, "user_prompt_submit.py")], { input: "{}", encoding: "utf8", env });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), {});
  assert.match(r.stderr, /degraded mode/);
});

test("regression PR #170: action_gate blocks when a delivery contract cannot be validated", () => {
  const repo = tempRepo();
  try {
    mkdirSync(join(repo, ".simplicio-loop/orchestrator/loop"), { recursive: true });
    writeFileSync(join(repo, ".simplicio-loop/orchestrator/loop/anchor.json"), JSON.stringify({ delivery: { allow_new_files_in_repo: false, allow_comments_in_code: false } }));
    writeFileSync(join(repo, "a.txt"), "x\n");
    git(repo, "add", "a.txt");
    const r = spawnSync(python, [join(hooks, "action_gate.py")], {
      cwd: repo, encoding: "utf8", env: { ...env, SIMPLICIO_LOOP: "1" },
      input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "git commit -m x" } }),
    });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /not importable.*fail-closed/);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test("regression PR #170: loop_stop refuses completion when the delivery contract module is missing", () => {
  const repo = tempRepo();
  try {
    mkdirSync(join(repo, ".simplicio-loop/orchestrator/loop"), { recursive: true });
    writeFileSync(join(repo, ".simplicio-loop/orchestrator/loop/anchor.json"), JSON.stringify({ delivery: { allow_new_files_in_repo: false, allow_comments_in_code: true } }));
    const code = "import sys,os; sys.path.insert(0, sys.argv[1]); import loop_stop; print(loop_stop._delivery_stop_guard(os.getcwd(), 1))";
    const r = spawnSync(python, ["-c", code, hooks], { cwd: repo, encoding: "utf8", env });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /not importable.*fail-closed/);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test("regression PR #170: pre-push never skips silently when no local gate exists", () => {
  const repo = tempRepo();
  try {
    mkdirSync(join(repo, "hooks"));
    copyFileSync(join(hooks, "action_gate.py"), join(repo, "hooks/action_gate.py"));
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "gate");
    const r = spawnSync(python, ["hooks/action_gate.py", "pre-push"], { cwd: repo, encoding: "utf8", env });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stdout, /no local gate found/);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test("regression PR #170: pre-push runs the package.json check script and blocks on failure", () => {
  const repo = tempRepo();
  try {
    mkdirSync(join(repo, "hooks"));
    copyFileSync(join(hooks, "action_gate.py"), join(repo, "hooks/action_gate.py"));
    writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "gate-fixture", private: true, scripts: { check: "node -e \"process.exit(3)\"" } }));
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "gate");
    const r = spawnSync(python, ["hooks/action_gate.py", "pre-push"], { cwd: repo, encoding: "utf8", env });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stdout, /local gate failed \(npm run check\)/);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});
