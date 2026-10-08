import { SlElement, STATES, define, esc, normState } from "./base.js";

const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDay = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s ?? ""));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};

/**
 * Month grid of scheduled items (used by the marketing distribution panel). Property/attribute
 * `events`: [{ date: "YYYY-MM-DD", title, state, channel }]. Attributes: month ("YYYY-MM"),
 * selected, today, locale (default pt-BR), week-start (0 Sunday, 1 Monday), label.
 * Keyboard (WAI-ARIA date grid): arrows, Home/End, PageUp/PageDown (month), Enter/Space selects
 * and fires `sl-select` with { date, events }.
 */
export class SlCalendar extends SlElement {
  static observedAttributes = ["events", "month", "selected", "today", "locale", "week-start", "label"];
  static jsonProps = ["events"];
  static styles = `
:host { display: block; }
.cal { background: var(--sl-panel); border-radius: var(--sl-radius-panel); padding: var(--sl-space-4);
  box-shadow: var(--sl-shadow), inset 0 0 0 1px var(--sl-line-soft); }
.head { display: flex; align-items: center; gap: var(--sl-space-3); margin-block-end: var(--sl-space-3); }
.month { margin: 0 auto 0 0; font-size: var(--sl-step-2); font-weight: var(--sl-weight-strong); }
.nav { inline-size: 2.5em; block-size: 2.5em; border: 1px solid var(--sl-line); border-radius: var(--sl-radius-plate);
  background: var(--sl-raised); cursor: pointer; display: grid; place-items: center; }
.nav svg { inline-size: 1em; block-size: 1em; }
table { inline-size: 100%; border-collapse: separate; border-spacing: 4px; table-layout: fixed; }
th { font-size: var(--sl-step--2); font-weight: var(--sl-weight-body); color: var(--sl-ink-muted); padding-block-end: var(--sl-space-1); }
th abbr { text-decoration: none; }
td { vertical-align: top; block-size: 6.5em; padding: var(--sl-space-1) var(--sl-space-2); border-radius: var(--sl-radius-plate);
  background: var(--sl-raised); box-shadow: inset 0 0 0 1px var(--sl-line-soft); cursor: pointer; overflow: hidden; }
td[data-out] { background: transparent; color: var(--sl-ink-muted); }
td[aria-selected="true"] { box-shadow: inset 0 0 0 2px var(--sl-ink); }
td[data-today] .num { background: var(--sl-ink); color: var(--sl-panel); }
.num { display: inline-grid; place-items: center; min-inline-size: 1.8em; block-size: 1.8em; border-radius: 50%;
  font-weight: var(--sl-weight-strong); font-size: var(--sl-step--1); }
ul { list-style: none; margin: var(--sl-space-1) 0 0; padding: 0; display: grid; gap: 2px; }
li { display: flex; align-items: center; gap: 0.35em; font-size: var(--sl-step--2); line-height: 1.25; min-inline-size: 0; }
li span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chip { inline-size: 0.7em; block-size: 0.7em; border-radius: 50%; background: var(--sl-c); flex: none; }
.chip[data-state="PENDING"] { background: transparent; box-shadow: inset 0 0 0 2px var(--sl-c); }
.chip[data-state="UNVERIFIED"] { border-radius: 1px; rotate: 45deg; }
.chip[data-state="FAIL"], .chip[data-state="BLOCKED"] { border-radius: 1px; }
.more { color: var(--sl-ink-muted); }
@container (max-width: 34rem) { td { block-size: 3.2em; } ul li span:last-child { display: none; } }
:host { container-type: inline-size; }
`;

  constructor() {
    super();
    this.shadowRoot.addEventListener("click", (e) => {
      const nav = e.target.closest?.(".nav");
      if (nav) return this._shiftMonth(Number(nav.dataset.step));
      const td = e.target.closest?.("td[data-date]");
      if (td) this._select(td.dataset.date, true);
    });
    this.shadowRoot.addEventListener("keydown", (e) => this._onKey(e));
  }

  get locale() {
    return this.getAttribute("locale") || "pt-BR";
  }

  get viewMonth() {
    const m = /^(\d{4})-(\d{2})/.exec(this.getAttribute("month") || "");
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, 1);
    const base = parseDay(this.getAttribute("selected")) || parseDay(this.getAttribute("today")) || new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  }

  eventsOn(day) {
    const list = Array.isArray(this.events) ? this.events : [];
    return list.filter((ev) => String(ev?.date ?? "").slice(0, 10) === day);
  }

  render() {
    const view = this.viewMonth;
    const loc = this.locale;
    const weekStart = this.getAttribute("week-start") === "1" ? 1 : 0;
    const today = this.getAttribute("today") || iso(new Date());
    const selected = this.getAttribute("selected");
    const focusDay = this._focusDay && this._focusDay.startsWith(iso(view).slice(0, 7)) ? this._focusDay
      : selected && selected.startsWith(iso(view).slice(0, 7)) ? selected
      : today.startsWith(iso(view).slice(0, 7)) ? today : iso(view);
    const rawTitle = new Intl.DateTimeFormat(loc, { month: "long", year: "numeric" }).format(view);
    const title = rawTitle.charAt(0).toLocaleUpperCase(loc) + rawTitle.slice(1);
    const long = new Intl.DateTimeFormat(loc, { weekday: "long" });
    const short = new Intl.DateTimeFormat(loc, { weekday: "short" });
    const dayLabel = new Intl.DateTimeFormat(loc, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    const start = new Date(view);
    start.setDate(1 - ((view.getDay() - weekStart + 7) % 7));
    const heads = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start); d.setDate(start.getDate() + i);
      return `<th scope="col"><abbr title="${esc(long.format(d))}">${esc(short.format(d).replace(".", ""))}</abbr></th>`;
    }).join("");
    let rows = "";
    const cur = new Date(start);
    for (let w = 0; w < 6; w++) {
      rows += "<tr>";
      for (let i = 0; i < 7; i++) {
        const day = iso(cur);
        const evs = this.eventsOn(day);
        const out = cur.getMonth() !== view.getMonth();
        const items = evs.slice(0, 3).map((ev) => {
          const st = normState(ev?.state);
          return `<li><span class="chip" data-state="${st}" aria-hidden="true"></span><span>${esc(ev?.title ?? "")}</span></li>`;
        }).join("") + (evs.length > 3 ? `<li class="more">+${evs.length - 3} mais</li>` : "");
        const spoken = evs.map((ev) => `${ev?.title ?? ""}${ev?.channel ? ` (${ev.channel})` : ""}: ${STATES[normState(ev?.state)]}`).join("; ");
        rows += `<td role="gridcell" data-date="${day}" tabindex="${day === focusDay ? 0 : -1}" aria-selected="${day === selected}"${out ? " data-out" : ""}${day === today ? ' data-today aria-current="date"' : ""}>` +
          `<span class="num" aria-hidden="true">${cur.getDate()}</span>` +
          `<span class="sr-only">${esc(dayLabel.format(cur))}${evs.length ? `, ${evs.length} ${evs.length === 1 ? "item" : "itens"}: ${esc(spoken)}` : ""}</span>` +
          `${items ? `<ul aria-hidden="true">${items}</ul>` : ""}</td>`;
        cur.setDate(cur.getDate() + 1);
      }
      rows += "</tr>";
    }
    const label = this.getAttribute("label") || "Calendário";
    const arrow = (d) => `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    return `<div class="cal"><div class="head"><p class="month" aria-live="polite">${esc(title)}</p>
<button class="nav" type="button" data-step="-1" aria-label="Mês anterior">${arrow("M10 3 5 8l5 5")}</button>
<button class="nav" type="button" data-step="1" aria-label="Próximo mês">${arrow("m6 3 5 5-5 5")}</button></div>
<table role="grid" aria-label="${esc(label)}: ${esc(title)}"><thead><tr>${heads}</tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  _shiftMonth(step) {
    const view = this.viewMonth;
    this._focusDay = null;
    this.setAttribute("month", iso(new Date(view.getFullYear(), view.getMonth() + step, 1)).slice(0, 7));
    this.shadowRoot.querySelector(`.nav[data-step="${step}"]`)?.focus();
  }

  _select(day, focus) {
    this.setAttribute("selected", day);
    this._focusDay = day;
    if (!day.startsWith(this.getAttribute("month") || iso(this.viewMonth).slice(0, 7))) this.setAttribute("month", day.slice(0, 7));
    this.update();
    if (focus) this.shadowRoot.querySelector(`td[data-date="${day}"]`)?.focus();
    this.emit("sl-select", { date: day, events: this.eventsOn(day) });
  }

  _onKey(e) {
    const td = e.target.closest?.("td[data-date]");
    if (!td) return;
    const d = parseDay(td.dataset.date);
    const weekStart = this.getAttribute("week-start") === "1" ? 1 : 0;
    const offset = (d.getDay() - weekStart + 7) % 7;
    const steps = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -offset, End: 6 - offset };
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      return this._select(td.dataset.date, true);
    }
    if (e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      const t = new Date(d.getFullYear(), d.getMonth() + (e.key === "PageUp" ? -1 : 1), 1);
      const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
      t.setDate(Math.min(d.getDate(), last));
      return this._moveTo(t);
    }
    if (!(e.key in steps)) return;
    e.preventDefault();
    const t = new Date(d); t.setDate(d.getDate() + steps[e.key]);
    this._moveTo(t);
  }

  _moveTo(date) {
    const day = iso(date);
    const cell = this.shadowRoot.querySelector(`td[data-date="${day}"]:not([data-out])`);
    if (cell) {
      for (const c of this.shadowRoot.querySelectorAll('td[tabindex="0"]')) c.tabIndex = -1;
      cell.tabIndex = 0;
      this._focusDay = day;
      cell.focus();
      return;
    }
    this._focusDay = day;
    this.setAttribute("month", day.slice(0, 7));
    this.shadowRoot.querySelector(`td[data-date="${day}"]`)?.focus();
  }
}

define("sl-calendar", SlCalendar);
