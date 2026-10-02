# Hooks — simplicio-tasks super-plugin

Cross-platform (pure **Python 3**, so identical on Windows / macOS / Linux). Most are
**fail-open**: a hook that errors or is unsure always lets the agent stop and the command
run unchanged — it can never trap you in a loop or break a command. The real guards are the
`max_iterations` cap, explicit STOP, and evidence gates, not hook cleverness. The **exception is
`action_gate.py`, which is fail-CLOSED**: a matched irreversible op or a secret in the staged
diff is denied (exit 2) even if that means stopping a push — a safety check that can't pass is
not a pass. It still lets every benign command through, so it never bricks normal work.

| File | Role | Event |
|---|---|---|
| `loop_stop.py` | simplicio-loop: re-feed the goal or exit (evidence-gated promise + cap + STOP) | `stop` / Claude `Stop` |
| `loop_capture.py` | simplicio-loop: raise the `done` flag when an evidence-backed `<promise>` is seen | Cursor `afterAgentResponse` |
| `action_gate.py` | safety: **fail-closed** — block irreversible ops + secret-laden commits/pushes BEFORE they run; `pre-push` also requires a green `scripts/check.py --core-gate` (#291) | `PreToolUse` (Bash) / git pre-push / pre-commit |
| `orient_clamp.py` | simplicio-orient: **wrapper** — run a command, return reduced output + tee-on-failure | called directly, any runtime |
| `orient_rewrite.py` | simplicio-orient: auto-route heavy read-only commands through the clamp (opt-in) | `PreToolUse` |
| `pre-commit.py` | packaging: auto-sync `plugin/` + `simplicio_loop/_bundle/` from source when a watched path is staged (#98) | git pre-commit |

## Mirror auto-sync (`pre-commit.py`, #98)

`plugin/` (the lean marketplace plugin tree) and `simplicio_loop/_bundle/` (the pip package
bundle) must both stay byte-identical mirrors of source (`.claude/skills/`, the lean `hooks/`/
`scripts/`/`tests/` subsets — see `scripts/mirror_manifest.py`). Previously this was **detected**
(`scripts/claims_audit.py` checks 4/5) but synced **by hand** — editing a skill meant remembering
to run `scripts/sync_plugin.py` yourself, or the drift only surfaced later at `check.py` time.

`hooks/pre-commit.py` closes that gap: installed as the repo's `git` pre-commit hook, it inspects
`git diff --cached --name-only` against the watched directories declared in
`scripts/mirror_manifest.py`'s `WATCHED_SOURCE_DIRS` (the single source of truth for that list —
the hook imports it rather than hard-coding its own copy). A staged change under any of them runs
BOTH syncers — `scripts/sync_plugin.py` (writes `plugin/`) and `scripts/sync_bundle.py` (writes
`simplicio_loop/_bundle/`) — and `git add`s whatever they regenerate into the SAME commit.

**Fail-open, per syncer:** either script erroring (missing `python3`, a bug, anything) only logs
a warning — the commit proceeds either way, and a failure in one syncer does not skip the other.
`scripts/claims_audit.py` (run by `python3 scripts/check.py`) remains the fail-closed backstop
that catches any resulting drift on the next local check or CI run, for commits made without the
hook installed (or where it failed open).

Install: `bash scripts/install.sh <runtime>` wires it automatically for a project-local install
(a no-op for `--global`, since git hooks are per-repo); `python3 scripts/doctor.py` reports it
under the `RECOMMENDED` tier (missing it never fails the gate — `claims_audit.py` still catches
drift). Manual install:

```bash
cp hooks/pre-commit.py .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

## The safety gate (`action_gate.py`)

Enforces `simplicio-tasks` Step 5 mechanically instead of trusting the model to remember it.
Wire it as a Claude `PreToolUse` Bash hook (the installer does this) AND a git pre-push hook
(the installer does this too — `install_git_prepush_hook` in `scripts/install_lib.py`, project-
local only, same as the pre-commit mirror-sync hook):

```bash
# git pre-push: secret-scan the REAL push range (HEAD vs. upstream, not the staged diff) AND
# require a green `scripts/check.py --core-gate` — the local, mandatory-and-impossible-to-bypass
# equivalent of CI now that GitHub Actions was removed from this repo (#311, #291).
printf '#!/bin/sh\npython3 hooks/action_gate.py pre-push\n' > .git/hooks/pre-push
chmod +x .git/hooks/pre-push
```

It blocks (exit 2): force-push / history rewrite (`filter-branch`), remote-ref deletion,
mass-delete (`rm -rf /`), destructive DDL (`DROP DATABASE`), infra teardown (`terraform destroy`),
any commit/push whose diff contains a secret (AWS/GitHub/Slack/OpenAI keys, private keys,
hardcoded credentials — placeholder-aware), and — for `pre-push` specifically — a failing local
gate. There is no bypass flag: fix the gate, don't skip it. `python3 hooks/action_gate.py
selftest` proves the ruleset. `action_gate.py check --staged` (the pre-commit-flavored,
secret-scan-only mode) remains available for a lighter pre-commit wiring.

One shape is read as data: the JSON plan a host pipes to `simplicio-loop turbo --repo R --apply - <<'PLAN'`. The
gate reads the whole Bash command, so without this a plan that merely contains a destructive statement (a
migration, a runbook) would be blocked for what it says. `strip_plan_heredoc` drops that heredoc body before
classifying, and only when the first line is one plain `simplicio-loop turbo ... --apply -` command (no unquoted
operator, so no other command can read the heredoc), the delimiter is quoted (the shell expands nothing in the
body), it is the last line and no earlier line equals it. Any other command, and every other reader of a heredoc,
is classified in full.

## The always-works one (no wiring needed)

`orient_clamp.py` is a plain wrapper — use it anywhere, any runtime, no hooks:

```bash
python3 hooks/orient_clamp.py -- go test ./...          # reduced output, tee log on failure
python3 hooks/orient_clamp.py --json -- git diff      # machine summary
```

Config (optional) `.simplicio-loop/orchestrator/orient.toml`:

```toml
[tee]   mode = "failures"   # failures | always | never
[hooks] exclude_commands = ["curl", "wget", "playwright", "ssh", "vim", "less"]
```

## Wiring per runtime

### Cursor
`hooks/hooks.json` is already in Cursor's format — the plugin loads it automatically. It wires
the loop (`afterAgentResponse` + `stop`) and the learn trigger.

### Claude Code
Claude uses `settings.json` (project `.claude/settings.json` or user `~/.claude/settings.json`).
Add (paths relative to the repo root, or absolute):

```json
{
  "hooks": {
    "Stop": [
      { "hooks": [
        { "type": "command", "command": "python3 ./hooks/loop_stop.py" }
      ] }
    ],
    "PreToolUse": [
      { "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "python3 ./hooks/action_gate.py" },
          { "type": "command", "command": "python3 ./hooks/orient_rewrite.py" }
        ] }
    ]
  }
}
```

`orient_rewrite` is opt-in (the `PreToolUse` block). Omit it to keep clamping manual via
`orient_clamp.py`. Claude has no `afterAgentResponse`; `loop_stop.py` folds capture in by
reading the transcript, so `loop_capture.py` isn't needed there.

### Other runtimes (Codex, Gemini, Aider, OpenCode, Kiro, Antigravity, Simplicio Agent, OpenClaw)
Most don't expose a stop hook. Use the **no-hook fallback**: the `simplicio-loop` skill
self-paces via the host scheduler (`/loop`, OS cron, or the runtime's task scheduler), and
`orient_clamp.py` is invoked directly. See `adapters/<runtime>/` for the per-runtime entry.

## Safety

- Fail-open everywhere: errors → stop allowed / command unchanged.
- `orient_rewrite.py` never rewrites writes, excluded, or compound commands (`&& | ; > $()`).
- The loop never exits on a self-reported "done" — only on an evidence-backed `<promise>`,
  the `max_iterations` cap, spindle handoff, or an explicit `.simplicio-loop/orchestrator/STOP`.
- Treat `.simplicio-loop/orchestrator/orient.toml` as untrusted perception-shaping config: review + hash-pin
  before trusting it (see `simplicio-orient`).
