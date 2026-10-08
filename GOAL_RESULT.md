## Issue #94 result (2026-07-22)

**BLOCKED / NEEDS-IMPLEMENTATION.** The shadow `loop.marketing` manifest, core-context handler
boundary, deterministic worker, fenced effect helper, tests, coverage and benchmark are green. The
mandatory upstream `simplicio.loop-extension/v1` loader/composer/SDK and conformance artifacts are
still unavailable while `simplicio-loop#557` is open. Therefore the legacy compatibility runner was
not removed, no parallel Marketing scheduler was invented, and issue #94 must not be closed or
merged as complete. Evidence and rollback details: `docs/evidence/issue-94-overlays.md`.

# Goal Result

## Issue #86 dependency audit — 2026-07-22

Status: **BLOCKED — no implementation or completion claim**.

Issue #86 is an integration epic whose ordered child issues #87–#96 were
unresolved at audit time. The audit intentionally avoided duplicating their
extension, conformance, release, and prototype-gate scopes. The upstream
extension dependency was closed, but the audited checkout had no registered
`loop.marketing` extension, so implementation, coverage, benchmark, and
completion claims remain fail-closed.

Recorded unblock conditions: land or explicitly re-scope the ordered children,
pin the upstream contract and hashes, run embedded/daemon/remote conformance,
then evaluate coverage, restart safety, and composition benchmarks.

## Issue #89 — 2026-07-22

Status: **BLOCKED**. The current main branch lacks the #87 extension
manifest/TypeScript bridge and the #88 dedicated role bindings on which #89
explicitly depends. The upstream contract slice also states that installed
extension conformance, the Marketing TypeScript bridge, and graph-hash
receipts remain out of scope. A local coordinator, claim manager, ledger, or
mock bridge would violate #89 rather than implement it. The inspected SHAs,
reproduction commands, missing evidence, and unblock sequence are documented
in `docs/evidence/issue-89-blocker.md`.

## Issue #87 — versioned extension contract (2026-07-22)

Implemented the repository-owned portion: manifest/lock, ownership ADR, TypeScript
adapter, fail-closed doctor, lossless conversion, idempotent reconciliation, unit,
integration, E2E/recovery, regression coverage, and benchmark. Touched extension code
has 100% statement/line/function coverage and 72.83% aggregate branch coverage
(`contract.ts` 85.71%; `reconcile.ts` branch instrumentation counts interface/type lines).

**External blocker:** upstream Loop v3.38.1 at commit
`b5ddbd6af76392198906e61d0911a236eca3bcf8` contains the Python manifest validator,
but no official TypeScript SDK, `probe_capabilities()`, core receipt/reconciliation API,
or embedded/daemon/remote conformance runner. The implementation therefore fails closed
with `REQUIRED_CAPABILITY_MISSING`; merge/issue closure must wait for that upstream
surface and a rerun of conformance in all three modes.

## Issue #90 — Marketing reporting/findings extension (2026-07-22)

Implemented the repository-owned reporting projection, deterministic finding
fingerprints, completion audit, and focused unit/integration/regression/benchmark
coverage. Upstream core receipt and remote-requery capabilities remain external;
the extension fails closed when they are unavailable.

## Issue #106 (2026-07-22)

Implemented the reproducible issue inventory/audit and published receipts under `docs/audits/`.
The fail-closed result is **BLOCKED**: 0 of 84 accessible issues currently meet the ten-section
contract, and this worker has no authenticated remote-mutation capability. Test and benchmark
evidence is recorded in `docs/audits/EVIDENCE.md`; issue #106 must remain open.

## Current run — 2026-07-11

## Issue #91 — 2026-07-22

Implemented the marketing-domain declarations for Continuous Evolution,
Adaptive Architecture and Elastic Replication without introducing a coordinator,
scheduler, queue, ledger or completion engine. The extension manifest and policy
evaluators keep defects as findings, create deterministic deduplicated RFCs for
evolution, protect compliance/safety, bind replication to finite budgets, accept
only independently verified isolated candidates, reject stale/late receipts and
automatically request rollback for regressive canaries.

Evidence: focused coverage is 100% statements/functions/lines and 96.72% branch;
the receipt hot path processed 10,000 candidates in 8.06ms; all 217 Node tests and
253 Playwright tests passed. The upstream conformance modes remain a responsibility
of the Loop core and its bridge work tracked by dependencies #87–#90; this change
declares the required `extension_version` and `composed_graph_hash` receipt fields
but does not counterfeit core receipts.

## Issue #92 — extension conformance certification (2026-07-22)

Implemented the repository-owned conformance matrix/oracle for `loop.marketing`.
Compatible candidates produce stable manifest and composed-graph hashes;
incompatible candidates are blocked before work. The packed-install path
exercises declared modes, fail-closed gates, independent role bindings, and a
fenced/idempotent fake publish effect. Upgrade remains manual and requires
conformance plus canary evidence; rollback restores the last compatible pin.
Release detection and ecosystem publication remain owned by issue #95.

## Issue #93 — Loop core/Hub extension integration (2026-07-22)

Implemented `loop_marketing` as a declarative `simplicio.loop-extension/v1`
consumer without adding a daemon, coordinator, queue, scheduler, lease manager,
or completion engine. It fails before campaign work on incompatibility, delegates
budgets and exactly-once authority to core, and rebuilds views from receipts.
Focused unit, integration, regression, system, and benchmark evidence is
recorded in the PR.

All programming issues in the active backlog (#65–#79) were implemented or audited
for executable scope using six parallel workers and integrated on branch
`codex/finish-all-programming`. #78 has no executable acceptance criterion; #79 is
implemented as a fixed-judge, compliance-gated, holdout-evaluated `DRY_RUN` loop.

Follow-up on 2026-07-13: issue #78 now has a repo-local narrative package instead of staying audit-only. The work adds canonical docs, campaign artifacts, and a focused unit test, while keeping public-site, demo hosting, and live analytics explicitly marked as external dependencies.

Follow-up on 2026-07-14 (issue #78 closeout): the remaining repo-achievable gaps are filled with real artifacts instead of copy decks — two self-contained, deploy-ready static pages under `site/` (landing page + Asolaria integration site section), a reproducible 5-iteration demo script (`scripts/demo-asolaria-loop.mjs`), and a fail-closed reduction proof-trail benchmark script (`scripts/reductions-benchmark.mjs`). Public domain hosting, recorded demo media, and live analytics remain the only genuinely external items, and are called out explicitly in every doc that references them.

Final validation: `npm run typecheck` PASS, `npm run lint` PASS, `npm run budget` PASS,
`npx playwright test` PASS (236/236). Publication actions were not triggered by the
autoresearch path (`published: false`, `dry_run: true`).

## Summary

Evolved the marketing engine from "complete pipeline driven by a playbook"
into an **autonomous loop with durable memory, central observability and
fail-closed gates**, porting the proven patterns of the sibling repos
(simplicio-loop, simplicio-dev-cli, simplicio-mapper) — phases F0–F8 of
PRD.md, all delivered.

- `marketing-engine loop` drains the piece backlog through the real gates
  with attempt memory (fingerprinted failures, STALLED skip after 3
  identical failures, estimated savings receipt per skip), then runs the
  verified publish pipeline and the promote pass. Modes drain/converge,
  bounded by `--max-iter`, DRY_RUN default.
- Two-track observability (`marketing-event/v1` stream), hash-chained
  savings ledger (`proof.kind` always "estimated", labeled estimator),
  versioned artifact contracts with producer-generated fixtures and a
  two-sided drift gate, `marketing-engine doctor`, convention lint and a
  token-budget guard with negative self-test.
- simplicio-loop operator layer installed (skills, loop_stop/orient hooks,
  fail-closed action_gate 15/15) with the super-skill upgraded from
  playbook to executable protocol; state split documented in
  docs/OPERATOR.md; real-provider wiring documented (credential-gated) in
  docs/MCP-TRANSPORT.md.
- Fixed the 4 e2e specs red since the watcher gate landed (mock marker vs
  placeholder heuristic; per-platform caption; TOON numeric brackets; mock
  echo length).

## Changed Files (highlights)

- `lib/cli/loop.ts`, `lib/loop/journal.ts`, `bin/marketing-engine.mjs` — the loop command (+ `doctor`, stdio streaming, flag passthrough fix)
- `lib/publish/verify-pipeline.ts` — verified publication with classified retry + receipts
- `lib/observability/{events,savings}.ts` — event stream + savings ledger
- `lib/contracts/{validate,registry}.ts`, `contracts/marketing-artifacts/v1/` — contracts, schemas, fixtures
- `lib/cli/doctor.ts`, `scripts/token-budget.mjs`, `scripts/lint-conventions.mjs`, `scripts/gen-fixtures.mjs`
- `lib/gate/watcher-gate.ts`, `lib/providers/__mocks__/llm.ts`, `lib/cli/generate.ts`, `lib/cli/promote.ts` — gate fixes + instrumentation
- `.claude/skills/`, `hooks/`, `.claude/settings.json`, `docs/OPERATOR.md`, `docs/MCP-TRANSPORT.md`, `.skills/simplicio-loop-marketing/SKILL.md`
- `PRD.md`, `PROGRESS.md`, `CHANGELOG.md`, `.gitignore`

## Validation Commands

```bash
npm run typecheck
npm run lint
npm run budget
npx playwright test
node bin/marketing-engine.mjs loop --root <tmp-host> --max-iter 2
node bin/marketing-engine.mjs doctor
```

## Validation Results

- `npx playwright test` — **217 passed, 0 failed** (baseline was 182 passed /
  4 failed; +31 new specs: events 5, savings-ledger 6, contracts 5,
  loop-drain 6, publish-verify 6, doctor 2, capstone loop-driven 1, plus the
  4 repaired).
- `npm run typecheck` — clean. `npm run lint` — clean. `npm run budget` —
  PASS (self-test proves the guard bites).
- Real CLI on a fresh host: `loop --max-iter 2` → `advanced=1 published=1
  stop=drained`, journal at `.simplicio/loop/journal.jsonl`, publish receipt
  and manifest written; `doctor` reports operator hooks present, action-gate
  selftest pass, python workers resolved.
- Operator workers: `loop_journal.py` / `task_anchor.py` / `task_backlog.py`
  selftests OK (source checkout), `hooks/action_gate.py selftest` 15/15,
  `token_budget.py --self-test` OK.

## Issue #95 — Loop core release train (2026-07-22)

Implemented the marketing-side consumer: versioned extension manifest, immutable core lock,
fail-closed release compatibility and diffs, canary/rollback, migration plan generation,
15-minute reconciliation automation, doctor visibility, and release identities in campaign
manifests. The consumer does not copy the upstream contract schema and introduces no
coordinator, scheduler, queue, or completion authority.

The external train remains blocked because `simplicio-loop` has not published the required
`simplicio.component-release/v1` artifact from issue #558. Consequently no real latest
candidate can pass the official embedded/daemon/remote evidence lane or be promoted to
stable; local fixtures prove both compatible and breaking paths without representing them
as upstream evidence.

## Issue #96 — Prototype-First completion (2026-07-22)

Implemented production enforcement for live effects: fresh ACCEPT fingerprints
bind to piece/campaign, brand, offer, channel, policy, and source; human approvals
expire; successful publish receipts replay exactly once. Prototype artifacts cover
deterministic storyboard/copy/caption/mock-image/mock-video/landing variants,
independent judge outputs, dry-run calendar/budget/payload evidence, zero spend
authority, rejection savings, and nullable real-performance metrics. PR evidence
reports typecheck/lint green, 99.12% touched statements, 1,257 decisions/s, and
252 Playwright tests; full check retains documented environment limitations.

## Issue #97 — token-cost result (2026-07-22)

Implemented cached `js-tiktoken` BPE fallback and generation-cost reconciliation.
Provider usage remains authoritative; fallback provenance and unavailable
measurements are explicit, and analytics never persist prompt bodies. Focused
tests cover provider usage, missing usage, unknown models, PT-BR/emoji,
tokenizer failure, stage correlation, and prompt privacy. PR evidence reports
85.96% focused statement/line coverage and 5,684 cached-tokenizer ops/s.

## Issue #100 — 2026-07-22

Implemented the correctness expansion without runtime dependencies: fail-closed
creative adapter constraints, property-tested caption fan-out, anonymized
Portuguese golden compliance fixtures across authentic templates, and an
incremental Stryker mutation gate. PR evidence records unit, integration,
regression, benchmark, system/E2E, focused coverage, and mutation results; no
provider calls or live publication occurred.

## Issue #102 result (2026-07-22)

Implemented the blocking CI quality/coverage gate and reproducible integrity
audit for parent `simplicio-loop#582`, including bounded read-only workflow
execution, lint/typecheck/budget, enforced coverage, and the Playwright system
suite. PR evidence records baseline SHA, failure injection, and residual risk;
the gate enforces 85% lines/statements/functions and 70% branches.
## Issue #99 result (2026-07-22)

Implemented the production caption invariant boundary and property tests.
Canonical four-platform fan-out now preserves platform keys, per-platform
bounds, Unicode-safe truncation, and pillar tags; a near-real Portuguese piece
is exercised through parsing, compliance, fan-out, regression, and observable
E2E assertions. PR evidence records full focused coverage and a throughput gate.

## Doctor contract regression fix (2026-07-22)

`buildDoctorReport` now returns both `release_train` identity/compatibility data
and the issue #93 `extension` conformance data through a typed merged contract.

Validation completed successfully:

- `npm run typecheck`
- `npm run lint`
- `npx playwright test e2e/doctor.spec.ts e2e/extension-core.spec.ts e2e/extension-conformance.spec.ts` (7 passed)

## Distribution dashboard epic (#171) and product epic (#159): per-issue result (2026-10-08)

Status words: DONE (implemented, tested, pushed), PARTIAL (implemented and verified, with a stated gap), BLOCKED-EXTERNAL (needs something outside this repository), DEFERRED (out of scope for this session). The visual direction of every dashboard UI issue was not produced through the `frontend-design` skill, which was not installed in the build session; that is the common gap of the dashboard rows marked PARTIAL.

| Issue | Status | Commit | Reason |
| --- | --- | --- | --- |
| #160 simplicio-video provider and brand-profile/v1 | DONE | a8fec47 | provider, profile command, DRY_RUN |
| #161 publisher seam with Real Oficial browser flow | DONE | 5f01d6c | dry-run and browser flow, receipts |
| #162 30-day plan, batch render, scheduling | DONE | bee373d | approved-only scheduling |
| #163 client approval link | DONE | 7850f8b | bound to the media hash |
| #164 derived formats and long-video cuts | DONE | 6d64535 | derived formats lane |
| #165 dubbing and translation adapter | DONE | ef4f8b0 | approval gate before spend |
| #166 metrics loop and winners | DONE | a54a1a2 | winners feed the next plan, monthly report |
| #172 marketing.* events and adapters | DONE | 07c3e54 | event stream and source adapters |
| #173 read-only backend with SSE replay | DONE | 43bf189 | |
| #174 dashboard command and client page | DONE | 7e2d6d3 | |
| #175, #176, #177 cockpit, pipeline, calendar | PARTIAL | 502b358, 5d2665f | shared `sl-*` kit and `frontend-design` not available |
| #178 status per network and publisher health | PARTIAL | 05494b9 | `frontend-design` not available |
| #179 quality and compliance gates | PARTIAL | e0f71be | `frontend-design` and JSON tree component not available |
| #180 credits and costs | PARTIAL | bd35cd1 | purchase history and render machine time have no source |
| #181 funnel and revenue | PARTIAL | ae04109 | no AbacatePay webhook reader (payload unconfirmed); BR sales arrive through `venda.json` |
| #182 approval queue with SLA | PARTIAL | 01b69ec | read-only v1 as specified |
| #183 performance, winners, double down | PARTIAL | 2ad2c9f | retention and thumbnails have no source |
| #184 distribution alerts | PARTIAL | 01b69ec | shared rule engine of simplicio-loop#1406 not readable |
| #185 dashboard quality | PARTIAL | 9b363a3 | alignment with simplicio-loop#1409 not readable |
| #186 Langflow and Mermaid/image of the flow | PARTIAL | 29143c1 | Langflow 1.12.0 import not verified (not installed); mapper generator and contract not readable; no per-execution diagram |
| #95 Loop core release train | BLOCKED-EXTERNAL | 637bbec (evidence), 8329ca8 (earlier pin) | needs a real Loop core and the signed component manifest; the issue stays open |
| #167 Stripe business setup | DEFERRED | | no live billing |
| #168 Real Oficial API request | DEFERRED | | needs a human to contact Real Oficial |
| #169 self-serve multi-client | DEFERRED | | after the MVP |
| #188 to #197 (parked) | DEFERRED | | labelled "[Estacionada]" |

Epic #171 stays open: all of its child issues #172 to #185 are implemented, but several carry the gaps above, and its own "done when" asks for a run on a real client, the shared contract and kit with simplicio-loop#1397, and the `frontend-design` pass. Epic #159 stays open: #167, #168 and #169 are deferred.

Final gate on commit 637bbec (the last code change; the commit that adds this section changes only this file): `npm run typecheck` exit 0; `npm run lint` exit 0; `npm run test:unit` 366 of 366; `npm run test:integration` 123 of 123; `npm run test:regression` 22 of 22; `npm run test:e2e` 345 passed; coverage over all of `lib/**/*.ts` with the Node and Playwright V8 coverage merged, statements and lines 89.20%, functions 89.73%, branches 79.44%; `npm run bench` dashboard reads in ms per read: cockpit 2.41, pipeline 2.94, calendar 0.06, status 0.30, quality 0.83, credits 0.24, funnel 0.20, performance 0.67, approvals 0.15, alerts 0.47, and `flow.build` 0.60.
