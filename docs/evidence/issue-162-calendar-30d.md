# Issue 162: 30-day calendar (`campaign --days 30` -> batch render -> schedule)

Status: implemented and verified under `DRY_RUN`. Live scheduling on Real Oficial depends on the browser driver from issue 161 and on the owner's session.

## What shipped

- `content-plan/v1` contract and a deterministic planner (`lib/plan/content-plan.ts`): dates and local times per network in the client's timezone (DST aware), format per slot with its resolved route (`lib/plan/formats.ts`), angle, hook and caption, and a `window` flag (`in_window` or `next_cycle`). Channel frequency limits from `lib/channels/registry.ts` are enforced.
- `lib/plan/batch.ts`: `renderBatch` with a persistent queue (`data/render-queue.hbp`, resumable, 3 attempts), `requestApprovals`, `scheduleApproved` (goes through `scheduleVerified`, so approval, window and idempotency are enforced there) and `planStatus` (status of every slot computed from the queue, approvals and receipt ledger).
- CLI: `campaign --client <slug> --days 30 [--start YYYY-MM-DD|next-month] [--per-week N] [--networks a,b] [--tz Zone] [--mix hero=0.2,...]`, `campaign render|approvals|schedule --client <slug>`, `calendar --client <slug> [--format table|markdown]`.
- `schedule install` (Linux cron) adds a day-25 job per client with a brand profile: plan the next month, render it, queue the approvals. Sending the approval link and scheduling stay manual. The macOS launchd scheduler does not get this job yet.

## Acceptance criteria

| Criterion | Result |
| --- | --- |
| The 30-day plan validates against its schema and respects per-network limits | done (`tests/unit/content-plan.test.ts`, `frequencyViolations`) |
| In `DRY_RUN` the e2e generates the plan plus dry-run receipts for every approved piece | done (`e2e/campaign-calendar.spec.ts`) |
| Re-running never duplicates a schedule (piece + network + date) | done (e2e and `tests/integration/plan-batch.test.ts`) |
| Pieces beyond 30 days never reach the publisher | done (a counting publisher in the integration test, `queued_next_cycle` in the e2e) |
| Paperclip view | only text is produced (`calendar --format markdown`); no cards are created |

## Notes

A plan that starts tomorrow has its last day just past the 30-day horizon, so that day is marked `next_cycle`; this is the intended behaviour of the window rule, not a bug.
