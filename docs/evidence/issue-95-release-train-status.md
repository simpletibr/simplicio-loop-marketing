# Issue 95: follow the latest compatible Loop core (release train)

Status: BLOCKED-EXTERNAL. The in-repo half exists and is tested; the half that needs the upstream Loop release, its signed component manifest and a running Loop core is not reachable from this build session. By the issue's own closing rule ("if implementation is missing, mark NEEDS-IMPLEMENTATION or BLOCKED, never complete") the issue stays open. Checked on 2026-10-08 against this tree.

## What exists in the repository and is covered by tests

| Step of the issue | State | Evidence |
| --- | --- | --- |
| 2 and 3: reconcile a candidate release and produce a deduplicated update | done in-repo | `scripts/reconcile-core-release.mjs` evaluates a `simplicio.component-release/v1` candidate against `extension/core.lock.json` and `extension/loop.marketing.json`, writes `artifacts/release-train/reconciliation.json`, and on `--apply-canary` rewrites the lock; `tests/integration/release-reconcile.test.ts` |
| 4: schema, capability and composed graph diff | done in-repo | `evaluateRelease` in `lib/release-train/core.ts` (schema diff, capability diff, order-independent graph hash); `tests/unit/release-train.test.ts` |
| 8: promote only a compatible green change | done in-repo, fail closed | breaking, revoked, unpinned, drifted or unconformant candidates are refused (`tests/unit/release-train.test.ts`) |
| 9: on a breaking change, a migration issue with the overlay diff, steps and rollback | done in-repo | the reconcile script writes `migration-issue.json` and exits 2; `tests/integration/release-reconcile.test.ts` |
| 10: keep the previous version for rollback | done | `extension/core.lock.json` pins Loop core 3.47.0 (stable) and keeps 3.38.0 in `previous`; `promoteLock` preserves the previous pin atomically |
| 12: versions and hashes in the receipt | done | `lib/release-train/receipt.ts` (`releaseIdentity`) |
| Benchmark | done | `tests/benchmark/release-train-perf.test.ts` |

These tests pass in the full gate of this branch (unit 366, integration 123, regression 22, e2e 345).

## What is left, and why it is blocked

- Steps 1, 5, 6, 7 and 11 need a real Loop core: `node bin/marketing-engine.mjs operator doctor --json` on this tree answers `BLOCKED`, reason `MANIFEST_REJECTED`, `core_version: null`, with the three required capabilities (`extension_manifest.validate`, `extension_receipts.read`, `extension_reconcile`) and the three modes (embedded, daemon, remote) all `false`: "Install a compatible simplicio-loop (3.38.1..3.99.99)". `simplicio-loop` is not installed in this environment, so conformance in embedded, daemon and remote modes, the sandboxed effects, recovery and exactly-once runs, and the p95, token, CPU and RSS measurements cannot be produced here.
- The upstream release still has to publish the signed `component-release.json` asset with the capabilities and conformance fields. The audit comments on the issue (2026-08-29 and 2026-09-02) say it did not, and the 3.47.0 pin in this repository was made from the public wheel digest instead (commit `8329ca8`, with the evidence in its message), because `reconcile-core-release.mjs` refuses a candidate without that conformance evidence.
- The repositories `simpletibr/simplicio-loop` and `wesleysimplicio/simplicio-loop` are not readable from this session (only this repository is configured), so whether a newer compatible release than 3.47.0 exists could not be checked, and the workflows that would open the deduplicated update pull request (`loop-core-release-train.yml`, `sync-loop-release.yml`) are not run: GitHub Actions are off for this work.

## What the owner has to do to unblock it

1. Publish (or point to) the signed `component-release.json` for the latest Loop core, with `requires_core`, protocols, overlays, effects and the conformance profile.
2. Install the compatible `simplicio-loop` where the conformance lane runs, then run `marketing-engine operator doctor --json` (it must stop answering `BLOCKED`) and the embedded, daemon and remote conformance.
3. Run `node scripts/reconcile-core-release.mjs --candidate <component-release.json>` and promote a green candidate as canary, then stable.
