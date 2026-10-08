# Issue 173: real-time dashboard backend

Status: PARTIAL by scope split. The server, SSE with replay, the read API for clients, campaigns and pieces, and the media route are done and verified. The data routes `/api/calendar`, `/api/credits`, `/api/funnel` and `/api/approvals` are added by their own issues (#177, #180, #181, #182) through the view registry (`lib/dashboard/routes.ts`).

## What shipped

- `lib/dashboard/server.ts` (`node:http`, no new dependency): binds 127.0.0.1, checks `Host` (DNS rebinding) and `Origin`, requires the session token on every `/api` route (Bearer header, HttpOnly cookie obtained by opening `/?token=...`, or `?token=` for EventSource), answers only GET and HEAD (405 otherwise), sets CSP, nosniff, no-referrer and no-store.
- Live updates: SSE at `/api/events` with `Last-Event-ID` replay, `client` and `campaign` filters, heartbeat, a cap on buffered bytes per client, and a JSON mode (`?format=json&after=<seq>`). A cheap source signature (size + mtime of the files the adapters read) is polled every 200 ms and runs a sync only when it changes.
- Routes: `/api/health`, `/api/clients`, `/api/clients/{slug}`, `/api/campaigns/{id}`, `/api/pieces/{id}`, `/api/events`, `/api/media/{piece}/{variant}` (preview 540x960 or final, with range requests, only from inside the piece outputs and the video factory's output folder after resolving symlinks, only known media types, never a render).
- Real Oficial is read-only and off by default: `lib/dashboard/realoficial.ts` allows exactly `ro_whoami`, `ro_list_projects`, `ro_list_renders`, caches them for 5 minutes and never opens a transport of its own (the caller injects one).

## Acceptance criteria

| Criterion | Result |
| --- | --- |
| A new event in the JSONL reaches the SSE client in under 500 ms (p95); reconnection without loss | done: `e2e/dashboard-sse.spec.ts` measured p50=90 ms, p95=170 ms, max=190 ms over 25 samples with the default 200 ms poll; replay and no-duplicate reconnection in `tests/integration/dashboard-server.test.ts` |
| No route calls a tool that spends credits (explicit allowlist) | done: allowlist and TTL tests, plus a static test that no file under `lib/dashboard/` names a spending tool |
| Media served only from the allowed folders (path traversal test) | done: plain and encoded traversal, a symlink escape, an approval request whose preview points outside, and unknown media types are all 404 |
