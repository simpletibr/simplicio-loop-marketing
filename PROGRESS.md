# Progress Log

## Checkpoint 11 (2026-07-22 — issue #86 dependency audit)

Status: blocked at audit time; no duplicate production implementation attempted.
The audit recorded the missing registered extension and preserved the fail-closed
unblock conditions. Later mainline integrations supersede the audited checkout
state without changing the substantive conclusion.

## Checkpoint 10 (2026-07-22 — issue #103 binary state slice)

Implemented native, versioned HBP/HBI envelopes and migrated the run ledger,
loop journal and piece manifest off JSON. Added a bounded, dry-run capable,
backup-preserving and idempotent legacy migrator; moved mapper metadata to TOML;
and added corruption/truncation/oversize regression tests plus a measured hot
path benchmark. Runtime readers have no JSON fallback for the migrated paths.

## Checkpoint 10c (2026-07-22 — issue #90 reporting/findings extension)

Status: implementation complete; upstream core receipt/requery evidence remains external.

Added the reporting projection, finding sanitize/fingerprint path, completion audit,
and focused test and benchmark evidence. Missing upstream capabilities remain fail-closed.

## Checkpoint 10b (2026-07-22 — issue #106 meta-audit)

Status: blocked on authenticated, reviewed rewrites of remote issue bodies.

Result:
 - Inventoried all accessible issues and added a fail-closed audit command with JSON/Markdown receipts.
 - Added unit, integration, regression, E2E, security and benchmark evidence; closure remains blocked
   until a maintainer applies the required remote issue changes.

## Checkpoint 12 (2026-07-22 — issue #91 evolution and replication policy)

Implemented the repository-owned `loop.marketing` evolution/replication policy:
protected gates, rollout and receipt metadata, deterministic proposal/finding
classification, bounded replication admission, stale-receipt rejection, loser
cancellation, and canary rollback evaluation. Loop core remains the owner of
scheduling, fences, effects, and completion. PR evidence reports 217 Node tests,
253 E2E tests, 100% touched statements/functions/lines, 96.72% branches, and a
10,000-candidate benchmark at 8.06 ms.

## Checkpoint 13 (2026-07-22 — issue #92 extension conformance)

Added the canonical extension conformance manifest/oracle, compatible-core
gating, deterministic manifest/graph receipts, fail-closed modes and gates,
fenced fake-effect recovery/security tests, packed-install E2E parity, and
upgrade/canary/rollback documentation. Central release detection remains the
responsibility of issue #95.

## Checkpoint 14 (2026-07-22 — issue #93 Loop core extension integration)

Published the pinned upstream-compatible extension manifest, hashed context
schemas, declarative overlays/roles/gates/resources, core-owned quota scopes,
receipt-derived views, core-authorized exactly-once effects, campaign preflight,
and doctor conformance reporting. Focused evidence is recorded in the PR.

## Checkpoint 9 (2026-07-14 — issue #78 closeout: deploy-ready assets + reproducible scripts)

Status: completed, ready for PR against `main`.

Result:
- Closed the remaining gap from Checkpoint 8: the narrative docs existed, but the
  "landing page" and "site section" asks were still copy decks, and the "demo
  loop" / "reproducible script" asks were still storyboards without code.
- Added two self-contained, deploy-ready static pages: `site/simplicio-on-metal/index.html`
  (P0 landing page) and `site/asolaria-integration/index.html` (P2 site section with
  integration timeline and ecosystem map), plus `site/README.md` explaining how to
  serve them locally and what remains external (a real hosting domain).
- Added `scripts/demo-asolaria-loop.mjs`: a reproducible 5-iteration demo that
  measures real orientation-reading token cost (heuristic:chars-div-4, the same
  labeled estimator as `lib/observability/savings.ts`) across the five canonical
  maps in `SIMPLICIO-MAP-OF-MAPS.md`, writing a regenerable receipt to
  `.specs/strategy/campaigns/2026-Q3-asolaria-on-metal/DEMO-RUN.md`.
- Added `scripts/reductions-benchmark.mjs`: the "script que qualquer um pode rodar"
  the case study asked for — parses `REDUCTIONS.md`, fails closed on any stale
  proof link, and writes a footprint receipt to `docs/evidence/reductions-benchmark.json`.
- Wired both scripts into `package.json` (`npm run demo:asolaria`,
  `npm run benchmark:reductions`) and cross-linked them from
  `SIMPLICIO-MAP-OF-MAPS.md`, `REDUCTIONS.md`, `DEMO.md`, `CASE-STUDY.md`,
  `LANDING.md`, `ROUTING.md`, `README.md`, and `README.pt-BR.md`.
- Extended `tests/fixtures/asolaria-artifacts.json` and
  `tests/unit/asolaria-docs.test.cjs` with checks that both scripts pass in
  `--check` mode and that the new static pages stay dependency-free.

Validation:
- `node --test tests/unit/asolaria-docs.test.cjs` — 7/7 pass.
- `node scripts/demo-asolaria-loop.mjs --check` — PASS (5/5 iterations).
- `node scripts/reductions-benchmark.mjs --check` — PASS (0 stale proof links).
- `node scripts/lint-conventions.mjs` — clean.
- `node scripts/claims-audit.mjs` — PASS.

## Checkpoint 8 (2026-07-13 — issue #78 Asolaria narrative package)

Status: completed on local branch, repo-local scope only.

Result:
- Audited issue #78 live and confirmed the ask is mostly narrative/publication-oriented, with several outputs depending on an external site not present in this repo.
- Added a repo-local Asolaria integration package instead of touching engine core: `SIMPLICIO-MAP-OF-MAPS.md`, `REDUCTIONS.md`, and a bounded campaign folder under `.specs/strategy/campaigns/2026-Q3-asolaria-on-metal/` containing `CAMPAIGN.md`, `HYPOTHESIS.md`, `ROUTING.md`, `LANDING.md`, `DEMO.md`, and `CASE-STUDY.md`.
- Added `tests/fixtures/asolaria-artifacts.json` and `tests/unit/asolaria-docs.test.cjs` so the required docs, cross-links, reduction count, and external-dependency boundaries are mechanically checked.
- Updated `README.md` and `CHANGELOG.md` to surface the package without altering loop/provider/gate code.

Validation:
- `node --test tests/unit/asolaria-docs.test.cjs` — pass.

## Checkpoint 7 (2026-07-11 — issues #65–#79)

Status: completed on `codex/finish-all-programming` pending PR/release publication.

Result:
- Added campaign anchors, durable journals/stall detection, evidence gates, reports,
  fail-closed action gates, local `check`, doctor, watcher, retrospective learnings,
  prompt-cache/usage telemetry, and a fixed-judge compliance-gated autoresearch loop.
- Fixed Windows path handling in the convention lint and repaired the doctor guard
  integration conflict found during cross-worker integration.
- Issue #78 was audited as narrative-only with no executable AC; issue #79 now has a
  DRY_RUN-only implementation with fixed judge manifest, holdout, cost/usage rows,
  savings receipt, and E2E coverage.

Validation:
- `npm run typecheck` — pass.
- `npm run lint` — pass.
- `npm run budget` — pass.
- `npx playwright test` — 236 passed, 0 failed.

## Current Status

Completed — autonomous-loop evolution plan (PRD.md, phases F0–F8) on
`claude/simplicio-loop-marketing-plan-e52ccv`. Final report in
GOAL_RESULT.md; full suite 217 passed / 0 failed.

## Checkpoints

### Checkpoint 6 (2026-07-09, F1–F5 — observability, ledger, contracts, operator, loop)

Status: completed

Task: Phases F1–F5 of PRD.md.

Result:
- F1: `lib/observability/events.ts` — two-track `marketing-event/v1`
  (stderr human + `.simplicio/events.jsonl`, 10MB rotation, kill-switch,
  fail-open); generate/promote/campaign instrumented.
- F2: `lib/observability/savings.ts` — hash-chained
  `simplicio.savings-event/v1` ledger, `proof.kind` always "estimated",
  estimator labeled, engine-owned file (runtime chain untouched).
- F3: `lib/contracts/validate.ts` (subset JSON Schema) + 5 schemas under
  `contracts/marketing-artifacts/v1/` + fixtures generated by the real
  producers (`scripts/gen-fixtures.mjs`) + two-sided drift gate.
- F4: simplicio-loop operator installed (skills, hooks incl. fail-closed
  action_gate 15/15, Stop/PreToolUse wiring); super-skill gained the
  executable loop protocol; `docs/OPERATOR.md` documents the state split.
- F5: `marketing-engine loop` — `lib/cli/loop.ts` drains the piece backlog
  in-process (processPiece → journal → promote) with `lib/loop/journal.ts`
  attempt memory (stable failure fingerprints, PROGRESS/STALLED, skip after
  K=3 identical failures + estimated savings receipt), yool-board tuples per
  piece, converge/drain modes, optional fail-open Python operator bridge
  (`MARKETING_LOOP_PY_WORKERS=1`), streaming stdio in the bin. Regression
  caught and fixed: global `--client` flag was swallowing new-piece's
  sub-flag — loop-local flags now flow through args._ passthrough.

Validation:
- `npx playwright test` — 208 passed (events 5, savings 6, contracts 5,
  loop-drain 6 all new).
- `npm run typecheck` / `npm run lint` — clean.
- Real CLI: `node bin/marketing-engine.mjs loop --root <tmp-host> --max-iter 2`
  → advanced=1, journal at `.simplicio/loop/journal.jsonl`, manifest +
  captions + compliance + qa written; converge mode stops after first land.

Next: F6 (publish-verify pipeline), F7 (doctor), F8 (capstone + PR).

### Checkpoint 5 (2026-07-09, F0 — green baseline + hygiene)

Status: completed

Task: Phase F0 of PRD.md — fix the 4 pre-existing red e2e specs, add convention
lint, gitignore runtime state, fill PRD.md.

Result:
- Root cause of the 4 red specs: the watcher-gate (commit b396280) blocked all
  DRY_RUN runs — the `[mock-<name>]` attestation stamped by mock LLMs tripped
  the placeholder check, the gate received the raw caption (without the
  per-platform `#pillar` hashtag), and the mock echoed only 40 chars of prompt
  so topic-coverage was 0%. Fixes: gate strips the mock marker under DRY_RUN
  only (outside DRY_RUN it still blocks — mock-leak detector), gate now checks
  the shipping per-platform caption, placeholder regex no longer flags pure
  numeric brackets (`[2]` TOON list markers / citations), mock echoes up to
  2000 chars. `promote-loop.spec.ts` updated to seed the MEASURED watcher
  report the claims gate requires by design (test predated the gate).
- New `scripts/lint-conventions.mjs` (node builtins only) + `npm run lint`:
  no console.log in lib/ outside lib/cli/, no `__mocks__` import outside
  provider registries/tests, provider-neutral skills stay neutral in prose,
  `.env` never tracked.
- `.gitignore`: `.simplicio/*` except `ledger/`, `.orchestrator/*` except
  `savings/`; untracked committed runtime state (cache/locks/runs/inventories).
- PRD.md filled with the phased plan (F0–F8).

Validation:
- `npx playwright test` — 186 passed, 0 failed.
- `npm run typecheck` — clean.
- `npm run lint` — clean.

Next: F1 (two-track observability, `marketing-event/v1`).

### Checkpoint 4 (2026-07-02, epic #46)

Status: completed

Task: Implement all 14 open child issues (#47-#60) of epic #46 — autonomous SaaS marketing loop across social networks and dev communities.

Result: See CHANGELOG.md [Unreleased] for the full list. Landed as 11 focused commits on `claude/open-issues-95whqo`: channel registry + integration broker, community compliance gate (3-state, addressing reviewer feedback on silent-pass risk), accrual-based analytics scoring (addressing reviewer feedback on one-shot-snapshot ranking), paid-growth budget guardrails, campaign CLI loop, browser/computer-use automation lane, community reply loop, Yool tuple-space board, strategy playbooks + evidence-aware content templates, root super-skill orchestrator, runtime-first ADR, and a capstone E2E mock launch loop test tying every lane together.

Validation:
- `npx tsc --noEmit` — clean.
- `npx playwright test` — 171 passed. 4 pre-existing failures in `e2e/generate-loop.spec.ts`, `e2e/notion-sync.spec.ts`, `e2e/promote-loop.spec.ts` confirmed to reproduce identically against `main` in a clean `git worktree` — unrelated to this branch (touches none of the files those tests exercise).

Next: Push and open a draft PR referencing #46-#60.

### Checkpoint 1

Status: completed

Task:
Apply `llm-project-mapper` to the repository without overwriting the repo's existing source of truth docs.

Result:
Bootstrap applied successfully. Added mapper overlays such as `.agents/`, `.claude/`, `docs/`, `scripts/`, `tests/`, `INIT.md`, and `.starter-meta.json`. Restored richer pre-existing `DESIGN.md` and `PERSONAS.md` while keeping new mapper-owned docs that improve repo navigation.

Validation:
`npm run typecheck`

Next:
Add persistent repository visuals to `README.md` and re-run the regression suite.

### Checkpoint 2

Status: completed

Task:
Add repository visuals near the top of `README.md` and document the applied project mapping.

Result:
Added `assets/readme/marketing-engine-hero.svg` and `assets/readme/marketing-engine-router.svg`, embedded them in `README.md`, and documented the mapper entrypoints and operational docs.

Validation:
`npm run test:e2e`

Next:
Commit and push the final mapper + README pass.

### Checkpoint 3

Status: completed

Task:
Wire HyperFrames (https://github.com/wesleysimplicio/hyperframes) into the engine as a first-class video provider following the three-step "Adding a Provider" contract.

Result:
- Added skills `.skills/hyperframes/` (composition authoring), `.skills/hyperframes-cli/` (lint/inspect/render dev loop), and `.skills/hyperframes-prompt-builder/` (specialist invoked by `video-prompt-builder` when the matrix resolves to `hyperframes`).
- Updated `.skills/video-prompt-builder/SKILL.md` to dispatch to the new specialist and recognize the new task kinds.
- Added new `VideoTask` union members `motion-typography`, `data-viz-reel`, `programmatic-short` in `lib/providers/types.ts`.
- Added `HyperframesVideoProvider` (stub gated on `HYPERFRAMES_ACTIVE=true`) and `MockHyperframesVideoProvider`; registered both in the real and mock video registries.
- Extended `lib/providers/matrix.ts` `EMBEDDED_DEFAULTS` and `TASK_LABEL_MAP` for the three new tasks.
- Added the three rows to the Video Routing table in `.specs/architecture/PROVIDERS.md`.
- Added `HYPERFRAMES_ACTIVE=false` to `.env.example` with a note about `npx hyperframes doctor`.
- Updated `CLAUDE.md` Stack table and Skills Available list.

Validation:
PROVIDERS.md video section re-parses correctly through the project's parser logic — all three new task kinds resolve to `hyperframes`. Local `npm run typecheck` blocked by pre-existing missing `@types/node` (unrelated to this change).

Next:
Commit on branch `claude/hyperframe-skills-S69hE`, push, open draft PR.

## Blockers

No OpenAI API key was available locally, and the official OpenAI docs checked on 2026-05-18 did not list a `gpt-image-2` model name. The README visuals were therefore committed as repository-native SVG assets instead of generated API outputs.

## Validation History

| Command | Result | Notes |
|---|---|---|
| `npm run typecheck` | pass | TS compile clean after mapper overlay |
| `npx playwright test e2e/cli.spec.ts e2e/cli-extras.spec.ts e2e/generate-loop.spec.ts e2e/notion-sync.spec.ts e2e/observability.spec.ts` | pass | Focused regression pass during integration |
| `npm run test:e2e` | pass | Full Playwright suite green: 119 passed |

### Checkpoint — issue #96 completion (2026-07-22)

Completed the previously deferred Prototype-First production boundary: mock image/video and landing/caption variants, independent brand/humanization/compliance/technical/evidence/security evaluation, calendar/budget publish simulation, expiring drift-bound ACCEPT receipts, prototype-vs-real metrics, publish enforcement, approval expiry, and exactly-once receipt replay. Added unit/integration/regression/security/E2E-compatible coverage and a 1,000-decision benchmark.

Validation: focused coverage 99.12% statements / 82.31% branches (minimum 85% touched-code statement coverage met); benchmark 795.8ms for 1,000 decisions (1,257 decisions/s); 252 Playwright tests passed. `npm run check` reached all checks but reports pre-existing environment/tooling blocks (doctor cannot find browser/ffmpeg; claims audit names five unrelated watcher env declarations).

## Checkpoint 15 (2026-07-22 — issue #97 token-cost reconciliation)

Replaced the provider-response `chars/4` fallback with cached BPE resolution;
unknown models and tokenizer failures remain explicit and fail-open. Provider
usage stays authoritative, with source/encoding/fallback/stage/correlation
metadata and prompt privacy. PR evidence reports typecheck/lint green, 214 Node
tests, 252 Playwright tests, 85.96% focused coverage, and 5,684 ops/s.

## Checkpoint 16 (2026-07-22 — issue #102 blocking CI gate)

Added the read-only `quality-gate` workflow, bounded lint/typecheck/budget,
enforced coverage thresholds, workflow-integrity verification, failure-mutation
coverage, provider regression checks, and Playwright system coverage. The merged
package keeps conformance/benchmark scripts and now enforces 85% lines,
statements, and functions plus 70% branches.

## Checkpoint 18 (2026-07-22 — issue #99 property tests and real-content invariants)

Added the production four-platform caption invariant boundary, Unicode-safe
truncation, 1,000 generated fast-check cases per run, a near-real Portuguese
fixture through parse/compliance/fan-out, regression coverage, and observable
E2E assertions. The PR records 100% focused production coverage and a measured
caption throughput benchmark above the configured threshold.

## Checkpoint 17 (2026-07-22 — issue #100 quality expansion)

Added constraint-aware image/video selection with property tests, deterministic
four-platform caption fan-out, anonymized Portuguese real-content fixtures across
five templates, and incremental Stryker mutation configuration. The PR records
81.82% mutation score, 90% focused branch coverage, and measured caption/provider
hot-path benchmarks.

## Checkpoint 18 (2026-07-22 — doctor contract regression)

Restored the issue #93 extension conformance payload in `buildDoctorReport`
without replacing the existing release-train payload. The merged, typed doctor
contract is covered by the focused doctor and extension Playwright specs;
typecheck and lint are clean.

## Checkpoint 19 (2026-10-08 — issues #175, #176, #177 dashboard views)

Cockpit, pipeline and calendar views of the distribution dashboard, with the
framework-free UI, presentation mode masked on the server and the per-piece
stage model. Full gate green on the committed tree (unit 340, integration 59,
regression 22, e2e 287, coverage 88.5% statements). PARTIAL: the
`frontend-design` skill and the shared `sl-*` kit were not available. Evidence:
`docs/evidence/issues-175-176-177-dashboard-views.md`.

## Checkpoint 20 (2026-10-08 — issue #164 derived formats)

Mix mensal de formatos, faixa de cortes de vídeo longo da Real Oficial (estimativa sempre antes, gasto só com a aprovação do Wesley, recibo sem o endereço do vídeo) e custo por formato. Gate completo verde (unit 361, integration 67, regression 22, e2e 295, cobertura 88,42% das linhas). Ao vivo depende de uma sessão MCP da Real Oficial; os templates do simplicio-videos ficam no outro repositório.

## Checkpoint 21 (2026-10-08 — issue #165 dubbing adapter)

Interface `Dubbing` com estimativa que nunca gasta, `dub()` que falha fechado sem a aprovação do Wesley, recibo com schema, matriz de idiomas por cliente e implementações dry-run e Real Oficial (ferramentas oficiais em vez do navegador provisório). Gate completo verde (unit 361, integration 67, regression 22, e2e 295). BLOQUEADO-EXTERNO: o piloto em 1 idioma precisa de sessão ao vivo da Real Oficial e do consentimento de voz dado no app.

## Checkpoint 22 (2026-10-08 — issue #166 metrics loop)

Fontes de métricas somente leitura, snapshots ligados ao recibo, vencedores do mês, plano do mês seguinte com variações dos vencedores e relatório mensal em markdown e PDF sem números inventados. Gate completo verde (unit 361, integration 67, regression 22, e2e 295, cobertura 88,42% das linhas). Ao vivo depende de credenciais por cliente e de uma sessão MCP da Real Oficial; o piloto com posts reais com recibo fica para quando houver publicação ao vivo.

## Checkpoint 23 (2026-10-08 — issue #178 status per network)

Matriz cliente por rede, saúde do publicador da Real Oficial, capacidade de contas e recibos com motivo e próximo passo humano; nenhuma credencial exibida (teste). Gate completo verde (unit 361, integration 81, regression 22, e2e 300, cobertura 88,8% das linhas). PARTIAL: a skill `frontend-design` não estava disponível; o limite do plano (Lite) é suposição do texto da issue.

## Checkpoint 24 (2026-10-08 — issue #179 quality gates per piece)

Selos por peça, bloqueio por hash divergente, taxa de aprovação de primeira, principais motivos e tendência. Gate completo verde (unit 361, integration 81, regression 22, e2e 300, cobertura 88,8% das linhas). PARTIAL: `frontend-design` e `<sl-json-tree>` indisponíveis; formato de `broll-licenses.json` é suposição a confirmar.

## Checkpoint 25 (2026-10-08 — issue #180 credits and costs)

Créditos e custos somente leitura, conferidos contra um cálculo de referência, com estimativas rotuladas e "sem dado" onde falta taxa, preço ou fonte. Gate completo verde (unit 361, integration 81, regression 22, e2e 300, cobertura 88,8% das linhas). PARTIAL: histórico de compras e tempo de máquina do render não têm fonte; `frontend-design` indisponível.

## Checkpoint 26 (2026-10-08 — issues #182 approval queue and #184 distribution alerts)

Fila de aprovações (cliente e Wesley) com SLA por cor, somente leitura, e centro de alertas com 11 regras que disparam e limpam sozinhas, sem duplicata, sem envio externo por padrão. Gate completo verde (unit 361, integration 102, regression 22, e2e 304, cobertura 88,97% das linhas). PARTIAL: `frontend-design` indisponível; motor compartilhado do simplicio-loop#1406 não acessível.

## Checkpoint 27 (2026-10-08 — issue #181 funnel and revenue)

Funil por país e lote, receita por processador na moeda original, assinaturas, churn, mínimo de 3 meses e LTV por cliente, tudo somente leitura; fixture de 200 prospects, 4 vendas e 2 assinaturas confere com o cálculo de referência. Gate completo verde (unit 361, integration 110, regression 22, e2e 307, cobertura 89,08% das linhas). PARTIAL: sem leitor do webhook da AbacatePay; `frontend-design` indisponível.

## Checkpoint 28 (2026-10-08 — issue #183 performance, winners and double down)

Ranking por métrica, vencedores do mês 1 ligados às variações do mês 2, comparação por formato, gancho e idioma, e crescimento por cliente; métrica ausente nunca vira zero. Gate completo verde (unit 361, integration 115, regression 22, e2e 309, cobertura 89,18% das linhas). PARTIAL: retenção e miniatura sem fonte; `frontend-design` indisponível.

## Checkpoint 29 (2026-10-08 — issue #185 dashboard quality)

Acessibilidade (axe-core, WCAG 2.2 AA, 0 violações em 10 seções x 2 temas e 4 estados de diálogo), LGPD (quatro vazamentos de contato achados e corrigidos), segurança, desempenho (LCP máx. 288 ms) e sessão de 8 h sem vazamento, com `docs/DASHBOARD.md`. Gate completo verde (unit 361, integration 123, regression 22, e2e 345, cobertura 89,22% das linhas). PARTIAL: `frontend-design` indisponível; alinhamento com simplicio-loop#1409 não acessível.

## Checkpoint 30 (2026-10-08 — issue #186 flow diagram)

Fluxo declarativo do projeto (entradas, passos, saídas) com Mermaid, SVG, PNG e Langflow gerados de um único arquivo, teste de drift contra o código e a lista de comandos da CLI, e imagem no README. PARTIAL: importação no Langflow 1.12.0 não verificada (não instalado); sem o gerador do simplicio-mapper; sem diagrama por execução.

## Checkpoint 31 (2026-10-08 — issue #95 release train check)

Verificado o que falta: a metade no repositório (reconciliação, diff de contrato, pin com rollback, recibo de versão) existe e passa nos testes; a metade que precisa do Loop core real está BLOCKED-EXTERNAL (`operator doctor --json` responde BLOCKED / MANIFEST_REJECTED, sem `simplicio-loop` instalado, sem o `component-release.json` assinado do upstream, Actions desligadas). A issue continua aberta. Evidência em `docs/evidence/issue-95-release-train-status.md`.
