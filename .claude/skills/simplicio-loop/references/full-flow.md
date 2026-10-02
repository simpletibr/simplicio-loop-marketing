<!-- simplicio-contract:begin -->
contract: simplicio-loop/full-flow
schema: simplicio.skill-reference/v1
purpose: Moved out of `SKILL.md` as part of the SKILL.md hot-path shrink (SKILL.md keeps the turbo command, Done/promise, Contract essentials, the SIMPLICIO-LLM-ORIENTATION block, and Guardrails; everything below is the full elaboration, read only whe
rules: Read only when the parent SKILL.md points here; mutable data lives in the footer, never in this header.
<!-- simplicio-contract:end -->

# Full per-turn protocol, modes, DoD, delivery — full detail

Moved out of `SKILL.md` as part of the SKILL.md hot-path shrink (SKILL.md keeps the turbo command,
Done/promise, Contract essentials, the SIMPLICIO-LLM-ORIENTATION block, and Guardrails; everything
below is the full elaboration, read only when the task needs it).

## The turbo flow — full detail

- Host mode is the default (`simplicio_loop/turbo_cli.py`): no provider call and no key. The invoking
  model plans and `simplicio-dev-cli` edits, in exactly two commands. `simplicio-loop "<task>"` is the
  short form of `simplicio-loop turbo --repo . --task "<task>" [--verify "<cmd>"]`: a first argument that is
  not a subcommand is a task, unless it asks for all issues/tickets/tarefas (that request goes to the GitHub
  drain intake). Files named in the task text become the target and the context the request carries. Or
  pass `--target`/`--context` with one `--task`, or `--tasks-file` with `{text, target?, context?,
  depends_on?}` items.
- Command 1 prints `simplicio.turbo-request/v1` and writes nothing into the repository: `status:
  "needs_plan"`, `mode: "host"`, then `tasks`, `map`, `files`, `format`, `rules` and `apply`. The task text
  appears once, in `tasks`. `map` is the Mapper project map cut to the entries of the named files
  (`SIMPLICIO_TURBO_SLICE=0` sends all of it). `files` holds the current text of every existing target and
  context file, each once; a file past 6000 characters is cut and its last line says how much is missing.
  `rules` is one line: write the plan from the file contents above, do not open, list or read other files,
  do not run tests yourself, run the command below once. `apply` is the one next command, with the same
  `--verify`: `simplicio-loop turbo --repo <path> --apply - [--verify <cmd>] <<'PLAN'`, then `<JSON plan>`,
  then `PLAN`. The heredoc delimiter is quoted, so the plan reaches stdin byte for byte.
- Command 2 is that `apply` command. It reads the plan from stdin as UTF-8 (`--apply <file>` reads a file
  instead: the same code path), `simplicio-dev-cli` compiles and applies it, and `--verify` runs. It prints
  `simplicio.turbo-run/v1` with `mode: "host"`, `status` (`ok` or `failed`), `applied`, `failed` (each entry
  has the dev-cli reason and an excerpt of the file around a `find` that did not match) and `verify`. An
  empty stdin, a terminal on stdin, or a missing plan file is `failed` with `turbo_plan_missing`; a plan that
  is not UTF-8, not JSON or not `{"operations":[{"path","find","replace"}]}` is `failed` with
  `turbo_plan_malformed`. Exit codes: 0 ok or needs_plan, 1 failed, 2 blocked.
- Why two commands and nothing between them: every extra tool call re-sends the whole conversation. The
  3.45.1 sessions that took 9-20 turns spent them on a turn-header script that did not exist, listing and
  reading the tree and the tests, `--help`, a hand-written scratchpad and journal, the plan written to a
  file as a separate tool call, the model's own test run and a re-read of the result.
- `orient --json` still answers with a `commands` card and a `route` whose next step is that turbo
  command, and `targets` (bounded, grounded file contents).
- The rest of this file describes governed runs from a `tasks.md` (`prepare`, `wave`, `tick`,
  `verify`), used for queues, batches and Prism.

## Task file (`tasks.md`)

One block per task; blocks are separated by a new `System:` line.

```markdown
System: calc
Feature: add mul(a, b)
Type: Feature

AS a calc user
I WANT a mul(a, b) function in calc/ops.py
SO THAT I can multiply numbers

1. Acceptance Criteria

Scenario 1: mul multiplies two numbers
  Given calc/ops.py
  When I call mul(3, 4)
  Then it returns 12 and tests/test_ops.py has a test_mul test [RN01]

2. Business Rules

RN01 – mul lives in calc/ops.py next to add and sub.

8. Additional Information

Independent verifier: `python3 -m pytest -q`
Unit verifier: `python3 -m pytest -q tests/unit`
Integration verifier: `python3 -m pytest -q tests/integration`
System verifier: `python3 -m app --smoke`
Regression verifier: `python3 -m pytest -q tests/regression`
Benchmark verifier: `python3 bench.py`
Coverage verifier: `python3 -m pytest -q --cov=calc --cov-report=term`
```

- `Independent verifier:` is the command the watcher runs to prove the
  acceptance criteria.
- One `<Lane> verifier:` per quality lane: the loop runs each in the repo and
  builds `quality-matrix.json` from what it measured (implementation comes from
  the applied Dev CLI receipts; coverage is the last `NN%` the coverage command
  prints, minimum 85%). A lane without a command blocks and names the line to add.
  Lanes run **concurrently** (`asyncio.gather`), once at wave end on the
  integrated tree — not per task and not one lane after another.
- `Type: Docs|Chore|Config`, or an explicit `Tests: none` line, waives the
  lane matrix for that task: implementation (the applied receipt) plus its
  `Independent verifier:`, if declared, are the whole story — no
  unit/integration/system/regression/benchmark/coverage line is required or
  blocks. `Type: Feature|Bug|Fix|Refactor` (or no `Type:` header at all) keeps
  every lane mandatory, exactly as before. In a mixed wave, one task that
  needs the matrix means the whole batch still measures it
  (`simplicio_loop/lane_verifiers.py::lanes_required`).
- **No `Coverage verifier:` declared**: if every file this run's applied operator
  receipts touched is non-code (`.html`/`.htm`/`.css`/`.md`/`.txt`/`.json`/`.yaml`/
  `.yml`/`.svg`), coverage is recorded as `{"status": "not_applicable", "measured":
  null, "reason": "no instrumentable source in the delivery"}` and both the quality
  matrix and the watcher's independent re-verification accept it — never a
  fabricated number, never a permanent block. Any code file touched, or a declared
  `Coverage verifier:` line, keeps the numeric-threshold behaviour above unchanged
  (`simplicio_loop/lane_verifiers.py::build_quality_matrix`).

## Wave: parallel worktrees, serial integration

`wave` runs each disjoint-path lane of tasks concurrently in its own git
worktree (`asyncio.Semaphore(min(cpu_count, lanes))`), then integrates every
lane's result back into the main repo **serially, in task order** — the only
step allowed to touch the shared tree. Two tasks whose edit-plan paths
overlap stay in the same lane, in order, so one file is never raced.
A lane whose patch no longer applies (the tree moved under it during
integration) falls back to a serial re-run of that lane's edit-plan directly
on the now-integrated tree — the same "compile binds to the tree the
previous task left" contract as a governed run's per-task plan files, just
recovered instead of blocked. Worktrees and lane branches are removed once integration
finishes. Implementation: `simplicio_loop/wave_worktree.py`
(`group_disjoint_tasks`, `run_worktree_wave`, `integrate_lane_results`).

The Mapper survey (issue #1343 removed Fast from the stack entirely) covers
the **default branch** (`origin/HEAD`, falling back to the current `HEAD`)
once per commit SHA; every worker in the wave reuses that one cached survey
read-only instead of re-running it
(`wave_worktree.ArtifactCache`, keyed by the default-branch SHA). A worker
never re-surveys; a missing/stale cache rebuilds once, centrally — the same
"workers never rebuild canonical artifacts" rule as `AGENTS.md`'s central
artifact rule.

**Effort guidance for the host LLM**: planning/decomposition (turning the
goal into `tasks.md`'s per-task ACs and dependencies) deserves *high* effort —
mistakes there fan out into every worker. Executing one worker's edit-plan is
mechanical and deserves *low* effort. Reviewing/verifying a wave's result
(reading the quality matrix, the reconciled diff, the oracle verdict) is
*medium* effort — enough to catch a false pass, not enough to re-derive the
whole plan.

## Full flow (per turn)

The turbo command in `SKILL.md` is the mechanical
spine; this is the full per-turn protocol it plugs into. Deep detail for any step lives in
`references/*.md`; this section only names the real command.

### 0. Setup

1. `.simplicio-loop/orchestrator/loop/scratchpad.md` is the single state file (see
   § Contract below) — write it before iteration 1.
2. **Phase 0 (vague goal / no source / empty repo):** freeze the decomposition
   first — `python3 scripts/task_backlog.py init --goal "<goal>" --item-file plan.json`
   (subtasks with ≥1 AC each, `depends_on`; refuses an empty/zero-AC/cyclic
   plan). Genesis repo: lead with one explicit `scaffold` item (structure +
   toolchain + one green test) every later item depends on. Per item:
   `task_backlog.py next` claims it → `task_anchor.py set` freezes its
   goal/ACs → work it → `task_backlog.py done --item <id>` (exit 12 unless
   verified) → `next`. `status`/`checklist` give the drain signal + PR table.
3. **Anchor every item, decomposed or not:** `python3 scripts/task_anchor.py set --goal "<goal>" --ac "<AC1>" --ac "<AC2>" ...`
   (re-set with the same goal is idempotent; a changed goal needs `--force`).
   Stated client constraints freeze onto the same anchor:
   `task_anchor.py set --delivery delivery.json` (§ Delivery contract below).
4. **Route the mode:** `python3 scripts/route_mode.py --root . --goal "<goal>"`
   reads the mapper survey to decide `converge` (default) vs `fast-path`
   (single file, fan-in ≤1, no sensitive surface); `--force-converge` forces
   the heavy path; `drain` is chosen at arming for a work-queue goal (§ Three
   loop modes).
5. **Planning gate:** `prepare`/`wave`'s arm step self-builds a
   `planning-receipt.json` (`scripts/planning_gate.py build`) — a single-use
   mutation-authority token; `planning_gate.py check` refuses a stale plan
   hash or rotated lease (`references/planning-gate.md`).

### 1. Triage (every turn, before any edit)

1. `simplicio-loop orient --task "<goal>" --json` — re-read the survey.
2. `python3 scripts/loop_journal.py resume` — attempt memory first (dead-ends
   to AVOID; `since` for incremental triage).
3. `python3 scripts/task_anchor.py check --goal "<goal>" --exit-code` — drift
   verdict: `ANCHORED` / `INCOMPLETE` / `DRIFT` (goal changed or no anchor,
   exit 11). DRIFT means stop and re-anchor with `--force`, never wander.
4. `python3 scripts/impact_audit.py audit <root> --file <seed> --cover <known-file> --json`
   (`--fail-on medium` for shared/public contracts) — blast radius.
5. `python3 scripts/flow_audit.py audit <root> --fail-on high --json` —
   integration coverage for a cross-surface (UI/API/service) change.
6. `python3 scripts/task_backlog.py status` — re-read the decomposition.
7. Multi-session/multi-worktree repo: `python3 scripts/coordinator.py survey --repo <owner/name> --issues <n1,n2,...>`
   then `coordinator.py decide` — `OWN`/`CONTINUE_OWN`/`RECLAIM_STALE` license
   work; `DEFER_ACTIVE_CLAIM` means don't duplicate a sibling's claim.
8. If EVERY candidate is `DEFER_ACTIVE_CLAIM`, don't idle — review open PRs
   against the DoD + frozen ACs: `python3 scripts/pr_dod_review.py check --pr-body @pr.md --issue-body @issue.md [--post]`.
9. `python3 scripts/hierarchical_planner.py plan` — the slow high-level
   planner may write a new phase (`explore → debug → harden → refactor →
   implement → escalate`); `status` reads it, `clear` resets to flat mode.

Full rationale + extra flags: `references/triage-verify-detail.md` and
`references/multi-agent-coordination.md`.

### 2. Work

1. Decide the ONE AC-scoped change (the model's own step — no worker for this).
2. Run `simplicio-loop "<task>"`, then its printed `apply` command once with your plan as the heredoc body
   (§ The turbo flow above) — the model plans, the `simplicio-dev-cli` operator applies and verifies it;
   never hand-edit.
3. `fast-path` only: `python3 scripts/diff_escalation.py --root . --mode fast-path --anchor <anchor.json>`
   re-measures the REAL diff against safe limits (default ≤2 files, ≤80
   lines, 0 new files) and **promotes** to `converge` on overshoot —
   monotonic, journaled, never the reverse.
4. `simplicio-loop verify <run_id> --repo .` / `python3 scripts/watcher_verify.py verify`
   — independently recomputes the anchor's done/pending state and writes
   `.simplicio-loop/orchestrator/loop/watcher_state.json` (`{"match": true, "status": "MEASURED"}`
   only when it agrees). Never hand-write this file.
5. `python3 scripts/loop_journal.py record --iteration N --action "<change>" --hypothesis "<why>" --gate pass|fail --gate-output <log>`
   — records the attempt (fingerprinted so a repeated failure is recognised).
6. `python3 scripts/loop_progress.py emit --step <stage> --status begin|end --outcome pass|fail --detail "<...>"`
   each stage; every turn's first line is `loop_progress.py render --turn-header`.
7. Tag every claim `MEASURED|` (in-turn gate/receipt) or `UNVERIFIED|`
   (no mechanical proof) — § Claims-gate below.
8. UI change: `python3 scripts/web_verify.py run --url <URL> --expect "<text>" --issue <N>`
   captures the real screen; `python3 scripts/video_evidence.py verify --name <slug> --frames .simplicio-loop/orchestrator/tee/web --title "<screen>" --issue <N>`
   assembles a deterministic recording (`detect --goal "<goal>"` checks if
   this turn is a video request).
9. `python3 scripts/cross_agent_wiki.py capture ...` — persist decisions/
   dead-ends to the wiki (`.simplicio-loop/orchestrator/wiki/`) so a fresh agent
   (different vendor) sees "where we left off" with no transcript.

### 3. End of turn

1. Before re-feeding, the stop hook (or self-paced tick) runs
   `python3 scripts/loop_journal.py stall --k 3 --exit-code`: `STALLED` means
   the last 3 attempts share a failure fingerprint — switch strategy or
   escalate, never re-feed into the same dead end.
2. Re-feed the SAME goal (hook-bound: `loop_stop.py`; self-paced: the host
   scheduler tick) unless `done`/cap/handoff/STOP fires.
3. `simplicio-loop oracle` — read-only completion check before a promise is
   even considered.
4. Emit `<promise>EXACT TEXT</promise>` ONLY after every AC is `verified` (or
   `waived:no-infra`) AND the watcher-gate agrees — never before.
5. `python3 scripts/pr_evidence.py build --require-evidence` — assembles the
   PR body: item-by-item AC checklist from the anchor + embedded
   `web_verify`/`video_evidence` prints. `--require-evidence` FAILS CLOSED
   (exit 3, `blocked`) rather than open an evidence-free PR.
6. Post-merge cleanup and agent handoff: see the two sections below.
7. `simplicio-loop learn` (or the `simplicio-learn` skill) — retrospective
   into durable memory once the run is closed.
8. Cancel: delete `.simplicio-loop/orchestrator/loop/`, or drop a
   `.simplicio-loop/orchestrator/STOP` flag to halt between iterations.

### Three loop modes

| | `converge` (single hard task) | `drain` (a queue of items) | `fast-path` (measured small scope) |
|---|---|---|---|
| Wants | depth — keep changing strategy until ONE thing passes | breadth — clear many independent items, idempotently | lowest ceremony while the mapper evidence remains within limits |
| Each turn | triage `since` last turn → one AC-scoped change → verify → watcher-gate → journal | claim next open item (`task_backlog.py next`) → implement → deliver → re-query source | preserve safety floor → edit → verify → measure real diff; promote on overflow |
| Termination | evidence-gated `<promise>`, OR stall detector says STALLED and escalates | source re-query returns empty for K consecutive rounds (default 2) AND the working set is idle | evidence-gated promise only after the same watcher/claims gates as converge |

All three still obey the universal exits (promise + evidence, `max_iterations`,
STOP); the split only changes WHEN "naturally done" is declared. Only a
supported flag forces `converge` from arming — none forces `fast-path`; a
vague/multi-file/hub/sensitive goal always fails closed to `converge`.

### Definition of Done — 7-dimension gate (adaptive)

Every anchored item needs evidence for: 1) implementation, 2) unit tests,
3) integration tests, 4) system/e2e tests, 5) regression (existing suite
green), 6) a performance benchmark for hot-path changes, 7) coverage ≥ 85%.
`task_anchor.py gate` refuses `done`/PR-open while any dimension is
`pending`.

**Adaptive DoD** — no dimension is silently skipped or blocked forever:

1. `python3 scripts/test_infra_probe.py probe` MEASURES whether the repo's
   ecosystem has a unit-test runner, coverage tooling, and CI that runs
   tests; result lands on the anchor as `test_infra`.
2. Missing unit tooling: a scratchpad-only external harness counts as
   evidence ONLY with all three — harness source, a named PASS/FAIL log, and
   a hash of the exact code fragment it replicates.
3. Structurally impossible (coverage with no tool; benchmark with no
   harness) → `waived:no-infra` with a reason, never `pending` forever.
4. `task_anchor.py gate` recognizes `verified` / `waived:no-infra` /
   `pending`. READY requires zero `pending`; every waiver MUST appear in the
   final report.
5. `Type: Docs|Chore|Config`, or `Tests: none` in `tasks.md`, waives the lane
   matrix for that task entirely (§ Task file above).

Full mechanics: `references/test-infra-probe.md`.

## GitHub source of truth

When the remote is GitHub, GitHub is the coordination SoT: Issues, PR comments,
checks, merge path. Re-query live state before closing. Do not substitute another
tracker unless the user asks.

## Drive

Hook hosts (Claude/Cursor): capture + stop hooks re-feed the goal and print the
progress header. Self-paced hosts: re-read the scratchpad every turn; triage →
decide → operate → verify.

Every turn's first line is the `loop_progress.py render --turn-header` line
(the N2 progress contract; see `references/progress-feedback.md`).

End every message: `DONE | NEXT | BLOCKED`.

## Bounded delivery policy

One implementation issue and one delivery PR per worker/session. Finish, hand
off, or mark the item blocked before claiming another; reviews do not
transfer ownership.

- **Live intake, frozen scope:** re-query the canonical source immediately
  before freezing; freeze that exact goal + ACs before mutation. A review
  finding may prove an AC incomplete, but never adds one silently — scope
  changes need a fresh query, re-anchoring, and an explicit owner decision.
- **Finding categories:** `AC_BLOCKER` (violates a frozen AC),
  `REGRESSION_BLOCKER` (security/correctness/compatibility/evidence
  regression from the patch), `FOLLOW_UP` (valuable but out of frozen
  scope). Only blockers hold the current delivery.
- **Review limits:** one implementation review + one final independent
  verification, at most two AC-scoped repair rounds. A remaining blocker
  stops `BLOCKED` with evidence and ownership — never an unbounded loop.
- **Ownership:** only the active owner mutates the delivery branch; a
  handoff updates the authority record before the receiver continues.
  Rebase once onto the current base immediately before final verification/
  merge; rerun affected gates after.
- **Release boundary:** merge, issue closure, and release are separate
  states — close only on merged evidence; tag/publish only when explicitly
  included and re-queried immediately before.

Rationale: `docs/adr/0008-bounded-delivery-policy.md`.

## Delivery contract (client constraints, enforced mechanically)

Plain-language client constraints ("don't open a PR", "no test files", "no
comments") must become a frozen contract next to the anchor, consumed by
mechanical gates, never self-certified by the LLM.

Freeze with `task_anchor.py set --delivery delivery.json`; an unknown field
is a hard error, never a silent no-op:

```json
{
  "open_pr": false,
  "push_branch": true,
  "allow_new_files_in_repo": false,
  "allow_comments_in_code": false,
  "commit_message_convention": "<type>(<scope>): <subject>"
}
```

| Clause | Mechanical gate |
|---|---|
| `open_pr: false` | `pr_evidence.py build --local-report` — writes evidence locally, never calls the PR API |
| `allow_new_files_in_repo: false` | `delivery_contract.py check-new-files` diffs `git status --porcelain` vs the turn baseline, BLOCKS on an unauthorized new file |
| `allow_comments_in_code: false` | `delivery_contract.py lint-comments` — comment-syntax-aware diff linter, fails on added comment lines |
| `commit_message_convention` | `delivery_contract.py check-commit-message` against every commit |

The final report lists the contract + per-clause compliance, tagged
`MEASURED`, never prose. Full schema: `references/delivery-contract.md`.

## Verifying a good loop

A correctly-run loop is auditable after the fact: the promise traces to
evidence (a passing gate, a `file:line` receipt, or a merged-PR/closed-item
re-query); it stopped only after proof, never a self-reported "done";
iteration never exceeded `max_iterations`; cancellation leaves no orphaned
state; the journal shows distinct attempts converging, not the same
fingerprint retried past K; every claim is tagged; and
`loop_journal.py claims-gate --check` passes. Otherwise the run is still in
progress, not complete.

## Post-merge cleanup

Once a PR the loop opened is merged into `main`:

```bash
python3 scripts/worktree_cleanup.py run --repo <owner/name> --pr <N> --branch <branch> --json
```

Deletes the branch (local + remote) and, if the work happened in a dedicated
worktree, removes it too. Fails safe: skips if the PR isn't actually MERGED,
or if the worktree/branch has uncommitted changes.

## Agent-to-agent handoff (spindle/latch)

When work must cross agents (different runtime/cap/scope), `HANDOFF.md`
becomes a confirmed handoff with a latch: `scripts/handoff.py handoff --next <agent> --state '{...}'`
sets a latch that blocks the next stage until `handoff.py confirm` (or
`receive` = confirm+status) releases it. The stop hook will NOT re-feed the
goal while a handoff is LATCHED (the target agent will pick up), and treats a
missing/corrupt spindle state as fail-open (no handoff). Full state machine:
`references/spindle-handoff.md`.
