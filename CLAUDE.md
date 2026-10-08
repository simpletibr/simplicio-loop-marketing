# Marketing Engine — Agent Charter

## Tool model

Marketing Engine is a CLI tool installed into a host project (`npx marketing-engine init`). It writes to `.marketing-engine/` inside the host repo (clients, env, outputs, data, specs) and never assumes a specific business domain. All client-specific knowledge lives under `.marketing-engine/clients/<slug>/`. The engine itself is generic and public.

## Mission

Marketing Engine is a provider-agnostic AI marketing motor that orchestrates the full content pipeline:

```
brief → script → creative → caption → compliance → publish → metrics → ads
```

The motor is generic; clients live under `.marketing-engine/clients/<slug>/` (or `.specs/clients/<slug>/` in the engine repo itself). A piece (a scheduled content item) is the smallest unit of work; each piece moves through the loop above and produces auditable artefacts under `outputs/<client>/<date>/<piece-id>/`.

The engine treats LLMs, image generators, video generators, publishing platforms, and ad platforms as **interchangeable providers** selected at runtime. Adding a new provider is a contract change, not a rewrite.

## Core Principle: Provider-Agnostic

**No skill or agent ever hardcodes a provider name.**

- Provider selection lives in `.specs/architecture/PROVIDERS.md` (routing matrix) and `.env` (active credentials and feature flags).
- Skills accept `task_type` and let `lib/router.ts` resolve the actual provider.
- Switching providers (e.g. `LLM_DEFAULT=claude` to `LLM_DEFAULT=deepseek`) must require zero code changes inside skills.
- A piece may override the default with `provider_override: { llm_text, image, video }` in its frontmatter; overrides win.
- Primary failure triggers automatic fallback (per `PROVIDERS.md`); both events logged to `data/llm-usage.jsonl`.

If you find yourself typing a provider name inside a skill body or agent prompt, stop and route through the matrix instead.

## Stack (configurable)

| Layer       | Providers (default first)                                   | Selection mechanism             |
| ----------- | ----------------------------------------------------------- | ------------------------------- |
| LLM         | claude, codex, deepseek (cheap), copilot, ollama (fallback) | `lib/router.ts` + PROVIDERS.md  |
| Image       | gpt-image, higgsfield, topview, wavespeed                   | `lib/providers/image.ts`        |
| Video       | higgsfield (Soul/DoP/Seedance), topview, wavespeed, simplicio-video (contract → voice → HyperFrames render → QA) | `lib/providers/video.ts`        |
| Publishing  | adaptlypost (MCP, 9 platforms)                              | `lib/publish/adaptlypost.ts`    |
| Ads         | meta-ads (MCP active)                                       | `lib/publish/meta-ads.ts`       |
| Calendar    | Notion (database `NOTION_CALENDAR_DB_ID`)                   | env-driven                      |

All credentials and feature flags live in `.env` (template: `.env.example`). Production runs default to `DRY_RUN=true` until a piece is explicitly promoted.

**Runtime dependency.** This project is runtime-first: it depends on `simplicio-runtime` as its orchestration kernel and does not require `simplicio-sprint` or `simplicio-prompt`. See `.specs/architecture/ADR-002-runtime-first.md`.

## Mandatory Loop per Piece

Every piece execution MUST follow this sequence:

1. **Read piece.md** — load frontmatter (client, channel, format, brief, provider overrides, compliance flags).
2. **llm-router** — resolve LLM for the piece task type (script, caption, compliance) via PROVIDERS.md + .env + overrides.
3. **Generate copy** — call resolved LLM through `lib/providers/llm.ts`; emit script.md and caption variants.
4. **Generate creative** — pick image/video provider via routing matrix; produce assets in `outputs/<client>/<date>/<piece-id>/`.
5. **Critic skills** — run brand-voice, humanizer, and platform critic skills; iterate until acceptance bar.
6. **Compliance** — run the active client's compliance skill (`compliance-<active client>`) or `compliance-generic`; output JSON `{pass, violations, suggestions}`. Block if `pass=false`.
7. **Publish** — call `adaptlypost` with the 4-platform caption set. Default `DRY_RUN=true`; flip via env only after human review.
8. **Metrics** — schedule a metrics pull via the metrics skill (later loop).
9. **Ads** — for promoted pieces, hand off to `meta-ads` agent with brief + creative IDs.

A piece is **only complete** when all gates above pass and Playwright evidence is recorded.

## Definition of Done (per piece)

- [ ] Compliance JSON returns `pass: true` (or human override logged).
- [ ] Tech specs pass (`qa-tech-specs` skill: aspect ratio, duration, file size, safe areas).
- [ ] 4-platform caption set generated (Instagram, TikTok, LinkedIn, X) with platform-specific length and CTA.
- [ ] Playwright evidence: at least one E2E spec exercises the piece pipeline end-to-end against mocks (`e2e/`).
- [ ] Run logged to `data/llm-usage.jsonl` and `data/runs.jsonl` (timestamp, providers used, cost estimate).
- [ ] Outputs stored under `outputs/<client>/<date>/<piece-id>/` with `manifest.json`.

## Definition of Done (per code change / issue / task)

No issue or task on this repo closes without all seven of the following, with
evidence (command + result), regardless of how small the change looks:

1. **Implementation** — the actual code change.
2. **Unit** — `npm run test:unit` (`tests/unit/**`).
3. **Integration** — `npm run test:integration` (`tests/integration/**`).
4. **System** — `npm run test:e2e` (Playwright specs under `e2e/`).
5. **Regression** — `npm run test:regression` (`tests/regression/**`).
6. **Benchmark** — `npm run bench` produces a measured number (ops/sec or ms/op) for the touched hot path.
7. **Coverage ≥ 85%** — measured honestly across *all* of `lib/**/*.ts` (not just
   the files a narrow suite happens to import). `npm run coverage` alone
   under-reports this because c8's default (non-`--all`) mode only
   instruments files the Node test runner actually imports; Playwright specs
   run in a separate process and are invisible to that report. To get the
   real number, merge `NODE_V8_COVERAGE` output from both `npm run test:node`
   and `npx playwright test` into one temp dir, then run
   `npx c8 report --temp-directory=<merged-dir> --all --include "lib/**/*.ts"`.

`npm test` (`test:node` + `test:e2e`) must be 100% green before any of the
above counts as done. This rule complements, but does not replace, the
per-piece Definition of Done above (which governs the *content* pipeline);
this one governs the *code* that implements it.

## How to Add a New Provider

Three steps. No skill rewrite.

1. **Add provider module** — create `lib/providers/<layer>/<name>.ts` implementing the layer interface (`LlmProvider`, `ImageProvider`, or `VideoProvider`). Include at least one mock for tests.
2. **Update PROVIDERS.md** — add the provider as a row in the relevant routing matrix (LLM/Image/Video) with the task types it serves and the rationale.
3. **Update `.env.example`** — add the provider's API key var (e.g. `NEW_PROVIDER_API_KEY=`) with a comment describing how to obtain it.

The router picks it up automatically. Existing skills do not change.

## Skills Available

- `revisao-humanizada` — strips AI-writing tells from generated copy.
- `higgsfield-prompt-builder` — converts brief into Higgsfield-ready prompts (Soul, DoP, Seedance).
- `video-prompt-builder` — generic motion/shot/composition prompt skeleton, provider-neutral.
- `copywriter-curto` — short-form copy (hooks, captions, CTAs).
- `caption-multi-platform` — fans one caption into IG/TikTok/LinkedIn/X variants with length and tone deltas.
- `compliance-<active client>` — per-client compliance skill (substitute the active client slug); audits pieces against forbidden claims and brand rules.
- `compliance-generic` — generic compliance audit (default fallback when no client-specific skill exists).
- `qa-tech-specs` — validates aspect ratio, duration, file size, safe areas per platform.
- `gpt-image-prompt-builder` — typography-precise prompts for GPT-Image (quote cards, carousels).
- `topview-prompt-builder` — UGC/avatar prompts for TopView.
- `wavespeed-batch` — batch A/B prompt expansion for Wavespeed.
- `hyperframes` — HTML-as-source-of-truth motion composition authoring (kinetic type, motion quote cards, programmatic data-viz reels). See https://github.com/wesleysimplicio/hyperframes.
- `hyperframes-cli` — runs `npx hyperframes` lint/inspect/preview/render against a composition project.
- `hyperframes-prompt-builder` — translates a piece brief into the HyperFrames composition spec; selected by `video-prompt-builder` when the matrix resolves to `simplicio-video`.
- `llm-router` — selects and calls an LLM provider based on `task_type`, PROVIDERS.md, and overrides.
- `simplicio-loop-marketing` — root super-skill orchestrator for the autonomous SaaS marketing loop (discover → orient → decide → create → verify → publish → measure → promote → learn); sequences the lanes below by capability, never by vendor.
- `content-engineering-authentic` — renders the five evidence-aware content templates (dev article, social derivative, video script, Reddit/forum answer, launch thread); marks missing evidence explicitly instead of inventing it.
- `watcher-gate` — N-Nest style independent verification pass; tags every output `MEASURED` / `CANON` / `UNVERIFIED`.
- `rtk-cli` — token-efficient shell inspection and validation helper.

## Skills Available (planned, code lives in `lib/` without a matching `.skills/*/SKILL.md` yet)

- Channel registry (`lib/channels/registry.ts`), integration broker (`lib/integrations/broker.ts`), community compliance gate (`lib/compliance/community.ts`), accrual-based analytics scoring (`lib/analytics/score.ts`), paid-growth budget guardrails (`lib/promotion/budget-guardrail.ts`), campaign loop CLI (`lib/cli/campaign.ts`), Yool tuple-space board (`lib/yool/board.ts`, see `.specs/architecture/YOOL-BOARD.md`), community reply loop (`lib/community/reply-loop.ts`), and the governed browser/computer-use lane (`lib/automation/browser-lane.ts`).

## Forbidden

- Hardcoding a provider name inside a skill or agent body.
- Using mocks in production paths (mocks belong under `lib/providers/__mocks__/` and tests).
- Pushing direct to `main` (PR + DoD gate required).
- Committing `.env`, real API keys, or any client PII into the repo.
- Running real provider calls during bootstrap or CI without explicit `DRY_RUN=false` and a credentialed environment.
- Touching the read-only reference tree at `~/Projetos/novos/agentic-starter` (inspiration only).

<!-- rtk-cli:start -->
## Shell token-smart (RTK CLI, optional)

If `rtk` (https://github.com/rtk-ai/rtk) is on PATH, prefer it for shell-heavy and exploratory work — compact output, ~40-70% fewer tokens, same signal.

```bash
rtk read AGENTS.md
rtk grep "pattern" src/
rtk find "*.js" .
rtk git status
rtk git diff
rtk git log -n 10
rtk npm test
```

Rules:

- Use `rtk read|grep|find|git ...` as first choice for textual inspection.
- Use `rtk <command>` on verbose validators where a summary is enough.
- **Do not** route through RTK: interactive prompts, streaming, evidence-bearing output.
- If `rtk` is not installed, fall back to plain commands — no hard dependency.

See `.skills/rtk-cli/SKILL.md` for the full skill manifest.
<!-- rtk-cli:end -->

<!-- yool-tuple-hamt:start -->
## yool / tuple / HAMT (capability addressing)

Spec: https://github.com/wesleysimplicio/yool-tuple-hamt (v0.2).

Every agent registered in this repo SHOULD declare its capability with the following fields:

```markdown
### My Agent

- yool_id: `agent.dev.python`
- authority: dev | ops | review | audit
- lane: fast | slow | background
- agent_terms:
    cpu_quota_pct: 60       # MANDATORY guardrail (spec §11.1)
    disk_quota_mb: 100      # MANDATORY guardrail (spec §11.2)
    timeout_s: 300
```

Guardrails are MANDATORY per Victor Genaro's review: *"precisa de guardrail pra não fritar o processador. Você precisa de garbage collector também pra não encher 100% do disco."* See spec §11.
<!-- yool-tuple-hamt:end -->

<!-- codex-long-running-agent-overlay:start -->
## Universal Long-Running Agent Overlay

This section complements the repository-specific guidance already in this file. If anything here conflicts with the repo-specific rules above, the repo-specific rules win.

- `PRD.md` is the task source of truth for long-running sessions.
- `PROGRESS.md` is the persistent checkpoint log.
- `GOAL_RESULT.md` is the final execution report.
- Before coding, read this file, `PRD.md`, `PROGRESS.md` when it exists, `README.md`, project manifests, tests, and the relevant source folders.
- Work in small checkpoints, run the smallest relevant validation after each meaningful change, update `PROGRESS.md`, and continue until complete or genuinely blocked.
- Stop only when the requested work is complete, validation is documented, and `GOAL_RESULT.md` reflects the outcome.
- Do not rewrite unrelated architecture, fake successful validation, expose secrets, or push without explicit operator instruction for the active session.
<!-- codex-long-running-agent-overlay:end -->

<!-- simplicio-global-llm-architecture-rules:start -->
## Regras arquiteturais obrigatórias para qualquer LLM

Estas regras valem para análise, planejamento, implementação, revisão, testes,
release e documentação neste ecossistema. O agente deve lê-las antes de agir:

1. **Não mantenha compatibilidade retroativa.** O que está obsoleto deve ser
   deletado diretamente. Não adicione camadas de compatibilidade, migrações ou
   fallbacks.
2. **Escolha a implementação mais simples que atende à necessidade atual.**
   Não crie abstrações preventivas nem camadas de configuração desnecessárias.
3. **Divida o sistema em camadas longas.** Faça primeiro uma versão mínima
   end-to-end funcionando; depois adicione capacidades por cima. Não desmonte
   algo que funciona por complexidades inacabadas.
4. **Mantenha os componentes modulares**, com responsabilidades claramente
   separadas e limites explícitos.
5. **Priorize bibliotecas maduras e mantidas.** Não reescreva do zero sem
   motivo técnico explícito e registrado.
6. **Inspecione primeiro as dependências existentes.** Antes de adicionar um
   pacote ou escrever uma solução própria, verifique o que o projeto já possui.
7. **Decida a arquitetura pensando no longo prazo.** Não aceite soluções
   temporárias com a intenção de mudar depois.
8. **Use padrões de produtos maduros.** Pesquise como soluções consolidadas
   resolvem o mesmo problema e reutilize padrões validados; não reinvente a roda.

<!-- simplicio-global-llm-architecture-rules:end -->

