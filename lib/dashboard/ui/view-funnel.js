import { h, fmtDate, fmtNumber } from "/ui/dom.js";

const STAGE_LABEL = { collected: "Prospects coletados", preview: "Prévias renderizadas", sent: "Prévias enviadas", replied: "Respostas", sale: "Vendas", subscription: "Assinaturas ativas" };
const dl = (rows) => h("dl", null, rows.flatMap(([k, v]) => [h("dt", { class: "muted" }, k), h("dd", null, v)]));
const pct = (v) => (v === null || v === undefined ? "sem dado" : `${fmtNumber(v, 1)}%`);
const CURRENCY = { BRL: "R$", USD: "US$", EUR: "€", CHF: "CHF" };
const cur = (code) => CURRENCY[code] ?? code;
const original = (by) => (Object.keys(by).length === 0 ? "—" : Object.entries(by).map(([c, v]) => `${cur(c)} ${fmtNumber(v, 2)}`).join(" + "));
const brl = (v) => (v === null || v === undefined ? "sem dado" : `R$ ${fmtNumber(v, 2)}`);
// Original currency first, then reais only when every payment carries the conversion.
function money(m) {
  if (m.count === 0) return "nenhum";
  const codes = Object.keys(m.by_currency);
  if (codes.length === 1 && codes[0] === "BRL" && m.brl !== null) return brl(m.brl);
  return `${original(m.by_currency)} · ${brl(m.brl)}${m.brl === null ? ` (${m.brl_missing} sem conversão)` : ""}`;
}

function bars(stages, label) {
  const top = Math.max(1, stages[0]?.count ?? 1);
  return h("ul", { class: "bars funnel", "aria-label": label }, stages.map((s) =>
    h("li", null,
      h("span", null, `${STAGE_LABEL[s.stage]}: ${fmtNumber(s.count)}`),
      h("progress", { max: top, value: s.count, "aria-label": `${STAGE_LABEL[s.stage]}: ${s.count} de ${top}` }),
      h("span", { class: "muted" }, s.conversion_pct === null ? "—" : `${fmtNumber(s.conversion_pct, 1)}% da etapa anterior`))));
}

function table(label, heads, rows) {
  return h("div", { class: "scroll", tabindex: "0", role: "region", "aria-label": label }, h("table", null,
    h("thead", null, h("tr", null, heads.map((t) => h("th", { scope: "col" }, t)))), h("tbody", null, rows)));
}

// Read-only on purpose: nothing here creates a charge, a subscription or a refund.
export async function funnelView({ api, state }) {
  const d = await api("/api/funnel", { client: state.params.get("client") ?? "" });
  const f = d.funnel, r = d.revenue, s = d.subscriptions;
  return h("section", { "aria-labelledby": "funnel-title" },
    h("h1", { id: "funnel-title" }, "Funil e receita"),
    h("p", { class: "muted" }, "Somente leitura: lê planilha, venda.json e webhooks gravados. Não cria cobrança. Valores em reais só aparecem quando a conversão está registrada; senão, moeda original e \"sem dado\"."),
    d.presentation ? h("p", { class: "sev warn", role: "status" }, "Modo apresentação: os valores por cliente estão ocultos.") : null,
    h("div", { class: "grid two" },
      h("section", { class: "card", "aria-labelledby": "fn-h" }, h("h2", { id: "fn-h" }, "Funil comercial"),
        bars(f.stages, "Funil comercial"),
        dl([["Prospect para venda", pct(f.sale_rate_pct)], ["Referência", d.reference.label], ["Diferença para a referência", f.vs_reference_pp === null ? "sem dado" : `${f.vs_reference_pp > 0 ? "+" : ""}${fmtNumber(f.vs_reference_pp, 2)} p.p.`]]),
        f.unknown_statuses.length ? h("p", { class: "muted" }, `Status da planilha sem etapa conhecida (contados como coletado): ${f.unknown_statuses.join(", ")}`) : null),
      h("section", { class: "card", "aria-labelledby": "rev-h" }, h("h2", { id: "rev-h" }, "Receita"),
        dl([["MRR (assinaturas ativas)", s.active === 0 ? "nenhuma" : `${original(s.mrr.by_currency)} · ${brl(s.mrr.brl)}`], ["Receita do mês", money(r.month.total)], ["Recorrente no mês", money(r.month.recurring)], ["Avulsa no mês", money(r.month.one_off)], ["Receita total", money(r.all_time.total)]]),
        h("h3", null, "Por processador"),
        r.by_processor.length === 0 ? h("p", { class: "muted" }, "Nenhum pagamento registrado.") : h("ul", null, r.by_processor.map((p) => h("li", null, `${p.processor === "stripe" ? "Stripe (exterior)" : p.processor === "abacatepay" ? "AbacatePay (BR)" : p.processor}: ${money(p)}`))))),
    h("div", { class: "grid two", style: "margin-top:16px" },
      h("section", { class: "card", "aria-labelledby": "sub-h" }, h("h2", { id: "sub-h" }, "Assinaturas"),
        dl([["Ativas", fmtNumber(s.active)], ["Cancelamentos em 30 dias", `${fmtNumber(s.churn_30d.canceled)} (churn ${pct(s.churn_30d.rate_pct)})`], [`Cancelados antes do mínimo de ${s.minimum_months} meses`, fmtNumber(s.churn_30d.canceled_before_minimum)]]),
        h("h3", null, "Por plano"),
        s.by_plan.length === 0 ? h("p", { class: "muted" }, "Nenhuma assinatura ativa.") : h("ul", null, s.by_plan.map((p) => h("li", null, `${p.plan}: ${fmtNumber(p.active)} ativa(s) · MRR ${brl(p.mrr_brl)}`)))),
      h("section", { class: "card", "aria-labelledby": "ref-h" }, h("h2", { id: "ref-h" }, "Fontes"),
        h("ul", null, h("li", null, "Planilha de controle exportada em CSV (prospects, prévias, envios, respostas)."), h("li", null, "venda.json da fábrica de vídeo (vendas pagas e entregues)."), h("li", null, "Webhooks da Stripe gravados em arquivo."), h("li", null, "AbacatePay entra pelo venda.json; não há leitor de webhook dele ainda.")))),
    h("section", { style: "margin-top:16px", "aria-labelledby": "grp-h" }, h("h2", { id: "grp-h" }, "Funil por país e lote"),
      f.groups.length === 0 ? h("p", { class: "muted" }, "Nenhum prospect ainda.") :
      table("Funil por país e lote", ["País", "Lote", ...Object.values(STAGE_LABEL)],
        f.groups.map((g) => h("tr", null, h("th", { scope: "row" }, g.country ?? "sem dado"), h("td", null, g.batch ?? "sem dado"), g.stages.map((st) => h("td", null, st.conversion_pct === null ? fmtNumber(st.count) : `${fmtNumber(st.count)} (${fmtNumber(st.conversion_pct, 1)}%)`)))))),
    h("section", { style: "margin-top:16px", "aria-labelledby": "pc-h" }, h("h2", { id: "pc-h" }, "Por cliente"),
      d.per_client_hidden ? h("p", { class: "muted" }, "Oculto no modo apresentação.") :
      d.per_client.length === 0 ? h("p", { class: "muted" }, "Nenhum cliente com venda ou assinatura.") :
      table("Clientes com venda", ["Cliente", "Situação", "Assinatura", "LTV", "Meses ativos", "Mínimo de 3 meses até", "Próxima cobrança"],
        d.per_client.map((c) => h("tr", null, h("th", { scope: "row" }, c.client), h("td", null, c.status), h("td", null, c.subscription ?? "sem assinatura"), h("td", null, money(c.ltv)), h("td", null, c.months_active === null ? "sem dado" : fmtNumber(c.months_active, 1)), h("td", null, c.minimum_until ? `${fmtDate(c.minimum_until)}${c.minimum_met ? " (cumprido)" : ""}` : "sem dado"), h("td", null, c.next_charge_at ? fmtDate(c.next_charge_at) : "sem dado")))),
      null));
}
