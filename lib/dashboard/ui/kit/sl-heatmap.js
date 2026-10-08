import { SlElement, define, esc, formatNumber, normState, toNumber } from "./base.js";

/**
 * Intensity grid (e.g. failures per gate per hour). Property/attribute `columns` (labels) and
 * `rows` ([{ label, values: [number|null] }]). Attributes: label, unit, state (colour), max.
 * Keyboard: the grid is one tab stop; arrows, Home/End and Ctrl+Home/End move between cells.
 */
export class SlHeatmap extends SlElement {
  static observedAttributes = ["columns", "rows", "label", "unit", "state", "max"];
  static jsonProps = ["columns", "rows"];
  static styles = `
:host { display: block; }
.wrap { overflow-x: auto; }
table { border-collapse: separate; border-spacing: 3px; }
caption { text-align: start; font-weight: var(--sl-weight-strong); padding-block-end: var(--sl-space-2); }
th { font-size: var(--sl-step--2); font-weight: var(--sl-weight-body); color: var(--sl-ink-muted); padding: 0 var(--sl-space-2); }
th[scope="row"] { text-align: end; white-space: nowrap; }
td { inline-size: 2.2em; block-size: 2.2em; min-inline-size: 2.2em; border-radius: var(--sl-radius-plate);
  background: color-mix(in srgb, var(--sl-c) var(--pct, 0%), var(--sl-panel));
  box-shadow: inset 0 0 0 1px var(--sl-line-soft); cursor: default; }
td.corner { background: none; box-shadow: none; }
td[data-empty] { background: repeating-linear-gradient(45deg, transparent 0 4px, var(--sl-line-soft) 4px 5px); }
td:focus-visible { outline-offset: 1px; }
.readout { margin: var(--sl-space-2) 0 0; min-block-size: 1.5em; font-size: var(--sl-step--1); color: var(--sl-ink-muted); }
.scale { display: flex; align-items: center; gap: var(--sl-space-2); font-size: var(--sl-step--2); color: var(--sl-ink-muted); margin-block-start: var(--sl-space-2); }
.scale i { inline-size: 6em; block-size: 0.7em; border-radius: var(--sl-radius-plate);
  background: linear-gradient(90deg, var(--sl-panel), var(--sl-c)); box-shadow: inset 0 0 0 1px var(--sl-line-soft); }
@media (forced-colors: active) { td { forced-color-adjust: none; } }
`;

  constructor() {
    super();
    this._active = [0, 0];
    this.shadowRoot.addEventListener("keydown", (e) => this._onKey(e));
    this.shadowRoot.addEventListener("focusin", (e) => this._onFocus(e));
    this.shadowRoot.addEventListener("click", (e) => e.target.closest?.("td")?.focus());
  }

  render() {
    const cols = Array.isArray(this.columns) ? this.columns : [];
    const rows = Array.isArray(this.rows) ? this.rows : [];
    const label = this.getAttribute("label") || "Mapa de calor";
    if (!rows.length || !cols.length) return `<p class="readout">Sem dados para o mapa de calor.</p>`;
    const unit = this.getAttribute("unit") || "";
    const all = rows.flatMap((r) => (r?.values || []).map((v) => toNumber(v, NaN))).filter(Number.isFinite);
    const max = toNumber(this.getAttribute("max"), Math.max(1, ...all));
    const state = normState(this.getAttribute("state"), "FAIL");
    const [ar, ac] = this._active;
    const body = rows.map((row, r) => `<tr><th scope="row">${esc(row?.label ?? "")}</th>${cols.map((col, c) => {
      const v = toNumber(row?.values?.[c], NaN);
      const has = Number.isFinite(v);
      const pct = has ? Math.round(Math.min(1, Math.max(0, v / max)) * 85 + (v > 0 ? 15 : 0)) : 0;
      const text = `${row?.label ?? ""}, ${col}: ${has ? formatNumber(v) + (unit ? " " + unit : "") : "sem dado"}`;
      return `<td tabindex="${r === ar && c === ac ? 0 : -1}" data-r="${r}" data-c="${c}" aria-label="${esc(text)}"${
        has ? ` data-css="--pct:${pct}%"` : " data-empty"}></td>`;
    }).join("")}</tr>`).join("");
    return `<div class="wrap" data-state="${state}"><table role="grid" aria-label="${esc(label)}"><caption>${esc(label)}</caption>
<thead><tr><td aria-hidden="true" class="corner"></td>${cols.map((c) => `<th scope="col">${esc(c)}</th>`).join("")}</tr></thead>
<tbody>${body}</tbody></table><div class="scale" aria-hidden="true">0<i></i>${esc(formatNumber(max))}${unit ? " " + esc(unit) : ""}</div>
<p class="readout" aria-live="polite"></p></div>`;
  }

  _onFocus(e) {
    const td = e.target.closest?.("td[data-r]");
    if (!td) return;
    this._active = [Number(td.dataset.r), Number(td.dataset.c)];
    for (const cell of this.shadowRoot.querySelectorAll("td[data-r]")) cell.tabIndex = cell === td ? 0 : -1;
    this.shadowRoot.querySelector(".readout").textContent = td.getAttribute("aria-label");
  }

  _onKey(e) {
    const td = e.target.closest?.("td[data-r]");
    if (!td) return;
    const rows = this.shadowRoot.querySelectorAll("tbody tr").length;
    const cols = this.shadowRoot.querySelectorAll("thead th").length;
    let r = Number(td.dataset.r), c = Number(td.dataset.c);
    const moves = {
      ArrowRight: () => (c = Math.min(cols - 1, c + 1)), ArrowLeft: () => (c = Math.max(0, c - 1)),
      ArrowDown: () => (r = Math.min(rows - 1, r + 1)), ArrowUp: () => (r = Math.max(0, r - 1)),
      Home: () => { c = 0; if (e.ctrlKey) r = 0; }, End: () => { c = cols - 1; if (e.ctrlKey) r = rows - 1; },
    };
    if (!moves[e.key]) return;
    e.preventDefault();
    moves[e.key]();
    this.shadowRoot.querySelector(`td[data-r="${r}"][data-c="${c}"]`)?.focus();
  }
}

define("sl-heatmap", SlHeatmap);
