import { h, fmtDate, fmtNumber } from "/ui/dom.js";

const dl = (rows) => h("dl", null, rows.flatMap(([k, v]) => [h("dt", { class: "muted" }, k), h("dd", null, v)]));
const usd = (v) => (v === null || v === undefined ? "sem dado" : `US$ ${fmtNumber(v, 4)}`);
const brl = (v) => (v === null || v === undefined ? "sem dado" : `R$ ${fmtNumber(v, 2)}`);

// Read-only on purpose: there is not a single control on this page that can spend, buy or render.
export async function creditsView({ api, state }) {
  const d = await api("/api/credits", { client: state.params.get("client") ?? "" });
  const ro = d.realoficial, tts = d.tts, ue = d.unit_economics;
  return h("section", { "aria-labelledby": "credits-title" },
    h("h1", { id: "credits-title" }, "Créditos e custos"),
    h("ul", { class: "muted" }, d.labels.map((l) => h("li", null, l))),
    h("div", { class: "grid two" },
      h("section", { class: "card", "aria-labelledby": "ro-h" }, h("h2", { id: "ro-h" }, "Real Oficial"),
        dl([["Saldo", ro.balance === null ? `sem dado (${ro.balance_source})` : `${fmtNumber(ro.balance)} créditos`], ["Gasto no mês", `${fmtNumber(ro.spent_month, 2)} créditos`], ["Projeção do mês (estimativa)", ro.projected_month === null ? "sem dado" : `${fmtNumber(ro.projected_month, 2)} créditos`], ["Histórico de compras", ro.purchases_note]]),
        h("h3", null, "Gasto por finalidade"),
        Object.keys(ro.by_purpose).length === 0 ? h("p", { class: "muted" }, "Nenhum gasto aprovado registrado.") : h("ul", null, Object.entries(ro.by_purpose).map(([k, v]) => h("li", null, `${k}: ${fmtNumber(v, 2)} créditos`)))),
      h("section", { class: "card", "aria-labelledby": "tts-h" }, h("h2", { id: "tts-h" }, "Voz (Gemini TTS)"),
        dl([["Requisições hoje", tts.requests_today === null ? "sem dado" : `${fmtNumber(tts.requests_today)} de ${tts.limit === null ? "sem dado" : fmtNumber(tts.limit)}`], ["Cota volta em", tts.blocked_until ? fmtDate(tts.blocked_until) : "cota não esgotada"], ["Segundos gerados no mês", tts.seconds_month === null ? "sem dado" : fmtNumber(tts.seconds_month, 1)], ["Custo no mês", usd(tts.cost_usd_month)], ["Custo no mês em reais (estimativa)", brl(tts.cost_brl_month)], ["Câmbio", tts.fx ? `${fmtNumber(tts.fx.rate, 4)} (${tts.fx.label})` : "sem dado (PTAX_USD_BRL não definido)"], ["Reaproveitamento de voz (cache)", tts.cache_hit_rate === null ? "sem dado" : `${fmtNumber(tts.cache_hit_rate, 1)}%`]]))),
    h("div", { class: "grid two", style: "margin-top:16px" },
      h("section", { class: "card", "aria-labelledby": "llm-h" }, h("h2", { id: "llm-h" }, "LLM e render"),
        d.llm ? dl([["Chamadas no mês", fmtNumber(d.llm.calls)], ["Custo no mês (estimado pelo pipeline)", usd(d.llm.cost_usd)], ["Por provedor", Object.entries(d.llm.by_provider).map(([k, v]) => `${k} ${usd(v.cost)}`).join(" · ")]]) : h("p", { class: "muted" }, "Sem dado: data/llm-usage.jsonl não tem linhas neste mês."),
        h("p", { class: "muted" }, d.render.note)),
      h("section", { class: "card", "aria-labelledby": "ue-h" }, h("h2", { id: "ue-h" }, "Custo por prévia e por venda (estimativa)"),
        dl([["Prévias renderizadas", fmtNumber(ue.previews)], ["Vendas", fmtNumber(ue.sales)], ["Custo variável por prévia", usd(ue.cost_per_preview_usd)], ["Prévias por venda", ue.previews_per_sale === null ? "sem dado" : fmtNumber(ue.previews_per_sale, 2)], ["Custo variável por venda", usd(ue.cost_per_sale_usd)]]))),
    h("section", { style: "margin-top:16px", "aria-labelledby": "pc-h" }, h("h2", { id: "pc-h" }, "Por cliente: custo contra preço"),
      ue.per_client.length === 0 ? h("p", { class: "muted" }, "Nenhum cliente com custo registrado.") :
      h("div", { class: "scroll", tabindex: "0", role: "region", "aria-label": "Custo por cliente" }, h("table", null,
        h("thead", null, h("tr", null, ["Cliente", "Créditos", "Aprovado por", "Voz (US$)", "Custo (R$, estimativa)", "Preço mensal (R$)", "Margem (R$)"].map((t) => h("th", { scope: "col" }, t)))),
        h("tbody", null, ue.per_client.map((c) => h("tr", null, h("th", { scope: "row" }, c.client), h("td", null, fmtNumber(c.credits, 2)), h("td", null, c.approved_by.join(", ") || "—"), h("td", null, fmtNumber(c.tts_usd, 4)), h("td", null, brl(c.cost_brl)), h("td", null, brl(c.mrr_brl)), h("td", null, brl(c.margin_brl)))))))));
}
