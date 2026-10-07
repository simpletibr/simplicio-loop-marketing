# simplicio-loop-marketing

Root super-skill orchestrator for the autonomous SaaS marketing loop.
Implements issue #48 (parent epic: #46). This skill does not duplicate any
existing capability — it sequences the lanes that already exist in this
repo and routes work through capability requests, never vendor-specific
code.

## Inputs

A campaign brief (`.specs/strategy/CAMPAIGN-template.md` shape, see
`lib/campaigns/campaign.ts`) supplies:

- `product`, `client_id` — which client under `.specs/clients/<slug>/`.
- `channels` — primary/secondary/test, resolved against
  `lib/channels/registry.ts`.
- `budget` — phases (organic-only first, then paid-ramp), consumed by
  `lib/promotion/budget-guardrail.ts`.
- `pieces_per_week` / `distribution` — pillar → piece count.
- `KPI` — primary/secondary metrics, see `lib/analytics/score.ts`
  `BUSINESS_METRICS` / `QUALITY_ENGAGEMENT_METRICS`.
- `language` — English-first; see `lib/channels/registry.ts`
  `englishFirstOrder()`.
- `DRY_RUN` — defaults true everywhere in this loop; live actions require
  explicit human promotion.

## Loop

```text
discover -> orient -> decide -> create -> verify -> publish -> measure -> promote -> learn -> repeat
```

| Stage | Capability | Owning module |
|---|---|---|
| discover | product/ICP scan | `.specs/product/*`, campaign brief |
| orient | channel plan | `lib/campaigns/campaign.ts` `planPieceQueue` |
| decide | piece queue → yool board | `lib/yool/board.ts` (`piece.plan` tuples) |
| create (copy) | script/caption generation | `lib/cli/generate.ts`, `lib/content/templates.ts`, `.skills/content-engineering-authentic/` |
| create (creative) | image/video generation | `lib/providers/image.ts`, `lib/providers/video.ts` (vídeo de cliente → provider `simplicio-video`, #160), routed via `.specs/architecture/PROVIDERS.md` |
| verify (brand/humanize) | brand-voice + humanizer critics | `lib/skills/brand-voice.ts`, `lib/skills/humanizer.ts` |
| verify (claims) | watcher gate | `lib/gate/watcher-gate.ts`, `lib/gate/claims-gate.ts` |
| verify (compliance) | generic + community compliance | `lib/compliance/loader.ts`, `lib/compliance/community.ts` |
| publish | broker-routed publish/schedule | `lib/integrations/broker.ts` → interface `publisher` (Real Oficial, #161; `adaptlypost.ts` deprecado), `lib/automation/browser-lane.ts` |
| measure | metrics snapshot + accrual scoring | `lib/analytics/score.ts` |
| promote | winner → paused ads-draft, guardrails | `lib/cli/promote.ts`, `lib/promotion/budget-guardrail.ts` |
| community | comment monitor + reply drafts | `lib/community/reply-loop.ts` |
| learn | learnings + objection feed | `lib/promotion/learnings.ts`, `data/learnings.md` |

Every stage transition is a tuple write on the Yool board
(`.specs/architecture/YOOL-BOARD.md`) so the loop's state is inspectable
without re-deriving it from scratch.

## Integração SimpleTI: fábrica de vídeo + Real Oficial (épico #159)

Plano: `docs/ROADMAP-REALOFICIAL-VIDEOS.md`.

- **Fábrica de vídeo:** repositório externo citado no roadmap. O loop escreve
  `simplicio.video-contract/v1` e chama o CLI da fábrica pelo provider de vídeo roteado na matriz.
  Recebe MP4 + `render.manifest.json` (sha256) como evidência. Voz principal: **Gemini TTS**.
- **Real Oficial:**
  - `publisher` → TikTok/Reels/Shorts, agenda ≤ 30 dias (#161, #162).
  - `dubbing` → dublagem 300+ idiomas e legendas 150+, só nas versões internacionais (#165).
  - Cortes de vídeo longo pelo MCP `ro_*` oficial (#164).
- **Superfície real hoje:** MCP/REST cobrem só cortes e renders. Publicar, agendar e dublar ficam
  no app web, então a implementação provisória usa a trilha de navegador. A API foi pedida (#168).
- **Guardrails extras:**
  - créditos Real Oficial (`ro_create_clips`, dublagem, imagens) só com OK explícito do Wesley;
  - publicar exige aprovação registrada do cliente (#163);
  - a sessão da Real Oficial é aberta pelo humano, e nenhum agente lê ou grava cookies ou tokens.

## Required lanes (all present)

Market/product discovery, SaaS offer/ICP strategy, organic content
planning, copy/script generation, creative asset generation, brand
voice/humanization, compliance and anti-spam review, publish/schedule,
metrics ingestion, paid traffic draft/promotion, learning replay,
browser/computer-use evidence — see the Yool worker-lane list in
`.specs/architecture/YOOL-BOARD.md` for the 1:1 mapping.

## Definition of Done

**Per piece** (see also `CLAUDE.md` → "Definition of Done (per piece)"):

- [ ] Compliance JSON returns `pass: true` (generic) AND, for
      community/forum channels, `status: "pass"` from
      `lib/compliance/community.ts` (`"needs_review"` holds for a human,
      it is never treated as a pass).
- [ ] Watcher gate tag is `MEASURED` or `CANON`, never `UNVERIFIED`, before
      the piece leaves `draft`.
- [ ] 4-platform caption set generated where applicable.
- [ ] Evidence recorded (screenshot/metric) or the template explicitly
      marks `[EVIDENCE MISSING: ...]` — never fabricated.
- [ ] Manifest written under `outputs/<client>/<date>/<piece-id>/`.

**Per campaign loop**:

- [ ] Organic phase runs before paid ramp
      (`lib/campaigns/campaign.ts` `organicPhaseActive`) unless explicitly
      overridden.
- [ ] Every paid promotion passes `lib/promotion/budget-guardrail.ts`
      `checkGuardrails` and is recorded with its hypothesis.
- [ ] `marketing-engine campaign review <id>` summarizes winners, losers,
      spend, and lessons.

## Guardrails

- `DRY_RUN=true` by default across generate, promote, publish, and the
  browser/computer-use lane.
- Publish and paid actions require human review unless a piece/campaign
  is explicitly promoted — no skill or agent flips `DRY_RUN` itself.
- No skill or agent hardcodes a provider or channel-specific client; all
  routing goes through `lib/providers/matrix.ts` (LLM/image/video) and
  `lib/integrations/broker.ts` (publish/schedule/metrics/ads/comments/
  evidence).

## Executable loop protocol (simplicio-loop contract)

The stages above are not a narrative — they run under the simplicio-loop
iteration contract (`.claude/skills/simplicio-loop/SKILL.md`, installed as
the operator layer; see `docs/OPERATOR.md` for the state split). The six
invariants apply verbatim:

1. **Evidence-gated exit.** The loop only stops on in-turn evidence: the
   `marketing-engine loop` summary line, green spec output, or a written
   receipt/manifest path. A claim with no evidence does not exit.
2. **Exact promise.** Exit is signaled ONLY by the sentinel
   `<promise>EXACT TEXT</promise>` equal to the agreed completion promise —
   never a fuzzy "done".
3. **Deterministic continuation.** Each turn re-feeds the same goal +
   current state; state lives on disk, not in the conversation.
4. **Bounded by construction.** `--max-iter` (CLI) / `max_iterations`
   (operator) is set before iteration 1. The cap fires a handoff, never a
   fake success.
5. **Single source of truth.** Product state: `.simplicio/loop/journal.jsonl`
   (schema `marketing-loop-state/v1`, written by `lib/loop/journal.ts`) +
   the yool board. Operator state: `.simplicio-loop/orchestrator/loop/*` (journal, anchor,
   backlog — the Python workers).
6. **Two modes.** `converge` (one campaign/piece pushed to done, stall
   escalation) vs `drain` (queue breadth; empty rounds terminate).

Mechanical bindings when the operator workers are available (fail-open —
absent workers never block the TS loop, see `lib/cli/loop.ts`):

```bash
# scope freeze (acceptance criteria come from PRD.md / the campaign brief)
python3 "$SIMPLICIO_LOOP_ROOT/scripts/task_anchor.py" set --goal "<goal>" --ac "<AC1>" --ac "<AC2>"
# backlog decomposition (multi-piece campaigns; depends_on honored)
python3 "$SIMPLICIO_LOOP_ROOT/scripts/task_backlog.py" init --goal "<goal>" --items-file <plan.json>
# attempt memory read at the top of every turn (anti-oscillation)
python3 "$SIMPLICIO_LOOP_ROOT/scripts/loop_journal.py" resume
# done gate — exit 12 while any AC is unverified; "done" is never self-declared
python3 "$SIMPLICIO_LOOP_ROOT/scripts/task_anchor.py" gate
```

The product-side equivalents always run regardless of the operator:
`marketing-engine loop --mode drain --max-iter N` drives the piece queue
with the TS journal (fingerprinted failures, `PROGRESS|STALLED` verdicts,
skip-after-K-identical-failures), emits `marketing-event/v1` on every
transition, and appends `simplicio.savings-event/v1` receipts when a skip
avoids re-derivation. Claims discipline: every output line a consumer acts
on is tagged `MEASURED` / `CANON` / `UNVERIFIED` by the watcher gate — an
`UNVERIFIED` piece never leaves `draft` and is never promoted.
