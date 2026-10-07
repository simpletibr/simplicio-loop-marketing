# Issue 163: client approval link

Status: implemented and verified; hosting of the page and the delivery to the client are manual by design.

## What shipped

- `approval/v1` contract (`contracts/marketing-artifacts/v1/schemas/approval.schema.json`) with a fixture produced by the real store.
- `lib/approval/store.ts`: append-only HBP log of requests and decisions. A decision needs a prior request for the same piece and media hash; the latest decision wins; a new render (new hash) needs a new request. `verifyApproval` binds an approval to piece, hash and the latest decision.
- `lib/approval/page.ts`: self-contained mobile page (9:16 cards, `preload="none"` 540x960 previews, captions per network with the date, Approve / Request change buttons). No scripts, CSP, escaped content, no internal data.
- `lib/approval/webhook.ts`: `node:http` handler. Per-request HMAC token, 16 KiB body cap (413), strict field matching, never binds by itself.
- `marketing-engine approval request | page | record | serve | adjustments`.
- `lib/gate/action-gate.ts`: new `schedule` action. It always requires a valid `approval/v1` for the exact media hash; with `DRY_RUN=false` it also requires the existing human approval record.

## Acceptance criteria

| Criterion | Result |
| --- | --- |
| A piece without approval, or with a different hash, is blocked by the action-gate (e2e) | done: `e2e/approval.spec.ts` (action-gate test), `tests/unit/approval-store.test.ts` |
| The page works on a phone (9:16) and loads only light previews | done: Chromium at 390x844 in `e2e/approval.spec.ts` (no horizontal overflow, `preload="none"`, previews copied from the preview file, final render never referenced) |
| A change request returns to the queue with the client's text | done: `approval adjustments` and `openAdjustments`; superseded by a new request |

## Decisions left to the owner

Where the page and the webhook are hosted (Drive, private GitHub Pages or the box) and how the link reaches the client. The agent sends nothing to clients. `approval serve` binds `127.0.0.1` only.
