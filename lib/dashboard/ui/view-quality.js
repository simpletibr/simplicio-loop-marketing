import { h, fmtNumber, NETWORK_LABEL } from "/ui/dom.js";

const SEALS = [["qa", "QA técnico"], ["compliance", "Compliance"], ["watcher", "Watcher"], ["licenses", "Licenças B-roll"], ["approval", "Aprovação"], ["ai_label", "Rótulo de IA"]];
const STATE = { pass: ["ok", "ok"], fail: ["error", "reprovado"], pending: ["warn", "pendente"], na: ["info", "não se aplica"], none: ["info", "sem dado"] };
const GATE_LABEL = { qa: "QA técnico", compliance: "Compliance", watcher: "Watcher" };

function seal(s) {
  const [cls, text] = STATE[s.state];
  return h("td", null, h("span", { class: `sev ${cls}` }, text), s.detail ? h("div", { class: "muted" }, s.detail) : null, s.reasons?.length ? h("div", { class: "muted" }, s.reasons.join(", ")) : null);
}

export async function qualityView({ api, state, go, openPiece }) {
  const status = state.params.get("status") ?? "";
  const data = await api("/api/quality", { client: state.params.get("client") ?? "", status });
  const a = data.aggregate;
  return h("section", { "aria-labelledby": "quality-title" },
    h("h1", { id: "quality-title" }, "Qualidade e compliance"),
    h("div", { class: "grid kpis" },
      ...a.first_try.map((g) => h("article", { class: "card kpi" }, h("h2", { class: "sub" }, `${GATE_LABEL[g.gate]}: aprovadas de primeira`), h("div", { class: "value" }, g.first_try_pass_pct === null ? "sem dado" : `${fmtNumber(g.first_try_pass_pct, 1)}%`), h("div", { class: "detail" }, `${g.pieces} peça(s) com resultado`))),
      h("article", { class: "card kpi" }, h("h2", { class: "sub" }, "Peças bloqueadas"), h("div", { class: "value" }, fmtNumber(a.blocked)), h("div", { class: "detail" }, `de ${a.total} peça(s)`))),
    h("div", { class: "grid two mt" },
      h("section", { class: "card", "aria-labelledby": "why-h" }, h("h2", { id: "why-h" }, "Principais motivos de reprovação"),
        a.top_reasons.length === 0 ? h("p", { class: "muted" }, "Nenhuma reprovação.") : h("ol", null, a.top_reasons.map((r) => h("li", null, `${GATE_LABEL[r.gate]}: ${r.reason} (${r.count})`)))),
      h("section", { class: "card", "aria-labelledby": "trend-h" }, h("h2", { id: "trend-h" }, "Tendência semanal (aprovadas de primeira)"),
        h("table", null, h("thead", null, h("tr", null, h("th", { scope: "col" }, "Semana"), ...Object.keys(GATE_LABEL).map((g) => h("th", { scope: "col" }, GATE_LABEL[g])))),
          h("tbody", null, a.trend.map((w) => h("tr", null, h("th", { scope: "row" }, w.week_start), ...Object.keys(GATE_LABEL).map((g) => h("td", null, w[g] === null ? "sem dado" : `${fmtNumber(w[g], 1)}%`)))))))),
    h("form", { class: "filterbar mt", onsubmit: (e) => e.preventDefault() },
      h("label", null, "Mostrar", h("select", { onchange: (e) => go("quality", { status: e.target.value }) }, h("option", { value: "" }, "Todas"), h("option", { value: "blocked", selected: status === "blocked" }, "Só bloqueadas")))),
    data.pieces.length === 0 ? h("p", { class: "muted" }, "Nenhuma peça com resultado de gate ainda.") :
    h("div", { class: "scroll", tabindex: "0", role: "region", "aria-label": "Selos por peça" }, h("table", null,
      h("thead", null, h("tr", null, h("th", { scope: "col" }, "Peça"), ...SEALS.map(([, t]) => h("th", { scope: "col" }, t)), h("th", { scope: "col" }, "Pode seguir?"))),
      h("tbody", null, data.pieces.map((p) => h("tr", { "data-blocked": p.blocked ? "1" : "0" },
        h("th", { scope: "row" }, h("button", { type: "button", onclick: () => openPiece(p.piece_id, { api }) }, p.piece_id), h("div", { class: "muted" }, `${p.client ?? ""} ${NETWORK_LABEL[p.network] ?? p.network ?? ""}`)),
        ...SEALS.map(([k]) => seal(p[k])),
        h("td", null, p.blocked ? h("span", { class: "sev error" }, `bloqueada: ${p.blocking.join(", ")}`) : h("span", { class: "sev ok" }, "sim"))))))));
}
