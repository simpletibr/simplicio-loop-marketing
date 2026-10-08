# Issue 186: Langflow and Mermaid/image of the whole flow

Status: PARTIAL. The flow file, the generator, the Mermaid, the SVG, the PNG, the Langflow file, the drift and determinism tests and the README section are done and verified, with local validation only (no GitHub Actions). Not done and not claimed: the import into a running Langflow 1.12.0 (Langflow is not installed in this environment, so there is no `GET /api/v1/flows/{id}` and no screenshot), the generation by `simplicio-mapper flow` / `simplicio map --flow` (those tools and the `simplicio.flow/v1` contract of simplicio-mapper#657 were not readable from this session; the shape used here is the one the issue describes, and `scripts/flow.mjs` is the local single-command generator), and the per-run diagram of what actually ran next to each execution report (this change is documentation and diagram only).

## What shipped

- `docs/flow/simplicio-loop-marketing.flow.json`: the single hand-kept source. 40 nodes (10 inputs, 18 steps, 10 outputs and 2 external effects) and 45 edges, one of them the declared feedback of the winners into the next plan. Each node names the files it comes from and, where it has them, the `marketing-engine` commands.
- `scripts/flow.mjs` (`npm run flow`, `npm run flow:check`): derives `docs/flow/simplicio-loop-marketing.mmd`, `.svg` (own layered layout, no dependency), `.png` (the SVG rasterised in the Chromium that the repo's e2e already uses) and `docs/flow/langflow/simplicio-loop-marketing.langflow.json` (one note per node, with its source, commands and what comes next). A PNG renderer that is missing is a stated block (exit 3), never a silent fallback. `--check` fails when a file is stale or the flow disagrees with the code.
- README (English and Portuguese): the image and the regeneration command.

## Acceptance criteria

| Criterion | Result |
| --- | --- |
| `docs/flow/` with the 4 artifacts, covering every input, step and output, no step left out | done: the test reads the command list from `marketing-engine help` and fails on a command that is not drawn or a node that is not connected |
| `*.langflow.json` imports and renders in the local Langflow 1.12.0 | NOT VERIFIED: Langflow is not installed here; the file is a flow of note nodes in the documented export shape |
| Mermaid validates with `mmdc`, SVG and PNG generated, explicit block if the renderer is missing | done: `@mermaid-js/mermaid-cli` 11.17.0 (run from a scratch folder, not a dependency of the repo) parsed and rendered the Mermaid, exit 0; the SVG and PNG are written; the PNG step exits 3 with a message when the browser is missing |
| Drift test: the flow references only files and commands that exist | done: `tests/unit/flow.test.ts` (also proves that a missing file, an unknown command, a command left out and an unconnected node are each reported) |
| Deterministic generation, same input same bytes | done: the test builds twice and compares, and compares with the committed files; `npm run flow:check` |
| README updated with the image and the command | done |
| Local validation only, no GitHub Actions | done |

To validate the Mermaid again: `npx --package @mermaid-js/mermaid-cli@11 mmdc -p <puppeteer config with the Chromium path and --no-sandbox> -i docs/flow/simplicio-loop-marketing.mmd -o /tmp/flow.svg`.

## Verification (full gate on this tree)

| Check | Command | Result |
| --- | --- | --- |
| Types | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Unit | `npm run test:unit` | 366 of 366 |
| Integration | `npm run test:integration` | 123 of 123 |
| Regression | `npm run test:regression` | 22 of 22 |
| System | `npm run test:e2e` | 345 passed |
| Coverage, all of `lib/**/*.ts` | `test:node` and Playwright V8 coverage merged, `c8 report --all` | statements and lines 89.17%, functions 89.68%, branches 79.45% (the generator lives in `scripts/`, outside that measure, and is exercised by `tests/unit/flow.test.ts`) |
| Benchmark | `npm run bench` | `flow.build` 0.75 ms/op (1337 ops/sec) |
| Freshness | `npm run flow:check` | up to date (40 nodes, 45 edges) |
