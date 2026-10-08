import { h, fmtDate, NETWORK_LABEL } from "/ui/dom.js";

const STATUS_LABEL = { queued_next_cycle: "fila do próximo ciclo", planned: "planejado", rendering: "em produção", render_failed: "em produção", rendered: "em aprovação", awaiting_approval: "em aprovação", changes_requested: "ajuste pedido", approved: "aprovado", scheduled: "agendado", cancelled: "cancelado", schedule_failed: "falhou" };
const DOW = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];

function monthDays(year, month) {
  const first = new Date(Date.UTC(year, month, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const total = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return { lead, total };
}

export async function calendarView({ api, state, go, openPiece }) {
  const today = new Date();
  const ym = state.params.get("month") ?? `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}`;
  const [year, month] = ym.split("-").map(Number);
  const mode = state.params.get("mode") ?? "month";
  const zone = state.params.get("zone") ?? "";
  const from = `${ym}-01`;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const data = await api("/api/calendar", { from, to: `${ym}-${String(last).padStart(2, "0")}`, client: state.params.get("client") ?? "", network: state.params.get("network") ?? "" });
  const timeIn = (e) => (zone && e.zones[zone] ? e.zones[zone] : e.client_time.local);
  const label = (e) => `${timeIn(e).slice(11)} ${NETWORK_LABEL[e.network] ?? e.network}`;
  const byDay = new Map();
  for (const e of data.entries) { const day = timeIn(e).slice(0, 10); byDay.set(day, [...(byDay.get(day) ?? []), e]); }
  const step = (delta) => { const d = new Date(Date.UTC(year, month - 1 + delta, 1)); go("calendar", { month: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}` }); };

  const controls = h("div", { class: "filterbar" },
    h("button", { type: "button", onclick: () => step(-1) }, "‹ Mês anterior"),
    h("strong", { "aria-live": "polite" }, ym),
    h("button", { type: "button", onclick: () => step(1) }, "Próximo mês ›"),
    h("label", null, "Visão", h("select", { onchange: (e) => go("calendar", { mode: e.target.value }) }, ...[["month", "Mês"], ["week", "Semana"], ["list", "Lista"]].map(([v, t]) => h("option", { value: v, selected: mode === v }, t)))),
    h("label", null, "Fuso", h("select", { onchange: (e) => go("calendar", { zone: e.target.value }) }, h("option", { value: "" }, "Do cliente"), ...data.zones.map((z) => h("option", { value: z, selected: zone === z }, z)))),
    h("label", null, "Rede", h("select", { onchange: (e) => go("calendar", { network: e.target.value }) }, h("option", { value: "" }, "Todas"), ...Object.entries(NETWORK_LABEL).map(([v, t]) => h("option", { value: v, selected: state.params.get("network") === v }, t)))));

  const notes = h("ul", { class: "muted" },
    h("li", null, `Limite da Real Oficial: ${data.window_days} dias. O que passa disso aparece como "fila do próximo ciclo" e nunca como agendado.`),
    data.heatmap.map((x) => h("li", null, `${x.client}: meta ${x.weekly_goal} posts/semana · dias vazios: ${x.empty_days.length ? x.empty_days.join(", ") : "nenhum"}`)),
    data.conflicts.map((c) => h("li", { class: "sev warn" }, `Conflito (${c.type}): ${c.piece_id} — ${c.detail}`)));

  let body;
  if (mode === "list") {
    body = h("div", { class: "scroll", tabindex: "0", role: "region", "aria-label": "Lista de posts" }, h("table", null,
      h("thead", null, h("tr", null, ["Data/hora", "BRT", "Rede", "Formato", "Situação", "Peça"].map((t) => h("th", { scope: "col" }, t)))),
      h("tbody", null, data.entries.map((e) => h("tr", null, h("td", null, fmtDate(timeIn(e))), h("td", null, e.brt.slice(11)), h("td", null, NETWORK_LABEL[e.network] ?? e.network), h("td", null, e.format), h("td", null, `${STATUS_LABEL[e.status]}${e.simulated ? " (simulação)" : ""}`), h("td", null, h("button", { type: "button", onclick: () => openPiece(e.piece_id, { api }) }, e.piece_id)))))));
  } else {
    const { lead, total } = monthDays(year, month - 1);
    const cells = [];
    const startDay = mode === "week" ? Math.max(1, Number(state.params.get("day") ?? new Date().getUTCDate())) : 1;
    const days = mode === "week" ? Array.from({ length: 7 }, (_, i) => startDay + i).filter((d) => d <= total) : Array.from({ length: total }, (_, i) => i + 1);
    if (mode !== "week") for (let i = 0; i < lead; i++) cells.push(h("div", { role: "gridcell" }));
    for (const d of days) {
      const key = `${ym}-${String(d).padStart(2, "0")}`;
      const items = byDay.get(key) ?? [];
      // The name is the visible text first, then the full date and the count, for a screen reader.
      const btn = h("button", { type: "button", class: `day${items.length ? "" : " empty"}`, tabindex: d === days[0] ? "0" : "-1", "data-day": key,
        onclick: () => { if (items[0]) openDay(key, items); } },
        h("span", { class: "n" }, String(d)),
        ...items.slice(0, 4).map((e) => h("span", { class: `post ${e.status}` }, `${label(e)}${e.simulated ? " ·sim" : ""}`)),
        items.length > 4 ? h("span", { class: "muted" }, `+${items.length - 4}`) : null,
        h("span", { class: "sr-only" }, ` — ${key}: ${items.length ? `${items.length} post(s)` : "sem posts"}`));
      cells.push(h("div", { role: "gridcell", "aria-selected": "false" }, btn));
    }
    const rows = [h("div", { class: "calrow", role: "row" }, ...DOW.map((d) => h("div", { class: "dow", role: "columnheader" }, d)))];
    for (let i = 0; i < cells.length; i += 7) rows.push(h("div", { class: "calrow", role: "row" }, ...cells.slice(i, i + 7)));
    const grid = h("div", { class: "cal", role: "grid", "aria-label": `Calendário ${ym}` }, ...rows);
    // roving tabindex: arrows move between days, Enter opens the day
    grid.addEventListener("keydown", (ev) => {
      const buttons = [...grid.querySelectorAll("button.day")];
      const i = buttons.indexOf(document.activeElement);
      if (i < 0) return;
      const move = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 7, ArrowUp: -7 }[ev.key];
      if (move === undefined) return;
      ev.preventDefault();
      const next = buttons[Math.min(Math.max(i + move, 0), buttons.length - 1)];
      for (const b of buttons) { b.tabIndex = -1; b.parentElement.setAttribute("aria-selected", "false"); }
      next.tabIndex = 0; next.parentElement.setAttribute("aria-selected", "true"); next.focus();
    });
    body = grid;
  }

  function openDay(key, items) {
    const drawer = document.getElementById("drawer");
    document.getElementById("drawer-title").textContent = key;
    document.getElementById("drawer-body").replaceChildren(h("ul", null, items.map((e) => h("li", null, h("button", { type: "button", onclick: () => { drawer.close(); openPiece(e.piece_id, { api }); } }, `${label(e)} · ${STATUS_LABEL[e.status]}${e.simulated ? " (simulação)" : ""} · ${e.piece_id}`), h("div", { class: "muted" }, `BRT ${e.brt.slice(11)} · ${e.client_time.timezone} ${e.client_time.local.slice(11)}`)))));
    drawer.showModal();
  }

  return h("section", { "aria-labelledby": "cal-title" }, h("h1", { id: "cal-title" }, "Calendário"), controls, body, notes);
}
