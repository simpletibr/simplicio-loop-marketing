import { h, fmtDate, fmtNumber, STAGE_LABEL, NETWORK_LABEL, STATE_LABEL } from "/ui/dom.js";
import "/ui/kit/sl-json-tree.js";

const FILTERS = [["client", "Cliente", "clients"], ["format", "Formato", "formats"], ["network", "Rede", "networks"], ["language", "Idioma", "languages"]];

function copyButton(label, text) {
  return h("button", { type: "button", onclick: async (e) => { try { await navigator.clipboard.writeText(text); e.target.textContent = "Copiado"; } catch { e.target.textContent = "Selecione e copie"; } } }, label);
}

// The voice timing is a JSON file: a tree is easier to read than the raw text. A file that is cut or damaged stays as text.
function timingView(text) {
  let data;
  try { data = JSON.parse(text); } catch { return h("pre", null, text); }
  const tree = h("sl-json-tree", { label: "timing.lock.json" });
  tree.data = data;
  return tree;
}

function section(title, ...children) {
  return h("section", { class: "mt-sm" }, h("h3", null, title), ...children);
}

export async function openPiece(id, { api }) {
  const drawer = document.getElementById("drawer");
  const body = document.getElementById("drawer-body");
  document.getElementById("drawer-title").textContent = id;
  body.replaceChildren(h("p", null, "Carregando…"));
  drawer.showModal();
  let d;
  try { d = await api(`/api/pieces/${encodeURIComponent(id)}`); } catch (e) { body.replaceChildren(h("p", { role: "alert" }, e.message)); return; }
  const a = d.artifacts ?? {};
  // `replaceChildren` turns a `null` into the text "null", so the sections that do not exist are dropped first.
  body.replaceChildren(...[
    d.media.preview || d.media.final
      ? h("video", { controls: true, preload: "none", playsinline: true, src: `/api/media/${encodeURIComponent(id)}/${d.media.final ? "final" : "preview"}`, "aria-label": `Vídeo da peça ${id} (${d.media.final ? "final" : "prévia"})` })
      : h("p", { class: "muted" }, "Sem prévia nem render final ainda. O painel nunca gera render."),
    h("p", { class: "muted" }, d.media.final ? "Mostrando o render final." : "Mostrando a prévia; o render final só aparece quando existir."),
    d.manifest ? section("Manifest", h("dl", null, h("dt", { class: "muted" }, "sha256 do render"), h("dd", null, d.manifest.render_sha256 ?? "sem dado"), h("dt", { class: "muted" }, "Gerado em"), h("dd", null, fmtDate(d.manifest.generated_at)))) : null,
    a.script ? section("Roteiro", h("pre", null, a.script)) : null,
    a.timing ? section("Voz (timing.lock.json)", timingView(a.timing)) : null,
    a.contract ? section("Contrato YAML", h("pre", null, a.contract)) : null,
    a.qa || a.compliance ? section("Folha de QA e compliance", h("pre", null, [a.qa, a.compliance].filter(Boolean).join("\n\n"))) : null,
    a.final_command ? section("FINAL-COMANDO.md (copiar, sem executar)", h("pre", null, a.final_command), copyButton("Copiar comando", a.final_command)) : null,
    a.captions ? section("Legendas por rede", h("pre", null, a.captions)) : null,
    section("Aprovações", d.approvals.length ? h("ul", null, d.approvals.map((x) => h("li", null, `${fmtDate(x.decided_at)} · ${x.decision === "approved" ? "aprovado" : "ajuste pedido"} (${x.decided_by_role})${x.note ? `: ${x.note}` : ""}`))) : h("p", { class: "muted" }, "Sem decisões.")),
    section("Agendamentos", d.receipts.length ? h("ul", null, d.receipts.map((r) => h("li", null, `${NETWORK_LABEL[r.network] ?? r.network} · ${fmtDate(r.publish_at)} · ${r.verdict}${r.dry_run ? " (simulação)" : ""}${r.failure_class ? ` · ${r.failure_class}` : ""}`))) : h("p", { class: "muted" }, "Sem recibos.")),
    section("Histórico de eventos", h("ol", null, d.events.map((e) => h("li", null, `${fmtDate(e.ts)} · ${e.kind.replace("marketing.", "")}`)))),
  ].filter(Boolean));
}

export async function pipelineView({ api, state, go }) {
  const params = Object.fromEntries(["client", "campaign", "format", "network", "language", "status", "q"].map((k) => [k, state.params.get(k) ?? ""]));
  const data = await api("/api/pipeline", params);
  const bar = h("form", { class: "filterbar", role: "search", "aria-label": "Filtros do pipeline", onsubmit: (e) => e.preventDefault() },
    ...FILTERS.map(([key, label, listKey]) =>
      h("label", null, label, h("select", { name: key, onchange: (e) => go("pipeline", { [key]: e.target.value }) },
        h("option", { value: "" }, "Todos"), ...data.filters[listKey].map((v) => h("option", { value: v, selected: params[key] === v }, NETWORK_LABEL[v] ?? v))))),
    h("label", null, "Situação", h("select", { name: "status", onchange: (e) => go("pipeline", { status: e.target.value }) },
      h("option", { value: "" }, "Todas"), ...["done", "failed", "active"].map((v) => h("option", { value: v, selected: params.status === v }, STATE_LABEL[v])))),
    h("label", null, "Buscar", h("input", { type: "search", name: "q", value: params.q, onchange: (e) => go("pipeline", { q: e.target.value }) })));
  const stuck = data.bottlenecks.oldest_stuck;
  const board = h("div", { class: "scroll", tabindex: "0", role: "region", "aria-label": "Quadro do pipeline, role horizontalmente" },
    h("div", { class: "board" }, data.stages.map((stage) => {
      const cards = data.cards.filter((c) => c.stage === stage);
      return h("section", { class: "col", "aria-labelledby": `col-${stage}` },
        h("h2", { id: `col-${stage}`, class: "sub" }, h("span", null, STAGE_LABEL[stage]), h("span", { class: "chip", "aria-label": `${cards.length} peças` }, cards.length)),
        cards.length === 0 ? h("p", { class: "muted" }, "Nenhuma peça.") : cards.map((c) =>
          h("button", { type: "button", class: "piece", "data-state": c.state, onclick: () => openPiece(c.piece_id, { api }) },
            h("strong", null, c.piece_id),
            h("div", { class: "meta" },
              c.format ? h("span", null, c.format) : null,
              c.network ? h("span", null, NETWORK_LABEL[c.network] ?? c.network) : null,
              c.language ? h("span", null, c.language) : null,
              h("span", null, `${STATE_LABEL[c.state]}`),
              h("span", null, c.time_in_stage_h === null ? "sem dado" : `${fmtNumber(c.time_in_stage_h, 1)} h na etapa`),
              c.retries ? h("span", null, `${c.retries} retentativa(s)`) : null,
              c.has_preview ? h("span", null, "prévia") : null,
              c.has_final ? h("span", null, "final") : null))));
    })));
  const hours = Object.entries(data.bottlenecks.avg_hours_into_stage).filter(([, v]) => v !== null);
  return h("section", { "aria-labelledby": "pipe-title" },
    h("h1", { id: "pipe-title" }, "Pipeline"),
    bar,
    h("p", { class: "muted" }, stuck ? `Peça parada há mais tempo: ${stuck.piece_id} em ${STAGE_LABEL[stuck.stage]} (${fmtNumber(stuck.hours, 1)} h).` : "Nenhuma peça parada."),
    hours.length ? h("p", { class: "muted" }, `Tempo médio para entrar em cada etapa (h): ${hours.map(([s, v]) => `${STAGE_LABEL[s]} ${fmtNumber(v, 1)}`).join(" · ")}`) : null,
    board,
    data.variations.length ? h("section", { class: "mt-sm" }, h("h2", null, "Variações"), h("ul", null, data.variations.map((v) => h("li", null, `${v.root_piece} → ${v.children.join(", ")}`)))) : null);
}
