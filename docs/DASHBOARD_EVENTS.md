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
| `qa_result` | factory `result.json`, piece `qa-tech-specs.json` | `passed`, `resolution`, `lufs`, `freeze_s`, `cuts` |
| `compliance_result` | piece `compliance.json` | `pass`, `violations` |
| `watcher_gate` | watcher report | `passed`, `tag` |
| `approval_requested` | approval log (queue `client`), yool `human.approval_required` (queue `operator`) | `queue`, `request_id`, `media_sha256` |
| `approval_decided` | approval log | `decision`, `decided_by_role`, `media_sha256`, `note` |
| `scheduled` | publish receipt ledger | `publish_at`, `publisher`, `receipt_id`, `dry_run` |
| `published` | `publish_verified` event | |
| `publish_failed` | publish receipt ledger | `failure_class`, `publisher`, `publish_at` |
| `dubbing_requested`, `dubbing_finished` | dubbing receipts (`data/dubbing.hbp`, issue #165) | `language`, `route`, `ai_generated_voice`, `verdict`, `failure_class?` |
| `metrics_snapshot` | `data/analytics-snapshots.jsonl` | `metric`, `value`, `source` |
| `winner_marked` | yool `winner.promote` (done) | |
| `credit_spent` | `data/credits.jsonl` | `provider`, `credits`, `purpose`, `approved_by` (rows without it are dropped and counted) |
| `tts_quota` | `tts-bloqueado-ate.txt`, `data/tts-usage.jsonl` | `blocked_until`, `requests`, `limit`, `exhausted` |
| `payment_received` | verified Stripe webhooks (JSONL), `venda.json` | `amount`, `currency`, `processor`, `amount_brl?` |
| `subscription_changed` | Stripe `customer.subscription.*` | `status`, `plan`, `mrr?` |

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
