import { SlElement, STATES, define, esc, lamp, normState, safeHref, toNumber } from "./base.js";

const URGENT = new Set(["FAIL", "BLOCKED", "STALLED"]);

/**
 * Alert (stall, failing gate, expired lease, budget). The message is the element's content.
 * Attributes: state, heading, href + link-label (evidence), timeout (ms; 0 = stays, default),
 * persistent (no dismiss button). Escape or the dismiss button closes it and fires `sl-dismiss`.
 * Auto-dismiss pauses while the toast is hovered or focused (WCAG 2.2.1).
 */
export class SlAlertToast extends SlElement {
  static observedAttributes = ["state", "heading", "href", "link-label", "timeout", "persistent"];
  static styles = `
:host { display: block; max-inline-size: 34em; }
.toast { display: grid; grid-template-columns: auto 1fr auto; gap: var(--sl-space-1) var(--sl-space-3); align-items: start;
  padding: var(--sl-space-3) var(--sl-space-3) var(--sl-space-3) var(--sl-space-4); background: var(--sl-raised);
  border-radius: var(--sl-radius-plate); border-inline-start: 6px solid var(--sl-c);
  box-shadow: var(--sl-shadow), inset 0 0 0 1px var(--sl-line-soft), 0 10px 24px -12px rgb(0 0 0 / 0.45); }
.lamp { --size: 1.6em; grid-row: span 2; margin-block-start: 0.1em; }
.title { margin: 0; font-weight: var(--sl-weight-strong); line-height: var(--sl-leading-tight); padding-block-start: 0.25em; }
.title .state-text { font-size: var(--sl-step--1); margin-inline-start: var(--sl-space-2); }
.msg { grid-column: 2; font-size: var(--sl-step--1); color: var(--sl-ink); }
.msg a { color: inherit; font-weight: var(--sl-weight-strong); }
.close { grid-row: 1; grid-column: 3; border: 0; background: transparent; border-radius: var(--sl-radius-plate);
  inline-size: 2.25em; block-size: 2.25em; cursor: pointer; display: grid; place-items: center; color: var(--sl-ink-muted); }
.close:hover { color: var(--sl-ink); background: color-mix(in srgb, var(--sl-ink) 10%, transparent); }
.close svg { inline-size: 1em; block-size: 1em; }
@media (prefers-reduced-motion: no-preference) {
  :host { animation: enter var(--sl-dur-base) var(--sl-ease); }
}
@keyframes enter { from { opacity: 0; translate: 0 0.5em; } }
`;

  /** Create a toast inside `region` (default: a fixed stack appended to the page). */
  static notify({ state = "RUNNING", heading = "", message = "", href = "", linkLabel = "", timeout = 0 } = {}, region) {
    let host = region;
    if (!host) {
      host = document.querySelector("[data-sl-toasts]");
      if (!host) {
        host = document.createElement("div");
        host.dataset.slToasts = "";
        document.body.append(host);
      }
    }
    const toast = document.createElement("sl-alert-toast");
    toast.setAttribute("state", state);
    toast.setAttribute("heading", heading);
    if (href) toast.setAttribute("href", href);
    if (linkLabel) toast.setAttribute("link-label", linkLabel);
    if (timeout) toast.setAttribute("timeout", String(timeout));
    toast.textContent = message;
    host.append(toast);
    return toast;
  }

  constructor() {
    super();
    this._paused = false;
    const pause = (v) => () => { this._paused = v; if (!v) this._arm(); };
    this.addEventListener("pointerenter", pause(true));
    this.addEventListener("pointerleave", pause(false));
    this.addEventListener("focusin", pause(true));
    this.addEventListener("focusout", pause(false));
    this.addEventListener("keydown", (e) => { if (e.key === "Escape" && !this.hasAttribute("persistent")) { e.stopPropagation(); this.dismiss(); } });
    this.shadowRoot.addEventListener("click", (e) => { if (e.target.closest(".close")) this.dismiss(); });
  }

  connectedCallback() {
    const state = normState(this.getAttribute("state"), "RUNNING");
    if (!this.hasAttribute("role")) this.setAttribute("role", URGENT.has(state) ? "alert" : "status");
    super.connectedCallback();
    this._arm();
  }

  disconnectedCallback() {
    clearTimeout(this._timer);
  }

  _arm() {
    clearTimeout(this._timer);
    const ms = toNumber(this.getAttribute("timeout"), 0);
    if (ms > 0 && !this._paused) this._timer = setTimeout(() => this.dismiss(), ms);
  }

  /** Close the toast; cancelable through the `sl-dismiss` event. */
  dismiss() {
    if (!this.emit("sl-dismiss", { state: this.getAttribute("state") })) return;
    clearTimeout(this._timer);
    this.hidden = true;
    this.remove();
  }

  render() {
    const state = normState(this.getAttribute("state"), "RUNNING");
    const href = safeHref(this.getAttribute("href"));
    const heading = this.getAttribute("heading") || STATES[state];
    const close = this.hasAttribute("persistent") ? "" :
      `<button class="close" type="button" aria-label="Dispensar alerta: ${esc(heading)}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8m0-8-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>`;
    return `<div class="toast" data-state="${state}">${lamp(state, state === "RUNNING" ? "live" : "")}
<p class="title">${esc(heading)}<span class="state-text">${STATES[state]}</span></p>${close}
<div class="msg"><slot></slot>${href ? ` <a href="${esc(href)}">${esc(this.getAttribute("link-label") || "Ver evidência")}</a>` : ""}</div></div>`;
  }
}

define("sl-alert-toast", SlAlertToast);
