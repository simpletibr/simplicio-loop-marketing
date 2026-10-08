## 0.4.0 - 2026-07-11

- Completed programming backlog #65-#79 with autonomous-loop gates, observability, doctor, watcher, retrospective, and DRY_RUN autoresearch.
- Added Windows-safe convention lint and 236-test release gate.

# Changelog

All notable changes to this project are documented here. Format based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **Baseline do gate:** `publishVerified`, o relatório de evidência e os relatórios de falhas/AB liam `manifest.json` e `runs.jsonl` depois da migração para HBP/HBI (toda peça gerada ficava bloqueada na publicação); as CLIs `evidence` e `report` não rodavam no modo de loader direto; as revisões de exceção de `config/json-boundaries.toml` venceram em 2026-10-01 e foram renovadas até 2027-01-31; specs seguem os formatos novos; `artifacts/` (saída gerada) é ignorado.
- **Revisão QA do PR #170:** `hooks/user_prompt_submit.py` não quebra mais todo prompt (registro removido e modo degradado explícito); o estado do loop em `.simplicio-loop/` (transcrições, journal, anchor) e o `__pycache__/` são ignorados pelo git; o pre-push do `hooks/action_gate.py` roda `npm run check` e bloqueia quando não há gate, em vez de pular em silêncio; `ImportError` de `simplicio_loop.delivery_contract` falha fechado em `action_gate.py` e `loop_stop.py`; removidos o `.pyc` versionado e a referência órfã `cross-repo-integration.md`.

### Added

- **Issue #183 desempenho por post, vencedores e "double down":** rota `/api/performance` e seção Desempenho, somente leitura: ranking de posts por visualizações, curtidas, comentários, compartilhamentos ou salvamentos, vencedores do mês ligados às variações que o plano do mês seguinte fez deles (com etapa e visualizações), comparação por formato, por gancho e por original ou dublado, e curva de crescimento por cliente. Métrica que a fonte não trouxe é "sem dado", nunca zero, e fica fora de somas e médias; dia sem leitura é lacuna na curva. Pendente: retenção (sem fonte), miniatura (sem fonte; a prévia carrega sob demanda) e a direção estética pela skill `frontend-design`.
- **Issue #181 funil comercial e receita:** rota `/api/funnel` e seção Funil e receita, somente leitura: prospects coletados, prévias, enviadas, respostas, vendas e assinaturas ativas por país e lote, com a conversão de cada etapa e prospect para venda contra a referência de cerca de 2%; receita (MRR, avulsa e recorrente, por Stripe e AbacatePay) na moeda original e em reais só quando toda a cobrança traz a conversão (senão "sem dado"); assinaturas por plano, churn de 30 dias e mínimo de 3 meses; por cliente, LTV, meses ativos, próxima cobrança (`next_charge_at` nos eventos de assinatura da Stripe) e `pago → entregue`. O modo apresentação esconde os valores por cliente. Nada cria cobrança. Pendente: leitor do webhook da AbacatePay (payload não confirmado; as vendas do BR entram pelo `venda.json`), a planilha em xlsx (lê-se o CSV exportado) e a direção estética pela skill `frontend-design`.
- **Issue #182 fila de aprovações e #184 alertas da distribuição:** rotas `/api/approvals` e `/api/alerts` e as seções Aprovações e Alertas. A fila do cliente lista links de aprovação sem resposta com idade, tempo até o post e cor (vermelho abaixo de 24 h ou atrasado, amarelo abaixo de 72 h), pedidos de ajuste com o texto do cliente sem dados de contato e só o controle de copiar (a v1 não aprova nada; teste); a fila do Wesley lista as decisões do tuple board com estimativa de crédito e impacto. Os alertas são uma função pura dos eventos, recibos e planos: existem enquanto a condição vale, sem duplicata, com `since` do início da condição; 11 regras (post não publicado, falha de publicação por tipo, sessão da Real Oficial, contas perto do limite, saldo baixo, cota de voz com horário de volta, aprovação vencendo, peça parada, QA ou compliance reprovando em sequência, mês com poucos posts, pagamento sem entrega), cada uma com teste de disparo e de limpeza. Centro de alertas, toast e notificação do navegador opcional; nada sai da máquina por padrão (só `MARKETING_DASHBOARD_ALERT_WEBHOOK`, desligado). Limiares por `MARKETING_ALERT_STUCK_HOURS`, `MARKETING_ALERT_MIN_SCHEDULED` e `MARKETING_ALERT_MIN_CREDITS`. Pendente: direção estética pela skill `frontend-design` (indisponível) e o motor de regras compartilhado do simplicio-loop#1406 (não acessível daqui).
- **Issue #180 créditos e custos:** rota `/api/credits` e visão Créditos e custos, somente leitura: saldo da Real Oficial (`ro_whoami`), gasto do mês por finalidade e por cliente com quem aprovou, projeção linear, cota e custo da voz (dólar pela `PTAX_USD_BRL`, rotulado como estimativa), reaproveitamento de voz, uso de LLM, e custo por prévia, por venda e por cliente contra o preço (crédito pela `RO_CREDIT_BRL`); sem a taxa ou o valor o campo é "sem dado". Nenhum botão ou formulário na página (teste). Pendente: histórico de compras e tempo de máquina do render (sem fonte), e direção estética pela skill `frontend-design`.
- **Issue #179 gates de qualidade e compliance por peça:** rota `/api/quality` e visão Qualidade com o selo de cada gate por peça (QA técnico, compliance, watcher, licenças do B-roll, aprovação por hash da mídia e rótulo de IA) e o motivo, peça com hash diferente do aprovado bloqueada, percentual aprovado de primeira por gate, principais motivos de reprovação e tendência semanal; um gate que não rodou é "sem dado", nunca aprovado. Os eventos `qa_result` e `compliance_result` passam a levar só os ids das regras (nunca o texto encontrado). Licenças do B-roll leem `broll-licenses.json` da peça, contrato ainda a confirmar com a fábrica de vídeo. Pendente: direção estética pela skill `frontend-design` e a árvore JSON do kit `sl-*` (não estavam disponíveis; o relatório do gate aparece em texto na gaveta da peça).
- **Issue #178 status por rede e saúde do publicador:** rota `/api/status` (matriz cliente × rede com conexão, último e próximo post, sucesso em 7 dias e falhas classificadas, saúde da sessão da Real Oficial, contas conectadas contra o limite do plano com aviso aos 80%), recibos `marketing-publish-receipt/v1` em lista e detalhe e captura de tela de evidência servida só de `data/evidence`; cada falha mostra o motivo e o próximo passo humano; recibos de simulação não contam como post nem como sucesso; texto livre passa por redação e nenhuma credencial, cookie ou token é exibido. A leitura da Real Oficial ganhou `ro_list_social_accounts` (somente leitura). Corrige a perda de foco do teclado quando o painel atualiza ao vivo. Pendente: direção estética pela skill `frontend-design`, que não estava disponível.
- **Issue #166 loop de métricas:** fontes somente leitura com respostas gravadas em teste (Real Oficial `ro_get_social_analytics`, YouTube `videos.list`, Instagram Insights, TikTok Display API `video.list` no lugar da Research API; os geradores de números sintéticos do DRY_RUN saíram), snapshots ligados ao recibo de publicação, vencedores do mês (top 20% por visualizações, mínimo de 3 posts medidos), `campaign --winners YYYY-MM` que dedica 40% do próximo plano a variações dos vencedores (`variant_of`), e relatório mensal em markdown e PDF sem dependência nova, onde métrica ausente é "sem dado" e nunca zero. Comando `marketing-engine metrics link|collect|import|winners|report`, evento `winner_marked` no painel e fluxo em `docs/METRICS-LOOP.md`.
- **Issue #165 dublagem e tradução (`dubbing`):** interface `Dubbing` com `estimate()` (nunca gasta nem chama a Real Oficial) e `dub()` (falha fechado sem `approvedByWesley`), recibo `dubbing-receipt/v1` com o rótulo de voz de IA, implementações `dry-run` e `realoficial` (ferramentas oficiais `ro_dub_clip`, `ro_translate_clips`, `ro_list_translations_and_dubs` e `ro_render_clip` por transporte injetado; o consentimento de direitos de voz nunca é dado pelo motor), matriz idioma → `tts` | `realoficial-dub` | `subtitle-only` configurável por cliente em `voice_routes` do perfil, comando `marketing-engine dubbing` e eventos `dubbing_requested`/`dubbing_finished` no painel. Checklist de revisão por idioma em `docs/DUBBING.md`. Pendente: piloto em 1 idioma, que precisa de sessão ao vivo e do consentimento do dono.
- **Issue #164 formatos derivados e faixa de cortes de vídeo longo:** `monthlyMix` (4 hero, 6 cutdowns, 4 variações de gancho, 3 slideshows, 3 carrosséis e 4 cortes quando o cliente tem vídeo longo), faixa `marketing-engine clips` (`ro_estimate_clips` → OK do Wesley → `ro_create_clips` → `ro_wait_for_clips` → `ro_render_clip`) que em DRY_RUN roda com respostas gravadas e não gasta nada, e ao vivo bloqueia sem `--approved-by-wesley`, com cotação vencida ou com termos não aceitos; cada gasto vira linha em `data/credits.jsonl` com `approved_by` e `format`; `cost --by-format` soma créditos e voz por formato. Contrato em `docs/DERIVED-FORMATS.md`. Pendente: os templates do simplicio-videos (outro repositório) e baixar os cortes ao vivo.
- **Issue #160 provider `simplicio-video` + `brand-profile/v1`:** novo provider que escreve `simplicio.video-contract/v1`, roda o CLI da fábrica de vídeo sem shell e só aceita o MP4 se o sha256 do `render.manifest.json` bater (o stub do HyperFrames saiu do registro, as três tarefas da matriz agora roteiam para `simplicio-video`); contrato `brand-profile/v1` com fixture gerada pelo produtor; comando `marketing-engine profile <url> --client <slug>` (recusa PII e robots ignorado, cada fato guarda a fonte); o manifest do render vira evidência em `publishVerified` (`render_evidence_blocked`). Ao vivo: depende do CLI instalado.
- **Issues #175, #176 e #177 cockpit, pipeline e calendário do painel:** modelo por peça com 11 etapas, rotas `/api/cockpit`, `/api/pipeline` e `/api/calendar`, UI sem framework nem build (landmarks, `aria-live`, tema claro/escuro, modo apresentação mascarado no servidor, paleta de comandos, SSE, gaveta da peça com prévia, calendário com teclado e fusos). KPIs conferidos contra um cálculo de referência (5 clientes, 60 peças) e "sem dado" onde não há fonte. A skill `frontend-design` e o kit `sl-*` não estavam disponíveis: direção estética pela skill pendente.
- **Issue #174 comando `dashboard`:** `marketing-engine dashboard` (`--client`, `--campaign`, `--port`, `--no-browser`, `--json`, `--present`, `--status`, `--stop`) e `--snapshot <out.html> --client <slug> --month YYYY-MM`, uma página estática do mês do cliente sem dados internos, que rotula simulações e mostra "sem dado" onde falta métrica; `status` passa a mostrar a URL do painel e volta a ler o `runs.hbp` (lia JSON). `approval list` lista pedidos e decisões.
- **Issue #173 backend em tempo real do painel:** servidor `node:http` local sem dependências novas (127.0.0.1, token de sessão, checagem de Host e Origin, CSP, só GET/HEAD), SSE com replay por `Last-Event-ID` (p95 de 170 ms medido), rotas de clientes, campanhas e peças, mídia com range requests restrita às pastas permitidas, e janela de leitura da Real Oficial limitada a `ro_whoami`, `ro_list_projects` e `ro_list_renders`.
- **Issue #172 eventos `marketing.*` do painel de distribuição:** envelope `simplicio.dashboard-event/v1` com os 21 tipos, log idempotente com `seq` (id do SSE) e adaptadores incrementais para o log de eventos, journal, yool board, recibos, aprovações, artefatos por peça, pastas de saída da fábrica de vídeo, CSVs, `venda.json`, webhooks Stripe, créditos, cota do TTS e métricas; uma fonte de verdade por tipo e dados de contato removidos. Contrato em `docs/DASHBOARD_EVENTS.md`.
- **Issue #162 calendário de 30 dias:** contrato `content-plan/v1` e planejador determinístico (horários locais por fuso com horário de verão, formato e rota por slot, limites por rede, janela de 30 dias), render em lote com fila persistente e retomada, pedidos de aprovação, agendamento só do que foi aprovado e dentro da janela (idempotente por peça + rede + dia) e visão `planStatus`; comandos `campaign --client <slug> --days 30`, `campaign render|approvals|schedule` e `calendar` (tabela e markdown); o `schedule install` em Linux agenda o plano do mês seguinte no dia 25.
- **Issue #161 seam `Publisher` + Real Oficial interina:** interface `Publisher` (dry-run por padrão, `realoficial-browser` sobre um `BrowserDriver`, `realoficial-api` reservado) e `scheduleVerified`: claims tag, janela de 30 dias, aprovação do cliente atada ao hash da mídia, action-gate no modo ao vivo, idempotência por peça + rede + dia e livro-razão de recibos `marketing-publish-receipt/v1` (veredictos `scheduled`/`cancelled`, evidência com screenshot e DOM redigido, falhas classificadas incluindo `layout_changed`). O broker passa a escolher o publisher (`PUBLISHER` explícito no modo ao vivo). `AdaptlyPostClient` marcado como obsoleto. O spike e o post de teste ao vivo dependem do dono.
- **Issue #163 link de aprovação do cliente:** contrato `approval/v1` (decisão atada ao sha256 da mídia, última decisão vale, render novo exige novo pedido), página estática mobile com prévias 540×960 sem scripts, webhook `node:http` com token por pedido e limite de corpo, comando `marketing-engine approval request|page|record|serve|adjustments`, fila de ajustes com o texto do cliente e ação `schedule` no action-gate que bloqueia peça sem aprovação ou com hash diferente.
- **Planejamento simplicio-videos + Real Oficial** (épico #159, issues #160–#169): `docs/ROADMAP-REALOFICIAL-VIDEOS.md` com papéis, superfície real de integração da Real Oficial (MCP/REST só de cortes; publicação/agendamento/dublagem só no app web → adaptadores `publisher`/`dubbing` com implementação provisória por navegador), fases, guardrails de créditos e riscos; super-skill `.skills/simplicio-loop-marketing/SKILL.md` atualizada.
- **simplicio-loop 3.47.0** instalado pelo instalador oficial (`simplicio-loop install`): skills em `.claude/skills/` e hooks em `hooks/` (o hook novo `UserPromptSubmit` fica desregistrado até o core empacotar o adapter, simpletibr/simplicio-loop#1410), mais o recibo `.simplicio-loop/install-ownership.json` classificado em `config/json-boundaries.toml`. `extension/core.lock.json` fixado em 3.47.0 (commit `e6f0f33`, sha256 do wheel `77c0b667…d389`), com rollback para 3.38.0.

- **Issue #99 completion:** extracted canonical caption fan-out with deterministic fast-check invariants for platform keys, bounds, Unicode-safe truncation, and pillar-tag preservation; added a near-real pt-BR fixture through parsing, compliance, fan-out, and observable E2E assertions.

- **Issue #93 Loop core extension binding:** publishes the pinned `simplicio.loop-extension/v1` marketing manifest, hashed context schemas, declarative stage/role/gate/resource bindings, core-owned budgets, receipt-derived views, and a fenced exactly-once effect adapter. Campaign startup rejects incompatible cores before creating work; doctor reports conformance.

- **Issue #92 conformance certification:** canonical manifest/schema compatibility gate, deterministic manifest and graph hashes, fail-closed incompatible-core handling, exactly-once fenced fake-effect recovery/security coverage, clean-package E2E parity, and documented upgrade/canary/rollback evidence.

- **Loop core release train** (issue #95): official `loop.marketing` extension manifest and immutable core lock; fail-closed component-release compatibility/diff evaluator; 15-minute event/poll reconciliation workflow with deduplicated bump PRs; canary/rollback pins; release identity in campaign manifests and doctor output; unit, integration, E2E, regression coverage and a numeric p95 budget.
- **Issue meta-audit** (#106): fail-closed, reproducible inventory with machine/human receipts and unit, integration, regression, E2E, security, and measured performance coverage.

- **4-layer DoD gate** (issues #99, hub simplicio-loop#579): [`DOD.md`](./DOD.md) documents a correctness-beyond-coverage layer on top of the existing 7 pillars — property-based testing (`fast-check`) for resolution/fan-out logic, real-content fixtures, a PR invariant-review question, and asserting on observable results instead of a reported status. `tests/unit/router-properties.test.ts` is the reference implementation, generating provider/override/env combinations against `lib/router.ts` and asserting determinism, override precedence, and no env-noise leakage. `.github/PULL_REQUEST_TEMPLATE.md` gained the invariant-check and observable-result-evidence sections.
- **Asolaria narrative package** (issue #78, repo-local scope only): canonical [SIMPLICIO-MAP-OF-MAPS.md](./SIMPLICIO-MAP-OF-MAPS.md), [REDUCTIONS.md](./REDUCTIONS.md), and the bounded campaign artifact set under `.specs/strategy/campaigns/2026-Q3-asolaria-on-metal/` (`CAMPAIGN.md`, `HYPOTHESIS.md`, `ROUTING.md`, `LANDING.md`, `DEMO.md`, `CASE-STUDY.md`) plus a fixture-backed unit test verifying required docs, links, and explicit external dependencies.
- **Asolaria package, deploy-ready follow-up** (issue #78 closeout): two self-contained static pages (`site/simplicio-on-metal/index.html`, `site/asolaria-integration/index.html`); a reproducible 5-iteration orientation-cost demo (`scripts/demo-asolaria-loop.mjs`, `npm run demo:asolaria`) writing `.specs/strategy/campaigns/2026-Q3-asolaria-on-metal/DEMO-RUN.md`; and a fail-closed reduction proof-trail benchmark (`scripts/reductions-benchmark.mjs`, `npm run benchmark:reductions`) writing `docs/evidence/reductions-benchmark.json`. All narrative docs cross-linked to the new artifacts; new unit tests spawn both scripts in `--check` mode.

Autonomous-loop evolution — the best patterns of the sibling repos (simplicio-loop, simplicio-dev-cli, simplicio-mapper) ported into the engine (see PRD.md):

- **`marketing-engine loop`** (`lib/cli/loop.ts`, `lib/loop/journal.ts`): one command drains the draft-piece backlog through generate's real gates with durable attempt memory — stable failure fingerprints in `.simplicio/loop/journal.jsonl` (`marketing-loop-state/v1`), `PROGRESS|STALLED` verdicts, and skip-after-3-identical-failures instead of retrying forever; `--mode drain|converge`, `--max-iter`, `--client`; yool-board tuple per piece; optional fail-open bridge to the simplicio-loop Python journal (`MARKETING_LOOP_PY_WORKERS=1`).
- **Verified publication** (`lib/publish/verify-pipeline.ts`): manifest contract → claims gate → compliance recheck → publish with classified retry (transient provider errors only, MAX 5; deterministic gate failures fail closed with zero provider calls); mechanical `marketing-publish-receipt/v1` next to each manifest; DRY_RUN never fakes a `published` transition.
- **Two-track observability** (`lib/observability/events.ts`): `marketing-event/v1` stream — human line on stderr + JSONL under `.simplicio/events.jsonl` with rotation, `SIMPLICIO_DISABLE_RUN_LOG` kill-switch and fail-open semantics; generate/promote/campaign/loop/publish instrumented.
- **Savings ledger** (`lib/observability/savings.ts`): hash-chained `simplicio.savings-event/v1` receipts with `proof.kind` always `"estimated"` and a labeled estimator (`heuristic:chars-div-4`) — estimates are never presented as measurements; `verifyChain()` detects tampering.
- **Versioned artifact contracts** (`lib/contracts/validate.ts`, `contracts/marketing-artifacts/v1/`): every persisted JSON carries a self-describing `schema` field validated by a dependency-free subset JSON Schema validator; fixtures generated by running the real producers (`scripts/gen-fixtures.mjs`) with a two-sided drift gate (`e2e/contracts.spec.ts`).
- **`marketing-engine doctor`** (`lib/cli/doctor.ts`): read-only self-diagnostic — provider keys, piece counts, event-stream health (gate fail rate, stalls), savings-chain integrity, loop journal, operator hooks; human on stderr, `marketing-doctor-report/v1` JSON on stdout.
- **Operator layer** (`.claude/skills/`, `hooks/`, `docs/OPERATOR.md`): simplicio-loop plugin installed (loop_stop re-feed hook, fail-closed `action_gate.py`, orient clamp); the super-skill now carries the executable loop protocol (exact `<promise>` sentinel, evidence-gated exit, converge/drain, iteration cap); state split documented (`.simplicio/` = product, `.orchestrator/` = agent session).
- **Guards**: convention lint (`scripts/lint-conventions.mjs`, `npm run lint`) and token/context budget guard with negative self-test (`scripts/token-budget.mjs`, `npm run budget`).
- **MCP transport contract** (`docs/MCP-TRANSPORT.md`): the documented, credential-gated path to wire real creative/publish/ads providers later.

Autonomous SaaS marketing loop across social networks and dev communities (epic #46, issues #47-#60):

- **Channel registry** (`lib/channels/registry.ts`, issue #49): typed registry of 8 social platforms and 41 developer/community portals across 10 languages (id, audience, link policy, tone, publish method, compliance notes, frequency limits).
- **Integration broker** (`lib/integrations/broker.ts`, issue #52): resolves publish/schedule/fetch_metrics/draft_ad/comment_monitor/evidence_capture to the safest adapter (api/mcp/browser/computer-use/manual) per channel, with dry-run simulation and structured failure logging.
- **Community compliance gate** (`lib/compliance/community.ts`, issue #56): anti-spam/etiquette audit with a `pass | fail | needs_review` three-state result — checks that cannot be evaluated (unreadable channel rules, corrupted post history) hold for human review instead of silently passing.
- **Accrual-based analytics scoring** (`lib/analytics/score.ts`, issue #54): ranks amplification candidates by the delta between successive polls (normalized per day), not a single cached snapshot, so slow-compounding threads aren't starved by yesterday's spike; flags implausible vanity-metric spikes as spam risk.
- **Strategy playbooks** (`.specs/strategy/PLAYBOOKS.md`, issue #50): per-channel launch playbook for the 10 priority international dev/community channels.
- **Content templates** (`.specs/pieces/templates/*.md`, `lib/content/templates.ts`, issue #57): five evidence-aware templates (dev article, social derivative, video script, Reddit/forum answer, launch thread) that mark missing evidence explicitly and render English-first before any localized adaptation.
- **Browser/computer-use lane** (`lib/automation/browser-lane.ts`, issue #51): governed evidence capture with redaction and failure-mode classification (login_required, captcha, two_factor, platform_rejection, policy_block); DRY_RUN-gated, live actions require explicit human approval.
- **Paid-growth budget guardrails** (`lib/promotion/budget-guardrail.ts`, issue #55): max daily spend, max CPA/CPL, max experiment duration, and stop-loss enforcement wired into the existing ads-draft flow, plus an append-only promotion-attempt audit log with hypothesis.
- **Campaign CLI** (`lib/cli/campaign.ts`, `lib/campaigns/campaign.ts`, issue #53): `marketing-engine campaign --brief <CAMPAIGN.md>` plans a channel/language/format-tagged piece queue and enforces organic-before-paid by default; `campaign review <id>` summarizes winners/losers/spend.
- **Yool tuple-space board** (`lib/yool/board.ts`, `.specs/architecture/YOOL-BOARD.md`, issue #59): event-sourced tuple board across 13 tuple classes and 11 worker lanes; mandatory agent-manifest guardrails (cpu/disk/timeout quotas); `WorkerGovernor` bounds concurrency per lane.
- **Community reply loop** (`lib/community/reply-loop.ts`, issue #60): classifies incoming comments, assigns risk level, drafts evidence-honest replies for human review; never posts autonomously.
- **Root super-skill** (`.skills/simplicio-loop-marketing/SKILL.md`, issue #48): orchestrates the full discover→...→learn loop by capability.
- **Runtime-first ADR** (`.specs/architecture/ADR-002-runtime-first.md`, issue #47): confirms zero required dependency on `simplicio-sprint`/`simplicio-prompt`.
- **E2E mock launch loop** (`e2e/saas-launch-loop.spec.ts`, issue #58): proves the full loop end-to-end against mocks, DRY_RUN throughout, never a live provider/platform call.

### Fixed

- The watcher gate blocked every DRY_RUN run since its introduction: the `[mock-<name>]` attestation tripped the placeholder check (now expected under DRY_RUN only — outside DRY_RUN it still blocks as a mock-leak detector), the gate verified the raw LLM caption instead of the shipping per-platform caption (which carries the pillar hashtag), pure-numeric brackets (`[2]` TOON list markers) are no longer flagged as placeholders, and mocks echo enough prompt for brief terms to survive into topic-coverage. Fixes the 4 long-red e2e specs (`generate-loop`, `notion-sync`, `promote-loop`).

## [0.3.1] - 2026-07-01

### Changed

- Hardened release-readiness and handoff guidance: added `docs/release-readiness.md` with a minimum readiness checklist, claims/evidence rules, and a handoff template; expanded `docs/architecture-map.md`, `docs/domain-map.md`, `docs/local-setup.md`, and `docs/troubleshooting.md` with clearer setup and troubleshooting detail; minor `README.md` update.

## [0.3.0] - 2026-06-30

### Added

- **watcher-gate (N-Nest style)**: independent verification layer in the generate loop that re-checks caption pillar hashtags, script topic coverage, caption length constraints, placeholder leakage, and overpromise language before allowing draft→scheduled transition. Every output receives a `claims_tag`: `MEASURED`, `CANON`, or `UNVERIFIED`.
- **claims-gate**: enforce claims discipline at promote time — UNVERIFIED pieces blocked from ad creation. Watcher reports persisted under `data/gate/<piece-id>.json`.
- `.skills/watcher-gate/SKILL.md`: skill manifest documenting gate rules, integration points, and DoD.
- Piece frontmatter: `claims_tag` and `watcher_report_path` optional fields. Template defaults to `claims_tag: UNVERIFIED`.
- Manifest payload now includes `watcher_report_path`.
- `maybeMarkMeasured` sets `claims_tag: MEASURED` when performance data confirms value.
- Promote loop checks claims gate before creating ad drafts; blocked pieces logged to `data/learnings.md`.

## [0.2.13] - 2026-05-19

### Added

- `<!-- rtk-cli:start -->` block in `AGENTS.md` and
  `.github/copilot-instructions.md` (CLAUDE.md is a symlink to AGENTS.md)
  documenting optional RTK CLI usage for token-smart shell exploration
  (https://github.com/rtk-ai/rtk).
- `.skills/rtk-cli/SKILL.md` skill manifest with plain→rtk mapping,
  trigger examples, and DoD.
- `<!-- yool-tuple-hamt:start -->` capability-addressing block citing
  yool/tuple/HAMT spec v0.2 with mandatory guardrails
  (`cpu_quota_pct=60`, `disk_quota_mb=100`, `timeout_s=300`) per Victor
  Genaro's review.

## [0.2.12] - 2026-05-18

### Fixed

- `qa-tech-specs` now reads channel constraints from `.specs/product/CHANNELS.md`,
  probes assets with `ffprobe` / `identify`, falls back to filename metadata
  when possible, and skips safely with install guidance when local probe tools
  are unavailable.
- The generate loop now writes `qa-tech-specs.json` per piece, blocks pieces
  that fail hard platform-spec checks before scheduling, and records the QA
  report path in the manifest for successful runs.
- Wavespeed image and video providers now support real model selection,
  batch-oriented variant expansion with concurrency capped at 5, and mocked
  local coverage for image downloads plus WAN video polling.

## [0.2.11] - 2026-05-18

### Fixed

- Compliance loading now honors `ACTIVE_CLIENT`, reads additive client override
  rules from `.specs/clients/<client>/COMPLIANCE.override.md`, and writes warn
  lines to a weekly digest plus repeat-block alerts to `data/learnings.md`.
- Blocking compliance reports now move local pieces to `review`, persist the
  report in `data/compliance-blocked/`, and keep the pipeline metadata pointed
  at the canonical `data/compliance/<piece>.json` audit trail.
- `generate` now routes compliance through the shared loader instead of the old
  inline regex helper, and the repo ships a template
  `.specs/clients/_template/COMPLIANCE.override.md` plus focused coverage for
  override loading, escalation, and review transitions.

## [0.2.10] - 2026-05-18

### Fixed

- `marketing-engine sync` now pulls Notion calendar rows into the host
  workspace `.marketing-engine/pieces/`, rendering new piece files from
  `.specs/pieces/piece-template.md` and recording the linked `notion_page_id`
  plus the last synced remote fingerprint.
- Notion sync conflicts now preserve the local piece file and append the remote
  snapshot as a comment block instead of overwriting the frontmatter or losing
  local edits.
- `generate` now back-syncs linked pieces to Notion when they advance to
  `scheduled`, and `promote` marks linked published pieces as `measured` in
  both the local piece file and the Notion calendar.
- `.ralph/sync-calendar.sh` now calls the real `marketing-engine sync`
  command, and the repo adds focused Notion sync coverage for creation,
  conflict handling, and status back-sync paths.

## [0.2.9] - 2026-05-18

### Fixed

- `DeepSeekProvider` now picks `deepseek-chat` for `caption` and
  `translation`, while reasoning-heavy tasks route through
  `deepseek-reasoner`.
- DeepSeek pricing now resolves the correct model family in
  `lib/providers/cost.ts`, with optional per-1k token env overrides for chat
  and reasoner tiers.
- Added provider coverage that asserts the DeepSeek request shape, retry
  behavior, usage accounting, and model-specific cost calculation.
- Synchronized the package version metadata across `package.json` and
  `package-lock.json`.

## [0.2.8] - 2026-05-18

### Fixed

- `OllamaProvider` now normalizes `OLLAMA_HOST`, preserves the configured
  `OLLAMA_MODEL`, and throws a descriptive unreachable-host error that points
  operators to start Ollama or change the host before the fallback chain moves
  on.
- Added local adapter coverage that asserts the Ollama `/api/chat` request
  payload and retry behavior when the local server is offline.
- Synchronized the published package metadata version between `package.json`
  and `package-lock.json`.
- Added the missing scheduler helper parameter annotations in
  `lib/schedule/{linux,mac}.ts` so the repo-wide typecheck can complete again.

## [0.2.7] - 2026-05-18

### Fixed

- `marketing-engine schedule` now routes install, status, and uninstall through
  platform-aware launchd and cron backends, including macOS uninstall/status
  support and a Windows manual Task Scheduler warning instead of silent writes.
- Scheduler preview mode now prints the exact launchd plist bodies or cron
  lines that would be installed, and the Linux cadence now correctly renders
  `22:00` and `09:00` as `0 22 * * *` / `0 9 * * *`.
- Added scheduler round-trip E2E coverage against temporary cron and launchd
  directories, plus updated setup guidance for the new CLI commands.

## [0.2.6] - 2026-05-18

### Fixed

- Provider pricing and usage estimation now live in
  `lib/providers/cost.ts`, keeping the editable pricing table and
  `char/4` fallback heuristic in one shared module.
- Real LLM adapters now emit a concrete retry attempt count, and
  `data/llm-usage.jsonl` persists `tokens`, `cost_usd`, and the final
  `attempt` number from the provider call instead of logging only a
  router-level success marker.
- Missing SDK usage payloads now warn once per provider/model pair while
  still producing cost estimates from the shared fallback token
  heuristic.

## [0.2.5] - 2026-05-18

### Fixed

- `lib/pieces/frontmatter.ts` now enforces `locale` as a required frontmatter
  field, matching the documented piece template contract.
- `lib/pieces/id.ts` now computes ISO weeks from UTC date parts, preventing
  timezone-dependent week rollover bugs in `PIECE-YYYYWww-NNN` ids.
- `lib/pieces/store.ts` now exports `list`, `read`, and `write` aliases in
  addition to the existing `*Piece*` helpers so the public API matches the issue
  contract more directly.

## [0.2.4] - 2026-05-18

### Fixed

- `marketing-engine new-piece`, `status`, and `logs` now operate against the
  host project's `.marketing-engine/` workspace instead of assuming runtime
  files live at the host root.
- `new-piece` now renders from `.specs/pieces/piece-template.md`, prints the
  created file path directly, and scans existing weekly piece files so repeated
  CLI invocations do not reuse the same `PIECE-YYYYWww-NNN` id.
- `status` and `logs` now return infra exit code `2` when the workspace has not
  been initialized yet, while still succeeding cleanly when the data directory
  exists but the usage log file is empty.

## [0.2.3] - 2026-05-18

### Fixed

- `marketing-engine promote` now reads and writes its runtime artefacts from the
  host project's `.marketing-engine/{data,pieces,outputs}` workspace by
  default, matching the scaffolded project layout.
- Winner drafts now honor `provider_override.ads` from the source piece
  frontmatter, and the CLI summary output matches the documented
  `promoted: N | losers: M | skipped: K` format.

## [0.2.2] - 2026-05-18

### Fixed

- `marketing-engine generate` now resolves the host project's
  `.marketing-engine/{pieces,outputs,data}` workspace by default instead of
  assuming runtime files live at the host root.
- `lib/cli/generate.ts` now honors the `MAX_ITER` environment variable in
  addition to the existing `--max-iter` flag, and the E2E coverage exercises
  both the host-workspace defaults and the capped iteration flow.

## [0.2.1] - 2026-05-18

### Added

- `e2e/provider-factories.spec.ts` exercises the non-`DRY_RUN` factory path so
  the suite proves the repo returns real provider adapters instead of production
  mocks.

### Changed

- E2E coverage now mirrors the Sprint 0 acceptance language more closely:
  `e2e/cli-init.spec.ts` and `e2e/cli-scan.spec.ts` split the host-project
  scaffold and scan coverage, `e2e/generate-loop.spec.ts` asserts structured
  usage-log tasks, and `e2e/matrix.spec.ts` proves that editing
  `.specs/architecture/PROVIDERS.md` changes routing without code edits.
- `CONTRIBUTING.md` now documents how to update `CHANGELOG.md`, and the PR
  template links directly to the changelog checklist target.

## [0.2.0] - 2026-05-18

### Added

- `lib/providers/matrix.ts` parses `.specs/architecture/PROVIDERS.md` as the single
  source of routing truth (ADR-001). Embedded defaults are used when the file is
  missing or malformed, with a stderr warning.
- `lib/providers/policy.ts` — shared retry/backoff/timeout helper (`withRetry`),
  per-provider pricing table and `estimateCost`/`estimateTokens` helpers.
- `lib/router.ts` exposes `runWithFallback` — wraps any provider call with the
  primary/fallback chain documented in `PROVIDERS.md` and writes one structured
  line per attempt to `data/llm-usage.jsonl` (`ok`, `fallback_used`, `attempt`,
  `latency_ms`).
- `lib/data/runs.ts` and `lib/data/manifest.ts` write the artefacts the AGENTS
  Definition of Done requires: `data/runs.jsonl` per piece run and
  `outputs/<client>/<date>/<piece-id>/manifest.json` per piece.
- `lib/pieces/{id,frontmatter,store}.ts` — piece engine. ISO-8601 week-numbered
  IDs (`PIECE-YYYYWww-NNN`), zero-dependency YAML frontmatter parser, state
  machine (`draft → scheduled → published → measured`, side state `review`).
- `lib/cli/generate.ts` — real generation loop that reads `pieces/`, routes
  every task through the matrix + fallback chain, runs inline compliance,
  writes outputs/script/captions/compliance.json/manifest.json, transitions
  status, and appends to `data/runs.jsonl`.
- `lib/cli/promote.ts` — real promotion loop that classifies `data/analytics.jsonl`
  (top/bottom 20% by save rate, ≥100 impressions), writes `ads-draft.json`
  for winners, appends `data/learnings.md` for losers.
- `lib/calendar/notion.ts` — Notion calendar reader (`pullCalendar`, `syncToLocal`,
  `pushStatus`). DRY_RUN-safe.
- `lib/publish/adaptlypost.ts` — real AdaptlyPost wiring with retry/backoff;
  DRY_RUN still writes `adaptlypost-draft.json` locally.
- `lib/publish/meta-ads.ts` — Meta Ads draft builder + `data/promotions.jsonl`
  writer. Real Meta API call is a stub (calls into the meta-ads MCP layer when
  available).
- `lib/analytics/{meta,tiktok,youtube}.ts` — DRY_RUN keeps deterministic synthetic
  data; non-DRY paths call Graph / TikTok Business / YouTube Data APIs.
- `lib/compliance/{generic,loader}.ts` — executable cross-vertical audit, writes
  `data/compliance/<piece>.json`, escalates blocks to `data/compliance-blocked/`,
  exposes `detectStreaks` for the alerts module.
- `lib/skills/{humanizer,brand-voice}.ts` — executable critic skills (regex pass
  + LLM secondary stub, voice-axis distance scoring).
- `lib/qa/tech-specs.ts` — ffprobe/identify wrapper with filename fallback;
  per-platform validation against `CHANNELS.md` specs.
- `lib/observability/{cost,ab-report,failures}.ts` — cost summary + HTML report,
  A/B per (task, provider) ROI table, failure-rate detector + webhook poster.
- `lib/schedule/cron.ts` — cron / launchd install / uninstall / status helpers
  with marker block isolation.
- CLI gains: `new-piece`, `status`, `logs`, `cost`, `ab-report`, `alerts`,
  `sync`, `schedule`. Each delegates to a TypeScript module via the bundled
  `tsx` runtime.
- E2E coverage (Playwright) across all of the above: matrix parsing,
  fallback chain, policy retry/timeout/cost, pieces engine, init/scan/generate
  loop, promote loop, compliance, qa-tech-specs, observability, CLI surface.

### Changed

- `lib/router.ts` no longer hardcodes routing tables; everything resolves via
  `lib/providers/matrix.ts`.
- `lib/providers/{llm,image,video}.ts` now contain real adapter classes that
  call concrete APIs. Mock variants live under `lib/providers/__mocks__/` and
  the factory switches based on `DRY_RUN`.
- `bin/marketing-engine.mjs` `generate` / `promote` are no longer placeholders.

### Notes

- All new external behavior is gated by `DRY_RUN=true` (the default) — CI never
  reaches real API endpoints.
- The mock providers preserve the original deterministic output, so previously
  authored e2e specs continue to pass.

## [0.1.0] - 2026-05-08

### Added

- CLI scaffold (`bin/marketing-engine.mjs`): `init`, `scan`, `check` commands.
- Provider type interfaces (`lib/providers/{types,llm,image,video}.ts`) and
  mock implementations.
- Publish + analytics scaffolds (`lib/publish/adaptlypost.ts`,
  `lib/analytics/{meta,tiktok,youtube}.ts`).
- Specs tree under `.specs/`: architecture (DESIGN, PROVIDERS, ROUTING-MATRIX,
  ADR-001), product (BRAND, CHANNELS, COMPLIANCE, PERSONAS, PILLARS), piece +
  campaign templates, client `_template/` overrides.
- 11 SKILL.md documents under `.skills/` (provider-neutral skills).
- E2E suite (Playwright): CLI, compliance, caption-format, tech-specs,
  provider-router, AdaptlyPost-publish.
- CI workflow + DoD workflow.
- Remotion video explainer (PT-BR + EN) under `video/`.
- Bilingual README + SETUP + CONTRIBUTING + AGENTS.md (charter) + Apache-2.0
  LICENSE.
