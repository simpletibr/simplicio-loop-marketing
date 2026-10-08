# Issues 182 and 184: approval queue with SLA, and distribution alerts

Status: PARTIAL for both. The routes, views, tests and screenshots are done and verified. Not available and not claimed: the `frontend-design` skill (not installed here, so the aesthetic direction was not produced through it), and the shared rule engine of `simpletibr/simplicio-loop#1406` (not readable from this build session; the rules here are implemented in `lib/dashboard/alerts.ts` and are not shared with it).

## What shipped

- `GET /api/approvals` (#182): two queues, read-only. Client: approval links with no decision for the same media hash, with the age, the time left to the scheduled post, a colour (red under 24 h or already late, yellow under 72 h, green after) and a "copy" control (the link when `MARKETING_APPROVAL_PAGE_URL` is set, else the command that generates the month's page; never a token). The client's own words for open change requests are listed with contact data removed. Operator: `human.approval_required` tuples that are not `done`, with the request, the credit estimate, the impact and the age (a day is yellow, three days red). Decision tuples now carry `tuple_id`, so a `done` update clears the item even without a piece.
- `GET /api/alerts` (#184): the rules below as a pure function of the event stream, the receipts and the plans. An alert exists exactly while its condition holds, its key is rule plus subject (no duplicates), `since` is when the condition began. The only view that also reads the Real Oficial balance and the connected accounts (read-only, cached).
- UI: sections `Aprovações` and `Alertas`; a count on the `Alertas` link; a toast for each new alert (one summary toast on the first load); optional desktop notifications, off until the person clicks the button and the browser grants permission, and generic in presentation mode.
- Outbound: nothing by default. `MARKETING_DASHBOARD_ALERT_WEBHOOK` (an `http(s)` URL, unset by default) receives only the alerts that began since the last check; the alerts already active at start are not repeated.
- Thresholds from the environment: `MARKETING_ALERT_STUCK_HOURS` (48), `MARKETING_ALERT_MIN_SCHEDULED` (8), `MARKETING_ALERT_MIN_CREDITS` (50). The publish grace (15 min), the repeated failures (3) and the payment grace (1 h) are constants.

## Acceptance criteria

| Issue | Criterion | Result |
| --- | --- | --- |
| 182 | A piece with a post in under 24 h and no approval is red and raises an alert | done: `tests/integration/dashboard-approvals.test.ts` (red, then the alert, then cleared by a decision) and `e2e/dashboard-ui-approvals-alerts.spec.ts` |
| 182 | No approval action in v1 | done: every write method on the route is refused (405), the view has no request, form or decision verb in its source, the rendered page has only "copy" and piece links and every request was a GET (e2e) |
| 182 | Two queues, client and Wesley, with SLA colour | done; the credit estimate and impact come from the tuple payload (`credit_estimate` or `credits`, `impact`, `request` or `reason`), a payload shape to confirm with the producer of those tuples |
| 184 | Each rule has a firing test and a clearing test | done: `tests/integration/dashboard-alerts.test.ts`, one test per rule (11 rules) |
| 184 | No duplicate alerts | done: keyed by rule and subject, repeated receipts and events give one alert; the webhook announces each alert once |
| 184 | Alert centre, toast, opt-in browser notification, no external send by default | done: e2e covers the toast, the live arrival of a new alert, the opt-in toggle and the notification of only new alerts |

Rules: post not published 15 min after its time, publish failed (by type), Real Oficial session (login, check or possibly expired), accounts near the plan limit, balance below the minimum, voice quota exhausted (with the time it returns), client approval due, piece stuck in a step, QA or compliance failing in a row, month with too few scheduled posts, payment received with no delivery started.

Screenshots (light): `dashboard/approvals-light.png`, `dashboard/alerts-light.png`.

## Verification (full gate on this tree)

| Check | Command | Result |
| --- | --- | --- |
| Types | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Unit | `npm run test:unit` | 361 of 361 |
| Integration | `npm run test:integration` | 102 of 102 |
| Regression | `npm run test:regression` | 22 of 22 |
| System | `npm run test:e2e` | 304 passed |
| Coverage, all of `lib/**/*.ts` | `test:node` and Playwright V8 coverage merged, `c8 report --all` | statements and lines 88.97%, functions 89.61%, branches 78.71% |
| Benchmark | `npm run bench` | approvals 0.15 ms/op, alerts 0.41 ms/op over 5 clients and 60 pieces |
