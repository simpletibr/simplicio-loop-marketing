# Issue 181: sales funnel and revenue

Status: PARTIAL. The route, view, tests and screenshots are done and verified, in DRY_RUN with recorded inputs only: nothing in this change creates a charge, a subscription or a refund, and no live Stripe or AbacatePay call exists. Not available and not claimed: the `frontend-design` skill (not installed here), a reader for the AbacatePay webhook (its payload is not confirmed; Brazilian sales arrive through the factory's `venda.json`), the spreadsheet `controle-vendas-videos.xlsx` itself (the panel reads its CSV export), and any live billing setup (issue #167 is deferred).

## What shipped

- `GET /api/funnel` (read-only; filters `client`, `country`, `batch`; `present=1`). Funnel by country and batch: prospects collected, previews rendered, sent, replied, sales, active subscriptions, with the conversion of each step and the prospect to sale rate against the reference of about 2%. A step counts everyone who got that far, so a spreadsheet that skips a status still gives a monotone funnel; a status with no step is counted as collected and reported.
- Revenue: MRR, one-off and recurring revenue (month and total), per processor (Stripe abroad, AbacatePay in Brazil) in the original currency and in reais. Reais are summed only when every payment carries the conversion; otherwise the total is `null` ("sem dado") with the number of payments missing it.
- Subscriptions by plan (package of 4 videos, the autopilot add-on), churn over 30 days, and the 3 month minimum (`minimum_until`, `minimum_met`) per subscription.
- Per client: LTV, months active, next charge, and `pago -> entregue`. The Stripe subscription events now carry `next_charge_at` (the period end, from the subscription or from its item in newer API versions).
- UI: section `Funil e receita`. Presentation mode drops every per-client value and keeps the totals.

## Acceptance criteria

| Criterion | Result |
| --- | --- |
| The fixture of 200 prospects, 4 sales and 2 subscriptions matches the reference computation | done: `tests/integration/dashboard-funnel.test.ts` (counts 200, 100, 60, 12, 4, 2; conversions 50, 60, 20, 33.3, 50; prospect to sale 2% = the reference; the cut by country and batch is rebuilt from the generating rule, independent of the view) |
| Presentation mode hides per-client values | done: the API test (no client slug anywhere in the payload, totals unchanged) and `e2e/dashboard-ui-funnel.spec.ts` (the per-client table is gone, the totals stay) |
| Read-only, never creates a charge | done: every write method on the route is refused, the page has no control, and every request of the e2e run was a GET |
| Money in the original currency plus reais | done, with "sem dado" where the rate is not recorded; the dollar rate comes from `PTAX_USD_BRL` as before |

Assumptions to confirm: the spreadsheet status words (Portuguese and English synonyms listed in `docs/DASHBOARD_EVENTS.md`), recurring revenue being the `invoice.paid` events, delivery being `entregue` in `venda.json` or a final render after the payment.

Screenshots (light): `dashboard/funnel-light.png`, `dashboard/funnel-present.png`.

## Verification (full gate on this tree)

| Check | Command | Result |
| --- | --- | --- |
| Types | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Unit | `npm run test:unit` | 361 of 361 |
| Integration | `npm run test:integration` | 110 of 110 |
| Regression | `npm run test:regression` | 22 of 22 |
| System | `npm run test:e2e` | 307 passed |
| Coverage, all of `lib/**/*.ts` | `test:node` and Playwright V8 coverage merged, `c8 report --all` | statements and lines 89.08%, functions 89.64%, branches 79.06% |
| Benchmark | `npm run bench` | funnel 0.29 ms/op (3487 ops/sec) over 5 clients and 60 pieces |
