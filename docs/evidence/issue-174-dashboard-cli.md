# Issue 174: `marketing-engine dashboard` and the client snapshot

Status: implemented and verified.

## What shipped

- `marketing-engine dashboard [--client <slug>] [--campaign <id>] [--port N] [--no-browser] [--json] [--present]` starts the local read-only server (`127.0.0.1`, session token) and prints the URL. `--client`, `--campaign` and `--present` travel in the URL hash for the UI. A second start returns the running instance instead of starting another.
- `--status [--json]` (exit 0 running, 1 not running; the token is never printed), `--stop [--json]` (SIGTERM to the recorded pid, waits for the state file to go away; a dead pid is cleaned up).
- `marketing-engine status` prints the dashboard URL when it is up (and this change also fixes `status`, which still read `runs.hbp` as JSON lines and therefore always showed no runs).
- `--snapshot <out.html> --client <slug> --month YYYY-MM [--present]`: a static, self-contained page of the client's month (calendar, status, results). No scripts and no external resources, and it never carries costs, credits, tokens, hashes, approver names, failure internals or another client's data. A simulated (DRY_RUN) schedule is labelled "agendado (simulação)" with a banner, "publicado" is claimed only for posts that already have metrics, and a missing metric is "sem dado". `--present` hides the client's name everywhere, captions included. Sending the page is always manual.

## Acceptance criteria

| Criterion | Result |
| --- | --- |
| CLI tests per flag | done: `e2e/dashboard-cli.spec.ts` (start, status, stop, second start, stale state, bad `--port`, missing `--snapshot` arguments, bad `--month`, `--present`) and `tests/unit/dashboard-snapshot.test.ts` |
| The snapshot opens offline and passes the "no internal fields" test (costs, tokens, other slugs) | done: loaded in Chromium with every non-file request blocked (none attempted); forbidden-string scan covers cost, usd, credit, token, sha256, approved_by, decided_by, publisher, dry_run, another client's slug and scripts |
