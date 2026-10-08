/**
 * server.ts — the local, read-only backend of the distribution dashboard.
 *
 * Hardening, in the order a request meets it:
 *   - binds 127.0.0.1 only;
 *   - Host must be the loopback address of this server (DNS rebinding);
 *   - a browser Origin, when present, must be this server;
 *   - every `/api` route needs the session token (Bearer header, session
 *     cookie, or `?token=` for EventSource, which cannot set headers);
 *   - GET and HEAD only: there is no route that writes, approves, schedules,
 *     renders or spends;
 *   - strict CSP, nosniff, no-referrer, no-store on everything.
 *
 * Live updates are Server-Sent Events with `Last-Event-ID` replay, fed by a
 * cheap source-signature poll that runs the adapters when something changed.
 */

import { createReadStream, existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { syncDashboard, defaultSources, type SyncOptions } from "../observability/dashboard";
import { allowedRoots, contentTypeOf, mediaCandidate, parseRange, safeFile, type Variant } from "./media";
import { campaignDetail, clientDetail, listClients, pieceDetail } from "./queries";
import { EventStore, type StoredEvent } from "./store";
import { sourceSignature } from "./watch";
import { engineRoot } from "../clients/paths";
import { listReceipts } from "../publish/publisher";
import { buildViews, type DashboardAlert, type ViewRoute } from "./routes";
import type { ReadOnlyRo } from "./realoficial";
import { aliasMap, maskTree } from "./views/common";
import { receiptDetail } from "./views/status";
import { currentAlerts } from "./alerts";
import { postWebhook } from "../observability/failures";

const UI_DIR = resolve(fileURLToPath(new URL(".", import.meta.url)), "ui");
const UI_TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const COOKIE = "sl_session";
const HEARTBEAT_MS = 15_000;
const MAX_REPLAY = 1000;
const MAX_BUFFERED = 1_000_000;

export interface DashboardOptions {
  root: string;
  port?: number;
  token?: string;
  sources?: SyncOptions;
  /** How often the source signature is checked. */
  pollMs?: number;
  now?: () => Date;
  /** Extra read-only view routes (calendar, credits, ...). */
  views?: ViewRoute[];
  /** Read-only Real Oficial window; absent unless the operator enabled it and supplied a transport. */
  ro?: ReadOnlyRo;
  /** Active alerts for the views that show health. */
  alerts?: () => DashboardAlert[];
}

export interface DashboardServer {
  url: string;
  port: number;
  token: string;
  store: EventStore;
  /** Runs the adapters now; returns how many events were new. */
  syncNow(): number;
  /** Sends the alerts that began since the last call to the operator's webhook; does nothing unless the webhook is set. */
  notifyAlerts(): void;
  close(): Promise<void>;
}

function tokenMatches(expected: string, given: string | undefined | null): boolean {
  if (!given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

function cookieOf(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  return raw.split(";").map((c) => c.trim().split("=")).find(([k]) => k === name)?.[1];
}

function baseHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "cache-control": "no-store", "content-security-policy": CSP, "cross-origin-resource-policy": "same-origin", ...extra };
}

function sendJson(res: ServerResponse, status: number, body: unknown, head = false): void {
  const text = JSON.stringify(body);
  res.writeHead(status, baseHeaders({ "content-type": "application/json; charset=utf-8", "content-length": String(Buffer.byteLength(text)) }));
  res.end(head ? undefined : text);
}

function sendError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message });
}

export async function startDashboard(opts: DashboardOptions): Promise<DashboardServer> {
  const root = opts.root;
  const token = opts.token ?? randomBytes(24).toString("hex");
  const sources = { ...defaultSources(root), ...opts.sources };
  const store = new EventStore(root);
  const clients = new Set<ServerResponse>();
  const viewRoutes = new Map((opts.views ?? buildViews()).map((v) => [v.path, v]));
  let signature = "";
  let port = 0;

  const syncNow = (): number => {
    const added = syncDashboard(root, store, sources).added;
    signature = sourceSignature(root, sources);
    return added;
  };
  const nowFn = opts.now ?? (() => new Date());
  const alertsNow = opts.alerts ?? ((): DashboardAlert[] => currentAlerts(root, store.all(), nowFn()));

  // The one outbound path, off unless the operator sets the webhook: it carries only alerts that just began,
  // and a restart does not repeat the ones already active.
  const webhook = /^https?:\/\//.test(process.env.MARKETING_DASHBOARD_ALERT_WEBHOOK ?? "") ? (process.env.MARKETING_DASHBOARD_ALERT_WEBHOOK as string) : null;
  let announced: Set<string> | null = null;
  const notifyAlerts = (): void => {
    if (!webhook) return;
    const active = alertsNow();
    const fresh = announced === null ? [] : active.filter((a) => !announced?.has(a.key));
    announced = new Set(active.map((a) => a.key));
    if (fresh.length > 0) void postWebhook(webhook, { source: "simplicio-marketing-dashboard", alerts: fresh });
  };

  syncNow();
  notifyAlerts();
  const timer = setInterval(() => {
    const next = sourceSignature(root, sources);
    if (next !== signature) {
      syncNow();
      notifyAlerts();
    }
  }, opts.pollMs ?? 200);
  timer.unref();
  const alertTimer = setInterval(notifyAlerts, 60_000);
  alertTimer.unref();

  const heartbeat = setInterval(() => {
    for (const res of clients) res.write(": ping\n\n");
  }, HEARTBEAT_MS);
  heartbeat.unref();

  const onEvent = (event: StoredEvent): void => {
    for (const res of clients) {
      const conn = res as ServerResponse & { filter?: { client?: string; campaign?: string }; present?: boolean };
      if (conn.filter?.client && event.client !== conn.filter.client) continue;
      if (conn.filter?.campaign && event.campaign_id !== conn.filter.campaign) continue;
      if (res.writableLength > MAX_BUFFERED) {
        res.destroy();
        continue;
      }
      res.write(`id: ${event.seq}\nevent: marketing\ndata: ${JSON.stringify(present(event, conn.present === true))}\n\n`);
    }
  };
  store.bus.on("event", onEvent);

  /** Presentation mode (?present=1): client slugs and names become stable aliases before anything leaves the server. */
  const present = <T>(data: T, on: boolean): T => {
    if (!on) return data;
    const known = listClients(root, store);
    return maskTree(data, aliasMap(known.map((c) => c.slug)), new Map(known.filter((c) => c.name).map((c) => [c.name as string, `Cliente ${known.findIndex((k) => k.slug === c.slug) + 1}`])));
  };

  const hostOk = (req: IncomingMessage): boolean => {
    const host = req.headers.host;
    return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
  };
  const originOk = (req: IncomingMessage): boolean => {
    const origin = req.headers.origin;
    return !origin || origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
  };

  function serveStatic(res: ServerResponse, name: string, head: boolean): void {
    const file = resolve(UI_DIR, name);
    if (!file.startsWith(UI_DIR) || !existsSync(file) || !statSync(file).isFile()) return sendError(res, 404, "not found");
    const body = readFileSync(file);
    res.writeHead(200, baseHeaders({ "content-type": UI_TYPES[extname(file)] ?? "application/octet-stream", "content-length": String(body.length) }));
    res.end(head ? undefined : body);
  }

  function serveEvents(req: IncomingMessage, res: ServerResponse, url: URL): void {
    const client = url.searchParams.get("client") ?? undefined;
    const campaign = url.searchParams.get("campaign") ?? undefined;
    const lastId = Number(req.headers["last-event-id"] ?? url.searchParams.get("lastEventId") ?? 0) || 0;
    if (url.searchParams.get("format") === "json") {
      const after = Number(url.searchParams.get("after") ?? 0) || 0;
      const limit = Math.min(Number(url.searchParams.get("limit") ?? 200) || 200, MAX_REPLAY);
      const events = store.query({ afterSeq: after, client, campaign_id: campaign, limit });
      return sendJson(res, 200, present({ events, last_seq: store.lastSeq }, url.searchParams.get("present") === "1"));
    }
    res.writeHead(200, baseHeaders({ "content-type": "text/event-stream; charset=utf-8", connection: "keep-alive", "x-accel-buffering": "no" }));
    const masked = url.searchParams.get("present") === "1";
    Object.assign(res, { filter: { client, campaign }, present: masked });
    res.write(`retry: 2000\n: connected seq=${store.lastSeq}\n\n`);
    for (const event of store.query({ afterSeq: lastId, client, campaign_id: campaign, limit: MAX_REPLAY })) {
      res.write(`id: ${event.seq}\nevent: marketing\ndata: ${JSON.stringify(present(event, masked))}\n\n`);
    }
    clients.add(res);
    req.on("close", () => clients.delete(res));
  }

  function serveMedia(req: IncomingMessage, res: ServerResponse, pieceId: string, variant: string, head: boolean): void {
    if (variant !== "preview" && variant !== "final") return sendError(res, 404, "unknown variant");
    const candidate = mediaCandidate(root, sources.videosDir, pieceId, variant as Variant);
    const file = candidate ? safeFile(candidate, allowedRoots(root, sources.videosDir)) : null;
    if (!file) return sendError(res, 404, variant === "final" ? "no final render yet" : "no preview");
    const size = statSync(file).size;
    const type = contentTypeOf(file) as string;
    const range = parseRange(req.headers.range, size);
    if (range === "invalid") {
      res.writeHead(416, baseHeaders({ "content-range": `bytes */${size}` }));
      return void res.end();
    }
    const common = { "content-type": type, "accept-ranges": "bytes", "cache-control": "private, max-age=60" };
    if (range) {
      res.writeHead(206, baseHeaders({ ...common, "content-range": `bytes ${range.start}-${range.end}/${size}`, "content-length": String(range.end - range.start + 1) }));
    } else {
      res.writeHead(200, baseHeaders({ ...common, "content-length": String(size) }));
    }
    if (head) return void res.end();
    createReadStream(file, range ? { start: range.start, end: range.end } : undefined).pipe(res);
  }

  /** The confirmation or failure screenshot of a receipt, from the evidence folder only. */
  function serveEvidence(res: ServerResponse, receiptId: string, head: boolean): void {
    const shot = listReceipts(root).find((r) => r.receipt_id === receiptId)?.evidence?.screenshot;
    const dir = resolve(engineRoot(root), "data", "evidence");
    const file = shot && existsSync(dir) ? safeFile(shot, [realpathSync(dir)]) : null;
    if (!file) return sendError(res, 404, "no evidence");
    res.writeHead(200, baseHeaders({ "content-type": contentTypeOf(file) as string, "content-length": String(statSync(file).size), "cache-control": "private, max-age=60" }));
    if (head) return void res.end();
    createReadStream(file).pipe(res);
  }

  const server: Server = createServer((req, res) => {
    void (async () => {
      try {
        if (!hostOk(req)) return sendError(res, 403, "bad host");
        if (!originOk(req)) return sendError(res, 403, "bad origin");
        const head = req.method === "HEAD";
        if (req.method !== "GET" && !head) {
          res.writeHead(405, baseHeaders({ allow: "GET, HEAD", "content-type": "application/json; charset=utf-8" }));
          return void res.end(JSON.stringify({ error: "read-only: GET and HEAD only" }));
        }
        const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
        const path = url.pathname;
        const bearer = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : undefined;
        const authed = tokenMatches(token, bearer) || tokenMatches(token, cookieOf(req, COOKIE)) || tokenMatches(token, url.searchParams.get("token"));

        if (!path.startsWith("/api/")) {
          // Static UI. Opening the printed URL (`/?token=...`) trades the token for an HttpOnly cookie.
          if (tokenMatches(token, url.searchParams.get("token"))) {
            res.writeHead(302, baseHeaders({ location: "/", "set-cookie": `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/` }));
            return void res.end();
          }
          if (path === "/" || path === "/index.html") return serveStatic(res, "index.html", head);
          if (path === "/app.js" || path === "/style.css") return serveStatic(res, path.slice(1), head);
          if (/^\/ui\/(?:kit\/)?[a-z0-9-]{1,40}\.js$/.test(path) || path === "/ui/kit/simplicio-live.css") return serveStatic(res, path.slice(4), head);
          return sendError(res, 404, "not found");
        }
        if (!authed) return sendError(res, 401, "missing or invalid session token");

        const masked = url.searchParams.get("present") === "1";
        if (path === "/api/health") {
          return sendJson(res, 200, { ok: true, events: store.size, last_seq: store.lastSeq, sse_clients: clients.size, time: (opts.now ?? (() => new Date()))().toISOString() }, head);
        }
        if (path === "/api/events") return serveEvents(req, res, url);
        if (path === "/api/clients") return sendJson(res, 200, present({ clients: listClients(root, store, opts.now?.()) }, masked), head);
        let m: RegExpExecArray | null;
        if ((m = /^\/api\/clients\/([a-z0-9-]{1,64})$/.exec(path))) {
          const detail = clientDetail(root, store, m[1] as string);
          return detail ? sendJson(res, 200, present(detail, masked), head) : sendError(res, 404, "unknown client");
        }
        if ((m = /^\/api\/campaigns\/([A-Za-z0-9._-]{1,160})$/.exec(path))) {
          const detail = campaignDetail(root, store, m[1] as string);
          return detail ? sendJson(res, 200, present(detail, masked), head) : sendError(res, 404, "unknown campaign");
        }
        if ((m = /^\/api\/pieces\/([A-Za-z0-9._-]{1,160})$/.exec(path))) {
          const detail = pieceDetail(root, store, sources.videosDir, m[1] as string);
          return detail ? sendJson(res, 200, present(detail, masked), head) : sendError(res, 404, "unknown piece");
        }
        if ((m = /^\/api\/media\/([A-Za-z0-9._-]{1,160})\/([a-z]{1,16})$/.exec(path))) {
          return serveMedia(req, res, m[1] as string, m[2] as string, head);
        }
        if ((m = /^\/api\/receipts\/([a-f0-9]{20})$/.exec(path))) {
          const detail = receiptDetail({ root }, m[1] as string);
          return detail ? sendJson(res, 200, present(detail, masked), head) : sendError(res, 404, "unknown receipt");
        }
        if ((m = /^\/api\/evidence\/([a-f0-9]{20})$/.exec(path))) return serveEvidence(res, m[1] as string, head);
        const view = viewRoutes.get(path);
        if (view) return sendJson(res, 200, present(await view.handle({ root, store, sources, now: (opts.now ?? (() => new Date()))(), query: url.searchParams, alerts: alertsNow, ro: opts.ro }), masked), head);
        return sendError(res, 404, "not found");
      } catch (error) {
        sendError(res, 500, error instanceof Error ? error.message.slice(0, 200) : "internal error");
      }
    })();
  });

  await new Promise<void>((done, fail) => {
    server.once("error", fail);
    server.listen(opts.port ?? 0, "127.0.0.1", done);
  });
  port = (server.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    token,
    store,
    syncNow,
    notifyAlerts,
    close: () =>
      new Promise<void>((done) => {
        clearInterval(timer);
        clearInterval(alertTimer);
        clearInterval(heartbeat);
        store.bus.off("event", onEvent);
        for (const res of clients) res.destroy();
        clients.clear();
        server.close(() => done());
        server.closeAllConnections?.();
      }),
  };
}
