# Metrics loop (issue #166)

Per-post performance, winners, the next month's plan and the monthly report. Everything is read-only against the networks.

1. `metrics link --client <slug> --piece <id> --network <n> --publish-at <iso> --source <realoficial|youtube|instagram|tiktok> --id <post id>` ties a live post to the receipt that scheduled it (`data/post-links.hbp`). The receipt must exist.
2. `metrics collect --client <slug>` reads each source once and appends one snapshot per reported metric to `data/analytics-snapshots.jsonl`, with the `receipt_id`. DRY_RUN never touches the network. Credentials: `YOUTUBE_API_KEY`, `META_ACCESS_TOKEN` (Instagram Insights), `TIKTOK_ACCESS_TOKEN` (Display API `video.list`, scope `video.list`, the account owner's token). Real Oficial (`ro_get_social_analytics`, the first source to try) needs an MCP transport, so it is read by an MCP session, not by the CLI.
3. `metrics import --client <slug> --file numbers.json` records numbers read by hand (`source: "manual"`).
4. `metrics winners --client <slug> --month YYYY-MM` ranks the month's posts by views and marks the top 20% (at least one). With fewer than 3 posts that have views nothing is marked: no data, no winners.
5. `campaign --client <slug> --days 30 --start <date> --winners YYYY-MM` plans the next month with 40% of the slots as variations of those winners (same hook and angle, rotating `hook_variant`, `cutdown` and `slideshow`, with `variant_of` pointing at the winner). Without recorded winners the command fails instead of planning without them.
6. `metrics report --client <slug> --month YYYY-MM [--pdf]` writes `outputs/<client>/reports/<month>.md` (and `.pdf`): posts, views, top 3 and what changes next month.

A number a source did not report is never stored as zero and never summed as zero: the report prints "sem dado" and says how many posts a total covers. Posts that only have a dry-run receipt are labelled "simulação".

The platform answers in `tests/fixtures/analytics/` are written from the public API documentation, not recorded from a live account.
