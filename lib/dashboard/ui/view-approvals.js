import { h, fmtAgo, fmtDate, fmtNumber, NETWORK_LABEL } from "/ui/dom.js";
import "/ui/kit/sl-kpi-card.js";

const SLA = {
  red: { cls: "error", text: "Vermelho", hint: "menos de 24 h do post" },
  yellow: { cls: "warn", text: "Amarelo", hint: "menos de 72 h do post" },
  green: { cls: "ok", text: "Verde", hint: "prazo folgado" },
  unknown: { cls: "info", text: "Sem prazo", hint: "sem data de post" },
};

const sla = (value) => h("span", { class: `sev ${SLA[value].cls}`, title: SLA[value].hint }, SLA[value].text);

function timeLeft(hours) {
  if (hours === null || hours === undefined) return "sem data";
  if (hours < 0) return `atrasado ${fmtNumber(Math.abs(hours), 1)} h`;
  return hours >= 48 ? `${fmtNumber(hours / 24, 1)} d` : `${fmtNumber(hours, 1)} h`;
}

// The one control on this page: copy. There is no approve, reject or send button in v1 (deciding goes through
// `marketing-engine approval record`, which writes an approval/v1 record behind the action gate).
function copyButton(label, text, toast) {
  return h("button", {
    type: "button",
    onclick: async () => {
      try {
        await navigator.clipboard.writeText(text);
        toast("Copiado.", "info");
      } catch {
        toast("Não foi possível copiar: selecione o texto na tabela.", "warn");
      }
    },
  }, label);
}

function table(label, heads, rows) {
  return h("div", { class: "scroll", tabindex: "0", role: "region", "aria-label": label }, h("table", null,
    h("thead", null, h("tr", null, heads.map((t) => h("th", { scope: "col" }, t)))),
    h("tbody", null, rows)));
}

export async function approvalsView({ api, state, toast, openPiece }) {
  const d = await api("/api/approvals", { client: state.params.get("client") ?? "" });
  const open = (id) => h("button", { type: "button", onclick: () => openPiece(id, { api }) }, id);
  return h("section", { "aria-labelledby": "appr-title" },
    h("h1", { id: "appr-title" }, "Fila de aprovações"),
    h("p", { class: "muted" }, "Somente leitura. A cor segue o tempo até o post: vermelho abaixo de 24 h ou atrasado, amarelo abaixo de 72 h, verde acima. A decisão é registrada pelo comando de aprovação, não por esta página."),
    h("div", { class: "grid kpis" },
      h("sl-kpi-card", { class: "kpi", label: "Aguardando o cliente", value: fmtNumber(d.summary.client) }),
      h("sl-kpi-card", { class: "kpi", label: "Pedidos de ajuste abertos", value: fmtNumber(d.summary.adjustments) }),
      h("sl-kpi-card", { class: "kpi", label: "Aguardando o Wesley", value: fmtNumber(d.summary.operator) }),
      h("sl-kpi-card", { class: "kpi", label: "Vermelhas / amarelas", value: `${fmtNumber(d.summary.red)} / ${fmtNumber(d.summary.yellow)}` })),
    h("section", { class: "mt", "aria-labelledby": "appr-client-h" },
      h("h2", { id: "appr-client-h" }, "Cliente: link de aprovação sem resposta"),
      d.client.length === 0 ? h("p", { class: "muted" }, "Nenhuma peça aguardando o cliente.") :
      table("Aprovações do cliente", ["Prazo", "Cliente", "Peça", "Rede", "Pedido", "Tempo até o post", "Data do post (UTC)", "Link"],
        d.client.map((i) => h("tr", { "data-sla": i.sla },
          h("td", null, sla(i.sla)), h("th", { scope: "row" }, i.client), h("td", null, open(i.piece_id)),
          h("td", null, i.network ? (NETWORK_LABEL[i.network] ?? i.network) : "sem dado"),
          h("td", null, fmtAgo(i.requested_at)),
          h("td", null, timeLeft(i.hours_to_post)), h("td", null, fmtDate(i.publish_at)),
          h("td", null, i.link ? [h("span", null, i.link), " ", copyButton("Copiar link", i.link, toast)] : [h("code", null, i.page_command), " ", copyButton("Copiar comando", i.page_command, toast)]))))),
    h("section", { class: "mt", "aria-labelledby": "appr-adj-h" },
      h("h2", { id: "appr-adj-h" }, "Pedidos de ajuste do cliente"),
      d.adjustments.length === 0 ? h("p", { class: "muted" }, "Nenhum pedido de ajuste aberto.") :
      h("ul", null, d.adjustments.map((a) => h("li", null,
        h("strong", null, `${a.client} · ${a.piece_id}`), ` · ${a.decided_by} · ${fmtAgo(a.decided_at)}`,
        h("blockquote", null, a.note))))),
    h("section", { class: "mt", "aria-labelledby": "appr-op-h" },
      h("h2", { id: "appr-op-h" }, "Wesley: decisões que só ele toma"),
      d.operator.length === 0 ? h("p", { class: "muted" }, "Nenhuma decisão pendente.") :
      table("Decisões do Wesley", ["Prazo", "Peça", "Pedido", "Estimativa de crédito", "Impacto", "Parado há"],
        d.operator.map((o) => h("tr", { "data-sla": o.sla },
          h("td", null, sla(o.sla)), h("td", null, o.piece_id ? open(o.piece_id) : "sem peça"), h("td", null, o.request ?? "sem descrição"),
          h("td", null, o.credit_estimate === null ? "sem dado" : `${fmtNumber(o.credit_estimate, 2)} créditos`), h("td", null, o.impact ?? "sem dado"), h("td", null, `${fmtNumber(o.age_hours, 1)} h`))))));
}
