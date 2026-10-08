# Issue 172: `marketing.*` events and source adapters

Status: PARTIAL. The contract, the idempotent store and all adapters are implemented and verified; two acceptance items need things this session did not have.

## What shipped

- Contract `simplicio.dashboard-event/v1` with the 21 `marketing.*` kinds (`lib/dashboard/events.ts`, schema and producer-generated fixture), documented in `docs/DASHBOARD_EVENTS.md`.
- `lib/dashboard/store.ts`: append-only HBP log, `seq` per event (the SSE id), dedupe by `event_id`, multi-writer safe reload, filters by client, campaign, piece and kind.
- Adapters in `lib/observability/dashboard/`: events log, loop journal, yool board, publish receipts, approvals, piece artifacts (manifest, compliance, QA, watcher, render manifest and voice), video-factory output folders, `lote.csv`, control spreadsheet CSV, `venda.json`, verified Stripe webhooks (JSONL), credit ledger, TTS quota, metric snapshots. JSONL sources are read incrementally with byte cursors.
- One source of truth per kind, so nothing is double counted.
- Contact data (e-mails, phones) is scrubbed from `data`; contact files are read through allow-lists.

## Acceptance criteria

| Criterion | Result |
| --- | --- |
| Real fixtures (a pilot prospect, a WJR/Lothus video) produce the expected event sequence (contract test) | PARTIAL: the sequence test passes on synthetic fixtures that follow the documented layout (`tests/fixtures/dashboard/`, `tests/integration/dashboard-sync.test.ts`). Captures from a real pilot batch were not available, so this is not claimed as the real-fixture test |
| Reprocessing the sources does not duplicate events | done (sync twice, new process, rebuilt log with the same ids, tailed logs add only new lines) |
| Contract documented in `docs/DASHBOARD_EVENTS.md`, pointing at simpletibr/simplicio-loop#1398 | done, with the caveat that the shared contract could not be read: the envelope is local and flagged for alignment |
