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
