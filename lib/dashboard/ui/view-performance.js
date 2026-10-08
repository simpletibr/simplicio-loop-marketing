import { h, svg, fmtDate, fmtNumber, NETWORK_LABEL } from "/ui/dom.js";

const METRIC_LABEL = { views: "Visualizações", likes: "Curtidas", comments: "Comentários", shares: "Compartilhamentos", saves: "Salvamentos" };
const STAGE_LABEL = { planned: "planejada", prospect: "coleta", script: "roteiro", voice: "voz", preview: "prévia", qa: "QA", compliance: "compliance", approval: "aprovação", final: "render final", scheduled: "agendada", published: "publicada", metrics: "com métricas" };
const num = (v) => (v === null || v === undefined ? "sem dado" : fmtNumber(v));
const FORMAT_LABEL = { hero: "hero", cutdown: "derivado (corte)", hook_variant: "variação de gancho", slideshow: "slideshow", carousel: "carrossel", long_cut: "corte longo" };

function table(label, heads, rows) {
  return h("div", { class: "scroll", tabindex: "0", role: "region", "aria-label": label }, h("table", null,
    h("thead", null, h("tr", null, heads.map((t) => h("th", { scope: "col" }, t)))), h("tbody", null, rows)));
}

function comparison(label, groups, nameOf = (g) => g) {
  return groups.length === 0 ? h("p", { class: "muted" }, "Sem posts medidos.") :
    table(label, ["Grupo", "Posts", "Medidos", "Média", "Mediana", "Total"],
      groups.map((g) => h("tr", null, h("th", { scope: "row" }, nameOf(g.group)), h("td", null, num(g.posts)), h("td", null, num(g.measured)), h("td", null, num(g.mean)), h("td", null, num(g.median)), h("td", null, num(g.total)))));
}

// A line of cumulative views per client. A day with no reading is a gap in the line, never a drop to zero.
function chart(c) {
  const W = 640, H = 150, pad = 6;
  const pts = c.points;
  const top = Math.max(1, ...pts.map((p) => p.views ?? 0));
  const x = (i) => pad + (i / Math.max(1, pts.length - 1)) * (W - 2 * pad);
  const y = (v) => H - pad - (v / top) * (H - 2 * pad);
  let d = "";
  let open = false;
  pts.forEach((p, i) => { if (p.views === null) { open = false; return; } d += `${open ? "L" : "M"}${x(i).toFixed(1)} ${y(p.views).toFixed(1)} `; open = true; });
  const measured = pts.filter((p) => p.views !== null);
  const last = measured.at(-1);
  const summary = last ? `Visualizações acumuladas de ${c.client}: ${fmtNumber(last.views)} em ${last.date}, ${measured.length} de ${pts.length} dias com leitura.` : `Sem leitura de visualizações para ${c.client} neste período.`;
  return h("div", { class: "card" },
    h("h3", null, c.client),
    last ? svg("svg", { class: "chart", viewBox: `0 0 ${W} ${H}`, width: "100%", role: "img", "aria-label": summary }, svg("path", { d, fill: "none", stroke: "currentColor", "stroke-width": 2.5, "stroke-linejoin": "round" }), measured.length <= 60 ? pts.map((p, i) => (p.views === null ? null : svg("circle", { cx: x(i).toFixed(1), cy: y(p.views).toFixed(1), r: 3.5, fill: "currentColor" }))) : null) : null,
    h("p", { class: "muted" }, summary),
    last ? h("details", null, h("summary", null, "Ver os números por dia"),
      table(`Visualizações por dia de ${c.client}`, ["Dia", "Visualizações", "Posts medidos"], pts.map((p) => h("tr", null, h("th", { scope: "row" }, p.date), h("td", null, num(p.views)), h("td", null, num(p.posts)))))) : null);
}

// Read-only on purpose: the next month's plan is made by the metrics loop, never from this page.
export async function performanceView({ api, state, go, openPiece }) {
  const metric = state.params.get("metric") ?? "views";
  const d = await api("/api/performance", { client: state.params.get("client") ?? "", network: state.params.get("network") ?? "", metric });
  return h("section", { "aria-labelledby": "perf-title" },
    h("h1", { id: "perf-title" }, "Desempenho e vencedores"),
    h("p", { class: "muted" }, "Somente leitura. Métrica que a rede não informou aparece como \"sem dado\", nunca como zero, e fica fora das médias. Retenção ainda não tem fonte."),
    h("div", { class: "filterbar", role: "group", "aria-label": "Métrica do ranking" }, d.metrics.map((m) => h("button", { type: "button", "aria-pressed": String(m === d.metric), onclick: () => go("performance", { metric: m === "views" ? "" : m }) }, METRIC_LABEL[m]))),
    h("section", { class: "mt", "aria-labelledby": "rank-h" }, h("h2", { id: "rank-h" }, `Ranking por ${METRIC_LABEL[d.metric].toLowerCase()}`),
      d.posts.length === 0 ? h("p", { class: "muted" }, "Nenhum post medido ainda.") :
      [h("p", { class: "muted" }, `${d.posts.length} de ${d.posts_total} posts medidos.`),
      table("Ranking de posts", ["#", "Peça", "Cliente", "Rede", "Formato", "Gancho (primeiros 2 s)", "Idioma", ...d.metrics.map((m) => METRIC_LABEL[m]), "Retenção", "Prévia"],
        d.posts.map((p) => h("tr", { "data-winner": p.winner ? "1" : null },
          h("td", null, p.rank ?? "—"),
          h("th", { scope: "row" }, h("button", { type: "button", onclick: () => openPiece(p.piece_id, { api }) }, p.piece_id), p.winner ? h("span", { class: "sev ok" }, "Vencedor") : null, p.variant_of ? h("span", { class: "chip" }, `variação de ${p.variant_of}`) : null),
          h("td", null, p.client ?? "sem dado"), h("td", null, NETWORK_LABEL[p.network] ?? p.network), h("td", null, FORMAT_LABEL[p.format] ?? p.format ?? "sem dado"), h("td", null, p.hook ?? "sem dado"),
          h("td", null, `${p.dubbed ? "dublado" : "original"}${p.language ? ` (${p.language})` : ""}`),
          d.metrics.map((m) => h("td", null, num(p.metrics[m]))), h("td", null, "sem fonte"),
          h("td", null, p.has_preview ? h("video", { src: `/api/media/${encodeURIComponent(p.piece_id)}/preview`, muted: true, preload: "metadata", width: "54", height: "96", "aria-label": `Prévia de ${p.piece_id}` }) : "sem prévia")))) ]),
    h("section", { class: "mt", "aria-labelledby": "win-h" }, h("h2", { id: "win-h" }, "Vencedores e as variações do mês seguinte"),
      d.winners.length === 0 ? h("p", { class: "muted" }, "Nenhum vencedor marcado: o mês precisa de pelo menos 3 posts medidos.") :
      h("div", { class: "grid cards" }, d.winners.map((w) => h("div", { class: "card", "data-winner-piece": w.piece_id },
        h("h3", null, `${w.piece_id} · ${w.month}`),
        h("p", { class: "muted" }, `${NETWORK_LABEL[w.network] ?? w.network} · ${FORMAT_LABEL[w.format] ?? w.format} · ${num(w.views)} visualizações · marcado em ${fmtDate(w.marked_at)}`),
        h("p", null, w.hook),
        w.variations.length === 0 ? h("p", { class: "muted" }, "Nenhuma variação planejada ainda.") :
        h("ul", null, w.variations.map((v) => h("li", null, h("button", { type: "button", onclick: () => openPiece(v.piece_id, { api }) }, v.piece_id), ` · ${FORMAT_LABEL[v.format] ?? v.format} · ${fmtDate(v.publish_at)} · ${STAGE_LABEL[v.stage] ?? v.stage} · visualizações: ${num(v.views)}`)))))) ),
    h("div", { class: "grid two mt" },
      h("section", { "aria-labelledby": "fmt-h" }, h("h2", { id: "fmt-h" }, `Por formato (${METRIC_LABEL[d.metric].toLowerCase()})`), comparison("Comparação por formato", d.comparison.by_format, (g) => FORMAT_LABEL[g] ?? g)),
      h("section", { "aria-labelledby": "lang-h" }, h("h2", { id: "lang-h" }, "Original e dublado"), comparison("Comparação por idioma", d.comparison.by_language))),
    h("section", { class: "mt", "aria-labelledby": "hook-h" }, h("h2", { id: "hook-h" }, "Por gancho (primeiros 2 segundos)"), comparison("Comparação por gancho", d.comparison.by_hook)),
    h("section", { class: "mt", "aria-labelledby": "grow-h" }, h("h2", { id: "grow-h" }, `Crescimento por cliente (${d.growth.days} dias)`),
      d.growth.clients.length === 0 ? h("p", { class: "muted" }, "Sem leituras de métricas.") : h("div", { class: "grid cards" }, d.growth.clients.map(chart))));
}
