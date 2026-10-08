// Simplicio Live: shared base for every <sl-*> element.
// Native Custom Elements + Shadow DOM, ES modules, no dependencies and no build step.

/** Run/gate states of the dashboard contract, plus PENDING for work that has not started. */
export const STATES = Object.freeze({
  RUNNING: "Em execução",
  PASS: "Aprovado",
  FAIL: "Falhou",
  UNVERIFIED: "Não verificado",
  ESTIMADO: "Estimado",
  STALLED: "Parado",
  BLOCKED: "Bloqueado",
  PENDING: "Aguardando",
});

/** Normalise any state-ish value to a known state key. */
export function normState(value, fallback = "PENDING") {
  const key = String(value ?? "").trim().toUpperCase();
  return Object.hasOwn(STATES, key) ? key : fallback;
}

// Every state has its own shape so colour is never the only signal (WCAG 1.4.1).
const SHAPES = {
  RUNNING: '<path d="M6 4.2v7.6l6.2-3.8z" fill="currentColor"/>',
  PASS: '<path d="M3.8 8.4l2.7 2.7 5.7-5.9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  FAIL: '<path d="M4.8 4.8l6.4 6.4m0-6.4-6.4 6.4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  UNVERIFIED: '<path d="M8 3.2 12.8 8 8 12.8 3.2 8z" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  ESTIMADO: '<path d="M8 3.2 12.8 8 8 12.8 3.2 8z" fill="currentColor" fill-opacity="0.35" stroke="currentColor" stroke-width="1.8"/>',
  STALLED: '<path d="M5.6 4.4v7.2m4.8-7.2v7.2" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  BLOCKED: '<circle cx="8" cy="8" r="4.7" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m4.7 11.3 6.6-6.6" stroke="currentColor" stroke-width="1.8"/>',
  PENDING: '<circle cx="8" cy="8" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/>',
};

/** Inline SVG glyph for a state (decorative: pair it with the state label). */
export function stateIcon(state) {
  return `<svg class="icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">${SHAPES[normState(state)]}</svg>`;
}

/** A lit lamp: coloured disc + state shape. */
export function lamp(state, extraClass = "") {
  const key = normState(state);
  return `<span class="lamp ${extraClass}" data-state="${key}">${stateIcon(key)}</span>`;
}

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
/** Escape text for HTML text and attribute positions. */
export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** Allow only http(s) and relative links; anything else (javascript:, data:) becomes "". */
export function safeHref(value) {
  const href = String(value ?? "").trim();
  if (!href) return "";
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href);
  return !scheme || /^https?$/i.test(scheme[1]) ? href : "";
}

/** Parse a JSON attribute; invalid JSON yields the fallback instead of throwing. */
export function parseJSON(text, fallback) {
  if (text == null || text === "") return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export function toNumber(value, fallback = 0) {
  const n = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

export function formatNumber(value, options = {}, locale = "pt-BR") {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 1, ...options }).format(value);
}

/** Shared shadow-DOM styles: lamps, focus ring, screen-reader text. */
export const BASE_CSS = `
:host { box-sizing: border-box; color: var(--sl-ink); font-family: var(--sl-font-sans);
  font-weight: var(--sl-weight-body); line-height: var(--sl-leading); font-variant-numeric: tabular-nums; }
:host([hidden]) { display: none !important; }
*, *::before, *::after { box-sizing: inherit; }
[data-state="RUNNING"] { --sl-c: var(--sl-state-running); }
[data-state="PASS"] { --sl-c: var(--sl-state-pass); }
[data-state="FAIL"] { --sl-c: var(--sl-state-fail); }
[data-state="UNVERIFIED"] { --sl-c: var(--sl-state-unverified); }
[data-state="ESTIMADO"] { --sl-c: var(--sl-state-estimated); }
[data-state="STALLED"] { --sl-c: var(--sl-state-stalled); }
[data-state="BLOCKED"] { --sl-c: var(--sl-state-blocked); }
[data-state="PENDING"] { --sl-c: var(--sl-state-pending); }
.icon { width: 1em; height: 1em; flex: none; display: block; }
.lamp { --size: var(--sl-lamp); display: inline-grid; place-items: center; flex: none;
  inline-size: var(--size); block-size: var(--size); border-radius: 50%;
  background: var(--sl-c); color: var(--sl-on-lamp); font-size: calc(var(--size) * 0.62);
  box-shadow: 0 0 0 2px var(--sl-panel), 0 0 0 3px color-mix(in srgb, var(--sl-c) 55%, transparent); }
.lamp .icon { inline-size: 1em; block-size: 1em; }
.lamp[data-state="PENDING"] { background: var(--sl-panel); color: var(--sl-c);
  box-shadow: inset 0 0 0 2px var(--sl-c); }
.lamp[data-state="BLOCKED"] { background: repeating-linear-gradient(135deg, var(--sl-c) 0 4px,
  color-mix(in srgb, var(--sl-c) 70%, var(--sl-panel)) 4px 7px); }
@media (prefers-reduced-motion: no-preference) {
  .lamp[data-state="RUNNING"].live { animation: sl-pulse var(--sl-dur-pulse) var(--sl-ease) infinite; }
}
@keyframes sl-pulse {
  0%, 100% { box-shadow: 0 0 0 2px var(--sl-panel), 0 0 0 3px color-mix(in srgb, var(--sl-c) 60%, transparent); }
  50% { box-shadow: 0 0 0 2px var(--sl-panel), 0 0 0 9px color-mix(in srgb, var(--sl-c) 0%, transparent); }
}
.state-text { color: var(--sl-c); font-weight: var(--sl-weight-strong); }
[data-state="PENDING"] .state-text, .state-text[data-state="PENDING"] { color: var(--sl-ink-muted); }
.sr-only { position: absolute; inline-size: 1px; block-size: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
:focus-visible { outline: var(--sl-focus-width) solid var(--sl-focus); outline-offset: 2px; }
button { font: inherit; color: inherit; }
@media (forced-colors: active) {
  .lamp { forced-color-adjust: none; border: 2px solid CanvasText; background: Canvas; color: CanvasText; box-shadow: none; }
}
`;

/**
 * Apply `data-css="--a:1;--b:2"` custom properties through the CSSOM, so rendering never
 * needs inline style attributes (keeps the kit usable under a strict style-src CSP).
 */
export function applyCssVars(root) {
  for (const el of root.querySelectorAll("[data-css]")) {
    for (const pair of el.dataset.css.split(";")) {
      const at = pair.indexOf(":");
      if (at > 0) el.style.setProperty(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
    }
    el.removeAttribute("data-css");
  }
}

const sheets = new Map();
function sheetFor(css) {
  let sheet = sheets.get(css);
  if (!sheet) {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    sheets.set(css, sheet);
  }
  return sheet;
}

/**
 * Base element: open shadow root with adopted (shared, parsed once) styles, JSON-capable
 * properties declared in `static jsonProps`, and a render() -> HTML string contract.
 */
export class SlElement extends HTMLElement {
  static styles = "";
  static jsonProps = [];

  constructor() {
    super();
    this._props = new Map();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.adoptedStyleSheets = [sheetFor(BASE_CSS), sheetFor(this.constructor.styles)];
  }

  connectedCallback() {
    // Properties assigned before the element upgraded shadow the accessors: re-apply them.
    for (const name of this.constructor.jsonProps) {
      if (Object.hasOwn(this, name)) {
        const value = this[name];
        delete this[name];
        this._props.set(name, value);
      }
    }
    this.update();
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue !== newValue && this.isConnected) this.update();
  }

  /** Re-render; components with live inner state override update() to patch instead. */
  update() {
    this.shadowRoot.innerHTML = this.render();
    applyCssVars(this.shadowRoot);
  }

  render() {
    return "";
  }

  /** Read a JSON property: the JS property wins, then the same-named attribute. */
  prop(name, fallback) {
    if (this._props.has(name)) return this._props.get(name) ?? fallback;
    return parseJSON(this.getAttribute(name), fallback);
  }

  emit(type, detail) {
    return this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true, cancelable: true }));
  }
}

/** Register a component once, wiring its JSON properties to accessors. */
export function define(tag, cls) {
  for (const name of cls.jsonProps) {
    Object.defineProperty(cls.prototype, name, {
      configurable: true,
      get() {
        return this.prop(name);
      },
      set(value) {
        this._props.set(name, value);
        if (this.isConnected) this.update();
      },
    });
  }
  if (!customElements.get(tag)) customElements.define(tag, cls);
  return cls;
}
