# Issue 185: dashboard quality (e2e, WCAG 2.2 AA, LGPD, performance, security)

Status: PARTIAL. Everything below is implemented, measured and green on this tree. Not done and not claimed: the visual direction through the `frontend-design` skill (not installed here), the alignment with the checks of `simpletibr/simplicio-loop#1409` (not readable from this build session), and a measurement on a very large operation (the numbers are from a 30 day plan on 2 networks, about 60 pieces, and from the 5 clients and 60 pieces of the benchmark fixture).

## What shipped

- Accessibility: `axe-core` (a dev dependency, used only by the browser specs) with the WCAG 2.2 AA rule tags plus best practice on all 10 sections in light and dark, on the piece, day and receipt drawers, on the command palette and in presentation mode (`e2e/dashboard-a11y.spec.ts`). Reflow at 360 px, focus order and the skip link, Escape closing the dialogs. Fixes found by the audit: a theme button whose name did not contain its visible text, a calendar that was not a valid ARIA grid (rows and cells now, the selection on the cell, a name that starts with the visible text), headings that skipped a level, a scrolling feed the keyboard could not reach, the info colour at 4.3:1 on its own background (now 5.4:1), a duplicated landmark name, a listbox with no name, a card grid that overflowed at 360 px, and a skip link whose `#main` was read as a navigation to the Cockpit.
- LGPD (`tests/integration/dashboard-privacy-security.test.ts`): a name, an e-mail, a phone number and a session cookie are planted in every source (factory folder, spreadsheet CSV, credit ledger, receipt text, approval note and approver, tuple board) and every GET response of the API (plain and in presentation mode) and the live stream are scanned. It found four leaks, all fixed: the client's note on a piece, the approver's name in the approval queue, phone numbers and a session cookie in a receipt's text. The event store, in memory and on disk, never holds contact data; the page for a client carries nothing internal, nothing of another client and no contact data.
- Security (same file): bound to the loopback, every route needs the token (no token, wrong bearer, wrong cookie), no route accepts a write (static files included), the panel reaches only the read-only Real Oficial tools, 15 path traversal attempts never read a file, and the page has no inline script, style or handler, no external resource and builds no markup from strings. The CSP finding: the page set inline `style` attributes that its own policy blocks, so the spacing of every section had silently not applied; they are classes now, and `e2e/dashboard-a11y.spec.ts` fails on any CSP violation in any section.
- Performance: `e2e/dashboard-perf.spec.ts` (largest contentful paint of every section against 1.5 s, and a browser session of 25 live refreshes) and `tests/integration/dashboard-soak.test.ts` (an 8 hour session in accelerated time). Previews are requested only when a piece is opened (e2e).
- Docs: `docs/DASHBOARD.md` (sections, rules, privacy, security, accessibility, measurements, limits) and a section with the cockpit screenshot in the README. The reference screenshots of every section were regenerated on the final UI.

## Measurements

| What | Budget | Measured |
| --- | --- | --- |
| LCP, local server, every section | under 1.5 s | cockpit 288 ms, pipeline 228, calendar 160, status 76, quality 100, credits 88, funnel 64, performance 84, approvals 72, alerts 104 |
| Browser, 25 live refreshes | no growth | DOM nodes 600 to 600, listeners 27 to 27, JS heap 1.6 to 1.7 MB |
| Server, 8 h accelerated (5760 events, 480 stream reconnects, 2880 section reads) | memory follows the stored events | heap 24.2 MB (minute 60) to 26.2 MB (minute 480), 0.35 KB per stored event, 0 streams left attached |
| axe-core | no violation | 0 in 20 section and theme runs and 4 dialog states (22 violations found and fixed before) |
| Reflow at 360 px | no sideways scroll | none in 10 sections |
| Section read, 5 clients and 60 pieces (`npm run bench`) | | cockpit 2.12, pipeline 3.00, calendar 0.06, status 0.35, quality 0.96, credits 0.31, funnel 0.21, performance 0.77, approvals 0.19, alerts 0.52 (ms per read) |

## Acceptance criteria

| Criterion | Result |
| --- | --- |
| Measurements attached (numbers) | done: the table above |
| `npm run typecheck`, `npm run test:node` and e2e green, no regression | see the verification table below |

## Verification (full gate on this tree)

| Check | Command | Result |
| --- | --- | --- |
| Types | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Unit | `npm run test:unit` | 361 of 361 |
| Integration | `npm run test:integration` | 123 of 123 |
| Regression | `npm run test:regression` | 22 of 22 |
| System | `npm run test:e2e` | 345 passed |
| Coverage, all of `lib/**/*.ts` | `test:node` and Playwright V8 coverage merged, `c8 report --all` | statements and lines 89.22%, functions 89.66%, branches 79.45% |
| Benchmark | `npm run bench` | dashboard reads in the table above |

Two e2e specs were racy under the load of the full suite and were fixed in this change (a keyboard test that moved to the next section before the previous one had finished rendering, and the notification test that opted in before the seeded alerts had all arrived); both now wait for the real completion signal and pass 4 of 4 repeats at 3 workers.
