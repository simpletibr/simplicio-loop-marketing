# Issue 161: Publisher seam and Real Oficial (interim browser automation)

Status: PARTIAL. The seam, the gates, the receipts and the fixture-driven browser flow are done and verified. The live spike and the live test post need the owner (session in the browser, optional credit spend), so they are not claimed.

## What shipped

- `lib/publish/publisher.ts`: `Publisher` interface (`capabilities`, `schedule`, `status`, `cancel`), `DryRunPublisher` (default), `scheduleVerified` (claims tag, 30-day window, client approval bound to the media hash, action-gate when live, idempotent per piece + network + day), append-only receipt ledger (`data/schedule.hbp`), `cancelScheduled`.
- Receipt: `marketing-publish-receipt/v1` extended additively (`scheduled` and `cancelled` verdicts, `publisher`, `network`, `publish_at`, `approval_ref`, `media_sha256`, `receipt_id`, `schedule_key`, `evidence`). Producer-generated fixture: `publish-receipt-scheduled.json`.
- `lib/publish/realoficial-browser.ts`: `RealOficialBrowserPublisher` over a `BrowserDriver`. Failures are classified (`login_required`, `captcha`, `two_factor`, `platform_rejection`, `policy_block`, and the new `layout_changed` for any unrecognised screen). Evidence: screenshot plus a DOM snapshot that goes through the browser lane's redaction.
- `lib/integrations/broker.ts`: `choosePublisher`. `DRY_RUN` resolves to `dry-run`; a live run must name `PUBLISHER` (`realoficial-browser` or the reserved `realoficial-api`), otherwise it throws.
- `AdaptlyPostClient` is marked `@deprecated` (not removed, per the issue).
- Screen fixtures: `tests/fixtures/realoficial/*.html`; fixture driver: `lib/providers/__mocks__/realoficial-browser.ts`.

## Acceptance criteria

| Criterion | Result |
| --- | --- |
| Interface and receipt have a versioned schema and unit tests | done (`tests/unit/publisher.test.ts`, contract fixtures) |
| e2e of `realoficial-browser` against HTML fixtures, no network | done (`tests/integration/realoficial-browser.test.ts`, `e2e/publisher.spec.ts`) |
| Spike documented in `docs/evidence/` (can a finished MP4 be posted without re-cut, and how many credits) | BLOCKED-EXTERNAL: runbook below |
| One scheduled test post (private or draft) with the owner's OK, receipt and screenshot | BLOCKED-EXTERNAL |
| No regression | see the gate in the commit |

## What is not implemented on purpose

The production `BrowserDriver` (attaching to the browser the owner already opened and logged in, for example over CDP) does not exist yet. The screen markers in `lib/publish/realoficial-browser.ts` (`data-screen=...`) match the recorded fixtures and must be calibrated against the real app during the spike. Until then a live run fails closed: `publisherFor` throws "not configured" and an unrecognised screen is `layout_changed`.

## Spike runbook (owner)

1. Open Real Oficial in the box's browser and log in yourself. Never hand cookies or passwords to the agent.
2. Read the Real Oficial terms about automation before enabling anything in production.
3. Schedule one finished MP4 (output of the video factory) on a test account, private or as a draft, by hand. Record each screen (HTML + screenshot) under `tests/fixtures/realoficial/`, noting: whether the file is accepted without re-cutting, the credit balance before and after, and the exact text of every error.
4. Adjust `MARKERS` in `lib/publish/realoficial-browser.ts` and add the `BrowserDriver` for the real app. Then repeat step 3 through the code with `DRY_RUN=false`, `PUBLISHER=realoficial-browser`, an `approval/v1` for the piece, and a `data/promotions.jsonl` human approval.
5. Attach the receipt and the confirmation screenshot to the issue.
