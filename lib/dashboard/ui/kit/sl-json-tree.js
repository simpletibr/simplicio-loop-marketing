import { SlElement, define, esc, toNumber } from "./base.js";

const isBranch = (v) => v !== null && typeof v === "object";

function preview(value) {
  if (Array.isArray(value)) return `[${value.length}]`;
  if (isBranch(value)) return `{${Object.keys(value).length}}`;
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

function typeOf(value) {
  return value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
}

/**
 * Collapsible JSON (receipts, contracts) as an ARIA tree. Property/attribute `data`.
 * Attributes: label, expand-depth (levels open at first render, default 1).
 * Keyboard (WAI-ARIA tree pattern): Up/Down, Right opens or enters, Left closes or goes to the
 * parent, Home/End, Enter/Space toggles.
 */
export class SlJsonTree extends SlElement {
  static observedAttributes = ["data", "label", "expand-depth"];
  static jsonProps = ["data"];
  static styles = `
:host { display: block; }
[role="tree"] { list-style: none; margin: 0; padding: var(--sl-space-3); font-family: var(--sl-font-mono); font-size: var(--sl-step--1);
  background: var(--sl-panel); border-radius: var(--sl-radius-panel); box-shadow: var(--sl-shadow), inset 0 0 0 1px var(--sl-line-soft);
  max-block-size: var(--sl-json-height, 26em); overflow: auto; }
[role="group"] { list-style: none; margin: 0; padding-inline-start: 1.4em; border-inline-start: 2px solid var(--sl-line-soft); margin-inline-start: 0.45em; }
[role="treeitem"] { outline: none; }
.row { display: flex; gap: 0.5em; align-items: baseline; padding: 1px var(--sl-space-2); border-radius: var(--sl-radius-plate); cursor: default; }
[role="treeitem"]:focus-visible > .row { outline: var(--sl-focus-width) solid var(--sl-focus); outline-offset: 0; }
[role="treeitem"]:focus > .row { background: color-mix(in srgb, var(--sl-ink) 10%, transparent); }
.tw { inline-size: 1em; flex: none; color: var(--sl-ink-muted); text-align: center; }
[aria-expanded="true"] > .row .tw::before { content: "−"; }
[aria-expanded="false"] > .row .tw::before { content: "+"; }
.k { color: var(--sl-ink); font-weight: var(--sl-weight-strong); }
.v { overflow-wrap: anywhere; }
.t-string { color: var(--sl-state-pass); }
.t-number { color: var(--sl-state-running); }
.t-boolean { color: var(--sl-state-stalled); }
.t-null { color: var(--sl-ink-muted); font-style: italic; }
.t-array, .t-object { color: var(--sl-ink-muted); }
`;

  constructor() {
    super();
    this.shadowRoot.addEventListener("keydown", (e) => this._onKey(e));
    this.shadowRoot.addEventListener("click", (e) => {
      const item = e.target.closest?.('[role="treeitem"]');
      if (!item) return;
      if (item.hasAttribute("aria-expanded")) this._toggle(item);
      this._focus(item);
    });
  }

  update() {
    const tree = document.createElement("ul");
    tree.setAttribute("role", "tree");
    tree.setAttribute("aria-label", this.getAttribute("label") || "JSON");
    const depth = Math.max(0, toNumber(this.getAttribute("expand-depth"), 1));
    const data = this.data;
    const root = data === undefined ? { "(vazio)": null } : isBranch(data) ? data : { valor: data };
    this._fill(tree, root, 1, depth);
    this.shadowRoot.replaceChildren(tree);
    const first = tree.querySelector('[role="treeitem"]');
    if (first) first.tabIndex = 0;
  }

  _fill(list, value, level, openDepth) {
    const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v]) : Object.entries(value);
    entries.forEach(([key, child], i) => {
      const li = document.createElement("li");
      li.setAttribute("role", "treeitem");
      li.setAttribute("aria-level", String(level));
      li.setAttribute("aria-setsize", String(entries.length));
      li.setAttribute("aria-posinset", String(i + 1));
      li.tabIndex = -1;
      const t = typeOf(child);
      li.innerHTML = `<span class="row"><span class="tw" aria-hidden="true"></span><span class="k">${esc(key)}</span>` +
        `<span class="v t-${t}">${esc(preview(child))}</span></span>`;
      if (isBranch(child)) {
        li._value = child;
        li._level = level;
        li.setAttribute("aria-expanded", "false");
        if (level <= openDepth) this._expand(li, openDepth);
      }
      list.append(li);
    });
  }

  _expand(li, openDepth = 0) {
    if (!li.querySelector(':scope > [role="group"]')) {
      const group = document.createElement("ul");
      group.setAttribute("role", "group");
      this._fill(group, li._value, li._level + 1, openDepth);
      li.append(group);
    }
    li.querySelector(':scope > [role="group"]').hidden = false;
    li.setAttribute("aria-expanded", "true");
  }

  _collapse(li) {
    li.querySelector(':scope > [role="group"]').hidden = true;
    li.setAttribute("aria-expanded", "false");
  }

  _toggle(li) {
    if (li.getAttribute("aria-expanded") === "true") this._collapse(li);
    else this._expand(li);
  }

  _visible() {
    return [...this.shadowRoot.querySelectorAll('[role="treeitem"]')].filter((el) => !el.closest("[hidden]"));
  }

  _focus(li) {
    for (const el of this.shadowRoot.querySelectorAll('[role="treeitem"][tabindex="0"]')) el.tabIndex = -1;
    li.tabIndex = 0;
    li.focus();
  }

  _onKey(e) {
    const item = e.target.closest?.('[role="treeitem"]');
    if (!item || e.target !== item) return;
    const items = this._visible();
    const i = items.indexOf(item);
    const expanded = item.getAttribute("aria-expanded");
    let next = null;
    switch (e.key) {
      case "ArrowDown": next = items[i + 1]; break;
      case "ArrowUp": next = items[i - 1]; break;
      case "Home": next = items[0]; break;
      case "End": next = items.at(-1); break;
      case "ArrowRight":
        if (expanded === "false") this._expand(item);
        else if (expanded === "true") next = item.querySelector('[role="treeitem"]');
        break;
      case "ArrowLeft":
        if (expanded === "true") this._collapse(item);
        else next = item.parentElement.closest('[role="treeitem"]');
        break;
      case "Enter": case " ":
        if (expanded) this._toggle(item);
        break;
      default: return;
    }
    e.preventDefault();
    if (next) this._focus(next);
  }
}

define("sl-json-tree", SlJsonTree);
