import { SlElement, STATES, define, esc, normState } from "./base.js";
import "./sl-sparkline.js";

/**
 * One measured number. Attributes: label, value, unit, delta (e.g. "-12%"), good ("up" | "down":
 * which direction is an improvement, default "up"), state, trend (sparkline values), detail.
 */
export class SlKpiCard extends SlElement {
  static observedAttributes = ["label", "value", "unit", "delta", "good", "state", "trend", "detail"];
  static styles = `
:host { display: block; container-type: inline-size; }
.plate { display: grid; gap: var(--sl-space-2); padding: var(--sl-space-4) var(--sl-space-4) var(--sl-space-4) var(--sl-space-5);
  background: var(--sl-panel); border-radius: var(--sl-radius-plate); position: relative; overflow: hidden;
  box-shadow: var(--sl-shadow), inset 0 0 0 1px var(--sl-line-soft); }
.plate::before { content: ""; position: absolute; inset-block: 0; inset-inline-start: 0; inline-size: 6px; background: var(--sl-c); }
.plate[data-state="PENDING"]::before { background: var(--sl-line-soft); }
.label { margin: 0; font-size: var(--sl-step--1); font-weight: var(--sl-weight-body); color: var(--sl-ink-muted); }
.value { margin: 0; white-space: nowrap; font-size: clamp(var(--sl-step-3), 17cqi, var(--sl-step-5)); font-weight: var(--sl-weight-strong); line-height: 1; letter-spacing: -0.01em; }
.value small { font-size: 0.4em; font-weight: var(--sl-weight-body); color: var(--sl-ink-muted); margin-inline-start: 0.2em; letter-spacing: 0; }
.row { display: flex; align-items: center; gap: var(--sl-space-3); flex-wrap: wrap; }
.delta { font-weight: var(--sl-weight-strong); font-size: var(--sl-step--1); }
.delta.good { color: var(--sl-state-pass); }
.delta.bad { color: var(--sl-state-fail); }
.delta.flat { color: var(--sl-ink-muted); }
.state-text { font-size: var(--sl-step--1); }
.detail { margin: 0; font-size: var(--sl-step--1); color: var(--sl-ink-muted); }
sl-sparkline { --sl-sparkline-width: 7em; margin-inline-start: auto; }
`;

  render() {
    const state = normState(this.getAttribute("state"));
    const delta = (this.getAttribute("delta") || "").trim();
    const goodUp = (this.getAttribute("good") || "up") !== "down";
    const sign = /^[-−]/.test(delta) ? -1 : /^\+?0([.,]0*)?%?$/.test(delta) ? 0 : delta ? 1 : 0;
    const cls = sign === 0 ? "flat" : (sign > 0) === goodUp ? "good" : "bad";
    const arrow = sign > 0 ? "↑" : sign < 0 ? "↓" : "";
    const meaning = sign === 0 ? "sem variação" : cls === "good" ? "melhorou" : "piorou";
    const label = this.getAttribute("label") || "";
    const trend = this.getAttribute("trend");
    return `<article class="plate" data-state="${state}" aria-label="${esc(label)}"><p class="label">${esc(label)}</p>
<p class="value">${esc(this.getAttribute("value") ?? "–")}${this.getAttribute("unit") ? `<small>${esc(this.getAttribute("unit"))}</small>` : ""}</p>
<div class="row">${delta ? `<span class="delta ${cls}"><span aria-hidden="true">${arrow} </span>${esc(delta.replace(/^[+\-−]/, ""))}<span class="sr-only"> (${meaning})</span></span>` : ""}${
      state !== "PENDING" ? `<span class="state-text" data-state="${state}">${STATES[state]}</span>` : ""}${
      trend ? `<sl-sparkline values="${esc(trend)}" state="${state === "PENDING" ? "RUNNING" : state}" label="${esc(label)}"></sl-sparkline>` : ""}</div>${
      this.getAttribute("detail") ? `<p class="detail">${esc(this.getAttribute("detail"))}</p>` : ""}</article>`;
  }
}

define("sl-kpi-card", SlKpiCard);
