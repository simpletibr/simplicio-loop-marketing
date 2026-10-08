import { SlElement, STATES, define, esc, formatNumber, lamp, normState, toNumber } from "./base.js";

/**
 * Proportions ring with a readable legend. Property/attribute `segments`:
 * [{ label, value, state }]. Attributes: label (accessible name), center (text in the hole).
 */
export class SlDonut extends SlElement {
  static observedAttributes = ["segments", "label", "center"];
  static jsonProps = ["segments"];
  static styles = `
:host { display: block; }
figure { margin: 0; display: flex; flex-wrap: wrap; align-items: center; gap: var(--sl-space-5); }
.ring { position: relative; inline-size: var(--sl-donut-size, 9em); aspect-ratio: 1; flex: none; }
svg { inline-size: 100%; block-size: 100%; rotate: -90deg; }
circle { fill: none; stroke-width: 14; }
.bg { stroke: var(--sl-line-soft); }
.seg { stroke: var(--sl-c); }
.center { position: absolute; inset: 0; display: grid; place-content: center; text-align: center;
  font-size: var(--sl-step-2); font-weight: var(--sl-weight-strong); line-height: 1; }
.center small { display: block; font-size: var(--sl-step--2); color: var(--sl-ink-muted); font-weight: var(--sl-weight-body); margin-block-start: 0.3em; }
ul { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--sl-space-2); min-inline-size: 12em; }
li { display: grid; grid-template-columns: auto 1fr auto; gap: var(--sl-space-2); align-items: center; }
.lamp { --size: 1.2em; }
.val { font-weight: var(--sl-weight-strong); }
.val small { color: var(--sl-ink-muted); font-weight: var(--sl-weight-body); }
figcaption { inline-size: 100%; font-weight: var(--sl-weight-strong); }
`;

  render() {
    const segs = (Array.isArray(this.segments) ? this.segments : [])
      .map((s) => ({ label: s?.label ?? "", value: Math.max(0, toNumber(s?.value, 0)), state: normState(s?.state) }));
    const total = segs.reduce((a, s) => a + s.value, 0);
    const r = 40, c = 2 * Math.PI * r, gap = segs.filter((s) => s.value).length > 1 ? 1.5 : 0;
    let offset = 0;
    const arcs = segs.map((s) => {
      if (!total || !s.value) return "";
      const len = (s.value / total) * c;
      const arc = `<circle class="seg" data-state="${s.state}" r="${r}" cx="50" cy="50" stroke-dasharray="${Math.max(0, len - gap).toFixed(2)} ${c.toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}"/>`;
      offset += len;
      return arc;
    }).join("");
    const label = this.getAttribute("label") || "Distribuição";
    const summary = total
      ? `${label}: ` + segs.map((s) => `${s.label} ${formatNumber(s.value)} (${Math.round((s.value / total) * 100)}%)`).join(", ")
      : `${label}: sem dados`;
    const center = this.getAttribute("center") ?? (total ? formatNumber(total, { notation: "compact" }) : "0");
    const legend = segs.map((s) => `<li data-state="${s.state}">${lamp(s.state)}<span>${esc(s.label)}<span class="sr-only">, ${STATES[s.state]}</span></span>` +
      `<span class="val">${formatNumber(s.value)} <small>${total ? Math.round((s.value / total) * 100) : 0}%</small></span></li>`).join("");
    return `<figure><figcaption>${esc(label)}</figcaption><div class="ring"><svg viewBox="0 0 100 100" role="img" aria-label="${esc(summary)}">` +
      `<circle class="bg" r="${r}" cx="50" cy="50"/>${arcs}</svg><span class="center" aria-hidden="true">${esc(center)}<small>total</small></span></div>` +
      `<ul>${legend}</ul></figure>`;
  }
}

define("sl-donut", SlDonut);
