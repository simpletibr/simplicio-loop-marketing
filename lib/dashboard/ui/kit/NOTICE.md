# Notice

This folder is a vendored copy of the Simplicio Live component kit.

- Source: https://github.com/simpletibr/simplicio-loop, folder `simplicio_loop/dashboard/static/components/`
- Commit: `4690dcc5598a432141c796dfc5a49f179efd8069`
- Copied on: 2026-10-08
- License: MIT, Copyright (c) 2026 Wesley Simplicio (see `LICENSE`)

## Copied

`base.js`, `simplicio-live.css`, `sl-kpi-card.js`, `sl-sparkline.js`, `sl-donut.js`, `sl-gate-badge.js`, `sl-timeline.js`, `sl-calendar.js`, `sl-connection-dot.js`, `sl-alert-toast.js`, `sl-heatmap.js`, `sl-json-tree.js`.

## Not copied

- `sl-stage-rail.js` and `phase-meta.js`: the rail draws the loop's own eight coding phases (`PHASES`, `PHASE_META`), and the pipeline here has eleven marketing stages with different names. Adding it would show coding labels to the operator.
- `sl-command-palette.js`, `sl-diff-view.js`, `sl-log-viewer.js`, `sl-lane-swimlane.js`, `index.js`, `package.json` and `fonts/`: no view uses them.

## Changes made here

Only what the page's Content-Security-Policy (`default-src 'none'; style-src 'self'; ...`) and its accessibility gate (axe, WCAG 2.2 AA, no violation) require, so the policy stays as strict as it was:

1. `simplicio-live.css`: removed the two `@font-face` blocks. The font files are not copied, and `font-src` falls back to `default-src 'none'`. The font stacks fall through to `system-ui`. Added a `[data-sl-toasts]` rule (see 2).
2. `sl-alert-toast.js`: `notify()` no longer sets `host.style.cssText`; the stack's position is the `[data-sl-toasts]` rule in the stylesheet.
3. `sl-calendar.js`: a day cell's name now comes from a visually hidden `<span class="sr-only">` instead of an `aria-label`. With the `aria-label`, axe 4.14 reports `label-content-name-mismatch` (serious) on every day that has a post, because the visible text (the number and the post titles) is not contained in the label. The spoken text is the same.

Every other file is byte-identical to the source commit. To update, copy again from a newer source commit and re-apply the three changes above.
