# PRD — Evolução do loop autônomo (extraindo os padrões dos repos irmãos)

## Objective

Evoluir o `marketing-engine` de "pipeline completo em DRY_RUN dirigido por playbook" para um
**loop autônomo real com memória durável, observabilidade central e gates fail-closed**, portando
os padrões já battle-tested dos repos irmãos:

- **simplicio-loop** → journal/anchor/backlog (memória de tentativa + freeze de AC), action-gate,
  token-budget — consumidos como plugin/operador Python (camada de agente, `.simplicio-loop/orchestrator/`; `.orchestrator/` até o loop 3.46).
- **simplicio-dev-cli** → observability two-track (stdout=payload, stderr=diagnóstico,
  events.jsonl versionado), pipeline apply+verify com retry classificado, doctor.
- **simplicio-mapper** → contratos de artefato versionados (campo `schema` auto-descritivo +
  validador subset + fixtures reais + drift gate), savings ledger com `proof_kind` rotulado.

## Context

O pipeline por peça (brief → script → creative → caption → compliance → publish → metrics → ads)
já existe em `lib/` e é coberto por specs Playwright (node runner) contra mocks. O que falta é a
camada de **orquestração autônoma**: um comando único que drene o backlog de peças com attempt
memory (não repetir a mesma falha), gates de evidência e trilha auditável.

Plano completo aprovado: ver histórico da sessão (plano "Evolução — simplicio-loop-marketing").

## Requirements (fases)

- [x] **F0 — Baseline verde e higiene**: 4 e2e vermelhos corrigidos (mock marker vs
      placeholder-check do watcher-gate; caption por plataforma no gate; claims-gate no teste de
      promote); lint de convenções (`scripts/lint-conventions.mjs`, node builtins);
      `.gitignore` para `.simplicio/*` (exceto `ledger/`) e `.simplicio-loop/*` (exceto `install-ownership.json`; legado: `.orchestrator/*`);
      este PRD preenchido.
- [ ] **F1 — Observabilidade two-track**: `lib/observability/events.ts` emite
      `marketing-event/v1` (stderr humano + `.simplicio/events.jsonl`, rotação 10MB, kill-switch
      `SIMPLICIO_DISABLE_RUN_LOG`, fail-open); instrumentar generate/promote/campaign;
      `e2e/events.spec.ts`.
- [ ] **F2 — Savings ledger**: `lib/observability/savings.ts` grava
      `simplicio.savings-event/v1` com `proof_kind: estimated` + `estimator` rotulado
      (`heuristic:chars-div-4`); nunca corromper a hash-chain existente do ledger;
      `e2e/savings-ledger.spec.ts`.
- [ ] **F3 — Contratos versionados**: `lib/contracts/validate.ts` (subset JSON Schema);
      `contracts/marketing-artifacts/v1/` (event, manifest, savings, loop-state,
      publish-receipt) + fixtures geradas pelo produtor real + drift gate;
      `e2e/contracts.spec.ts`.
- [ ] **F4 — Plugin operador**: instalar simplicio-loop (skills + hooks) no repo; SKILL.md do
      super-skill vira protocolo executável (promise exata, evidence-gated exit,
      converge/drain); `docs/OPERATOR.md`.
- [ ] **F5 — Comando `loop`**: `lib/cli/loop.ts` drena peças+campanhas via yool board +
      WorkerGovernor; `lib/loop/journal.ts` (fingerprint de falha, PROGRESS/STALLED,
      anti-oscilação); bridge Python opcional fail-open; generate→promote in-process;
      `e2e/loop-drain.spec.ts`.
- [ ] **F6 — Publish-verify**: `lib/publish/verify-pipeline.ts` (validar → dry-run → gates →
      publish → receipt → retry classificado, MAX_ATTEMPTS=5); receipt
      `marketing-publish-receipt/v1`; `e2e/publish-verify.spec.ts`.
- [ ] **F7 — Doctor**: `lib/cli/doctor.ts` (env, freshness de events/ledger, resumo do stream,
      selftest do plugin); JSON `marketing-doctor-report/v1` no stdout; `e2e/doctor.spec.ts`.
- [ ] **F8 (opcional) — MCP transport**: `docs/MCP-TRANSPORT.md` documentando o contrato para
      ligar providers reais (sem código real sem `DRY_RUN=false` + credenciais).

## Non-Goals

- Ligar chamadas reais de provider (creative/publish/ads) — fica documentado em F8, dependente
  de credenciais humanas.
- Reescrever módulos existentes de `lib/` que já passam nos specs.
- Adicionar dependências novas (validador e lint são caseiros, node builtins).
- Mudar o default `DRY_RUN=true`.

## Technical Notes

Arquivos-chave: `bin/marketing-engine.mjs` (dispatch + `spawnTsx`), `lib/cli/generate.ts`
(`runGenerateLoop`), `lib/cli/promote.ts` (`runPromoteLoop`), `lib/yool/board.ts`
(tuple-space + WorkerGovernor), `lib/gate/watcher-gate.ts` (disciplina MEASURED/UNVERIFIED).

Divisão de estado: `.simplicio/` = produto (events, ledger, loop state); `.simplicio-loop/orchestrator/` =
operador/agente (journal/anchor/backlog do plugin Python); `.marketing-engine/` = artefatos de
peça no host (inalterado).

## Validation Commands

```bash
npm run typecheck
npm run lint
npx playwright test
node bin/marketing-engine.mjs loop --max-iter 2   # F5+, DRY_RUN
node bin/marketing-engine.mjs doctor              # F7+
```

## Done When

- [ ] Todas as fases F0–F7 implementadas com seus specs e2e verdes
- [ ] `npx playwright test` completo verde (186+ specs)
- [ ] `npm run typecheck` e `npm run lint` verdes
- [ ] Capstone `e2e/saas-launch-loop.spec.ts` passa pelo comando `loop`
- [ ] GOAL_RESULT.md atualizado com validação real
