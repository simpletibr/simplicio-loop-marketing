# Dubbing and translation (issue #165)

Language versions of a piece for the target countries. `lib/dubbing/dubbing.ts` is the interface (`Dubbing.estimate()` and `Dubbing.dub()`), `marketing-engine dubbing` is the CLI.

## Which lane a language takes

| Lane | What happens | Cost | AI-voice label |
| --- | --- | --- | --- |
| `tts` | The voice provider re-records the translated script through the video factory (`intl`). The engine only records the hand-off. | voice provider | no |
| `realoficial-dub` | Real Oficial dubs the rendered clip with AI copies of the speakers' voices, then renders it. | free in Real Oficial | yes, always |
| `subtitle-only` | Real Oficial translates the captions; the original audio stays. | free in Real Oficial | no |

Default matrix (`DEFAULT_DUBBING_MATRIX`): `pt`, `en`, `es`, `de`, `fr`, `it`, `ja` go to `tts`; `zh`, `ar`, `hi` and every language not listed go to `realoficial-dub`. A client changes any entry in the `voice_routes` of its brand profile, by exact tag first and then by base language, for example `{"ar": "subtitle-only", "en-GB": "realoficial-dub"}`. `marketing-engine dubbing matrix --client <slug>` prints the matrix a client gets. The defaults are a starting point: they are to be confirmed by the per-language review below before scaling.

With `--subtitles` (or `subtitles: true`) the captions are translated in addition to the lane, for clients that want subtitles in every case.

## Safety

- `estimate()` never calls Real Oficial and never changes anything.
- `dub()` is blocked, with a receipt and no remote call, unless `approvedByWesley` is `true` (`--approved-by-wesley`).
- The one-time voice-rights consent is given by the owner in the Real Oficial app. When Real Oficial asks for it the receipt is `blocked` with `consent_required`; the engine never consents and never stores the consent link.
- A dub that is still processing is `blocked` with `not_ready`; run the same command again later. A language that was already dubbed is never dubbed twice.
- Every outcome is a `dubbing-receipt/v1` in `data/dubbing.hbp` and reaches the dashboard as `dubbing_requested` / `dubbing_finished`.
- DRY_RUN (the default) uses canned answers and spends nothing. A live run needs a Real Oficial transport injected by an MCP session; the CLI cannot provide one, so it never dubs live on its own.

## Human review of one video per language (before scaling)

Run once per new language, with a real video, and record the result in the PR or the client folder:

1. Play the dubbed MP4 end to end with a native speaker.
2. Voice: it is recognisably the same speaker, with no robotic artefacts, clipped words or wrong gender.
3. Meaning: the translation keeps the claim, the offer and the call to action; no prohibited claim appeared in translation.
4. Names, numbers, prices and currency are correct and spoken naturally.
5. Captions: burned-in text matches the audio, fits the safe area and is not cut off.
6. Timing: lip and cut rhythm still work; nothing important is spoken over the end card.
7. Label: the post says the voices are AI-generated (the receipt carries `ai_generated_voice`).
8. Decide the lane for the language (`tts`, `realoficial-dub` or `subtitle-only`) and put it in the client's `voice_routes` if it differs from the default.

## Pilot

A pilot in one language, with the owner's OK, a receipt, the credits and the review above, needs a live Real Oficial session and the voice-rights consent, and is not done from this repository.

## Assumptions to calibrate on the first live answer

The tools `ro_dub_clip`, `ro_translate_clips`, `ro_list_translations_and_dubs` and `ro_render_clip` are the official ones. The fixtures under `tests/fixtures/realoficial/ro-answers/` are written from their descriptions, not captured: the field names of the `ro_list_translations_and_dubs` rows (`items[]`, `status`, `dub_id`, `subtitle_translation_id`, `language`) are the part to confirm. Dub codes can be longer than caption codes (`arb` and `ar`), so languages are matched by prefix.
