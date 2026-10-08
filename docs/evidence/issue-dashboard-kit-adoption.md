# Dashboard: adoption of the simplicio-live component kit (MIT)

Refs #171 (epic), #178, #179, #185. Kit source: `simpletibr/simplicio-loop`, commit `4690dcc5598a432141c796dfc5a49f179efd8069` (2026-10-08), folder `simplicio_loop/dashboard/static/components/`, MIT License, Copyright (c) 2026 Wesley Simplicio. The repo owner authorized copying it into this repository.

## Step 0: the event contract diverges from the loop's, and this PR does not fix it

Decision (fixed before this work started, not changed here): the envelope and the contract stay as they are in this PR. Aligning them is a separate follow-up PR. This section only records the difference.

Compared: `contracts/dashboard-event/v1/schema.json` in the loop clone (`simplicio.dashboard-event/v1`, `additionalProperties: false`, 16 required fields) against `lib/dashboard/events.ts` and `contracts/marketing-artifacts/v1/schemas/dashboard-event.schema.json` in this repo. Both declare the same `$id`/`schema` value, `simplicio.dashboard-event/v1`, and they describe two different shapes.

| Field | Loop contract (required unless noted) | This repo (`events.ts`) | Difference |
| --- | --- | --- | --- |
| `schema` | const `simplicio.dashboard-event/v1` | same const | none |
| `event_id` | ULID, `^[0-9A-HJKMNP-TV-Z]{26}$` | 24 hex characters, a sha256 prefix of `source` + `key` (deterministic, so a re-read never duplicates) | format differs |
| `seq` | integer >= 1, monotonic and gap free per run | not in the envelope; the store adds `seq` on `StoredEvent` only (SSE id), not on `DashboardEvent` | missing from the envelope |
| `ts` | UTC `YYYY-MM-DDTHH:MM:SS.mmmZ` | `toISOString()`, same shape | none |
| `run_id` | non-empty string | absent | missing |
| `task_id` | string or `null` | absent | missing |
| `scope` | `collection`, `task` or `scenario` (ties to `task_id`) | absent | missing |
| `source` | enum `hook`, `runner`, `worker`, `oracle`, `operator` | free string (`events log`, `journal`, `yool board`, `receipts`, ...) | enum vs free text |
| `kind` | loop catalog name, or `<namespace>.<kind>` (`loop.` reserved) | `marketing.<kind>` (21 kinds) | compatible with the namespace rule |
| `phase` | string or `null` | absent | missing |
| `lane` | string or `null` | absent | missing |
| `iteration` | integer >= 0 or `null` | absent | missing |
| `severity` | `debug`, `info`, `warning`, `error` | `info`, `warn`, `error` | `warn` vs `warning`; no `debug` |
| `payload` | object | named `data` | renamed |
| `refs` | array of non-empty strings | absent | missing |
| `producer_version` | `<producer>@<version>` | absent | missing |
| `derived` | optional boolean | absent | none |
| `client`, `campaign_id`, `piece_id`, `network` | not allowed (`additionalProperties: false`) | optional top-level fields; the dashboard filters on them | extra properties the loop schema rejects |

Summary: 9 required fields are missing (`seq`, `run_id`, `task_id`, `scope`, `phase`, `lane`, `iteration`, `refs`, `producer_version`), 1 is renamed (`data` to `payload`), 2 differ in value space (`event_id`, `source`), 1 differs in an enum member (`severity`: `warn` vs `warning`), and 4 top-level fields are rejected by the loop schema. A marketing event would fail validation against the loop schema today.

Follow-up (not part of this PR): one alignment PR that decides the mapping (for example `client`/`campaign_id`/`piece_id`/`network` into `payload` or `refs`, `run_id` from the campaign, `scope: task` with the piece as `task_id`), changes `events.ts`, the local schema, the store and the adapters together, and runs the loop's fixtures against the marketing stream.

## Step 1: what was vendored, and the CSP check

Folder: `lib/dashboard/ui/kit/`, plain browser ES modules, no build step, no new npm dependency. The files and the source commit are named in `kit/NOTICE.md`; the MIT text is `kit/LICENSE`.

- Copied (12): `base.js`, `simplicio-live.css`, `sl-kpi-card.js`, `sl-sparkline.js` (the KPI card imports it), `sl-donut.js`, `sl-gate-badge.js`, `sl-timeline.js`, `sl-calendar.js`, `sl-connection-dot.js`, `sl-alert-toast.js`, `sl-heatmap.js`, `sl-json-tree.js`.
- Not copied: `sl-stage-rail.js` and `phase-meta.js`. The rail draws the loop's own eight coding phases (`PHASES` and `PHASE_META`: "Contrato recebido", "Plano congelado", "Watcher verificando", ...), and the pipeline here has eleven marketing stages with other names. Using it would show coding labels to the operator, so it is not a clear fit and is left out (a rail that takes its own stations would be an upstream change). Also not copied: command palette, diff view, log viewer, lane swimlane, `index.js`, `package.json`, `fonts/`.
- Differences from the source commit (3 of 12 files, each listed in `kit/NOTICE.md`): `simplicio-live.css` loses its two `@font-face` blocks (the font files are not copied and `font-src` falls back to `default-src 'none'`); `sl-alert-toast.js` no longer sets `host.style.cssText` (the position is a `[data-sl-toasts]` rule); `sl-calendar.js` names a day cell with a visually hidden span instead of an `aria-label` (axe `label-content-name-mismatch`, serious, on every day with a post).
- The Content-Security-Policy is unchanged: `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`. The only server change is the static route: `/ui/<name>.js` also accepts `/ui/kit/<name>.js`, plus the one file `/ui/kit/simplicio-live.css`. The kit styles itself with adopted stylesheets and the CSSOM (`el.style.setProperty`), which `style-src 'self'` allows; no inline `style` attribute exists in any template.

Grep results on the final tree (run from `lib/dashboard/ui`):

```
$ grep -nE "\sstyle\s*=" kit/*.js kit/*.css index.html *.js
(no match)

$ grep -nE "\.style\.cssText|setAttribute\(\s*[\"']style|<style\b" kit/*.js kit/*.css index.html *.js
(no match)

$ grep -nE "<script\b" kit/*.js kit/*.css index.html *.js
index.html:32:<script type="module" src="/app.js"></script>

$ grep -nE "\son[a-z]+\s*=" kit/*.js index.html *.js
(no match)

$ grep -nE "\beval\(|new Function\(|document\.write|insertAdjacentHTML|outerHTML" kit/*.js *.js
(no match)

$ grep -nE "@import|@font-face|url\(" kit/*.css style.css
(no match)

$ grep -nE "https?://" kit/*.js kit/*.css *.js index.html   (the SVG namespace is an identifier, not an address)
dom.js:18:export const svgNs = "http://www.w3.org/2000/svg";

$ grep -n "innerHTML" kit/*.js *.js
kit/base.js:178:    this.shadowRoot.innerHTML = this.render();
kit/sl-json-tree.js:81:      li.innerHTML = `<span class="row"><span class="tw" aria-hidden="true"></span><span class="k">${esc(key)}</span>` +
```

The two `innerHTML` sites are the kit's: `base.js` renders a component's shadow DOM from a template string in which every value goes through `esc()`, and `sl-json-tree.js` does the same for each row. The page's own scripts still build no markup from strings. `tests/integration/dashboard-privacy-security.test.ts` now checks the kit folder for inline style, inline handlers, scripts, dynamic code and external addresses (it allows `innerHTML` in the kit and nowhere else), checks that the kit's stylesheet loads no font, and checks that the kit is served as scripts and one stylesheet only (traversal attempts and other file names stay 404, the policy keeps `style-src 'self'` and gains no `unsafe-inline`). `e2e/dashboard-a11y.spec.ts` fails on any CSP violation reported by the browser in any section; it passed.

## Step 2: where the kit is used

| Place | Kit element | Replaces |
| --- | --- | --- |
| Header | `sl-connection-dot` (`#conn`, `status="live"` or `"connecting"`) | the hand-drawn dot and text |
| Toasts (alerts, copy feedback) | `sl-alert-toast` through `SlAlertToast.notify` into `#toasts` | the hand-built toast div |
| Cockpit | 11 `sl-kpi-card` | 11 hand-built KPI cards |
| Quality | 3 `sl-kpi-card` with a weekly `trend` (the card draws an `sl-sparkline`), an `sl-donut` (blocked against released), an `sl-heatmap` (weekly trend by gate, "sem dado" cells hatched), an `sl-gate-badge` for every seal and for "Pode seguir?" | KPI cards, the "Peças bloqueadas" card, the week by gate table, text pills |
| Approvals, Alerts | 4 and 3 `sl-kpi-card` | hand-built KPI cards |
| Calendar, month view | `sl-calendar` (its own month buttons; the view reloads the server data when the month changes) | the hand-built month grid |
| Receipt drawer | `sl-timeline` (stage, ok or failed) | an ordered list |
| Piece drawer | `sl-json-tree` for `timing.lock.json` (text when the file is not valid JSON) | a `<pre>` |

Kept as they were, and why:

- The pipeline river (cockpit): no flow diagram in the kit.
- The cumulative views chart (performance): the view's rule is that a day with no reading is a gap, never an interpolation, and `sl-sparkline` drops missing values and joins the rest, with even spacing.
- The calendar week and list views: the kit has a month grid only. The week view keeps its small hand-built grid and its keyboard handling; the list is a table.
- The funnel and capacity bars (`<progress>`), the status page, credits, the board and every other table: no kit element fits.

Decisions that came with the kit: the page palette is derived from the kit tokens (`--bg`, `--panel`, `--fg`, `--ok`, ... are `var(--sl-*)`) and the theme switch sets the kit's `data-sl-theme`, so the hand-written light, dark-by-media and dark-by-attribute palette blocks are gone; `--sl-fluid` is pinned to `1rem` (the kit scales its type with the viewport for wall screens, the page does not); the tint of the `.sev` pills is 8% because 14% gave 4.18:1 for green text (axe color-contrast) and 8% gives 4.56:1. Simulated posts are drawn with the kit's `ESTIMADO` state, a real schedule with `PASS`, and a post waiting for the next cycle with `PENDING`; the mapping of post status, seal and KPI to kit attributes is `lib/dashboard/ui/state.js`, a module with no DOM that node tests (`tests/integration/dashboard-ui-state.test.ts`, 8 tests) tie to the sources of the values (the `SlotStatus` union, the `SealState` union, the cockpit KPI ids). A KPI has a "better" side only where one exists (failures and open approvals are better when they fall); the funnel and the voice quota show the change as plain text, and so does a change of zero or none.

Hand-written CSS deleted after the specs passed with the kit: the KPI value, delta and detail rules, the connection dot, the toast and its stack, and the three palette blocks. `style.css` went from 110 to 95 lines.

A bug found on the way and fixed in its own commit: the piece drawer printed "nullnull" for a piece without a contract or a timing file (`replaceChildren` turns `null` into the text "null"). The pipeline spec now fails when the drawer text contains "null".

## Step 3: tests and evidence

Selectors changed only where the DOM changed: `#conn` is checked through `status="live"` (was `data-state="open"`); the toast is `sl-alert-toast` (was `.toast`); the calendar test uses the kit's cells and list items (was `button.day` and `.post`) and starts on the first day of the month, because the grid also shows the days of the neighbouring months; the cockpit KPI is found by its text (a kit card has no heading); the quality page has 3 KPI cards and 1 donut (was 4 cards). The keyboard navigation spec now waits for the first render to hand the focus to the content before it presses Enter; in one full run it had pressed Enter before that and the navigation did not happen, and it passed in six isolated repeats and in the next full run, so this is a wait for a state the spec already waited for in its later steps.

The 14 reference screenshots in `docs/evidence/dashboard/` were regenerated by the e2e run (`DASHBOARD_SCREENSHOTS=1 npm run test:e2e`) on the kit UI.

## Verification (full gate, in series, run twice on the code of this PR; the table is the run on the final head)

The browsers in this build container are Chromium 141 (revision 1194) while `@playwright/test` 1.59.1 expects revision 1217. The repo's own switch was used (`MARKETING_ENGINE_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`, `e2e/support/browser.ts`); nothing was installed. The screenshots and axe results are therefore from Chromium 141. Without the switch 59 browser specs fail at launch, which is the environment and not the code.

| Check | Command | Result |
| --- | --- | --- |
| Types | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | `lint: clean` |
| Unit | `npm run test:unit` | 366 of 366 |
| Integration | `npm run test:integration` | 132 of 132 (123 before; 9 new) |
| Regression | `npm run test:regression` | 22 of 22 |
| All node tests | `npm run test:node` | 532 of 532 |
| System | `npm run test:e2e` | 345 passed |
| Accessibility | `e2e/dashboard-a11y.spec.ts` (axe, WCAG 2.2 AA, 10 sections in light and dark, drawers, palette, presentation mode, 360 px, CSP violations) | 34 of 34, 0 violations |
| Coverage, all of `lib/**/*.ts` | `test:node` and Playwright V8 coverage merged, `c8 report --all` | statements and lines 89.22%, functions 89.66%, branches 79.47% |
| Flow and contract | `npx playwright test e2e/contracts.spec.ts e2e/saas-launch-loop.spec.ts e2e/dashboard-ui.spec.ts` | 14 passed |
| Flow and contract | `node --import tsx/esm --test tests/integration/dashboard-sync.test.ts tests/integration/piece-pipeline.test.ts tests/regression/operator-hooks.test.ts` | 14 of 14 |

Benchmark (`npm run bench`, the server reads the dashboard serves, 5 clients and 60 pieces; the server code is unchanged by this PR; second full run, on the final head): cockpit 2.18, pipeline 3.87, calendar 0.06, status 0.38, quality 1.05, credits 0.26, funnel 0.19, performance 0.66, approvals 0.24, alerts 0.68 ms per read. The first full run, on the same code, gave 2.41, 2.83, 0.06, 0.28, 0.98, 0.31, 0.19, 1.03, 0.16 and 0.45 ms: the spread between two runs is the noise of this container, not a change.

Browser hot paths (`e2e/dashboard-perf.spec.ts`, measured in the coverage run, which slows it; final head): largest contentful paint cockpit 280 ms, pipeline 248, calendar 124, status 124, quality 104, credits 144, funnel 112, performance 132, approvals 212, alerts 96, against the 1.5 s budget (issue 185 measured 288, 228, 160, 76, 100, 88, 64, 84, 72 and 104 ms without coverage; the first run of this PR gave 308, 268, 212, 156, 116, 120, 124, 108, 128 and 124 ms); 25 live refreshes leave the page at 677 nodes before and after, 28 listeners before and after, heap 1.7 to 1.8 MB.

## Not done

- The event envelope and contract are not aligned with the loop's (Step 0, follow-up PR).
- The stage rail is not used (see Step 1).
- Only Chromium was run. The kit relies on `light-dark()`, `color-mix()` and constructable stylesheets, which current Chromium, Firefox and Safari support; no Firefox or WebKit run was made.
