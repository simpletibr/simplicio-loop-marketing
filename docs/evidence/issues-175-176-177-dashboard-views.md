# Issues 175, 176 and 177: cockpit, pipeline and calendar views

Status: PARTIAL for all three. The data models, routes, UI, tests and screenshots are done and verified. Two things the issues ask for were not available and are not claimed: the `frontend-design` skill (not installed in this repository nor in the build session, so the aesthetic direction was not produced through it) and the shared `sl-*` component kit from simpletibr/simplicio-loop#1399 (not reachable), so the components are local.

## What shipped

- `lib/dashboard/model.ts`: per-piece state of the 11 stages (prospect, script, voice, preview, QA, compliance, approval, final render, scheduled, published, metrics), folded from the event stream plus the plan. Every view that says "as of last week" runs the same code on the events up to that instant.
- `GET /api/cockpit` (#175): 11 KPIs with the variation against a week earlier (a KPI without a source is `null`, shown as "sem dado", never zero), the pipeline "river" (pieces that reached each stage, drop-off, average hours per hop), the live feed with plain-language text, the client grid (health from alerts, next publication, share of the month filled, views) and country tiles.
- `GET /api/pipeline` (#176): every piece with format, network, language, stage, time in stage, retries, whether a preview and a final exist; filters by client, campaign, format, network, language, status and text; average hours to enter each stage; the oldest stuck piece; hero to variation tree where the plan links them.
- `GET /api/calendar` (#177): entries with the client's local time, BRT and any requested zones; status per slot; `scheduled_on_realoficial` only for a real receipt; cadence per client (weekly goal, empty days); conflicts (same network and time, no approval less than 24 h before, outside the window). Slots beyond 30 days read "fila do próximo ciclo" and never "agendado".
- UI (`lib/dashboard/ui/`): no framework and no build step. Landmarks, skip link, `aria-live` announcements, visible focus, light/dark/auto theme, presentation mode, command palette (Ctrl/Cmd+K), live updates over SSE, piece drawer (preview with `preload="none"`, script, voice timing, contract, QA, FINAL-COMANDO.md with a copy button that never executes, captions, approvals, receipts, history), month/week/list calendar with arrow-key navigation and a time zone selector.
- Presentation mode (`?present=1`) is applied on the server: client slugs and names become `Cliente A...` in every JSON response and SSE frame, and the UI never builds names from anything else.

## Acceptance criteria

| Issue | Criterion | Result |
| --- | --- | --- |
| 175 | With the 5-client, 60-piece fixture the KPIs match the reference computation | done: `tests/integration/dashboard-views.test.ts` (reference written independently of the view code, now and a week earlier) |
| 175 | Updates live without reloading; presentation mode masks data | done: `e2e/dashboard-ui.spec.ts` (feed updates after a decision recorded by the CLI; no client name on screen in presentation mode) |
| 175 | Dark and light screenshots plus the `frontend-design` direction in the PR | PARTIAL: screenshots in `docs/evidence/dashboard/`; the skill direction cannot be provided |
| 176 | The 30-day campaign fixture shows the right columns and counts | done: `dashboard-views.test.ts` |
| 176 | The player plays the preview through range requests; the final only if it exists, never generates a render | done for range requests and "never generates" (`tests/integration/dashboard-server.test.ts`, drawer test); actual video decoding is not asserted because the dry-run MP4 is a placeholder |
| 176 | e2e with screenshots | done |
| 177 | 30 days x 3 networks render correctly in Sao Paulo, New York and Singapore | done: hour-by-hour check per zone in `dashboard-views.test.ts` |
| 177 | Posts beyond 30 days never appear as scheduled on Real Oficial | done (view test and the UI label) |
| 177 | Keyboard: move between days and open a post | done (`e2e/dashboard-ui.spec.ts`) |

Not done: the cadence heatmap is textual (weekly goal and empty days) rather than a drawn heatmap; the voice timeline is shown as the raw `timing.lock.json`, not as an interactive timeline; the country tiles are not a geographic map.

## Verification (full gate on this tree)

| Check | Command | Result |
| --- | --- | --- |
| Types | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Unit | `npm run test:unit` | 340 of 340 |
| Integration | `npm run test:integration` | 59 of 59 |
| Regression | `npm run test:regression` | 22 of 22 |
| System | `npm run test:e2e` | 287 passed |
| Coverage, all of `lib/**/*.ts` | `test:node` and Playwright V8 coverage merged, `c8 report --all` | statements and lines 88.5%, functions 89.79%, branches 76.45% |
| Benchmark | `npm run bench` | `dashboard.query` 15144 ops/sec (0.066 ms); the three views have no benchmark of their own yet |
