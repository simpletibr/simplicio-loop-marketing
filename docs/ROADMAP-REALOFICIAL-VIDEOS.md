# Roadmap: simplicio-loop-marketing + simplicio-videos + Real Oficial

> Planejamento aprovado pelo Wesley em 02/10/2026. Épico: [#159](https://github.com/simpletibr/simplicio-loop-marketing/issues/159).
> Estado: **em implementação**. A tabela "Estado por issue" no fim da página diz o que já existe. `DRY_RUN=true` continua como padrão.

## Objetivo

Transformar este repo num produto de **"social no piloto automático"** para pequenos negócios, no estilo do [Fastlane](https://www.usefastlane.ai/):

```
URL do cliente → perfil da marca → plano de 30 dias → vídeos e formatos derivados
             → aprovação do cliente → agendamento/publicação → métricas → mais do que funcionou
```

A referência de mercado é o Fastlane (lido em 02/10/2026): perfil pela URL, fila de conteúdo para aprovar ("Blitz"), automação que enche o calendário, formatos UGC/slideshow/hook + demo/meme, agendamento no TikTok/Reels/Shorts/LinkedIn, analytics, workspaces e API + MCP. Planos de US$ 0, 29, 49 e 149 por mês.

## Papéis

| Peça | Papel | Onde |
|---|---|---|
| **simplicio-loop-marketing** (este repo) | Cérebro: perfil, plano, copy, compliance, fila, aprovação, publicação via adaptadores, métricas e promoção | `lib/`, CLI `marketing-engine` |
| **[simpletibr/simplicio-videos](https://github.com/simpletibr/simplicio-videos)** | Fábrica de vídeo: contrato YAML → voz **Gemini TTS** (cache) → B-roll/motion (HyperFrames) → render determinístico → QA | CLI `simplicio-video`, MCP `simplicio-video-mcp` |
| **[Real Oficial](https://realoficial.com.br)** | Publicação e agendamento (TikTok, Reels, Shorts; até 30 dias), dublagem (300+ idiomas), tradução de legendas (150+), vozes de IA/faceless, imagens e carrosséis, cortes de vídeo longo | MCP/REST (só cortes) + app web |
| **simplicio-loop** (instalado em `.claude/skills/` + `hooks/`, v3.47.0) | Operador: loop com evidência, anchor/backlog, action-gate | `simplicio-loop install` |

**Voz:** o **Gemini TTS é a narração principal** (qualidade aprovada). A voz e a dublagem da Real Oficial entram só nas **traduções** para clientes de outros países.

## Superfície de integração da Real Oficial (o que existe de verdade)

| Superfície | Cobre | Publicar | Agendar | Dublar/legendar | Voz | Imagens |
|---|---|---|---|---|---|---|
| MCP `https://api.realoficial.com.br/mcp` (OAuth): `ro_whoami`, `ro_estimate_clips`, `ro_create_clips`, `ro_wait_for_clips`, `ro_get_project`, `ro_list_projects`, `ro_list_clips`, `ro_get_clip`, `ro_render_clip`, `ro_list_renders`, `ro_list_offers`, `ro_start_purchase`, `ro_get_purchase_status` | Conta, saldo, cortes, renders, compra | ❌ | ❌ | ❌ | ❌ | ❌ |
| REST (Bearer): `/api/v1/createShorts`, `/api/v1/shorts/{project_id}`, render, `/api/v1/renders` | Cortes e renders | ❌ | ❌ | ❌ | ❌ | ❌ |
| App web `app.realoficial.com.br` | Tudo | ✅ | ✅ (≤ 30 dias) | ✅ | ✅ | ✅ |

Fontes: [realoficial.com.br](https://realoficial.com.br), [llms.txt](https://realoficial.com.br/llms.txt) e [MCP](https://realoficial.com.br/pt/mcp). Em 02/10/2026, o `docs.realoficial.com.br` respondeu HTTP 429 / desafio anti-bot à leitura automática, então a busca por endpoints não documentados ficou em [#168](https://github.com/simpletibr/simplicio-loop-marketing/issues/168).

**Consequência:** publicação, agendamento e dublagem ficam atrás de **interfaces próprias**. A implementação Real Oficial é **provisória, por automação de navegador** (`lib/automation/browser-lane.ts`), até existir API ou MCP oficial. Aí troca só a implementação.

```ts
// lib/publish/publisher.ts (planejado, #161)
interface Publisher {
  readonly id: string; // "dry-run" | "realoficial-browser" | "realoficial-api"
  capabilities(): { networks: ("tiktok" | "ig_reels" | "yt_shorts")[]; maxScheduleDays: number };
  schedule(req: { clientSlug: string; mediaPath: string; caption: string; networks: string[];
                  publishAt: string; approvalRef: string }): Promise<PublishReceipt>;
  status(receiptId: string): Promise<PublishReceipt>;
  cancel(receiptId: string): Promise<void>;
}

// lib/dubbing/dubbing.ts (planejado, #165)
interface Dubbing {
  readonly id: string;
  estimate(req: DubRequest): Promise<{ credits?: number; unknown?: true }>; // nunca gasta
  dub(req: DubRequest & { approvedByWesley: true }): Promise<DubReceipt>;   // gasta → exige OK
}
```

## Arquitetura

```
simplicio-loop-marketing (TS)
  profile ─► plan 30d ─► copy/captions + compliance ─► fila ─► aprovação (#163) ─► publisher.schedule (#161/#162) ─► métricas (#166) ─► promote
     │ simplicio.video-contract/v1 (#160)                                  ▲
     ▼                                                                     │ MP4 + render.manifest.json (sha256)
simplicio-videos (Python): voz Gemini → broll/motion/slides → render → QA ─┘
     │ versões internacionais
     ▼
dubbing (#165) → Real Oficial (dublagem 300+ / legendas 150+)      clips (#164) → Real Oficial MCP ro_* (oficial)
cobrança: Stripe no exterior (#167) · AbacatePay no Brasil (simplicio-video venda)
```

## Fases

| Fase | Entrega | Issues | Esforço |
|---|---|---|---|
| **0: ligar as peças** | Provider `simplicio-video`, `brand-profile/v1`, interfaces `publisher`/`dubbing` (dry-run), spike Real Oficial: postar um MP4 pronto agendado ou privado e medir créditos | [#160](https://github.com/simpletibr/simplicio-loop-marketing/issues/160), [#161](https://github.com/simpletibr/simplicio-loop-marketing/issues/161) | 4 a 6 dias |
| **Paralelo** | Pedido de API/MCP à Real Oficial (o agente redige, o Wesley envia) | [#168](https://github.com/simpletibr/simplicio-loop-marketing/issues/168) | 0,5 dia + espera |
| **1: MVP vendável** | Link de aprovação, calendário de 30 dias agendado na Real Oficial, formatos derivados (slideshow, cutdown, variações de gancho, cortes de vídeo longo), assinatura Stripe | [#163](https://github.com/simpletibr/simplicio-loop-marketing/issues/163), [#162](https://github.com/simpletibr/simplicio-loop-marketing/issues/162), [#164](https://github.com/simpletibr/simplicio-loop-marketing/issues/164), [#167](https://github.com/simpletibr/simplicio-loop-marketing/issues/167) | 1,5 a 2 semanas |
| **2: internacional + métricas** | Dublagem e legendas por país (Gemini nativo quando houver voz boa, Real Oficial nos demais), loop de métricas → mais do que funcionou, relatório mensal | [#165](https://github.com/simpletibr/simplicio-loop-marketing/issues/165), [#166](https://github.com/simpletibr/simplicio-loop-marketing/issues/166) | 2 a 3 semanas |
| **3: self-serve** | Multi-tenant, onboarding pela URL, swipe, planos com créditos | [#169](https://github.com/simpletibr/simplicio-loop-marketing/issues/169) | 4 a 6 semanas (depois) |

**Pronto da Fase 0:** `marketing-engine loop --client <teste>` gera 1 vídeo real pelo simplicio-videos e deixa 1 post **agendado na Real Oficial** (privado ou rascunho), com recibo `marketing-publish-receipt/v1` e screenshot.

## Guardrails (valem para todas as fases)

- **Créditos da Real Oficial só com OK explícito do Wesley.** `ro_estimate_clips` sempre antes de `ro_create_clips`; dublagem e imagens idem.
- **Nada é publicado sem a aprovação registrada do cliente** (`approval/v1` com o hash da mídia), checada pelo action-gate.
- **A sessão da Real Oficial é aberta pelo Wesley** no navegador do box. Nenhum agente lê, copia ou grava cookies, tokens ou senhas.
- `DRY_RUN=true` é o padrão; o modo ao vivo é promovido peça a peça.
- Código do simplicio-videos não muda por este repo: templates novos são issues **daquele** repo.

## Riscos

| Risco | Mitigação |
|---|---|
| Publicação e dublagem só no app web (a automação quebra quando o layout muda) | Interfaces + fixtures HTML nos testes, falha `layout_changed`, recibo com screenshot, pedido de API (#168) |
| Termos de uso sobre automação do app | Ler antes de ativar; perguntar no pedido de API |
| Limite de contas conectadas (Lite: 1 + até 5 Instagram + 5 TikTok, por tempo limitado) | Subir de plano conforme a carteira ou cliente com conta própria |
| Postar MP4 pronto sem re-corte não confirmado | Spike da Fase 0 (#161), com OK do Wesley |
| Qualidade da dublagem | QA humano de 1 vídeo por idioma; Gemini nativo quando possível |
| Duas stacks (TS + Python) | Só contrato + MCP; e2e com contrato real |

## Fase 0 em uso: comandos reais

### Perfil da marca (#160)

```bash
# DRY_RUN=true (padrão): usa o coletor de fixture, nada externo roda.
marketing-engine profile https://www.lothus.com.br --client lothus

# Ao vivo: DRY_RUN=false + o CLI instalado (pip install -e simplicio-videos; Node >= 22; ffmpeg).
SIMPLICIO_VIDEO_BIN=/caminho/simplicio-video DRY_RUN=false \
  marketing-engine profile https://www.lothus.com.br --client lothus
```

Grava `clients/<slug>/brand-profile.hbi` (contrato `brand-profile/v1`, cada fato com a fonte). O coletor do `simplicio-video` é quem respeita robots.txt e LGPD: uma coleta que declare PII ou robots ignorado é recusada.

### Vídeo pelo contrato (#160)

O provider `simplicio-video` (matriz `PROVIDERS.md`, tarefas `motion-typography`, `data-viz-reel`, `programmatic-short`; ou `provider_override: { video: simplicio-video }` na peça) escreve `contract.yaml` (`simplicio.video-contract/v1`), roda `simplicio-video run --json --contract <yaml> --out <dir>` sem shell e valida o `render.manifest.json` (o sha256 do MP4 precisa bater). O manifest entra na peça (`render_manifest_path`, `render_sha256`) e o `publishVerified` bloqueia com `render_evidence_blocked` se o arquivo mudar.

Formato esperado do manifest (estrito): `{ "output": { "path", "sha256", "bytes?", "duration_s?" }, "voice?": { "provider", "seconds", "cost_usd", "cache_hit" }, "qa?": { "passed" } }`. A saída do CLI precisa terminar com uma linha JSON `{ "ok": true, "mp4": "...", "manifest": "..." }`.

> Não verificado contra o `simplicio-videos` real nesta sessão (o CLI não estava instalado e o repo não era acessível): os nomes dos subcomandos e os campos do contrato YAML estão isolados em `lib/video/contract.ts` (`cliArgs`, `serializeVideoContract`) e em `lib/profile/brand-profile.ts` (`collectProspect`). O primeiro run ao vivo com `SIMPLICIO_VIDEO_BIN` confirma ou ajusta esses pontos.
