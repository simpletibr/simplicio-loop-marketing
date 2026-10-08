---
name: video-prompt-builder
description: Assembles a video generation prompt by picking the provider via PROVIDERS.md and delegating to the matching provider-specific builder
version: 0.1.0
---

# Video Prompt Builder

Generic, provider-agnostic dispatcher for video generation prompts. Reads the routing matrix in `.specs/architecture/PROVIDERS.md`, decides which provider should run the piece, and delegates to the right specialist (`higgsfield-prompt-builder`, `topview-prompt-builder`, `wavespeed-batch`, `hyperframes-prompt-builder`).

## When to invoke

- Any video generation step in the pipeline (`brief -> script -> creative` when creative type is video).
- When a piece declares `type: video` in `.specs/pieces/*.md`.
- A/B testing video hooks across providers and the orchestrator needs a single entry point.
- Re-running the same brief on a different provider after an A/B winner is picked.
- When an upstream agent has a brief but does not know which provider to choose.

## Inputs

- `brief`: object. Visual brief with at least `subject`, `motion`, `mood`, `aspect`, `duration_seconds`.
- `task_kind`: string. One of `cinematic_reel`, `motion_control`, `ugc_product_holder`, `product_demo`, `talking_head`, `batch_hook_test`, `motion_typography`, `data_viz_reel`, `programmatic_short`.
- `piece_path`: string, optional. Path to the piece file. May contain `provider_override.video`.
- `dry_run`: boolean, optional. When true, returns the resolved provider and parameters without calling the MCP.

## Process

1. Read `.specs/architecture/PROVIDERS.md` and parse the Video matrix into a `task_kind -> provider` map.
2. If `piece_path` is set and contains `provider_override.video`, use the override.
3. Else look up `task_kind` in the matrix. If unknown, fall back to the matrix default for `cinematic_reel`.
4. Verify the chosen provider has the env vars set (`HIGGSFIELD_MCP_ACTIVE`, `TOPVIEW_API_KEY`, `WAVESPEED_API_KEY`, `SIMPLICIO_VIDEO_BIN`).
5. Map provider to specialist skill: Higgsfield -> `higgsfield-prompt-builder`, Topview -> `topview-prompt-builder`, Wavespeed -> `wavespeed-batch`, simplicio-video -> `hyperframes-prompt-builder`.
6. Translate `brief` fields into the input shape the specialist expects.
7. Invoke the specialist and capture its `params` and `mcp_tool` output.
8. If `dry_run`, return the resolved provider, the params, and the MCP tool. Otherwise call the MCP and return the artifact reference.
9. Log the run to `data/video-usage.jsonl` with timestamp, provider, task_kind, and outcome.

## Outputs

- `provider_used`: string.
- `params`: object. Final parameter object ready for the MCP call.
- `mcp_tool`: string. The MCP tool name.
- `artifact_ref`: string, when not in dry_run. Path or URL to the generated video.
- `cost_estimate_usd`: number.

## Examples

### Example 1: cinematic reel routed to Higgsfield

Input: `{ brief: { subject: "model in linen suit", motion: "tracking shot", mood: "editorial", aspect: "9:16", duration_seconds: 6 }, task_kind: "cinematic_reel" }`
Output: `{ provider_used: "higgsfield", mcp_tool: "higgsfield_seedance_generate", params: {...} }`

### Example 2: UGC ad routed to Topview

Input: `{ brief: { subject: "skincare bottle held by avatar", motion: "static", mood: "friendly", aspect: "9:16", duration_seconds: 15 }, task_kind: "ugc_product_holder" }`
Output: `{ provider_used: "topview", mcp_tool: "topview_avatar_generate", params: {...} }`

### Example 3: weekly KPI reel routed to simplicio-video

Input: `{ brief: { headline: "Semana 21 em números", aspect: "9:16", duration_seconds: 12, variables: { leads: 42, delta_pct: 12 } }, task_kind: "programmatic_short" }`
Output: `{ provider_used: "simplicio-video", mcp_tool: "video_run", params: { composition_spec: {...}, render_args: {...} } }` — local render via the `hyperframes` + `hyperframes-cli` skills.

## Failure modes

- task_kind not in matrix: log a warning and use the cinematic_reel default.
- Required env var missing for the chosen provider: drop to the next provider in the matrix and surface a warning.
- Specialist skill returns an error: surface it and do not auto-retry on a different provider unless the caller opts in.
- Duration exceeds provider limit: trim to the provider max and surface a notice.

## Related skills

- `higgsfield-prompt-builder`: specialist for Soul, DoP, Seedance.
- `topview-prompt-builder`: specialist for UGC and avatar-driven ads.
- `wavespeed-batch`: specialist for cheap batch hook tests.
- `hyperframes-prompt-builder`: specialist for HTML-rendered motion typography, data-viz reels, and parametrized programmatic shorts.
- `llm-router`: separate dispatcher for text generation; same pattern, different domain.
- `qa-tech-specs`: validates the final video against the platform spec.
