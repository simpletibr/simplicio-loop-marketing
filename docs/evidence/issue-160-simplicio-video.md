# Issue 160: provider `simplicio-video` + `brand-profile/v1`

Status: implemented and verified under `DRY_RUN`; the live render with the real factory CLI is blocked by external setup.

## What shipped

- `lib/video/contract.ts`: deterministic `simplicio.video-contract/v1` YAML, the factory CLI runner (no shell), and `verifyRenderManifest` (strict shape plus sha256 of the MP4).
- `lib/providers/video.ts`: `SimplicioVideoProvider` replaces the old stub; the three matrix tasks that pointed at it now route to `simplicio-video`. Mock lives in `lib/providers/__mocks__/video.ts` and writes a verifiable render manifest.
- `contracts/marketing-artifacts/v1/schemas/brand-profile.schema.json` + fixture produced by the real producer (`scripts/gen-fixtures.mjs`).
- `marketing-engine profile <url> --client <slug>` (`lib/cli/profile.ts`, `lib/profile/brand-profile.ts`): PII or robots violations are rejected, every fact keeps its source.
- Render evidence in `lib/publish/verify-pipeline.ts`: stage `render_manifest`, failure class `render_evidence_blocked`.

## Acceptance criteria

| Criterion | Result |
| --- | --- |
| `generate` with `DRY_RUN=false` + `SIMPLICIO_VIDEO_BIN` produces one real MP4 | BLOCKED-EXTERNAL: needs the factory CLI (Python, Node >= 22, ffmpeg) and credentials; the live path is exercised against a fake CLI in `tests/integration/simplicio-video-provider.test.ts` |
| `DRY_RUN=true` runs nothing external and uses a fixture manifest | done (`e2e/simplicio-video.spec.ts`) |
| `brand-profile/v1` validates and has a producer-generated fixture (drift gate) | done (`e2e/contracts.spec.ts`) |
| Unit and e2e green, no regression | see the gate below |
| Roadmap updated with the real command | done (`docs/ROADMAP-REALOFICIAL-VIDEOS.md`) |

## Open assumptions (verify on the first live run)

The factory repository was not reachable from this session, so these points are isolated in one place each and flagged in the roadmap: the CLI subcommands (`lib/video/contract.ts: cliArgs`, `lib/profile/brand-profile.ts: collectProspect`), the YAML field names (`serializeVideoContract`), and the render manifest shape (`RenderManifest`).

## Gate (this commit)

`npm run typecheck`, `npm run lint`: clean. `npm run test:unit` 298 pass. `npm run test:integration` 27 pass. `npm run test:regression` 22 pass. `npm run test:e2e` 267 pass. Coverage over all of `lib/**/*.ts` (merged node + Playwright V8 data): 85.97% lines. Bench: `video.contract-serialize` 343546 ops/sec (0.0029 ms/op); `video.render-manifest-verify` 2719 ops/sec (0.3678 ms/op, 256 KiB file).
