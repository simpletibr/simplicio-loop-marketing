# Marketing Engine

> 🇧🇷 Versão em português. Read this in English: [README.md](README.md).

Engine de marketing AI provider-agnostic. Cai em qualquer projeto, escaneia, gera posts, publica em 9 plataformas — tudo configurável via `.env`.

[![CI](https://github.com/wesleysimplicio/marketing-engine/actions/workflows/ci.yml/badge.svg)](https://github.com/wesleysimplicio/marketing-engine/actions/workflows/ci.yml)

## Veja o explainer das skills (90s)

Um walkthrough renderizado em Remotion do pipeline e de cada skill em `.skills/`. Renderizado em português; uma [versão em inglês](./README.md#watch-the-skills-explainer-90s) também está disponível.

<!--
  O GitHub renderiza automaticamente uma URL https://github.com/<owner>/<repo>/raw/<branch>/...
  numa linha sozinha como um <video controls> inline. A URL precisa apontar
  pra uma branch real — HEAD ou path relativo desliga o embed. Forks devem
  reescrever essa URL para o próprio owner/repo (ou removê-la e usar só o
  fallback do <details> abaixo).
-->
https://github.com/wesleysimplicio/marketing-engine/raw/main/video/out/marketing-engine-skills.mp4

<details>
  <summary>Player não carregou? Clique para a thumbnail / download direto</summary>

  <p align="center">
    <a href="./video/out/marketing-engine-skills.mp4">
      <img src="./video/out/cover.png" alt="Marketing Engine — capa do explainer das skills" width="720" />
    </a>
  </p>

  <p align="center">
    <a href="./video/out/marketing-engine-skills.mp4"><b>▶︎ Abrir marketing-engine-skills.mp4</b></a>
    &nbsp;·&nbsp;
    <a href="./video/README.md">como foi feito</a>
  </p>
</details>

### Tour visual cena a cena

| Etapa | Cena |
|---|---|
| `pipeline` | <img src="./video/out/02-pipeline.png" alt="brief → script → creative → caption → compliance → publish → metrics → ads" width="520" /> |
| `provider-agnostic` | <img src="./video/out/03-provider-agnostic.png" alt="llm-router orbitado por claude, codex, deepseek, higgsfield, topview, wavespeed" width="520" /> |
| `llm-router` | <img src="./video/out/04-llm-router.png" alt="task_type resolvida num provider concreto" width="520" /> |
| `copywriter-curto` | <img src="./video/out/05-copywriter-curto.png" alt="hook, caption, headline com contador de caracteres" width="520" /> |
| `revisao-humanizada` | <img src="./video/out/06-revisao-humanizada.png" alt="diff antes/depois removendo fingerprints de IA" width="520" /> |
| `caption-multi-platform` | <img src="./video/out/07-caption-multi-platform.png" alt="uma base copy adaptada para Instagram, TikTok, LinkedIn e X" width="520" /> |
| `higgsfield-prompt-builder` | <img src="./video/out/08-higgsfield.png" alt="viewport cinematográfico com lente, motion e mood" width="520" /> |
| `topview-prompt-builder` | <img src="./video/out/09-topview.png" alt="avatar UGC com script falado tokenizado" width="520" /> |
| `wavespeed-batch` | <img src="./video/out/10-wavespeed.png" alt="grid 3x2 de variantes A/B com winner glow" width="520" /> |
| `gpt-image-prompt-builder` | <img src="./video/out/11-gpt-image.png" alt="slides de quote-card / carrossel" width="520" /> |
| `video-prompt-builder` | <img src="./video/out/12-video-prompt-builder.png" alt="brief roteado para higgsfield, topview ou wavespeed" width="520" /> |
| `compliance-generic` | <img src="./video/out/13-compliance.png" alt="escudo bloqueando claims médicos e garantias financeiras" width="520" /> |
| `qa-tech-specs` | <img src="./video/out/14-qa-tech-specs.png" alt="aspect, duração, codec e safe-area" width="520" /> |
| `definition-of-done` | <img src="./video/out/15-dod-outro.png" alt="os 6 gates que um piece precisa passar" width="520" /> |

### Tour visual cena a cena

| Etapa | Cena |
|---|---|
| `pipeline` | <img src="./video/out/02-pipeline.png" alt="brief → script → creative → caption → compliance → publish → metrics → ads" width="520" /> |
| `provider-agnostic` | <img src="./video/out/03-provider-agnostic.png" alt="llm-router orbitado por claude, codex, deepseek, higgsfield, topview, wavespeed" width="520" /> |
| `llm-router` | <img src="./video/out/04-llm-router.png" alt="task_type resolvida num provider concreto" width="520" /> |
| `copywriter-curto` | <img src="./video/out/05-copywriter-curto.png" alt="hook, caption, headline com contador de caracteres" width="520" /> |
| `revisao-humanizada` | <img src="./video/out/06-revisao-humanizada.png" alt="diff antes/depois removendo fingerprints de IA" width="520" /> |
| `caption-multi-platform` | <img src="./video/out/07-caption-multi-platform.png" alt="uma base copy adaptada para Instagram, TikTok, LinkedIn e X" width="520" /> |
| `higgsfield-prompt-builder` | <img src="./video/out/08-higgsfield.png" alt="viewport cinematográfico com lente, motion e mood" width="520" /> |
| `topview-prompt-builder` | <img src="./video/out/09-topview.png" alt="avatar UGC com script falado tokenizado" width="520" /> |
| `wavespeed-batch` | <img src="./video/out/10-wavespeed.png" alt="grid 3x2 de variantes A/B com winner glow" width="520" /> |
| `gpt-image-prompt-builder` | <img src="./video/out/11-gpt-image.png" alt="slides de quote-card / carrossel" width="520" /> |
| `video-prompt-builder` | <img src="./video/out/12-video-prompt-builder.png" alt="brief roteado para higgsfield, topview ou wavespeed" width="520" /> |
| `compliance-generic` | <img src="./video/out/13-compliance.png" alt="escudo bloqueando claims médicos e garantias financeiras" width="520" /> |
| `qa-tech-specs` | <img src="./video/out/14-qa-tech-specs.png" alt="aspect, duração, codec e safe-area" width="520" /> |
| `definition-of-done` | <img src="./video/out/15-dod-outro.png" alt="os 6 gates que um piece precisa passar" width="520" /> |

## O que faz

- Escaneia o projeto host (`package.json`, README, árvore de fontes, assets de marca existentes) e rascunha brand, persona e content-pillar specs pra você revisar.
- Gera copy via camada LLM roteada (Claude, Codex, DeepSeek, Copilot, Ollama) escolhida por task type.
- Gera imagens e vídeos via providers roteados (gpt-image, Higgsfield, TopView, Wavespeed) selecionados por formato.
- Roda audit de compliance antes de qualquer publish e bloqueia peças que falham no gate.
- Publica caption set de 4 plataformas via AdaptlyPost (Instagram, TikTok, Facebook, LinkedIn, X, Threads, Pinterest, Shorts, YouTube — 9 ao total).
- Puxa analytics em schedule, classifica top performers, rascunha campanhas Meta Ads dos vencedores.


## Roadmap: integração com simplicio-videos + Real Oficial

O plano para virar produto de "social no piloto automático" está em [docs/ROADMAP-REALOFICIAL-VIDEOS.md](./docs/ROADMAP-REALOFICIAL-VIDEOS.md) (épico [#159](https://github.com/simpletibr/simplicio-loop-marketing/issues/159)). Resumo:
- o [simplicio-videos](https://github.com/simpletibr/simplicio-videos) é a fábrica de vídeo, com voz Gemini TTS;
- a [Real Oficial](https://realoficial.com.br) publica e agenda, até 30 dias, no TikTok, Reels e Shorts, e faz a dublagem e as legendas das versões internacionais;
- os cortes de vídeo longo vêm do MCP oficial da Real Oficial.

## Quick start

```
cd /caminho/do/seu-projeto
npx marketing-engine init
cp .marketing-engine/.env.example .marketing-engine/.env
# preencha ANTHROPIC_API_KEY no mínimo
npx marketing-engine check
npx marketing-engine generate    # DRY_RUN por default
```

## Por que provider-agnostic

Nenhum provider é hardcoded. `PROVIDERS.md` + `.env` decidem qual LLM, image ou video service trata cada task. Trocar provider é uma mudança de env, não refactor. Skills declaram `task_type` abstrato (`copy-short`, `image-carousel`, `video-reel`); o router resolve o vendor concreto em runtime e aplica fallback automático.

## Stack suportada

| Camada | Providers (default primeiro) |
|---|---|
| LLM | claude, codex, deepseek, copilot, ollama |
| Image | gpt-image, higgsfield, topview, wavespeed |
| Video | higgsfield, topview, wavespeed |
| Publishing | adaptlypost (9 plataformas) |
| Ads | meta-ads |

Regras de roteamento e racional em [.specs/architecture/PROVIDERS.md](./.specs/architecture/PROVIDERS.md).

## Comandos CLI

| Comando | O que faz |
|---|---|
| `init` | Faz scaffold do `.marketing-engine/` no projeto host |
| `scan` | Re-escaneia o projeto host pra atualizar specs draft |
| `check` | Valida chaves de env dos providers |
| `generate` | Roda loop de geração (DRY_RUN-safe) |
| `promote` | Roda loop de promoção |
| `anchor` | Cria/confere/gateia anchors de campanha e roda selftest do anchor |

## Arquitetura

Pipeline: `brief → script → creative → caption → compliance → publish → metrics → ads`. O router faz broker de toda chamada externa pra que troca de vendor seja só config.

```mermaid
flowchart LR
    brief[Brief / piece.md] --> router[lib/router.ts]
    router --> llm[LLM]
    router --> media[Image / Video]
    llm --> compliance[Compliance Gate]
    media --> compliance
    compliance -->|pass| publish[AdaptlyPost / 9 plataformas]
    publish --> metrics[Analytics]
    metrics --> ads[Meta Ads draft]
```

Design completo: [.specs/architecture/DESIGN.md](./.specs/architecture/DESIGN.md).

## Layout do repo

```
.specs/        # product, architecture, workflow, sprints — docs canônicas
.skills/       # skills reutilizáveis (provider-neutral)
.ralph/        # scripts operacionais (loops, sync, checks)
lib/           # router + adapters de provider + publish + ads
bin/           # entry da CLI (marketing-engine.mjs)
e2e/           # specs Playwright
```

Detalhes de setup: [SETUP.md](./SETUP.md). Contrato com agente e Definition of Done: [AGENTS.md](./AGENTS.md).

## Desenvolver

```
npm install
npm run typecheck
npm run test:e2e
node bin/marketing-engine.mjs help
```

## Pacote narrativo Asolaria (issue #78)

Ver seção "Asolaria narrative package" em [README.md](./README.md#asolaria-narrative-package): mapa de mapas, catálogo de reduções, e duas páginas estáticas prontas para deploy em `site/`.

## Contribuindo

Veja [CONTRIBUTING.md](./CONTRIBUTING.md). Issues e PRs bem-vindos. Conventional commits obrigatórios. CI tem que passar checks de DoD antes do merge.

## Licença

Apache-2.0. Veja [LICENSE](./LICENSE).
