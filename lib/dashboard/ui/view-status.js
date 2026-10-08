import { h, fmtDate, fmtNumber, NETWORK_LABEL } from "/ui/dom.js";
import "/ui/kit/sl-timeline.js";

const CONNECTION = { connected: "conectado", disconnected: "desconectado", unknown: "sem dado" };
const SESSION = { active: "ativa", expired: "possivelmente expirada", login_required: "login necessário", challenge: "verificação pendente", unknown: "sem dado" };

function failureLine(f) {
  return f ? h("p", { class: "muted" }, `${f.reason} ${f.next_step}`) : null;
}

function capacity(cap) {
  if (!cap) return h("p", { class: "muted" }, "Sem dado: a leitura da Real Oficial está desligada ou não respondeu.");
  return h("ul", { class: "bars" }, cap.platforms.map((p) =>
    h("li", null,
      h("span", null, `${p.platform}: ${p.used} de ${p.limit} contas`),
      h("progress", { max: p.limit, value: Math.min(p.used, p.limit), "aria-label": `${p.platform}: ${p.used} de ${p.limit} contas` }),
      p.warning ? h("span", { class: "sev warn" }, p.used >= p.limit ? "lotado" : "quase lotado") : null)));
}

async function openReceipt(id, api) {
  const drawer = document.getElementById("drawer");
  const body = document.getElementById("drawer-body");
  document.getElementById("drawer-title").textContent = `Recibo ${id}`;
  body.replaceChildren(h("p", null, "Carregando…"));
  drawer.showModal();
  let r;
  try { r = await api(`/api/receipts/${encodeURIComponent(id)}`); } catch (e) { body.replaceChildren(h("p", { role: "alert" }, e.message)); return; }
  const stages = h("sl-timeline", { label: "Etapas do recibo" });
  stages.items = r.stages.map((s) => ({ time: "", title: s.stage, state: s.ok ? "PASS" : "FAIL", detail: s.detail }));
  body.replaceChildren(
    h("dl", null,
      h("dt", { class: "muted" }, "Peça"), h("dd", null, r.piece_id),
      h("dt", { class: "muted" }, "Rede"), h("dd", null, NETWORK_LABEL[r.network] ?? r.network),
      h("dt", { class: "muted" }, "Publicador"), h("dd", null, `${r.publisher}${r.dry_run ? " (simulação)" : ""}`),
      h("dt", { class: "muted" }, "Situação"), h("dd", null, r.verdict),
      h("dt", { class: "muted" }, "Data do post"), h("dd", null, fmtDate(r.publish_at))),
    failureLine(r),
    h("h3", null, "Etapas"),
    stages,
    r.has_evidence ? h("img", { src: `/api/evidence/${encodeURIComponent(id)}`, alt: `Captura de tela da evidência do recibo ${id}`, class: "evidence-img" }) : h("p", { class: "muted" }, "Sem captura de tela neste recibo."));
}

export async function statusView({ api, state }) {
  const data = await api("/api/status", { client: state.params.get("client") ?? "", network: state.params.get("network") ?? "" });
  const p = data.publisher;
  return h("section", { "aria-labelledby": "status-title" },
    h("h1", { id: "status-title" }, "Status por rede"),
    h("div", { class: "grid two" },
      h("section", { class: "card", "aria-labelledby": "health-h" },
        h("h2", { id: "health-h" }, "Saúde do publicador (Real Oficial)"),
        h("p", null, h("span", { class: `sev ${p.session === "active" ? "ok" : p.session === "unknown" ? "info" : "error"}` }, `Sessão ${SESSION[p.session]}`)),
        h("dl", null, h("dt", { class: "muted" }, "Último sucesso"), h("dd", null, fmtDate(p.last_success)),
          h("dt", { class: "muted" }, "Falhas em 30 dias"), h("dd", null, Object.keys(p.failures_30d).length ? Object.entries(p.failures_30d).map(([k, n]) => `${k} ${n}`).join(" · ") : "nenhuma")),
        p.next_step ? h("p", { role: "status" }, h("strong", null, "Próximo passo: "), p.next_step) : null,
        p.evidence_receipt ? h("p", null, h("a", { href: `/api/evidence/${encodeURIComponent(p.evidence_receipt)}`, target: "_blank", rel: "noopener" }, "Abrir a última captura de tela de evidência")) : null),
      h("section", { class: "card", "aria-labelledby": "cap-h" }, h("h2", { id: "cap-h" }, "Contas conectadas e limite do plano"), capacity(data.capacity))),
    h("section", { class: "mt", "aria-labelledby": "matrix-h" },
      h("h2", { id: "matrix-h" }, "Cliente por rede"),
      data.matrix.length === 0 ? h("p", { class: "muted" }, "Nenhum cliente ainda.") :
      h("div", { class: "scroll", tabindex: "0", role: "region", "aria-label": "Matriz cliente por rede" }, h("table", null,
        h("thead", null, h("tr", null, ["Cliente", "Rede", "Conexão", "Último post", "Próximo post", "Sucesso em 7 dias", "Falhas", "Motivo e próximo passo"].map((t) => h("th", { scope: "col" }, t)))),
        h("tbody", null, data.matrix.map((c) => h("tr", null,
          h("th", { scope: "row" }, c.client), h("td", null, NETWORK_LABEL[c.network] ?? c.network),
          h("td", null, CONNECTION[c.connection]), h("td", null, fmtDate(c.last_post)), h("td", null, fmtDate(c.next_post)),
          h("td", null, `${c.success_rate_7d === null ? "sem dado" : `${fmtNumber(c.success_rate_7d, 1)}% de ${c.attempts_7d}`}${c.simulated ? ` · ${c.simulated} em simulação` : ""}`),
          h("td", null, Object.keys(c.failures).length ? Object.entries(c.failures).map(([k, n]) => `${k} ${n}`).join(" · ") : "nenhuma"),
          h("td", null, c.last_failure ? `${c.last_failure.reason} ${c.last_failure.next_step}` : "")))))),
    h("section", { class: "mt", "aria-labelledby": "rc-h" },
      h("h2", { id: "rc-h" }, "Recibos de publicação"),
      data.receipts.length === 0 ? h("p", { class: "muted" }, "Sem recibos.") :
      h("div", { class: "scroll", tabindex: "0", role: "region", "aria-label": "Recibos" }, h("table", null,
        h("thead", null, h("tr", null, ["Quando", "Cliente", "Peça", "Rede", "Situação", "Motivo"].map((t) => h("th", { scope: "col" }, t)))),
        h("tbody", null, data.receipts.map((r) => h("tr", null,
          h("td", null, fmtDate(r.ts)), h("td", null, r.client), h("td", null, h("button", { type: "button", onclick: () => openReceipt(r.receipt_id, api) }, r.piece_id)),
          h("td", null, NETWORK_LABEL[r.network] ?? r.network), h("td", null, `${r.verdict}${r.dry_run ? " (simulação)" : ""}`), h("td", null, r.reason ?? "")))))))));
}
