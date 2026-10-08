# Derived formats and the long-video lane (issue #164)

A 30 day month is filled without 30 hero videos. The plan (`content-plan/v1`) carries a `format` and the resolved `route` of every slot.

| Format | Lane | Notes |
| --- | --- | --- |
| `hero` | `video-factory` | full video; the only one that needs a new voice take |
| `cutdown` (6 to 11 s) | `video-factory` | reuses the hero's cached voice, no new TTS |
| `hook_variant` | `video-factory` | new opening on the same cached voice |
| `slideshow` | `video-factory` | |
| `carousel` | `local-composition` | local composition; generated imagery is a separate, explicit request |
| `long_cut` | `realoficial-clips` | cuts of the client's long video; the only lane that spends credits |

`monthlyMix({ hasLongVideo })` (lib/plan/formats.ts) is the mix a month asks for: 4 hero, 6 cutdowns and 4 hook variants, 3 slideshows and 3 carousels, plus 4 long cuts when the client has lives or a YouTube channel. Pass it to the planner as `--mix hero=4,cutdown=6,hook_variant=4,slideshow=3,carousel=3,long_cut=4`; the planner turns counts into proportions.

## Long cuts (`marketing-engine clips`)

`ro_estimate_clips` -> the owner's OK -> `ro_create_clips` -> `ro_wait_for_clips` -> `ro_render_clip`.

- `clips --client <slug> --url <youtube-or-twitch-url> --estimate` only quotes.
- `clips ... ` in DRY_RUN (default) runs the whole flow with canned `ro_*` answers, spends nothing, writes no credit row and leaves a `realoficial-clips-receipt/v1` in `data/clips.hbp` (the video address is stored only as a hash).
- Live, `ro_create_clips` is irreversible, so the run is blocked unless the owner passes `--approved-by-wesley`; the quote must be unexpired and any term it lists (`tiktok`, `ai_video_terms`, ...) must be accepted with `--accept-terms`. The CLI cannot supply a Real Oficial transport, so only an MCP session can run it live.
- Every spend is a row in `data/credits.jsonl` with `approved_by` and `format`. A run that already charged is final: re-running never creates a second project.

## Cost per format

`marketing-engine cost --by-format [--client <slug>]` prints, for each format, the Real Oficial credits and the voice spend (cached voice costs nothing), from the credits ledger, the voice events and the plan.

## Not in this repository

The new video templates (slideshow, hook variants, cutdown) are issues of the video factory repository, opened only on the owner's order. Downloading the rendered clips into `outputs/` needs a live Real Oficial session.
