# Domain Map

## Product Context

- App: Marketing Engine
- Main users: Developer maintainer, AI execution agent
- Main business goal: Provider-agnostic AI marketing engine. CLI that drops into any host project. Pipeline: brief -> script -> creative -> caption -> compliance -> publish -> metrics -> ads. Switch LLM/image/video provider via env, never via skill rewrite.

## Core Concepts

| Concept | Meaning | Source of truth |
|---|---|---|
| Piece | Smallest unit of work in the pipeline, defined by frontmatter + body. | `pieces/<status>/<piece>.md`, `lib/pieces/frontmatter.ts` |
| Watcher report | Independent verification artifact for a piece before promotion. | `.marketing-engine/data/gate/<piece-id>.json`, `lib/gate/watcher-gate.ts` |
| Claims tag | Verification state attached to a piece: `MEASURED`, `CANON`, `UNVERIFIED`. | `lib/gate/watcher-gate.ts`, `lib/gate/claims-gate.ts` |
| Run log | Execution summary of generate/promote loops. | `.marketing-engine/data/runs.jsonl` |
| Usage log | Provider/cost telemetry. | `.marketing-engine/data/llm-usage.jsonl` |
| Promotion draft | Paid-media handoff generated from winning pieces that pass claims discipline. | `outputs/<client>/<date>/<piece-id>/ads-draft*.json` |

## Critical Rules

| Rule | Expected behavior | Where implemented | How to test |
|---|---|---|---|
| Commands stay documented | Desenvolvimento, validação e evidência precisam estar explícitos | docs/local-setup.md + AGENTS.md | executar os comandos listados |
| Mapping stays current | Mudanças relevantes atualizam docs no mesmo PR | .specs/ + docs/ | revisão de diff |
| Claims before spend | Peças `UNVERIFIED` não podem virar promoção paga | `lib/gate/claims-gate.ts`, `lib/cli/promote.ts` | rodar promote loop com watcher report falhando |
| Watcher before schedule | Generate loop só avança peça quando o watcher passa | `lib/cli/generate.ts`, `lib/gate/watcher-gate.ts` | rodar generate com peça que viole checks |

## Main Entities

| Entity | Description | Storage |
|---|---|---|
| Piece frontmatter | metadados como `client`, `platforms`, `status`, `claims_tag`, `watcher_report_path` | markdown under `.marketing-engine/pieces/` |
| Manifest | consolidated outputs + providers + reports for one piece | `outputs/<client>/<date>/<piece-id>/manifest.hbi` |
| Gate enforcement | persisted decision explaining why a piece can/cannot be promoted | `.marketing-engine/data/gate/<piece-id>.enforcement.json` |
| Learning entry | loser / blocked-piece note for future iteration | `.marketing-engine/data/learnings.md` |

## Important Flows

### Generate loop

1. User/system action: run `marketing-engine generate` in a host repo.
2. Entry point: `bin/marketing-engine.mjs` -> `lib/cli/generate.ts`.
3. Main modules: router, provider adapters, compliance gate, watcher gate, manifest writer.
4. Output: piece transitions (`draft` -> `scheduled` or `review`), manifests, gate reports, run logs.
5. Evidence: stdout, `.marketing-engine/data/*.jsonl`, `outputs/.../manifest.hbi`, Playwright suite.

### Promote loop

1. User/system action: run `marketing-engine promote` after analytics exist.
2. Entry point: `bin/marketing-engine.mjs` -> `lib/cli/promote.ts`.
3. Main modules: analytics classifier, claims gate, ads draft writer, learning logger.
4. Output: ad drafts for winners that pass claims discipline; losers appended to learnings.
5. Evidence: `.marketing-engine/data/promotions.jsonl`, `.marketing-engine/data/gate/*.enforcement.json`, ads draft JSONs.

## Edge Cases

- Missing watcher report: piece is treated as `UNVERIFIED` and blocked from promotion.
- Node < 18: Playwright validation may fail before tests execute.
- No initialized host workspace: workspace-dependent commands exit early with infra guidance.
