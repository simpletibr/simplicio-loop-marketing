import { h, fmtAgo } from "/ui/dom.js";
import { cockpitView } from "/ui/view-cockpit.js";
import { pipelineView, openPiece } from "/ui/view-pipeline.js";
import { calendarView } from "/ui/view-calendar.js";

// The registry of sections. Each entry renders into <main> and may react to live events.
export const VIEWS = [
  { id: "cockpit", label: "Cockpit", render: cockpitView },
  { id: "pipeline", label: "Pipeline", render: pipelineView },
  { id: "calendar", label: "Calendário", render: calendarView },
];

export const state = { view: "cockpit", params: new URLSearchParams(), present: false };
const $ = (id) => document.getElementById(id);
const store = (k, v) => { try { v === undefined ? localStorage.getItem(k) : localStorage.setItem(k, v); } catch { /* storage may be blocked */ } };
const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };

export async function api(path, params = {}) {
  const url = new URL(path, location.origin);
  for (const [k, v] of Object.entries(params)) if (v !== "" && v !== null && v !== undefined) url.searchParams.set(k, v);
  if (state.present) url.searchParams.set("present", "1");
  const res = await fetch(url, { credentials: "same-origin" });
  if (res.status === 401) throw Object.assign(new Error("Sessão inválida: abra o painel pela URL impressa pelo comando `marketing-engine dashboard`."), { auth: true });
  if (!res.ok) throw new Error(`Erro ${res.status} em ${url.pathname}`);
  return res.json();
}

export function announce(text) {
  const live = $("live");
  live.textContent = "";
  setTimeout(() => { live.textContent = text; }, 30);
}

export function toast(text, level = "info") {
  const node = h("div", { class: `toast ${level}`, role: level === "error" ? "alert" : "status" }, text);
  $("toasts").append(node);
  setTimeout(() => node.remove(), 8000);
}

function parseHash() {
  // `#/pipeline?client=a` from the app, or `#client=a&present=1` from the CLI's printed URL.
  const raw = location.hash.replace(/^#/, "");
  let view = "cockpit";
  let query = raw;
  if (raw.startsWith("/")) [view, query = ""] = raw.slice(1).split("?");
  state.view = VIEWS.some((v) => v.id === view) ? view : "cockpit";
  state.params = new URLSearchParams(query);
  state.present = state.params.get("present") === "1";
}

export function go(view, params = {}) {
  const next = new URLSearchParams(state.params);
  for (const [k, v] of Object.entries(params)) (v === "" || v === null || v === undefined ? next.delete(k) : next.set(k, v));
  location.hash = `#/${view}${next.toString() ? `?${next}` : ""}`;
}

function renderNav() {
  const nav = $("nav");
  nav.replaceChildren(...VIEWS.map((v) => h("a", { href: `#/${v.id}${state.params.toString() ? `?${state.params}` : ""}`, "aria-current": v.id === state.view ? "page" : false }, v.label)));
}

let rendering = 0;
export async function render(opts = {}) {
  const ticket = ++rendering;
  const view = VIEWS.find((v) => v.id === state.view);
  const main = $("main");
  document.title = `${view.label} · Simplicio`;
  renderNav();
  try {
    const node = await view.render({ api, state, go, announce, toast, openPiece });
    if (ticket !== rendering) return;
    main.replaceChildren(node);
    if (!opts.quiet) { main.focus({ preventScroll: true }); announce(`${view.label} carregado`); }
  } catch (error) {
    if (ticket !== rendering) return;
    main.replaceChildren(h("section", { class: "error", role: "alert" }, h("h1", null, "Não foi possível carregar"), h("p", null, error.message)));
  }
}

async function fillScope() {
  const clients = await api("/api/clients").then((d) => d.clients, () => []);
  const select = $("scope-client");
  select.replaceChildren(h("option", { value: "" }, "Todos"), ...clients.map((c) => h("option", { value: c.slug }, c.name ?? c.slug)));
  select.value = state.params.get("client") ?? "";
  const campaigns = clients.filter((c) => !select.value || c.slug === select.value).flatMap((c) => c.plans);
  const camp = $("scope-campaign");
  camp.replaceChildren(h("option", { value: "" }, "Todas"), ...campaigns.map((p) => h("option", { value: p }, p)));
  camp.value = state.params.get("campaign") ?? "";
  return clients;
}

// Live updates over Server-Sent Events; the browser reconnects with Last-Event-ID by itself.
let source = null;
let refreshTimer = 0;
function connect() {
  source?.close();
  const url = new URL("/api/events", location.origin);
  if (state.params.get("client")) url.searchParams.set("client", state.params.get("client"));
  if (state.params.get("campaign")) url.searchParams.set("campaign", state.params.get("campaign"));
  if (state.present) url.searchParams.set("present", "1");
  source = new EventSource(url);
  const conn = $("conn");
  const set = (stateName, text) => { conn.dataset.state = stateName; $("conn-text").textContent = text; };
  source.onopen = () => set("open", "Ao vivo");
  source.onerror = () => set("reconnecting", "Reconectando…");
  source.addEventListener("marketing", (message) => {
    const event = JSON.parse(message.data);
    window.dispatchEvent(new CustomEvent("marketing-event", { detail: event }));
    if (event.severity !== "info") announce(`${event.kind.replace("marketing.", "")}${event.piece_id ? ` em ${event.piece_id}` : ""}`);
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      const busy = document.activeElement && ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName);
      if (!busy && !$("drawer").open && !$("palette").open) render({ quiet: true });
    }, 600);
  });
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === "auto" ? "" : theme;
  $("theme-toggle").textContent = `Tema: ${theme === "auto" ? "auto" : theme === "dark" ? "escuro" : "claro"}`;
  store("sl-theme", theme);
}

function setupShell() {
  let theme = read("sl-theme") ?? "auto";
  applyTheme(theme);
  $("theme-toggle").addEventListener("click", () => { theme = theme === "auto" ? "dark" : theme === "dark" ? "light" : "auto"; applyTheme(theme); });
  const pt = $("present-toggle");
  pt.addEventListener("click", () => go(state.view, { present: state.present ? "" : "1" }));
  $("scope").addEventListener("change", () => go(state.view, { client: $("scope-client").value, campaign: $("scope-campaign").value }));
  $("drawer-close").addEventListener("click", () => $("drawer").close());
  $("drawer").addEventListener("click", (e) => { if (e.target === $("drawer")) $("drawer").close(); });

  const palette = $("palette");
  const input = $("palette-input");
  const results = $("palette-results");
  let corpus = [];
  async function open() {
    palette.showModal();
    input.value = "";
    const [clients, board] = await Promise.all([api("/api/clients").catch(() => ({ clients: [] })), api("/api/pipeline").catch(() => ({ cards: [] }))]);
    corpus = [
      ...VIEWS.map((v) => ({ label: `Seção: ${v.label}`, run: () => go(v.id) })),
      ...clients.clients.map((c) => ({ label: `Cliente: ${c.name ?? c.slug}`, run: () => go(state.view, { client: c.slug }) })),
      ...board.cards.slice(0, 500).map((c) => ({ label: `Peça: ${c.piece_id}`, run: () => openPiece(c.piece_id, { api }) })),
    ];
    list();
  }
  function list() {
    const q = input.value.trim().toLowerCase();
    const hits = corpus.filter((c) => !q || c.label.toLowerCase().includes(q)).slice(0, 12);
    results.replaceChildren(...hits.map((c, i) => h("li", { role: "option", "aria-selected": i === 0 ? "true" : "false", tabindex: "-1", onclick: () => { palette.close(); c.run(); } }, c.label)));
    results.dataset.hits = String(hits.length);
    results._hits = hits;
  }
  $("palette-open").addEventListener("click", open);
  input.addEventListener("input", list);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); const first = results._hits?.[0]; if (first) { palette.close(); first.run(); } }
  });
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); open(); }
  });
}

async function boot() {
  setupShell();
  window.addEventListener("hashchange", async () => { parseHash(); $("present-toggle").setAttribute("aria-pressed", String(state.present)); document.body.dataset.present = state.present ? "1" : "0"; await fillScope(); connect(); render(); });
  parseHash();
  $("present-toggle").setAttribute("aria-pressed", String(state.present));
  document.body.dataset.present = state.present ? "1" : "0";
  await fillScope();
  connect();
  await render();
  setInterval(() => { for (const n of document.querySelectorAll("[data-ago]")) n.textContent = fmtAgo(n.dataset.ago); }, 30_000);
}

boot();
