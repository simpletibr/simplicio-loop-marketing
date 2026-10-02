---
name: simplicio-tasks
description: Legacy compatibility alias for `/simplicio-loop`. Use only when an older install, adapter, or saved prompt still invokes `/simplicio-tasks`; immediately route the run through `.claude/skills/simplicio-loop/SKILL.md`, which now owns the public core + loop protocol.
---

<!-- simplicio-contract:begin -->
contract: simplicio-tasks
schema: simplicio.skill/v1
purpose: Legacy compatibility alias for `/simplicio-loop`.
rules: Follow this skill end-to-end; mutable data (versions, dates, counts) lives in the footer, never in this header.
<!-- simplicio-contract:end -->

# /simplicio-tasks — legacy alias for /simplicio-loop

`/simplicio-loop` is now the single public command for Simplicio's autonomous body-of-work
orchestration. This file remains only so older installs, adapter docs, or saved prompts that still
mention `/simplicio-tasks` keep working without breaking.

## What to do

1. Treat `/simplicio-tasks <goal>` exactly as `/simplicio-loop <goal>`.
2. Load and follow `.claude/skills/simplicio-loop/SKILL.md` as the authoritative protocol.
3. Keep these shared references for deep detail when needed:

| Need depth on… | Read |
|---|---|
| the 50 extension points + fallbacks | `references/extension-points.md` |
| token economy (catalog, caps, clamp, tee+CCR, terminal table) | `references/token-economy.md` |
| discover / intake / route / autoscale / speed / model-routing | `references/orchestration.md` |
| quality loop · safety gates · delivery · feedback | `references/quality-safety-delivery.md` |
| 24/7 standing loop · arming the watcher | `references/standing-loop-247.md` |
| front-end proof via Playwright | `references/web-evidence.md` |
| demo-video proof (Playwright default · hyperframes on request) | `references/video-evidence.md` |

## Compatibility note

- Public docs, installers, and runtime entry files should point to `/simplicio-loop`.
- Older prompts such as `/simplicio-tasks finish all the open issues` are still accepted as an
  alias and should be executed with the unified `/simplicio-loop` contract.

<!-- simplicio-global-llm-architecture-rules:start -->
## Regras arquiteturais globais (obrigatórias)

- Delete diretamente o que está obsoleto; não preserve compatibilidade retroativa,
  não crie migrações e não deixe fallbacks.
- Escolha a implementação mais simples para a necessidade atual; sem abstrações
  preventivas ou configuração desnecessária.
- Entregue primeiro o mínimo end-to-end e evolua por camadas longas, sem desmontar
  o que funciona por complexidade inacabada.
- Mantenha modularidade e separação clara de responsabilidades.
- Prefira bibliotecas maduras e mantidas; reescreva do zero apenas com motivo
  técnico explícito.
- Inspecione as dependências existentes antes de adicionar pacotes ou reimplementar.
- Tome decisões arquiteturais para o longo prazo; não deixe soluções temporárias.
- Reutilize padrões validados por produtos maduros; não reinvente a roda.

<!-- simplicio-global-llm-architecture-rules:end -->

## What the model sees

When a host loads this skill, the model receives the YAML frontmatter, the
immutable `simplicio-contract` header, and this body, verbatim. Files under
`references/` enter the context only when this body points to them. Nothing
here is generated per run.

### Token effect

The body is paid once per session as input tokens. References are paid only on
demand, so the always-loaded part stays the short hot path.

### KV cache effect

The frontmatter and header are byte-stable across releases (pinned in
`contracts/headers.lock.json`), and mutable data lives only at the end of the
file. The provider can therefore reuse the cached prefix from the second call
on, and a release does not invalidate it unless a `header-change:` note says so.
