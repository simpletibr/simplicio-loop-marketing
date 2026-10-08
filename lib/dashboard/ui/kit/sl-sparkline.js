import { SlElement, define, esc, formatNumber, normState, toNumber } from "./base.js";

/** Small trend line. Attributes: values ("4,7,5" or JSON array), label, unit, state. */
export class SlSparkline extends SlElement {
  static observedAttributes = ["values", "label", "unit", "state"];
  static styles = `
:host { display: inline-block; inline-size: var(--sl-sparkline-width, 8em); block-size: var(--sl-sparkline-height, 2em);
  vertical-align: middle; }
svg { display: block; inline-size: 100%; block-size: 100%; overflow: visible; }
.line { fill: none; stroke: var(--sl-c); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round;
  vector-effect: non-scaling-stroke; }
.area { fill: color-mix(in srgb, var(--sl-c) 16%, transparent); stroke: none; }
.last { fill: var(--sl-c); stroke: var(--sl-panel); stroke-width: 2; vector-effect: non-scaling-stroke; }
`;

  get values() {
    const raw = this.getAttribute("values") || "";
    const list = raw.trim().startsWith("[") ? (() => { try { return JSON.parse(raw); } catch { return []; } })() : raw.split(/[\s,;]+/);
    return list.map((v) => toNumber(v, NaN)).filter(Number.isFinite);
  }

  /** Human summary used as the accessible name. */
  get summary() {
    const v = this.values;
    const label = this.getAttribute("label") || "Tendência";
    const unit = this.getAttribute("unit") ? ` ${this.getAttribute("unit")}` : "";
    if (!v.length) return `${label}: sem dados`;
    const f = (n) => formatNumber(n) + unit;
    return `${label}: último ${f(v.at(-1))}, mínimo ${f(Math.min(...v))}, máximo ${f(Math.max(...v))}, ${v.length} pontos`;
  }

  render() {
    const v = this.values;
    const state = normState(this.getAttribute("state"), "RUNNING");
    const w = 100, h = 32, pad = 3;
    let body = "";
    if (v.length) {
      const min = Math.min(...v), max = Math.max(...v), span = max - min || 1;
      const pts = v.map((n, i) => [v.length === 1 ? w : (i / (v.length - 1)) * w, h - pad - ((n - min) / span) * (h - pad * 2)]);
      const line = pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
      const [lx, ly] = pts.at(-1);
      body = `<polygon class="area" points="0,${h} ${line} ${w},${h}"/><polyline class="line" points="${line}"/>` +
        `<circle class="last" cx="${lx.toFixed(2)}" cy="${ly.toFixed(2)}" r="2.6"/>`;
    }
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="${esc(this.summary)}" data-state="${state}">${body}</svg>`;
  }
}

define("sl-sparkline", SlSparkline);
