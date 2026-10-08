import { h, fmtAgo } from "/ui/dom.js";

const SEVERITY = { error: { cls: "error", text: "Erro" }, warn: { cls: "warn", text: "Aviso" }, info: { cls: "info", text: "Info" } };

function notifyControl(notify, refresh) {
  if (!notify.supported()) return h("p", { class: "muted" }, "Este navegador não oferece notificações. O centro de alertas e os avisos na tela continuam valendo.");
  const on = notify.enabled();
  return h("p", null,
    h("button", { type: "button", "aria-pressed": String(on), onclick: async () => { if (on) notify.disable(); else await notify.enable(); refresh(); } }, on ? "Notificações do navegador: ligadas" : "Notificações do navegador: desligadas"),
    " ", h("span", { class: "muted" }, "Opcional: o aviso aparece no desktop só enquanto esta página estiver aberta."));
}

export async function alertsView({ api, state, notify, refresh, openPiece }) {
  const d = await api("/api/alerts", { client: state.params.get("client") ?? "", severity: state.params.get("severity") ?? "" });
  return h("section", { "aria-labelledby": "alerts-title" },
    h("h1", { id: "alerts-title" }, "Alertas"),
    h("p", { class: "muted" }, d.external_delivery === "webhook"
      ? "Envio externo: só o webhook configurado pelo operador recebe os alertas que acabam de começar."
      : "Envio externo desligado: nenhum WhatsApp, e-mail ou Slack. Os alertas aparecem aqui, na tela e, se você ligar, no desktop."),
    notifyControl(notify, refresh),
    h("div", { class: "grid kpis" },
      h("div", { class: "card kpi" }, h("div", { class: "value" }, String(d.counts.error)), h("div", null, "Erros")),
      h("div", { class: "card kpi" }, h("div", { class: "value" }, String(d.counts.warn)), h("div", null, "Avisos")),
      h("div", { class: "card kpi" }, h("div", { class: "value" }, String(d.counts.info)), h("div", null, "Informações"))),
    h("section", { class: "mt", "aria-labelledby": "alerts-list-h" },
      h("h2", { id: "alerts-list-h" }, "Ativos agora"),
      d.alerts.length === 0 ? h("p", { class: "muted", role: "status" }, "Nenhum alerta ativo. Cada alerta some sozinho quando a causa é resolvida.") :
      h("ul", { class: "alerts" }, d.alerts.map((a) => h("li", { class: "card", "data-rule": a.rule, "data-severity": a.severity },
        h("p", null, h("span", { class: `sev ${SEVERITY[a.severity].cls}` }, SEVERITY[a.severity].text), " ", h("strong", null, a.message)),
        a.next_step ? h("p", null, h("span", { class: "muted" }, "Próximo passo: "), a.next_step) : null,
        h("p", { class: "muted" }, [a.client ? `${a.client} · ` : "", `desde ${fmtAgo(a.since)}`, a.piece_id ? " · " : "", a.piece_id ? h("button", { type: "button", onclick: () => openPiece(a.piece_id, { api }) }, a.piece_id) : null]))))));
}
