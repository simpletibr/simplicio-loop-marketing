import { h, svg, fmtNumber, fmtAgo, fmtDate, STAGE_LABEL } from "/ui/dom.js";
import { kpiAttrs } from "/ui/state.js";
import "/ui/kit/sl-kpi-card.js";

const kpiTile = (k) => h("sl-kpi-card", { class: "kpi", ...kpiAttrs(k) });

// A compact flow diagram: one bar per stage (height ~ pieces that reached it), bands between bars, drop-off labelled.
function river(data) {
  const W = 1040, H = 220, top = 20, gap = (W - 60) / (data.nodes.length - 1);
  const max = Math.max(1, ...data.nodes.map((n) => n.reached));
  const hOf = (n) => Math.max(2, (n / max) * (H - top - 40));
  const root = svg("svg", { class: "river", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-labelledby": "river-title river-desc" });
  root.append(svg("title", { id: "river-title" }, "Rio do pipeline"), svg("desc", { id: "river-desc" }, data.nodes.map((n) => `${STAGE_LABEL[n.stage]}: ${n.reached}`).join("; ")));
  data.links.forEach((l, i) => {
    const a = data.nodes[i], b = data.nodes[i + 1];
    const x1 = 30 + i * gap + 10, x2 = 30 + (i + 1) * gap - 10;
    const ya = top + (H - top - 40 - hOf(a.reached)) / 2, yb = top + (H - top - 40 - hOf(b.reached)) / 2;
    const ha = hOf(a.reached), hb = hOf(b.reached);
    const d = `M${x1},${ya} C${(x1 + x2) / 2},${ya} ${(x1 + x2) / 2},${yb} ${x2},${yb} L${x2},${yb + hb} C${(x1 + x2) / 2},${yb + hb} ${(x1 + x2) / 2},${ya + ha} ${x1},${ya + ha} Z`;
    const bottleneck = l.dropped > 0 && l.dropped >= Math.max(1, a.reached * 0.3);
    root.append(svg("path", { d, fill: bottleneck ? "var(--warn-bg)" : "var(--info-bg)", stroke: bottleneck ? "var(--warn)" : "var(--info)", "stroke-width": 1, "stroke-dasharray": bottleneck ? "4 3" : "0" }));
    if (l.dropped > 0) root.append(svg("text", { x: (x1 + x2) / 2, y: top - 6, "text-anchor": "middle", "font-size": 11, fill: "var(--muted)" }, `−${l.dropped}`));
  });
  data.nodes.forEach((n, i) => {
    const x = 30 + i * gap, ht = hOf(n.reached), y = top + (H - top - 40 - ht) / 2;
    root.append(svg("rect", { x: x - 10, y, width: 20, height: ht, rx: 3, fill: "var(--accent)" }),
      svg("text", { x, y: H - 22, "text-anchor": "middle", "font-size": 11, fill: "var(--fg)" }, STAGE_LABEL[n.stage]),
      svg("text", { x, y: H - 8, "text-anchor": "middle", "font-size": 11, fill: "var(--muted)" }, String(n.reached)));
  });
  return root;
}

export async function cockpitView({ api, state, go }) {
  const data = await api("/api/cockpit");
  const feed = h("ul", { class: "feed", tabindex: "0", "aria-label": "Eventos recentes" }, data.feed.map((f) =>
    h("li", null,
      h("time", { datetime: f.ts, "data-ago": f.ts }, fmtAgo(f.ts)),
      h("span", { class: `sev ${f.severity}` }, f.severity === "info" ? "ok" : f.severity === "warn" ? "atenção" : "erro"),
      h("span", null, `${f.client ? `${f.client} · ` : ""}${f.text}`, f.thumbnail ? " · prévia disponível" : ""))));
  const clients = state.params.get("client") ? data.clients.filter((c) => c.slug === state.params.get("client")) : data.clients;
  const healthText = { ok: "saudável", attention: "atenção", critical: "crítico" };
  return h("section", { "aria-labelledby": "cockpit-title" },
    h("h1", { id: "cockpit-title" }, "Cockpit"),
    h("div", { class: "grid kpis" }, data.kpis.map(kpiTile)),
    h("div", { class: "grid two mt" },
      h("section", { class: "card", "aria-labelledby": "river-h" }, h("h2", { id: "river-h" }, "Rio do pipeline"), river(data.river)),
      h("section", { class: "card", "aria-labelledby": "feed-h" }, h("h2", { id: "feed-h" }, "Ao vivo"), feed)),
    h("section", { class: "mt", "aria-labelledby": "clients-h" },
      h("h2", { id: "clients-h" }, "Clientes"),
      h("div", { class: "grid clients" }, clients.map((c) =>
        h("article", { class: "card" },
          h("h3", null, h("button", { type: "button", onclick: () => go("pipeline", { client: c.slug }) }, c.name ?? c.slug)),
          h("p", null, h("span", { class: `sev ${c.health === "ok" ? "ok" : c.health === "attention" ? "warn" : "error"}` }, healthText[c.health]), c.alerts ? ` · ${c.alerts} alerta(s)` : ""),
          h("dl", null,
            h("dt", { class: "muted" }, "Próxima publicação"), h("dd", null, fmtDate(c.next_publication)),
            h("dt", { class: "muted" }, "Mês preenchido"), h("dd", null, c.month_filled_pct === null ? "sem dado" : `${c.month_filled_pct}%`),
            h("dt", { class: "muted" }, "Visualizações"), h("dd", null, fmtNumber(c.views_total))))))),
    h("section", { class: "mt", "aria-labelledby": "world-h" },
      h("h2", { id: "world-h" }, "Clientes por país"),
      data.world.length === 0 ? h("p", { class: "muted" }, "Sem dado de país: crie o perfil do cliente com `marketing-engine profile`.") :
      h("div", { class: "grid clients" }, data.world.map((w) =>
        h("article", { class: "card" }, h("h3", null, w.country), h("p", null, `${w.clients.length} cliente(s)`), h("p", { class: "muted" }, `Idiomas: ${w.languages.join(", ") || "sem dado"} · versões dubladas: ${w.dubbed_versions}`))))));
}
