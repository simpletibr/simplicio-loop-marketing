import { h, fmtNumber, NETWORK_LABEL } from "/ui/dom.js";
import { SEAL_STATE } from "/ui/state.js";
import "/ui/kit/sl-kpi-card.js";
import "/ui/kit/sl-donut.js";
import "/ui/kit/sl-heatmap.js";
import "/ui/kit/sl-gate-badge.js";

const SEALS = [["qa", "QA técnico"], ["compliance", "Compliance"], ["watcher", "Watcher"], ["licenses", "Licenças B-roll"], ["approval", "Aprovação"], ["ai_label", "Rótulo de IA"]];
const GATE_LABEL = { qa: "QA técnico", compliance: "Compliance", watcher: "Watcher" };

// A seal that does not apply is not a gate: it says so and nothing more.
function seal(name, s) {
  if (s.state === "na") return h("td", null, h("span", { class: "muted" }, "não se aplica"));
  const reason = [s.state === "none" ? "sem dado" : null, s.detail, s.reasons?.length ? s.reasons.join(", ") : null].filter(Boolean).join(" · ");
  return h("td", null, h("sl-gate-badge", { gate: name, state: SEAL_STATE[s.state], reason }));
}

export async function qualityView({ api, state, go, openPiece }) {
  const status = state.params.get("status") ?? "";
  const data = await api("/api/quality", { client: state.params.get("client") ?? "", status });
  const a = data.aggregate;
  const trendOf = (gate) => a.trend.map((w) => w[gate]).filter((v) => v !== null);
  const blocked = h("sl-donut", { class: "card", label: "Peças bloqueadas e liberadas" });
  blocked.segments = [{ label: "Bloqueadas", value: a.blocked, state: "BLOCKED" }, { label: "Liberadas", value: a.total - a.blocked, state: "PASS" }];
  const trend = h("sl-heatmap", { label: "Aprovadas de primeira, por semana", unit: "%", state: "PASS", max: 100 });
  trend.columns = a.trend.map((w) => w.week_start);
  trend.rows = Object.entries(GATE_LABEL).map(([gate, name]) => ({ label: name, values: a.trend.map((w) => w[gate]) }));
  return h("section", { "aria-labelledby": "quality-title" },
    h("h1", { id: "quality-title" }, "Qualidade e compliance"),
    h("div", { class: "grid kpis" },
      ...a.first_try.map((g) => {
        const weekly = trendOf(g.gate);
        return h("sl-kpi-card", { class: "kpi", label: `${GATE_LABEL[g.gate]}: aprovadas de primeira`, value: g.first_try_pass_pct === null ? "sem dado" : fmtNumber(g.first_try_pass_pct, 1), unit: g.first_try_pass_pct === null ? null : "%", trend: weekly.length > 1 ? weekly.join(",") : null, detail: `${g.pieces} peça(s) com resultado` });
      }),
      blocked),
    h("div", { class: "grid two mt" },
      h("section", { class: "card", "aria-labelledby": "trend-h" }, h("h2", { id: "trend-h" }, "Tendência semanal (aprovadas de primeira)"), trend),
      h("section", { class: "card", "aria-labelledby": "why-h" }, h("h2", { id: "why-h" }, "Principais motivos de reprovação"),
        a.top_reasons.length === 0 ? h("p", { class: "muted" }, "Nenhuma reprovação.") : h("ol", null, a.top_reasons.map((r) => h("li", null, `${GATE_LABEL[r.gate]}: ${r.reason} (${r.count})`))))),
    h("form", { class: "filterbar mt", onsubmit: (e) => e.preventDefault() },
      h("label", null, "Mostrar", h("select", { onchange: (e) => go("quality", { status: e.target.value }) }, h("option", { value: "" }, "Todas"), h("option", { value: "blocked", selected: status === "blocked" }, "Só bloqueadas")))),
    data.pieces.length === 0 ? h("p", { class: "muted" }, "Nenhuma peça com resultado de gate ainda.") :
    h("div", { class: "scroll", tabindex: "0", role: "region", "aria-label": "Selos por peça" }, h("table", null,
      h("thead", null, h("tr", null, h("th", { scope: "col" }, "Peça"), ...SEALS.map(([, t]) => h("th", { scope: "col" }, t)), h("th", { scope: "col" }, "Pode seguir?"))),
      h("tbody", null, data.pieces.map((p) => h("tr", { "data-blocked": p.blocked ? "1" : "0" },
        h("th", { scope: "row" }, h("button", { type: "button", onclick: () => openPiece(p.piece_id, { api }) }, p.piece_id), h("div", { class: "muted" }, `${p.client ?? ""} ${NETWORK_LABEL[p.network] ?? p.network ?? ""}`)),
        ...SEALS.map(([k, name]) => seal(name, p[k])),
        h("td", null, h("sl-gate-badge", { gate: "Pode seguir", state: p.blocked ? "BLOCKED" : "PASS", reason: p.blocked ? p.blocking.join(", ") : null }))))))));
}
