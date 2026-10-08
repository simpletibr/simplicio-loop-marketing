import { SlElement, define, esc } from "./base.js";

const STATUS = {
  live: { state: "PASS", label: "Ao vivo" },
  connecting: { state: "RUNNING", label: "Conectando" },
  stale: { state: "UNVERIFIED", label: "Sem eventos recentes" },
  offline: { state: "FAIL", label: "Desconectado" },
};

/** Live-stream (SSE) connection indicator. Attributes: status, label, detail. */
export class SlConnectionDot extends SlElement {
  static observedAttributes = ["status", "label", "detail"];
  static styles = `
:host { display: inline-flex; align-items: center; gap: var(--sl-space-2); font-size: var(--sl-step--1); }
.dot { inline-size: 0.8em; block-size: 0.8em; border-radius: 50%; background: var(--sl-c); flex: none;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--sl-c) 25%, transparent); }
.dot[data-state="FAIL"] { background: transparent; box-shadow: inset 0 0 0 2px var(--sl-c); }
.detail { color: var(--sl-ink-muted); }
@media (prefers-reduced-motion: no-preference) {
  .dot[data-state="RUNNING"] { animation: blink var(--sl-dur-pulse) steps(2, jump-none) infinite; }
}
@keyframes blink { 50% { opacity: 0.35; } }
@media (forced-colors: active) { .dot { forced-color-adjust: none; background: CanvasText; } }
`;

  connectedCallback() {
    if (!this.hasAttribute("role")) this.setAttribute("role", "status");
    super.connectedCallback();
  }

  get status() {
    const value = this.getAttribute("status");
    return Object.hasOwn(STATUS, value) ? value : "connecting";
  }

  render() {
    const meta = STATUS[this.status];
    const detail = this.getAttribute("detail");
    return `<span class="dot" data-state="${meta.state}" aria-hidden="true"></span>
<span class="label">${esc(this.getAttribute("label") || meta.label)}</span>${
      detail ? `<span class="detail">${esc(detail)}</span>` : ""}`;
  }
}

define("sl-connection-dot", SlConnectionDot);
