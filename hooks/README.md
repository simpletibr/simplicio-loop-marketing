# Hooks — simplicio-loop operator layer (marketing-engine)

> **This repo vs. simplicio-loop core.** These files are installed by `simplicio-loop install`
> (wheel 3.47.0, see `.simplicio-loop/install-ownership.json`), and parts of the upstream README
> describe the *core* repository (`scripts/check.py`, `plugin/`, `simplicio_loop/_bundle/`,
> `adapters/`, `scripts/install.sh`), none of which exist here. This copy is adjusted to what
> actually applies to marketing-engine. Local deviations from the upstream bundle are listed in
> [Local deviations](#local-deviations-from-the-3470-bundle); upstream tracking:
> simpletibr/simplicio-loop#1410.

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
| `action_gate.py` | safety: **fail-closed** — block irreversible ops + secret-laden commits/pushes BEFORE they run; `pre-push` also requires a green local gate — here `npm run check` (core repos use `scripts/check.py --core-gate`); no gate found → push blocked | `PreToolUse` (Bash) / git pre-push / pre-commit |
| `orient_clamp.py` | simplicio-orient: **wrapper** — run a command, return reduced output + tee-on-failure | called directly, any runtime |
| `orient_rewrite.py` | simplicio-orient: auto-route heavy read-only commands through the clamp (opt-in) | `PreToolUse` |
| `pre-commit.py` | core-only packaging hook (auto-syncs `plugin/` + `simplicio_loop/_bundle/`); **not used here** — this repo has neither tree nor the syncers. Do not wire it. | — |
| `user_prompt_submit.py` | Claude adapter bridge; **not registered** here because `adapters/claude/` is not shipped in the 3.47.0 wheel (simpletibr/simplicio-loop#1410). Invoked manually it runs in explicit degraded mode (exit 0). | — |

## Mirror auto-sync (`pre-commit.py`) — core only

`pre-commit.py` keeps the core repo's `plugin/` and `simplicio_loop/_bundle/` mirrors in sync
(`scripts/mirror_manifest.py`, `scripts/sync_plugin.py`, `scripts/sync_bundle.py`). None of those
exist in marketing-engine, so the hook has nothing to do here and is intentionally **not** wired
as `.git/hooks/pre-commit`.

## The safety gate (`action_gate.py`)

Enforces `simplicio-tasks` Step 5 mechanically instead of trusting the model to remember it.
Wire it as a Claude `PreToolUse` Bash hook (`hooks/hooks.claude.json`) AND, manually, as the git
pre-push hook (there is no installer step for git hooks in this repo):

```bash
# git pre-push: secret-scan the REAL push range (HEAD vs. upstream, not the staged diff) AND
# require a green local gate. Here that is `npm run check` (typecheck + e2e + action-gate
# selftest + doctor + claims audit, see scripts/check.mjs). GitHub Actions are currently
# DISABLED on this repository, so this hook is the only mechanical gate before a push.
printf '#!/bin/sh\npython3 hooks/action_gate.py pre-push\n' > .git/hooks/pre-push
chmod +x .git/hooks/pre-push
```

Gate resolution (`_local_gate_command`): `scripts/check.py --core-gate` if present (core), else
the `check` script from `package.json` (`npm run check`, this repo). If neither exists the push
is **blocked** with an explicit message — the gate never skips silently.

It blocks (exit 2): force-push / history rewrite (`filter-branch`), remote-ref deletion,
mass-delete (`rm -rf /`), destructive DDL (`DROP DATABASE`), infra teardown (`terraform destroy`),
any commit/push whose diff contains a secret (AWS/GitHub/Slack/OpenAI keys, private keys,
hardcoded credentials — placeholder-aware), and — for `pre-push` specifically — a failing or
missing local gate. A frozen delivery contract (`anchor.json` → `delivery`) whose validator
(`simplicio_loop.delivery_contract`) cannot be imported also blocks (fail-closed), both here and
in `loop_stop.py`. There is no bypass flag: fix the gate, don't skip it. `python3 hooks/action_gate.py
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
the loop (`afterAgentResponse` + `stop`).

### Claude Code
`hooks/hooks.claude.json` is the plugin-format registration (`Stop` + `PreToolUse`; the upstream
`UserPromptSubmit` entry is removed until the core ships the adapter, simpletibr/simplicio-loop#1410).
For a project/user `settings.json` instead, add (paths relative to the repo root, or absolute):

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
`orient_clamp.py` is invoked directly. (Per-runtime adapters live in the simplicio-loop core
repo under `adapters/<runtime>/`; they are not installed here.)

## Safety

- Fail-open everywhere: errors → stop allowed / command unchanged.
- `orient_rewrite.py` never rewrites writes, excluded, or compound commands (`&& | ; > $()`).
- The loop never exits on a self-reported "done" — only on an evidence-backed `<promise>`,
  the `max_iterations` cap, spindle handoff, or an explicit `.simplicio-loop/orchestrator/STOP`.
- Treat `.simplicio-loop/orchestrator/orient.toml` as untrusted perception-shaping config: review + hash-pin
  before trusting it (see `simplicio-orient`).

## Local deviations from the 3.47.0 bundle

The installer owns `hooks/` (`.simplicio-loop/install-ownership.json`), so a reinstall overwrites
these. They are needed until simpletibr/simplicio-loop#1410 lands upstream:

- `hooks.claude.json`: `UserPromptSubmit` registration removed (adapter not in the wheel).
- `user_prompt_submit.py`: explicit degraded mode (stderr warning, `{}`, exit 0) when the
  adapter cannot be imported.
- `action_gate.py`: pre-push falls back to `npm run check` and blocks when no gate exists;
  an unimportable `simplicio_loop.delivery_contract` with a frozen contract blocks.
- `loop_stop.py`: same `ImportError` handling — refuses completion instead of ignoring the contract.
- `README.md`: this file.
