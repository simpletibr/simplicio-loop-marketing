import { test } from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync, appendFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startDashboard, type DashboardServer } from "../../lib/dashboard/server.ts";
import { parseRange } from "../../lib/dashboard/media.ts";
import { RO_READ_ONLY_TOOLS, RO_SPENDING_TOOLS, createReadOnlyRo } from "../../lib/dashboard/realoficial.ts";
import { buildBrandProfile, fixtureCollection, writeBrandProfile } from "../../lib/profile/brand-profile.ts";
import { planContent, savePlan } from "../../lib/plan/content-plan.ts";
import { requestApproval } from "../../lib/approval/store.ts";

const FIXTURES = resolve("tests/fixtures/dashboard");

function host(): { root: string; data: string } {
  const root = mkdtempSync(join(tmpdir(), "me-dash-srv-"));
  const data = join(root, ".marketing-engine", "data");
  mkdirSync(data, { recursive: true });
  cpSync(join(FIXTURES, "prospects"), join(data, "prospects"), { recursive: true });
  cpSync(join(FIXTURES, "stripe-webhooks.jsonl"), join(data, "stripe-webhooks.jsonl"));
  writeFileSync(join(data, "prospects", "lothus-pilot", "preview.mp4"), Buffer.from("0123456789abcdefghij"));
  mkdirSync(join(data, "prospects", "lothus-pilot", "final"), { recursive: true });
  return { root, data };
}

async function withServer<T>(root: string, fn: (s: DashboardServer) => Promise<T>, pollMs = 50): Promise<T> {
  const server = await startDashboard({ root, pollMs });
  try {
    return await fn(server);
  } finally {
    await server.close();
  }
}

const api = (s: DashboardServer, path: string, init: RequestInit = {}) =>
  fetch(`${s.url}${path}`, { ...init, headers: { authorization: `Bearer ${s.token}`, ...(init.headers as Record<string, string> | undefined) } });

function rawGet(port: number, path: string, headers: Record<string, string>): Promise<number> {
  return new Promise((done, fail) => {
    const req = httpRequest({ host: "127.0.0.1", port, path, headers }, (res) => {
      res.resume();
      res.on("end", () => done(res.statusCode ?? 0));
    });
    req.on("error", fail);
    req.end();
  });
}

test("the API needs the session token and trades it for a cookie on the first page load", async () => {
  const { root } = host();
  await withServer(root, async (s) => {
    assert.equal((await fetch(`${s.url}/api/health`)).status, 401);
    assert.equal((await fetch(`${s.url}/api/health`, { headers: { authorization: "Bearer nope" } })).status, 401);
    assert.equal((await api(s, "/api/health")).status, 200);
    assert.equal((await fetch(`${s.url}/api/health?token=${s.token}`)).status, 200, "EventSource cannot send headers");
    const page = await fetch(`${s.url}/?token=${s.token}`, { redirect: "manual" });
    assert.equal(page.status, 302);
    const cookie = page.headers.get("set-cookie") ?? "";
    assert.match(cookie, /HttpOnly; SameSite=Strict/);
    assert.equal((await fetch(`${s.url}/api/health`, { headers: { cookie: cookie.split(";")[0] as string } })).status, 200);
    const health = (await (await api(s, "/api/health")).json()) as { ok: boolean; events: number };
    assert.equal(health.ok, true);
    assert.ok(health.events > 5);
  });
});

test("Host and Origin checks, read-only methods and security headers", async () => {
  const { root } = host();
  await withServer(root, async (s) => {
    const auth = { authorization: `Bearer ${s.token}` };
    assert.equal(await rawGet(s.port, "/api/health", { ...auth, host: "evil.example" }), 403, "DNS rebinding");
    assert.equal(await rawGet(s.port, "/api/health", { ...auth, host: `127.0.0.1:${s.port}`, origin: "http://evil.example" }), 403);
    assert.equal(await rawGet(s.port, "/api/health", { ...auth, host: `localhost:${s.port}`, origin: `http://localhost:${s.port}` }), 200);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      for (const path of ["/api/health", "/api/clients", "/api/media/lothus-pilot/preview", "/api/events"]) {
        const res = await api(s, path, { method });
        assert.equal(res.status, 405, `${method} ${path}`);
        assert.equal(res.headers.get("allow"), "GET, HEAD");
      }
    }
    const res = await api(s, "/api/health");
    assert.match(res.headers.get("content-security-policy") ?? "", /default-src 'none'.*frame-ancestors 'none'/);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("referrer-policy"), "no-referrer");
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal((await api(s, "/api/health", { method: "HEAD" })).status, 200);
    assert.equal((await api(s, "/api/nope")).status, 404);
    assert.equal((await fetch(`${s.url}/secret.txt`)).status, 404);
    assert.equal((await fetch(`${s.url}/%2e%2e/%2e%2e/etc/passwd`)).status, 404);
  });
});

test("clients, campaigns and pieces come from the store and the repo artifacts", async () => {
  const { root } = host();
  const profile = buildBrandProfile(fixtureCollection("https://lothus.com.br"), { client: "lothus", url: "https://lothus.com.br", mode: "dry-run" });
  writeBrandProfile(root, profile);
  const plan = planContent({ client: "lothus", profile, start: "2026-10-08", days: 7, perWeek: 2, networks: ["tiktok"], now: new Date("2026-10-07T12:00:00Z") });
  savePlan(root, plan);
  await withServer(root, async (s) => {
    const list = (await (await api(s, "/api/clients")).json()) as { clients: Array<{ slug: string; has_profile: boolean; plans: string[]; name?: string }> };
    const lothus = list.clients.find((c) => c.slug === "lothus");
    assert.deepEqual([lothus?.has_profile, lothus?.name, lothus?.plans], [true, "Lothus", [plan.plan_id]]);
    assert.ok(list.clients.some((c) => c.slug === "wjr-pilot" && !c.has_profile), "clients known only from events are listed too");

    const detail = (await (await api(s, "/api/clients/wjr-pilot")).json()) as { slug: string; piece_rows: Array<{ piece_id: string }>; events_by_kind: Record<string, number> };
    assert.equal(detail.slug, "wjr-pilot");
    assert.ok(detail.piece_rows.some((p) => p.piece_id === "wjr-pilot"));
    assert.ok((detail.events_by_kind["marketing.payment_received"] ?? 0) >= 1);
    assert.equal((await api(s, "/api/clients/nobody")).status, 404);
    assert.equal((await api(s, "/api/clients/Bad_Slug")).status, 404);

    const campaign = (await (await api(s, `/api/campaigns/${plan.plan_id}`)).json()) as { plan: { plan_id: string }; slots: unknown[]; counts: Record<string, number> };
    assert.equal(campaign.plan.plan_id, plan.plan_id);
    assert.equal(campaign.slots.length, plan.slots.length);
    assert.equal(campaign.counts.planned, plan.slots.length);
    assert.equal((await api(s, "/api/campaigns/unknown-plan")).status, 404);

    const piece = (await (await api(s, "/api/pieces/lothus-pilot")).json()) as { events: unknown[]; media: { preview: boolean; final: boolean } };
    assert.ok(piece.events.length >= 5);
    assert.deepEqual(piece.media, { preview: true, final: false }, "the final only appears once it exists");
    assert.equal((await api(s, "/api/pieces/ghost")).status, 404);
  });
});

test("SSE streams new events within the poll interval and replays what a reconnecting client missed", async () => {
  const { root, data } = host();
  await withServer(root, async (s) => {
    const abort = new AbortController();
    const res = await fetch(`${s.url}/api/events?client=wjr-pilot&token=${s.token}`, { signal: abort.signal });
    assert.equal(res.headers.get("content-type"), "text/event-stream; charset=utf-8");
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const frames: Array<{ id: number; kind: string }> = [];
    const pump = (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return;
          buffer += decoder.decode(value, { stream: true });
          for (;;) {
            const end = buffer.indexOf("\n\n");
            if (end === -1) break;
            const frame = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const id = /^id: (\d+)/m.exec(frame)?.[1];
            const data = /^data: (.*)$/m.exec(frame)?.[1];
            if (id && data) frames.push({ id: Number(id), kind: (JSON.parse(data) as { kind: string }).kind });
          }
        }
      } catch {
        /* aborted */
      }
    })();
    const waitFor = async (n: number) => {
      const t0 = Date.now();
      while (frames.length < n && Date.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 10));
      assert.ok(frames.length >= n, `expected ${n} frames, got ${frames.length}`);
    };
    await waitFor(4); // replay of the wjr-pilot history
    assert.ok(frames.every((f, i) => i === 0 || (frames[i - 1] as { id: number }).id < f.id), "ids are increasing");
    const replayed = frames.length;
    const lastSeen = (frames.at(-1) as { id: number }).id;

    appendFileSync(join(data, "stripe-webhooks.jsonl"), `${JSON.stringify({ id: "evt_live", type: "invoice.paid", created: 1790002000, data: { object: { amount_paid: 500, currency: "usd", subscription_details: { metadata: { client: "wjr-pilot" } } } } })}\n`);
    await waitFor(replayed + 1);
    assert.equal(frames.at(-1)?.kind, "marketing.payment_received");
    abort.abort();
    await pump;

    // reconnect: only what happened after Last-Event-ID, no gap, no duplicate
    appendFileSync(join(data, "stripe-webhooks.jsonl"), `${JSON.stringify({ id: "evt_while_away", type: "invoice.paid", created: 1790003000, data: { object: { amount_paid: 700, currency: "usd", subscription_details: { metadata: { client: "wjr-pilot" } } } } })}\n`);
    const added = await new Promise<number>((done) => setTimeout(() => done(s.syncNow()), 0));
    assert.ok(added >= 0);
    const replay = (await (await fetch(`${s.url}/api/events?client=wjr-pilot&format=json&after=${lastSeen}&token=${s.token}`)).json()) as { events: Array<{ seq: number; event_id: string }>; last_seq: number };
    assert.ok(replay.events.length >= 1);
    assert.ok(replay.events.every((e) => e.seq > lastSeen));
    assert.equal(new Set(replay.events.map((e) => e.event_id)).size, replay.events.length);

    const sse = await fetch(`${s.url}/api/events?client=wjr-pilot&token=${s.token}`, { headers: { "last-event-id": String(lastSeen) } });
    const r2 = sse.body!.getReader();
    const first = new TextDecoder().decode((await r2.read()).value);
    assert.match(first, /retry: 2000/);
    assert.ok(!first.includes(`id: ${lastSeen}\n`), "events up to Last-Event-ID are not repeated");
    await r2.cancel();
  });
});

test("media: range requests, no final until it exists, and nothing outside the allowed folders", async () => {
  const { root, data } = host();
  await withServer(root, async (s) => {
    const full = await api(s, "/api/media/lothus-pilot/preview");
    assert.equal(full.status, 200);
    assert.equal(full.headers.get("accept-ranges"), "bytes");
    assert.equal(Buffer.from(await full.arrayBuffer()).toString(), "0123456789abcdefghij");
    const part = await api(s, "/api/media/lothus-pilot/preview", { headers: { range: "bytes=5-9" } });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get("content-range"), "bytes 5-9/20");
    assert.equal(Buffer.from(await part.arrayBuffer()).toString(), "56789");
    const tail = await api(s, "/api/media/lothus-pilot/preview", { headers: { range: "bytes=-4" } });
    assert.equal(Buffer.from(await tail.arrayBuffer()).toString(), "ghij");
    assert.equal((await api(s, "/api/media/lothus-pilot/preview", { headers: { range: "bytes=99-" } })).status, 416);
    assert.equal((await api(s, "/api/media/lothus-pilot/preview", { headers: { range: "garbage" } })).status, 416);
    assert.equal((await api(s, "/api/media/lothus-pilot/preview", { method: "HEAD" })).status, 200);
    assert.equal((await api(s, "/api/media/lothus-pilot/final")).status, 404, "the panel never renders a final");
    assert.equal((await api(s, "/api/media/lothus-pilot/other")).status, 404);

    writeFileSync(join(data, "prospects", "lothus-pilot", "final", "final.mp4"), "final bytes");
    assert.equal((await api(s, "/api/media/lothus-pilot/final")).status, 200);

    // path traversal in the piece id, plain and encoded
    for (const id of ["..", "../secrets", "%2e%2e%2fsecrets", "a%2fb", "a\\b"]) {
      assert.equal((await api(s, `/api/media/${id}/preview`)).status, 404, id);
    }
    // a symlink inside the allowed folder that points outside it
    const secret = join(mkdtempSync(join(tmpdir(), "me-secret-")), "leak.mp4");
    writeFileSync(secret, "secret");
    mkdirSync(join(data, "prospects", "evil"), { recursive: true });
    symlinkSync(secret, join(data, "prospects", "evil", "preview.mp4"));
    assert.equal((await api(s, "/api/media/evil/preview")).status, 404, "symlink escape");
    // an approval request whose preview path points outside the allowed folders
    requestApproval(root, { client: "acme", pieceId: "sneaky", month: "2026-10", mediaSha256: "a".repeat(64), preview: secret, captions: {} });
    assert.equal((await api(s, "/api/media/sneaky/preview")).status, 404, "approval preview outside the allowed folders");
    // only known media types are served
    writeFileSync(join(data, "prospects", "lothus-pilot", "notes.txt"), "x");
    assert.equal((await api(s, "/api/media/lothus-pilot/notes.txt")).status, 404);
  });
});

test("parseRange covers open, suffix and unsatisfiable ranges", () => {
  assert.equal(parseRange(undefined, 10), null);
  assert.deepEqual(parseRange("bytes=0-3", 10), { start: 0, end: 3 });
  assert.deepEqual(parseRange("bytes=4-", 10), { start: 4, end: 9 });
  assert.deepEqual(parseRange("bytes=-3", 10), { start: 7, end: 9 });
  assert.deepEqual(parseRange("bytes=5-500", 10), { start: 5, end: 9 });
  assert.equal(parseRange("bytes=10-12", 10), "invalid");
  assert.equal(parseRange("bytes=7-3", 10), "invalid");
  assert.equal(parseRange("bytes=-", 10), "invalid");
  assert.equal(parseRange("items=1-2", 10), "invalid");
});

test("the panel can only call the read-only Real Oficial tools, and caches them", async () => {
  assert.deepEqual([...RO_READ_ONLY_TOOLS], ["ro_whoami", "ro_list_projects", "ro_list_renders"]);
  assert.equal(RO_SPENDING_TOOLS.filter((t) => (RO_READ_ONLY_TOOLS as readonly string[]).includes(t)).length, 0);
  const calls: string[] = [];
  let clock = 1_000;
  const ro = createReadOnlyRo({ call: async (tool) => (calls.push(tool), { tool }) }, { ttlMs: 5 * 60_000, now: () => clock });
  const first = await ro.get("ro_whoami");
  assert.equal(first.cached, false);
  clock += 60_000;
  assert.equal((await ro.get("ro_whoami")).cached, true);
  clock += 5 * 60_000;
  assert.equal((await ro.get("ro_whoami")).cached, false);
  assert.deepEqual(calls, ["ro_whoami", "ro_whoami"]);
  for (const tool of RO_SPENDING_TOOLS) await assert.rejects(ro.get(tool as never), /not on the read-only allowlist/);
  assert.equal(calls.length, 2, "refused calls never reach the transport");
});

test("no dashboard source names a tool that spends credits or money", () => {
  const dir = resolve("lib/dashboard");
  const files: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|js|html)$/.test(name)) files.push(p);
    }
  };
  walk(dir);
  const spending = /ro_(create_clips|render_clip|render_clips|start_purchase|dub_clip|translate_clips|confirm_spend|confirm_publishing|cut_clip|edit_clip)|stripe\.(charges|paymentIntents|checkout)\.create/;
  for (const file of files.filter((f) => !f.endsWith("realoficial.ts"))) {
    assert.ok(!spending.test(readFileSync(file, "utf8")), `${file} references a spending tool`);
  }
});
