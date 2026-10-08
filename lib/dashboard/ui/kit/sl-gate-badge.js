import { SlElement, STATES, define, esc, lamp, normState, safeHref } from "./base.js";

/**
 * One gate (evidence, watcher, oracle, DoD, quality-gate) and its honest state.
 * Attributes: gate, state, reason, href (link to the evidence).
 */
export class SlGateBadge extends SlElement {
  static observedAttributes = ["gate", "state", "reason", "href"];
  static styles = `
:host { display: inline-block; font-size: var(--sl-step--1); }
.plate { display: inline-grid; grid-template-columns: auto 1fr; column-gap: var(--sl-space-2); align-items: center;
  padding: var(--sl-space-1) var(--sl-space-3) var(--sl-space-1) var(--sl-space-1);
  border-radius: var(--sl-radius-pill); background: var(--sl-raised); color: var(--sl-ink);
  box-shadow: var(--sl-shadow), inset 0 0 0 1px var(--sl-line-soft); text-decoration: none; max-inline-size: 32em; }
.lamp { --size: 1.6em; grid-row: span 2; }
.gate { font-weight: var(--sl-weight-strong); }
.state-text { font-size: var(--sl-step--1); }
.line { display: flex; gap: var(--sl-space-2); align-items: baseline; flex-wrap: wrap; }
.reason { grid-column: 2; color: var(--sl-ink-muted); font-size: var(--sl-step--2); line-height: var(--sl-leading-tight);
  padding-block-end: 2px; }
a.plate:hover { box-shadow: var(--sl-shadow), inset 0 0 0 2px var(--sl-c); }
a.plate .gate { text-decoration: underline; text-underline-offset: 0.18em; text-decoration-thickness: 1px; }
`;

  render() {
    const state = normState(this.getAttribute("state"));
    const gate = this.getAttribute("gate") || "gate";
    const reason = this.getAttribute("reason");
    const href = safeHref(this.getAttribute("href"));
    const tag = href ? "a" : "span";
    const attrs = href ? ` href="${esc(href)}"` : "";
    return `<${tag} class="plate" part="plate" data-state="${state}"${attrs}>${lamp(state, state === "RUNNING" ? "live" : "")}
<span class="line"><span class="gate">${esc(gate)}</span><span class="state-text">${STATES[state]}</span></span>${
      reason ? `<span class="reason">${esc(reason)}</span>` : ""}</${tag}>`;
  }
}

define("sl-gate-badge", SlGateBadge);
