# Providers Configuration

This file is the single source of truth for provider routing across the Marketing Engine. It is read by `lib/router.ts` and consulted by every skill before any external call. Skills declare an abstract task type (for example `copy-short`, `image-carousel`, `video-reel`); the router resolves the row below into a concrete provider, applies any per-piece `provider_override`, and instantiates the adapter from `lib/providers/`. Switching a vendor is a one-line edit here plus the matching key in `.env`; no skill or agent code changes.

## LLM Routing

| Task | Default | Fallback | Reason |
|------|---------|----------|--------|
| Orchestration | claude | codex | best reasoning |
| Code generation | claude | codex | tools, MCP |
| Copy short (caption) | deepseek | claude | low cost |
| Copy long (script) | claude | codex | quality |
| Compliance check | claude | codex | attention to detail |
| Translation | deepseek | claude | cheap |
| Humanization | claude | codex | nuance |

## Image Routing

| Task | Provider | Reason |
|------|----------|--------|
| Quote card / typography | gpt-image | typographic precision |
| UGC ad with avatar | topview | native avatar template |
| Cinematic / editorial | higgsfield | Soul 2.0 |
| Carousel slides | gpt-image | template consistency |
| Batch A/B | wavespeed | cost/speed |
| Inpaint / local edit | gpt-image | precise control |
| Face swap / try-on | topview | dedicated feature |
| Before/after consulting | gpt-image | precise edit |

## Video Routing

| Task | Provider | Reason |
|------|----------|--------|
| Cinematic reel | higgsfield | Seedance 2.0 |
| Motion control | higgsfield | DoP |
| UGC product holder | topview | avatar holds product |
| Product demo (URL) | topview | scrape + auto script |
| Talking head | topview | AI presenter |
| Batch hook test | wavespeed | cheap/fast |
| Motion typography | simplicio-video | HyperFrames kinetic type rendered by the video factory, brand-faithful, deterministic |
| Data viz reel | simplicio-video | declared variables → re-renderable charts (NYT-style) |
| Programmatic short | simplicio-video | parametrized composition; byte-identical re-renders; render manifest carries the file sha256 |

## Override per piece

A `piece.md` may set `provider_override: { llm_text, image, video }` in its frontmatter to force a specific provider for that piece. The override always wins over the defaults above. If the overridden provider fails, the router still applies the standard fallback chain (LLM only).

## Adding a new provider

1. Implement the relevant interface in `lib/providers/llm.ts`, `lib/providers/image.ts`, or `lib/providers/video.ts` (`name()` plus the contract methods). Include a mock alongside it for tests.
2. Register the new adapter in the factory in the same file so `ProviderFactory.<kind>(taskType)` can return it.
3. Add a row to the appropriate routing table in this file and a matching variable in `.env.example` (for example `MYPROVIDER_API_KEY=`). Update `AGENTS.md` if the provider introduces a new capability category.
