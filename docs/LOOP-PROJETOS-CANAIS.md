# O looping por projeto e por canal

> Estado: **plano**. Complementa o [roadmap](ROADMAP-REALOFICIAL-VIDEOS.md) e o épico [#159](https://github.com/simpletibr/simplicio-loop-marketing/issues/159). Nada aqui está implementado.

O produto é um looping de marketing que nunca para, da ideia até o post, e roda **por projeto** e **por canal**:

```
ideia → roteiro → vídeo → aprovação → post (um por canal) → números → aprendizado → próxima ideia
```

Só o passo do vídeo é feito pelo [simplicio-videos](https://github.com/simpletibr/simplicio-videos) (o motor determinístico: contrato YAML entra, MP4 sai). Todo o resto vive neste repositório.

## Projeto e canal

- **Projeto**: uma marca ou negócio cujo marketing o looping cuida (nome, site, idioma, fuso, voz e tom, kit visual, **fatos** com a origem de cada um, metas). Roteiros só podem usar fatos do projeto: preço, telefone ou número que não esteja nos fatos é barrado.
- **Canal**: um projeto numa rede (Instagram Reels, TikTok, YouTube Shorts...) com conta conectada, ritmo (dias e horários), melhores horários, estilo de legenda, opções de post e o caminho de postagem (Real Oficial, conexão direta ou pacote pronto para postar).
- Um vídeo aprovado vira **um post por canal**: o vídeo é o mesmo, a legenda, a capa, o horário e as opções mudam.

## O que falta aqui (e vira schema em `contracts/marketing-artifacts/v1`)

| Schema | O que guarda | Issue |
|---|---|---|
| `brand-profile/v1` | projeto: identidade, fatos com fonte, metas | #160 |
| `content-plan/v1` | calendário por canal e "preencher a semana" | #162 |
| `approval/v1` | aprovação presa à versão do conteúdo (hash) + checklist; confirmação de uso único para postar | #163 |

## Regras que devem valer

- **Aprovação presa ao conteúdo**: se o roteiro, o vídeo ou a legenda mudam, a aprovação vale para a versão antiga e é descartada. Prévia e vídeo final são renderizações da mesma especificação.
- **Nada posta sem humano**: ver o vídeo, marcar o checklist e confirmar a semana. Confirmação de uso único, ligada ao conteúdo exato.
- **Prazos e falhas** em linguagem simples: aprovar até 24 h antes do horário (senão o horário fica vazio); render falhou → uma nova tentativa, depois aviso; conta desconectada → posts esperam; limite diário ou créditos esgotados → aviso.
- **Números**: janelas de 24 h, 72 h e 7 dias depois do post. Sem conta conectada, os números são digitados ou importados; **nunca inventados**. Em modo simulado (`DRY_RUN`) eles não podem virar "aprendizado".
- **Zero tokens de IA por padrão** no caminho de ideia, roteiro, legenda e vídeo (modelos e regras); IA de texto é um passo opcional e marcado.
- **Aviso**: quando algo precisa do humano (aprovação, falha, conta), o looping avisa (Telegram primeiro); sem aviso, ele esperaria em silêncio.

## Três jeitos de ver (painel, épico #171)

Clássico (calendário e listas por projeto e canal), Híbrido (o Clássico com uma faixa do looping) e Game (uma casinha por etapa). Os três mostram o mesmo estado e usam o mesmo cartão de decisão.

## Ordem

1. Perfil do projeto a partir do site (#160) e interface com o motor de vídeo (`simplicio-video`, ver [`docs/interface.md`](https://github.com/simpletibr/simplicio-videos/pulls) quando publicado).
2. Canais, calendário e o pacote pronto para postar com lembrete (#162).
3. Aprovação (#163) e postagem pela Real Oficial quando houver caminho para o arquivo de vídeo (#161, #168).
4. Números e aprendizado (#166), painel (#171).
