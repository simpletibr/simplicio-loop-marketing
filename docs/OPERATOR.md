# Camada de operador (simplicio-loop) — divisão de estado e resolução de workers

Este repo roda com **duas camadas de orquestração** que nunca competem entre si:

| Camada | Quem escreve | Diretório de estado | Conteúdo |
|---|---|---|---|
| **Produto** (marketing-engine, TS) | `lib/observability/*`, `lib/loop/journal.ts`, `lib/cli/loop.ts` | `.simplicio/` | `events.jsonl` (`marketing-event/v1`), `ledger/marketing-savings-events.jsonl` (`simplicio.savings-event/v1`, hash-chained), `loop/journal.jsonl` (`marketing-loop-state/v1`, mirrored into `outputs/<client>/<date>/<piece>/journal.jsonl` when the piece directory exists) |
| **Operador** (agente/sessão, Python) | workers do plugin simplicio-loop | `.simplicio-loop/orchestrator/` (simplicio-loop ≥ 3.47; antes `.orchestrator/`) | `loop/` (scratchpad, journal, anchor, done flag, `last_response.txt`), `backlog/backlog.jsonl`, `tee/` (evidências) — nada disso é trackeado |

Regra de bolso: `.simplicio/` é o **estado do produto** (auditável, contratos
versionados em `contracts/marketing-artifacts/v1/`); `.simplicio-loop/orchestrator/` é o
**estado da sessão do agente** que dirige o produto (pode conter transcrições,
por isso nunca vai para o git). O `.gitignore` ignora `.simplicio-loop/*` e mantém
trackeados apenas `.simplicio-loop/install-ownership.json` (recibo do instalador)
e o ledger do produto (`.simplicio/ledger/`). `.orchestrator/*` continua ignorado
para checkouts com estado legado (< 3.47).

## O que o instalador wireou

`bash scripts/install.sh claude` (rodado a partir do checkout do
simplicio-loop) copiou:

- `.claude/skills/` — as skills do operador (`simplicio-loop`,
  `simplicio-orient`, `simplicio-review`, `simplicio-compress`,
  `simplicio-learn`, `simplicio-tasks`).
- `hooks/` — hooks Python cross-platform (fail-open, exceto o gate):
  `loop_stop.py` (re-feed/exit do loop), `orient_rewrite.py` (clamp opt-in),
  `action_gate.py` (**fail-closed**: bloqueia force-push, mass-delete,
  segredos em diff — `python3 hooks/action_gate.py selftest` prova 15/15),
  `orient_clamp.py` (wrapper de output, sem wiring).
- `.claude/settings.json` — `Stop → loop_stop.py`,
  `PreToolUse[Bash] → action_gate.py + orient_rewrite.py`.
- `.git/hooks/pre-commit` — no-op fail-open fora do repo fonte do plugin.

## Resolução dos workers Python (journal/anchor/backlog)

A cópia lean do plugin NÃO carrega os workers de loop; eles vivem no
checkout fonte do simplicio-loop. Resolução, em ordem:

1. `SIMPLICIO_LOOP_ROOT` — aponte para o checkout
   (ex.: `export SIMPLICIO_LOOP_ROOT=$HOME/Projetos/ai/simplicio-loop`);
   workers em `$SIMPLICIO_LOOP_ROOT/scripts/`.
2. Checkout irmão `../simplicio-loop/scripts/` (layout deste workspace).
3. Ausentes → a camada de produto segue sozinha (`lib/loop/journal.ts` é o
   attempt-memory TS); o bridge é **fail-open** e o modo ativo fica
   registrado em `.simplicio/events.jsonl`.

Verificação (todos devem passar antes de confiar no operador):

```bash
python3 "$SIMPLICIO_LOOP_ROOT/scripts/loop_journal.py" selftest
python3 "$SIMPLICIO_LOOP_ROOT/scripts/task_anchor.py" selftest
python3 "$SIMPLICIO_LOOP_ROOT/scripts/task_backlog.py" selftest
python3 hooks/action_gate.py selftest
(cd "$SIMPLICIO_LOOP_ROOT" && python3 scripts/token_budget.py --self-test)
```

Nota: o pacote pip `simplicio-loop` fornece apenas `install`/`dashboard`
(não expõe os workers como verbos), e `simplicio-runtime` não está instalado
neste ambiente — o protocolo trata operador ausente como BLOCK para
native-bind claims, nunca como fallback silencioso (contrato do
`.claude/skills/simplicio-loop/SKILL.md`).

## Protocolo

O contrato executável do loop (promise exata, evidence-gated exit,
converge/drain, cap de iterações) está em
`.skills/simplicio-loop-marketing/SKILL.md` § "Executable loop protocol".
