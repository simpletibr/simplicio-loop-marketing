# Issues 178, 179 and 180: status per network, quality gates, credits and costs

Status: PARTIAL for all three. The routes, views, tests and screenshots are done and verified. Not available and not claimed: the `frontend-design` skill (not installed here, so the aesthetic direction was not produced through it), the shared `sl-*` kit and its `<sl-json-tree>` (not reachable, so gate reports are plain text in the piece drawer), and live Real Oficial answers (the fixtures are written from the tool descriptions).

## What shipped

- `GET /api/status` (#178): client by network matrix, publisher session health, connected accounts against the plan limit, receipts. `GET /api/receipts/<id>` (detail) and `GET /api/evidence/<id>` (the receipt's screenshot, only from `data/evidence`). The read-only Real Oficial window gained `ro_list_social_accounts`.
- `GET /api/quality` (#179): the seals per piece, the first-try pass rate per gate, the top rejection reasons (`?reasons=N` for more than five) and the weekly trend. `qa_result` and `compliance_result` events carry rule ids only.
- `GET /api/credits` (#180): Real Oficial balance (read-only `ro_whoami`), the month's spend by purpose and client with the approver, a linear projection, voice quota, seconds, cost, cache hit rate, LLM usage and the unit economics per preview, sale and client.
- UI: three sections (`Status por rede`, `Qualidade`, `Créditos e custos`) in the same framework-free shell.
- Fix found while testing: a live refresh rebuilt the navigation and the content and dropped the keyboard focus. Links are updated in place and a refresh waits while the person is working inside the page (`e2e/dashboard-ui-gates.spec.ts` fails against the old behaviour).

## Acceptance criteria

| Issue | Criterion | Result |
| --- | --- | --- |
| 178 | Fixtures of each failure type show the reason and the human next step ("Wesley precisa logar na RO") | done: `tests/integration/dashboard-status.test.ts` (all 16 failure classes have both; the matrix, the session health and the receipt rows) |
| 178 | No credential or cookie is displayed | done: a receipt with a cookie, bearer token, password, token, API key and e-mail in its stage text leaves the API without any of them, and no credential-shaped field exists in the payload |
| 178 | Capacity bar with a warning before it fills | done: warning at 80% of the plan limit; the Lite limits (5 Instagram, 5 TikTok, 1 YouTube) are an assumption from the issue text |
| 179 | PASS and FAIL fixtures of each gate render with the reason | done: `tests/integration/dashboard-quality.test.ts` |
| 179 | A piece whose hash differs from the approved one appears blocked | done (`approval_hash_mismatch`) |
| 179 | Gate report JSON and QA sheet in detail | PARTIAL: shown as text in the existing piece drawer, no JSON tree component |
| 179 | Licenses (`broll --check`) | PARTIAL: read from `broll-licenses.json` in the piece folder (`{ "passed": boolean }`), a format to confirm with the video factory; absent is "sem dado" |
| 180 | Fixture numbers match the reference computation, estimates labelled | done: `tests/integration/dashboard-credits.test.ts` (reference written independently of the view; estimates carry `estimate: true` and a label) |
| 180 | No button that spends credit | done: `e2e/dashboard-ui-gates.spec.ts` (no button or form in the page, every request a GET) plus the GET-only server and the read-only allowlist |
| 180 | Purchase history | not done: there is no source for it and the panel never starts or lists purchases; the page says so |
| 180 | Render machine time | not done: the video factory does not report it yet; the page says so |

Screenshots (light): `dashboard/status-light.png`, `dashboard/quality-light.png`, `dashboard/credits-light.png`.

## Verification (full gate on this tree)

| Check | Command | Result |
| --- | --- | --- |
| Types | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Unit | `npm run test:unit` | 361 of 361 |
| Integration | `npm run test:integration` | 81 of 81 |
| Regression | `npm run test:regression` | 22 of 22 |
| System | `npm run test:e2e` | 300 passed |
| Coverage, all of `lib/**/*.ts` | `test:node` and Playwright V8 coverage merged, `c8 report --all` | statements and lines 88.8%, functions 87.31%, branches 77.92% |
| Benchmark | `npm run bench` | status 0.49 ms/op, quality 1.37 ms/op, credits 0.35 ms/op over 5 clients and 60 pieces |
