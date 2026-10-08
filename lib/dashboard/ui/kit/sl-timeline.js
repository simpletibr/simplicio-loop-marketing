import { SlElement, STATES, define, esc, lamp, normState } from "./base.js";

/**
 * Ordered iterations/events. Property/attribute `items`:
 * [{ time, title, state, detail }] oldest first. Attribute `label` names the list.
 */
export class SlTimeline extends SlElement {
  static observedAttributes = ["items", "label"];
  static jsonProps = ["items"];
  static styles = `
:host { display: block; }
ol { list-style: none; margin: 0; padding: 0; counter-reset: step; }
li { display: grid; grid-template-columns: 5.5em auto 1fr; column-gap: var(--sl-space-3); position: relative;
  padding-block-end: var(--sl-space-4); counter-increment: step; }
li::before { content: ""; position: absolute; inset-block: 1.9em 0; left: calc(5.5em + var(--sl-space-3) + 0.85em - 2px);
  inline-size: 4px; background: var(--sl-line-soft); }
li:last-child::before { display: none; }
li[data-state="PASS"]::before { background: color-mix(in srgb, var(--sl-state-pass) 55%, transparent); }
time { color: var(--sl-ink-muted); font-size: var(--sl-step--1); text-align: end; padding-block-start: 0.15em; }
.lamp { --size: 1.7em; }
.body { min-inline-size: 0; }
.title { margin: 0; font-weight: var(--sl-weight-strong); line-height: var(--sl-leading-tight); padding-block-start: 0.15em; }
.title::before { content: counter(step) ". "; color: var(--sl-ink-muted); font-weight: var(--sl-weight-body); }
.state-text { font-size: var(--sl-step--1); }
.detail { margin: var(--sl-space-1) 0 0; color: var(--sl-ink-muted); font-size: var(--sl-step--1); max-inline-size: 70ch; }
.empty { color: var(--sl-ink-muted); margin: 0; }
`;

  render() {
    const items = Array.isArray(this.items) ? this.items : [];
    const label = esc(this.getAttribute("label") || "Linha do tempo");
    if (!items.length) return `<p class="empty">Nenhuma iteração registrada ainda.</p>`;
    return `<ol aria-label="${label}">${items.map((it) => {
      const state = normState(it?.state);
      return `<li data-state="${state}"><time>${esc(it?.time ?? "")}</time>${lamp(state, state === "RUNNING" ? "live" : "")}
<div class="body"><p class="title">${esc(it?.title ?? "")}</p><span class="state-text">${STATES[state]}</span>${
        it?.detail ? `<p class="detail">${esc(it.detail)}</p>` : ""}</div></li>`;
    }).join("")}</ol>`;
  }
}

define("sl-timeline", SlTimeline);
