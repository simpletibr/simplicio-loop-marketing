# Dashboard events: `marketing.*` over `simplicio.dashboard-event/v1`

Contract for the distribution dashboard stream (epic #171, issue #172). The coding dashboard's shared contract lives in simpletibr/simplicio-loop#1398. That repository was not reachable from the session that built this, so the envelope below is a local definition (`contracts/marketing-artifacts/v1/schemas/dashboard-event.schema.json`, `$id` `simplicio.dashboard-event/v1`) that only adds the `marketing.*` namespace. Aligning field names with the shared contract is a follow-up for the owner; `lib/dashboard/events.ts` is the single place to change.

## Envelope

```json
{
  "schema": "simplicio.dashboard-event/v1",
  "event_id": "24 hex chars, derived from source + the source's own key",
  "ts": "ISO 8601 UTC",
  "kind": "marketing.<name>",
  "source": "which adapter produced it",
  "client": "client slug",
  "campaign_id": "plan id",
  "piece_id": "piece id",
  "network": "tiktok | ig_reels | yt_shorts",
  "severity": "info | warn | error",
  "data": {}
}
```

Hierarchy: `client -> campaign_id -> piece_id -> network`. The stored form (`data/dashboard-events.hbp`) adds a monotonic `seq`, which is the SSE event id.

## Idempotency and privacy

- `event_id = sha256(source + NUL + key)[0:24]`, where `key` is the source's own identity for the occurrence (byte offset of a log line, tuple id + version, receipt id + verdict + time, content hash of a file). Re-reading a source never duplicates an event, and deleting the log and syncing again rebuilds the same ids.
- Free text in `data` is scrubbed of e-mail addresses and phone numbers before it enters the stream (LGPD). Adapters read contact files through allow-lists of fields.
- Stripe amounts are in the original currency; `amount_brl` appears only when `PTAX_USD_BRL` is set and is labelled `fx: "estimate:env PTAX_USD_BRL"`. Missing metrics are never turned into zero.

## Kinds

| Kind | Source of truth | Main `data` fields |
| --- | --- | --- |
| `prospect_collected` | factory `coleta.json`, `lote.csv`, control spreadsheet CSV, `profile_built` event | `country`, `batch`, `status` |
| `script_ready` | loop journal (passing `copy` attempt) | `attempt` |
| `voice_rendered` | render manifest (`voice`) | `provider`, `seconds`, `cost_usd`, `cache_hit` |
| `render_started` | `piece_start` event | |
| `render_finished` | factory preview and final manifests, piece `manifest.hbi`, `render_failed` event | `stage` (`preview`/`final`), `ok`, `sha256`, `duration_s` |
| `qa_result` | factory `result.json`, piece `qa-tech-specs.json` | `passed`, `resolution`, `lufs`, `freeze_s`, `cuts`, `rules?` (rule ids of the tech-specs report) |
| `compliance_result` | piece `compliance.json` | `pass`, `violations`, `rules?` (rule ids only, never the matched text) |
| `watcher_gate` | watcher report | `passed`, `tag` |
| `approval_requested` | approval log (queue `client`), yool `human.approval_required` (queue `operator`) | `queue`, `request_id`, `media_sha256`; operator queue: `tuple_id`, `status`, `request` or `reason`, `credit_estimate` or `credits`, `impact` (from the tuple payload) |
| `approval_decided` | approval log | `decision`, `decided_by_role`, `media_sha256`, `note` |
| `scheduled` | publish receipt ledger | `publish_at`, `publisher`, `receipt_id`, `dry_run` |
| `published` | `publish_verified` event | |
| `publish_failed` | publish receipt ledger | `failure_class`, `publisher`, `publish_at` |
| `dubbing_requested`, `dubbing_finished` | dubbing receipts (`data/dubbing.hbp`, issue #165) | `language`, `route`, `ai_generated_voice`, `verdict`, `failure_class?` |
| `metrics_snapshot` | `data/analytics-snapshots.jsonl` | `metric`, `value`, `source` |
| `winner_marked` | yool `winner.promote` (done), winners ledger (`data/winners.hbp`, issue #166) | `month`, `metric`, `value`, `format`, `hook` |
| `credit_spent` | `data/credits.jsonl` | `provider`, `credits`, `purpose`, `approved_by` (rows without it are dropped and counted) |
| `tts_quota` | `tts-bloqueado-ate.txt`, `data/tts-usage.jsonl` | `blocked_until`, `requests`, `limit`, `exhausted` |
| `payment_received` | verified Stripe webhooks (JSONL), `venda.json` | `amount`, `currency`, `processor`, `amount_brl?` |
| `subscription_changed` | Stripe `customer.subscription.*` | `status`, `plan`, `mrr?`, `next_charge_at?` (the period end, from the subscription or its item; none once cancelled) |

One occurrence comes from exactly one source, so nothing is counted twice: scheduling, approvals, gates and final renders are read from their own artifacts, and the events log contributes only the kinds that no artifact owns.

## Factory output layout read by the adapters

Documented from the roadmap, not from the factory's code (not readable from the build session); the files are read, never written.

```
<out>/lote.csv                      slug,country,batch,status
<out>/<slug>/coleta.json            { country, batch, status, collected_at }   (allow-listed fields only)
<out>/<slug>/preview.manifest.json  { generated_at, output: { sha256, duration_s } }
<out>/<slug>/result.json            { generated_at, passed, resolution, lufs, freeze_s, cuts }
<out>/<slug>/render.manifest.json   { generated_at, output, voice: { provider, seconds, cost_usd, cache_hit } }
<out>/<slug>/venda.json             { status, amount, currency, processor, paid_at }
```

`<out>` is `SIMPLICIO_VIDEOS_OUT` (default `data/prospects`); the control spreadsheet export is `MARKETING_CONTROL_CSV` (default `data/controle-prospects.csv`, columns `slug,country,batch,status,updated_at`). The fixtures under `tests/fixtures/dashboard/` follow this layout and are synthetic reproductions: replacing them with captures of a real pilot prospect is pending.

## Approval queue and alerts (issues #182 and #184)

`GET /api/approvals` is read-only and has no decision control: deciding goes through `marketing-engine approval record` (an `approval/v1` record behind the action gate). The client queue is the approval log's requests with no decision for the same media hash, coloured by the time to the post (red under 24 h or late, yellow under 72 h, green after). The operator queue is the `human.approval_required` tuples whose status is not `done`, coloured by age. `MARKETING_APPROVAL_PAGE_URL` (optional) is the address where the month's approval page is published; without it the panel offers the command that generates the page, and never a token.

`GET /api/alerts` evaluates the rules in `lib/dashboard/alerts.ts` as a pure function of the event stream, the receipts and the plans. An alert exists exactly while its condition holds (it clears by itself), its `key` is rule plus subject (no duplicates) and `since` is when the condition began. Rules: post not published 15 min after its time, publish failed (by type), Real Oficial session expired or asking login or a check, connected accounts near the plan limit, Real Oficial balance below the minimum, voice quota exhausted (with the time it returns), client approval due, piece stuck in a step, QA or compliance failing in a row, month with too few scheduled posts, payment received with no delivery started.

Thresholds come from the environment: `MARKETING_ALERT_STUCK_HOURS` (48), `MARKETING_ALERT_MIN_SCHEDULED` (8), `MARKETING_ALERT_MIN_CREDITS` (50). Nothing is sent outside by default. The only outbound path is `MARKETING_DASHBOARD_ALERT_WEBHOOK` (an `http(s)` URL, unset by default): it receives `{ source, alerts }` with only the alerts that began since the last check, and the alerts already active when the panel starts are not repeated. Browser (desktop) notifications are opt-in in the Alertas section and live only in the browser.

## Funnel and revenue (issue #181)

`GET /api/funnel` is read-only and never a billing client: it reads the control spreadsheet export (`prospect_collected`), the factory's `venda.json` and the recorded Stripe webhook log (`payment_received`, `subscription_changed`). Filters: `client`, `country`, `batch`; `present=1` drops every per-client value (the per-client rows and the subscription list), keeping the totals.

A step counts everyone who got that far: collected, preview (a preview render, or the spreadsheet status `previa`/`preview`), sent (`enviada`/`enviado`/`sent`), replied (`respondeu`/`resposta`/`replied`), sale (a payment, or `vendido`/`venda`/`pago`/`fechado`/`sold`/`paid`), subscription (the latest `subscription_changed` is `active` or `trialing`; never from a spreadsheet status). Accents and case are ignored; a status with no step is counted as collected and reported in `unknown_statuses`. The reference for prospect to sale is about 2%.

Money keeps its original currency; reais are summed only when every payment carries `amount_brl` (else `brl: null` and `brl_missing`). A payment is recurring when its event type is `invoice.paid`, one-off otherwise. MRR sums the active subscriptions; churn is the cancellations of the last 30 days over (active + cancellations); the minimum is 3 months from the first active event (`minimum_until`, `minimum_met`). A client is `entregue` when `venda.json` says so or a final render finished after the first payment, `pago` before that.

AbacatePay sales arrive through `venda.json` (processor `abacatepay`); there is no reader for its webhook yet because its payload is not confirmed. Not billing: nothing here creates a charge, a subscription or a refund.

## Performance, winners and double down (issue #183)

`GET /api/performance` is read-only (filters `client`, `network`, `metric` = `views|likes|comments|shares|saves`, `days` for the growth curve). It reads the `metrics_snapshot` events of the metrics loop (issue #166), the winners ledger (`data/winners.hbp`) and the content plans.

- Ranking: the latest reading of each metric of each post, ranked by the chosen metric. A metric the source did not report is `null` ("sem dado"), never zero; a post without the chosen metric comes last and has no rank. Retention has no source and is listed in `unavailable_metrics`.
- Winners: each winner of the ledger with the slots of the plans that vary it (`variant_of`), their month, format, production stage (`planned` until an event exists) and views (`null` until measured).
- Comparison by format, by hook (the opening line, first two seconds) and by original or dubbed language (a piece with a finished dubbing receipt counts as dubbed): posts, measured posts, mean, median and total of the chosen metric over the measured posts only; a group with none has no mean.
- Growth per client: the sum of each post's latest views as of each day; a day with no reading is `null` (a gap), never zero.
- Previews load on demand: only the first 12 ranked posts that have a preview file show one, and with `preload="metadata"`. There is no thumbnail (still frame) source.

