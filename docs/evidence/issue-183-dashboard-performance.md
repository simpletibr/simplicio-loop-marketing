# Issue 183: performance per post, winners and double down

Status: PARTIAL. The route, view, tests and screenshot are done and verified. Not available and not claimed: the `frontend-design` skill (not installed here), retention (the metrics sources do not report it; the page says "sem fonte"), and a thumbnail (a still frame of each post has no source: the first 12 ranked posts that have a preview file load it on demand with `preload="metadata"`, the others open the piece drawer).

## What shipped

- `GET /api/performance` (read-only; filters `client`, `network`, `metric`, `days`). Ranking of posts by views, likes, comments, shares or saves, by network and client. A metric the source did not report is `null` ("sem dado"), never zero: it is left out of every sum, mean and median, and a post without the chosen metric comes last and unranked.
- Winners of the ledger (issue #166) with the variations the plan made of them (`variant_of`): month, format, production stage and views (`null` until measured).
- Comparison by format (hero, derived, slideshow, cut), by hook (the first two seconds) and by original or dubbed language; growth per client as a line of cumulative views, with a gap, not a drop, on a day with no reading, and a table of the numbers.
- UI: section `Desempenho`, with a metric selector, the ranking, the winners with their variations, the three comparisons and the growth curves.

## Acceptance criteria

| Criterion | Result |
| --- | --- |
| The 2 month fixture shows the winners of month 1 linked to the variations of month 2 | done: `tests/integration/dashboard-performance.test.ts` runs the real loop (snapshots, `selectWinners`, `recordWinners`, `planContent` with the winners) and checks each winner's variations against the plan of month 2; `e2e/dashboard-ui-performance.spec.ts` runs it through the CLI (`metrics import`, `metrics winners`, `campaign --winners`) and checks the page |
| A missing metric never becomes zero | done: tests for the post, the group statistics, the growth curve and the winner's variations (a mutation that turns null into 0 fails the first test) |

Assumptions to confirm: a piece with a finished dubbing receipt counts as "dublado" (and its language comes from the plan slot or the receipt); the format and hook of a post come from the plan slot of its piece.

Screenshot (light): `dashboard/performance-light.png`.

## Verification (full gate on this tree)

| Check | Command | Result |
| --- | --- | --- |
| Types | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Unit | `npm run test:unit` | 361 of 361 |
| Integration | `npm run test:integration` | 115 of 115 |
| Regression | `npm run test:regression` | 22 of 22 |
| System | `npm run test:e2e` | 309 passed |
| Coverage, all of `lib/**/*.ts` | `test:node` and Playwright V8 coverage merged, `c8 report --all` | statements and lines 89.18%, functions 89.66%, branches 79.17% |
| Benchmark | `npm run bench` | performance 0.63 ms/op (1595 ops/sec) over 5 clients and 60 pieces |
