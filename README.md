# Marketing Engine

> 🇺🇸 English. Leia em português: [README.pt-BR.md](README.pt-BR.md).


Provider-agnostic AI marketing engine. Drop into any project, scan it, generate posts, publish across 9 platforms — all configurable via .env.

[![CI](https://github.com/wesleysimplicio/marketing-engine/actions/workflows/ci.yml/badge.svg)](https://github.com/wesleysimplicio/marketing-engine/actions/workflows/ci.yml)

## Repository visuals

These visuals stay near the top of the README on purpose, so the repository always has a fast visual map for humans and coding agents.

![Marketing Engine hero](./assets/readme/marketing-engine-hero.svg)

![Marketing Engine routing matrix](./assets/readme/marketing-engine-router.svg)

## Flow of the whole project

Every input, step and output of the project, drawn from one declarative file ([`docs/flow/simplicio-loop-marketing.flow.json`](docs/flow/simplicio-loop-marketing.flow.json), `simplicio.flow/v1`, each node pointing at the files and commands it comes from). The [Mermaid](docs/flow/simplicio-loop-marketing.mmd), the [SVG](docs/flow/simplicio-loop-marketing.svg), the PNG below and the [Langflow notes flow](docs/flow/langflow/simplicio-loop-marketing.langflow.json) are generated from it, the same bytes on every run, and a test fails when the flow names a file or command that is gone or leaves a CLI command out.

![Flow of simplicio-loop-marketing](docs/flow/simplicio-loop-marketing.png)

Regenerate with `npm run flow`; check that nothing is stale with `npm run flow:check`.

## Distribution dashboard

A local, read-only panel of the distribution loop (`marketing-engine dashboard`): pipeline, calendar, status per network, quality gates, credits and costs, sales funnel and revenue, per-post performance, approval queue and alerts. It binds to the loopback address, answers `GET` only and never spends, charges or publishes. See [docs/DASHBOARD.md](docs/DASHBOARD.md).

![Dashboard cockpit](docs/evidence/dashboard/cockpit-light.png)

## Watch the skills explainer (90s)

A Remotion-rendered walkthrough of the pipeline and every skill in `.skills/`. Rendered in English; a [Portuguese version](./README.pt-BR.md#veja-o-explainer-das-skills-90s) is also available.

<!--
  GitHub auto-renders a bare https://github.com/<owner>/<repo>/raw/<branch>/...
  URL on its own line as an inline <video controls> player. The URL must
  point at a real branch — using HEAD or a relative path disables the embed.
  Forks should rewrite this URL to their own owner/repo (or remove it and
  rely on the <details> fallback below).
-->
https://github.com/wesleysimplicio/marketing-engine/raw/main/video/out/marketing-engine-skills-en.mp4

<details>
  <summary>Player not loading? Click for the fallback thumbnail / direct download</summary>

  <p align="center">
    <a href="./video/out/marketing-engine-skills-en.mp4">
      <img src="./video/out/cover-en.png" alt="Marketing Engine — skills explainer cover" width="720" />
    </a>
  </p>

  <p align="center">
    <a href="./video/out/marketing-engine-skills-en.mp4"><b>▶︎ Open marketing-engine-skills-en.mp4</b></a>
    &nbsp;·&nbsp;
    <a href="./video/README.md">how it was built</a>
  </p>
</details>

### Visual tour of each scene

| Stage | Scene |
|---|---|
| `pipeline` | <img src="./video/out/02-pipeline-en.png" alt="brief → script → creative → caption → compliance → publish → metrics → ads" width="520" /> |
| `provider-agnostic` | <img src="./video/out/03-provider-agnostic-en.png" alt="llm-router orbited by claude, codex, deepseek, higgsfield, topview, wavespeed" width="520" /> |
| `llm-router` | <img src="./video/out/04-llm-router-en.png" alt="task_type resolved into a concrete provider" width="520" /> |
| `copywriter-curto` | <img src="./video/out/05-copywriter-curto-en.png" alt="hook, caption, headline typewriter with character counter" width="520" /> |
| `revisao-humanizada` | <img src="./video/out/06-revisao-humanizada-en.png" alt="before/after diff stripping AI fingerprints" width="520" /> |
| `caption-multi-platform` | <img src="./video/out/07-caption-multi-platform-en.png" alt="one base copy fanned out to Instagram, TikTok, LinkedIn, X" width="520" /> |
| `higgsfield-prompt-builder` | <img src="./video/out/08-higgsfield-en.png" alt="cinematic viewport with lens, motion, mood parameters" width="520" /> |
| `topview-prompt-builder` | <img src="./video/out/09-topview-en.png" alt="UGC avatar with spoken script tokens" width="520" /> |
| `wavespeed-batch` | <img src="./video/out/10-wavespeed-en.png" alt="3x2 A/B variant grid with winner glow" width="520" /> |
| `gpt-image-prompt-builder` | <img src="./video/out/11-gpt-image-en.png" alt="quote-card carousel slides" width="520" /> |
| `video-prompt-builder` | <img src="./video/out/12-video-prompt-builder-en.png" alt="brief routed to higgsfield, topview, or wavespeed" width="520" /> |
| `compliance-generic` | <img src="./video/out/13-compliance-en.png" alt="shield blocking medical claims and financial guarantees" width="520" /> |
| `qa-tech-specs` | <img src="./video/out/14-qa-tech-specs-en.png" alt="aspect, duration, codec, safe-area checks" width="520" /> |
| `definition-of-done` | <img src="./video/out/15-dod-outro-en.png" alt="6 gates that must pass before a piece ships" width="520" /> |

### Visual tour of each scene

| Stage | Scene |
|---|---|
| `pipeline` | <img src="./video/out/02-pipeline.png" alt="brief → script → creative → caption → compliance → publish → metrics → ads" width="520" /> |
| `provider-agnostic` | <img src="./video/out/03-provider-agnostic.png" alt="llm-router orbited by claude, codex, deepseek, higgsfield, topview, wavespeed" width="520" /> |
| `llm-router` | <img src="./video/out/04-llm-router.png" alt="task_type resolved into a concrete provider" width="520" /> |
| `copywriter-curto` | <img src="./video/out/05-copywriter-curto.png" alt="hook, caption, headline typewriter with character counter" width="520" /> |
| `revisao-humanizada` | <img src="./video/out/06-revisao-humanizada.png" alt="before/after diff stripping AI fingerprints" width="520" /> |
| `caption-multi-platform` | <img src="./video/out/07-caption-multi-platform.png" alt="one base copy fanned out to Instagram, TikTok, LinkedIn, X" width="520" /> |
| `higgsfield-prompt-builder` | <img src="./video/out/08-higgsfield.png" alt="cinematic viewport with lens, motion, mood parameters" width="520" /> |
| `topview-prompt-builder` | <img src="./video/out/09-topview.png" alt="UGC avatar with spoken script tokens" width="520" /> |
| `wavespeed-batch` | <img src="./video/out/10-wavespeed.png" alt="3x2 A/B variant grid with winner glow" width="520" /> |
| `gpt-image-prompt-builder` | <img src="./video/out/11-gpt-image.png" alt="quote-card carousel slides" width="520" /> |
| `video-prompt-builder` | <img src="./video/out/12-video-prompt-builder.png" alt="brief routed to higgsfield, topview, or wavespeed" width="520" /> |
| `compliance-generic` | <img src="./video/out/13-compliance.png" alt="shield blocking medical claims and financial guarantees" width="520" /> |
| `qa-tech-specs` | <img src="./video/out/14-qa-tech-specs.png" alt="aspect, duration, codec, safe-area checks" width="520" /> |
| `definition-of-done` | <img src="./video/out/15-dod-outro.png" alt="6 gates that must pass before a piece ships" width="520" /> |

## What it does

- Scans the host project (package.json, README, source tree, existing brand assets) and drafts brand, persona, and content-pillar specs you can review and edit.
- Generates copy through a routed LLM layer (Claude, Codex, DeepSeek, Copilot, Ollama) chosen per task type.
- Generates images and videos through routed providers (gpt-image, Higgsfield, TopView, Wavespeed) selected by content format.
- Runs a compliance audit before any publish action and blocks pieces that fail the gate.
- Publishes the 4-platform caption set through AdaptlyPost (Instagram, TikTok, Facebook, LinkedIn, X, Threads, Pinterest, Shorts, YouTube — 9 platforms total).
- Pulls analytics on a schedule, classifies top performers, and drafts Meta Ads campaigns from the winners.


## Roadmap: simplicio-videos + Real Oficial integration

The plan to turn this engine into a "social media on autopilot" product lives in [docs/ROADMAP-REALOFICIAL-VIDEOS.md](./docs/ROADMAP-REALOFICIAL-VIDEOS.md) (Portuguese; epic [#159](https://github.com/simpletibr/simplicio-loop-marketing/issues/159)). Summary:
- [simplicio-videos](https://github.com/simpletibr/simplicio-videos) is the video factory, with Gemini TTS narration;
- [Real Oficial](https://realoficial.com.br) handles publishing and scheduling (up to 30 days) to TikTok, Reels and Shorts, plus dubbing and subtitles for international versions;
- long-video clips come from Real Oficial's official MCP.

## Quick start

```
cd /path/to/your-project
npx marketing-engine init
cp .marketing-engine/.env.example .marketing-engine/.env
# fill ANTHROPIC_API_KEY at minimum
npx marketing-engine check
npx marketing-engine generate    # DRY_RUN by default
```

## Why provider-agnostic

No provider is hardcoded. `PROVIDERS.md` plus `.env` decide which LLM, image, or video service handles each task. Switching providers is one env change, not a refactor. Skills declare an abstract `task_type` (`copy-short`, `image-carousel`, `video-reel`); the router resolves the concrete vendor at runtime and applies fallback automatically.

## Stack supported

| Layer | Providers (default first) |
|---|---|
| LLM | claude, codex, deepseek, copilot, ollama |
| Image | gpt-image, higgsfield, topview, wavespeed |
| Video | higgsfield, topview, wavespeed |
| Publishing | adaptlypost (9 platforms) |
| Ads | meta-ads |

Routing rules and rationale live in [.specs/architecture/PROVIDERS.md](./.specs/architecture/PROVIDERS.md).

## CLI commands

| Command | What it does |
|---|---|
| `init` | Scaffold `.marketing-engine/` in host project |
| `scan` | Re-scan host project to refresh draft specs |
| `check` | Validate provider env keys |
| `generate` | Run generation loop (DRY_RUN-safe) |
| `promote` | Run promotion loop |
| `anchor` | Create/check/gate campaign anchors and run anchor selftest |
| `operator doctor --json` | Probe the pinned Loop extension contract and fail closed on incompatibility |

## Architecture

Pipeline: `brief → script → creative → caption → compliance → publish → metrics → ads`. The router brokers every external call so vendor swaps stay configuration-only.

```mermaid
flowchart LR
    brief[Brief / piece.md] --> router[lib/router.ts]
    router --> llm[LLM]
    router --> media[Image / Video]
    llm --> compliance[Compliance Gate]
    media --> compliance
    compliance -->|pass| publish[AdaptlyPost / 9 platforms]
    publish --> metrics[Analytics]
    metrics --> ads[Meta Ads draft]
```

Full design: [.specs/architecture/DESIGN.md](./.specs/architecture/DESIGN.md).

## Project mapping

This repository now ships with an applied [llm-project-mapper](https://github.com/wesleysimplicio/llm-project-mapper) overlay so agents and contributors get an operational map by default.

- Entry docs: [AGENTS.md](./AGENTS.md), [PRD.md](./PRD.md), [PROGRESS.md](./PROGRESS.md), [GOAL_RESULT.md](./GOAL_RESULT.md)
- Mapper-owned operational docs: [docs/local-setup.md](./docs/local-setup.md), [docs/domain-map.md](./docs/domain-map.md), [docs/architecture-map.md](./docs/architecture-map.md), [docs/troubleshooting.md](./docs/troubleshooting.md), [docs/release-readiness.md](./docs/release-readiness.md)
- Agent overlays: [.agents/README.md](./.agents/README.md), [.claude/settings.json](./.claude/settings.json), [INIT.md](./INIT.md)

## Asolaria narrative package

Issue #78's repo-local narrative deliverables live here:

- [SIMPLICIO-MAP-OF-MAPS.md](./SIMPLICIO-MAP-OF-MAPS.md)
- [REDUCTIONS.md](./REDUCTIONS.md)
- [.specs/strategy/campaigns/2026-Q3-asolaria-on-metal/](./.specs/strategy/campaigns/2026-Q3-asolaria-on-metal/)
- [site/simplicio-on-metal/index.html](./site/simplicio-on-metal/index.html) — deploy-ready "Simplicio on Metal" landing page
- [site/asolaria-integration/index.html](./site/asolaria-integration/index.html) — deploy-ready "Simplicio + Asolaria" site section
- `node scripts/demo-asolaria-loop.mjs` — reproducible 5-iteration orientation-cost demo
- `node scripts/reductions-benchmark.mjs` — reproducible proof-trail benchmark for REDUCTIONS.md

These files package the Asolaria-inspired narrative in a way this repo can test and review locally, including two static pages that are self-contained and deploy-ready. Actually publishing them at a real domain (e.g. `simpleti.com.br/simplicio/on-metal`), recording hosted demo media, and collecting live campaign analytics are still external follow-up work — this repository does not own that hosting target.

## Repo layout

```
.specs/        # product, architecture, workflow, sprints — canonical docs
.skills/       # reusable skills (provider-neutral)
.ralph/        # operational scripts (loops, sync, checks)
lib/           # router + provider adapters + publish + ads
bin/           # CLI entry (marketing-engine.mjs)
e2e/           # Playwright specs
```

Setup details: [SETUP.md](./SETUP.md). Agent contract and Definition of Done: [AGENTS.md](./AGENTS.md).

## Develop

```
npm install
npm run typecheck
npm run test:e2e
node bin/marketing-engine.mjs help
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Issues and PRs welcome. Conventional commits required. CI must pass DoD checks before merge.

## License

Apache-2.0. See [LICENSE](./LICENSE).
