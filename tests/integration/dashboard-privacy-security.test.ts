import { test } from "node:test";
import assert from "node:assert/strict";
import { createConnection } from "node:net";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { makeEvent } from "../../lib/dashboard/events.ts";
import { EventStore, eventsLogPath } from "../../lib/dashboard/store.ts";
import { syncDashboard } from "../../lib/observability/dashboard/index.ts";
import { buildViews } from "../../lib/dashboard/routes.ts";
import { startDashboard, type DashboardServer } from "../../lib/dashboard/server.ts";
import { RO_READ_ONLY_TOOLS, createReadOnlyRo } from "../../lib/dashboard/realoficial.ts";
import { requestApproval, recordDecision } from "../../lib/approval/store.ts";
import { appendReceipt, receiptIdOf, scheduleKey, type ScheduleReceipt } from "../../lib/publish/publisher.ts";
import { writeTuple } from "../../lib/yool/board.ts";
import { buildSnapshot } from "../../lib/dashboard/snapshot.ts";
import { HOUR, emptyHost, planned, sha } from "../helpers/dashboard-fixture.ts";

const EMAIL = "joao.silva@exemplo.com.br";
const PHONE = "+55 11 91234-5678";
const COOKIE = "session=abc123secretcookie";
// any e-mail address, and a phone number written the way people write them (country code, area code, number)
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE_RE = /\+\d{2}[\s-]?\(?\d{2}\)?[\s-]?\d{4,5}[\s-]?\d{4}/;

/** A host whose every source carries a person's contact data, so that the test can look for it in every response. */
function worldWithContacts() {
  const { root, eRoot } = emptyHost();
  const now = new Date();
  const plan = planned(root, now, "lothus");
  const data = join(eRoot, "data");
  // factory folder: the contact fields are not on the allow-list of the adapter
  mkdirSync(join(data, "prospects", "lothus-pilot"), { recursive: true });
  writeFileSync(join(data, "prospects", "lothus-pilot", "coleta.json"), JSON.stringify({ country: "BR", batch: "b1", status: "coletado", contact: { name: "João da Silva", email: EMAIL, phone: PHONE }, email: EMAIL, phone: PHONE }));
  writeFileSync(join(data, "controle-prospects.csv"), `slug,country,batch,status,updated_at,email,telefone\nlothus-pilot,BR,b1,enviada,2026-10-01T10:00:00Z,${EMAIL},${PHONE}\n`);
  // free text fields that people fill in
  writeFileSync(join(data, "credits.jsonl"), `${JSON.stringify({ ts: now.toISOString(), client: "lothus", piece_id: "P1", provider: "realoficial", credits: 5, purpose: `cortes para ${EMAIL}`, approved_by: `wesley ${PHONE}` })}\n`);
  const slot = plan.slots[0]!;
  const key = scheduleKey({ pieceId: slot.piece_id, network: slot.network, publishAt: slot.publish_at });
  const receipt: ScheduleReceipt = { schema: "marketing-publish-receipt/v1", ts: now.toISOString(), piece_id: slot.piece_id, client: "lothus", provider: "realoficial-browser", publisher: "realoficial-browser", dry_run: false, verdict: "failed", claims_tag: "MEASURED", attempts: 1, stages: [{ stage: "schedule", ok: false, detail: `falhou para ${EMAIL} ${PHONE} com ${COOKIE}` }], failure_class: "layout_changed", network: slot.network, publish_at: slot.publish_at, approval_ref: "ap-1", media_sha256: "a".repeat(64), receipt_id: receiptIdOf(key), schedule_key: key };
  appendReceipt(root, receipt);
  requestApproval(root, { client: "lothus", pieceId: "P-adj", month: "2026-10", mediaSha256: sha(1), preview: "p.mp4", captions: {}, publishAt: new Date(now.getTime() + 10 * HOUR).toISOString() });
  recordDecision(root, { client: "lothus", pieceId: "P-adj", mediaSha256: sha(1), decision: "changes_requested", note: `Ligue para ${PHONE} ou escreva para ${EMAIL}`, decidedBy: `client:Ana ${EMAIL}` });
  writeTuple(eRoot, { id: "human.approval_required", class: "human.approval_required", status: "pending", payload: { request: `Falar com ${EMAIL}`, impact: `Cliente ${PHONE}` } });
  return { root, plan, receipt };
}

async function withServer<T>(root: string, fn: (s: DashboardServer) => Promise<T>, ro?: Parameters<typeof startDashboard>[0]["ro"]): Promise<T> {
  const server = await startDashboard({ root, pollMs: 50, ro });
  try {
    return await fn(server);
  } finally {
    await server.close();
  }
}

const get = (s: DashboardServer, path: string, headers: Record<string, string> = {}) => fetch(`${s.url}${path}`, { headers: { authorization: `Bearer ${s.token}`, ...headers } });

test("no contact data from any source reaches any response of the API", async () => {
  const { root, plan, receipt } = worldWithContacts();
  await withServer(root, async (s) => {
    s.syncNow();
    const clients = (await (await get(s, "/api/clients")).json()) as { clients: Array<{ slug: string }> };
    const paths = [
      "/api/health", "/api/clients", ...clients.clients.map((c) => `/api/clients/${c.slug}`), `/api/campaigns/${plan.plan_id}`,
      "/api/pieces/lothus-pilot", `/api/pieces/${plan.slots[0]!.piece_id}`, "/api/pieces/P-adj", `/api/receipts/${receipt.receipt_id}`,
      "/api/events?format=json&limit=1000", ...buildViews().map((v) => v.path), "/api/approvals?client=lothus", "/api/alerts?client=lothus",
    ];
    let scanned = 0;
    for (const path of paths) {
      for (const query of ["", path.includes("?") ? "&present=1" : "?present=1"]) {
        const res = await get(s, `${path}${query}`);
        assert.ok([200, 404].includes(res.status), `${path}${query} -> ${res.status}`);
        const body = await res.text();
        assert.doesNotMatch(body, EMAIL_RE, `${path}${query} carries an e-mail address`);
        assert.doesNotMatch(body, PHONE_RE, `${path}${query} carries a phone number`);
        for (const needle of [EMAIL, PHONE, "91234", "João da Silva", COOKIE, "abc123secretcookie"]) assert.equal(body.includes(needle), false, `${path}${query} carries "${needle}"`);
        scanned++;
      }
    }
    assert.ok(scanned >= 40, `only ${scanned} responses were scanned`);
    // and the same on the live stream: the first frames of an SSE connection
    const stream = await fetch(`${s.url}/api/events`, { headers: { authorization: `Bearer ${s.token}` } });
    const reader = (stream.body as ReadableStream<Uint8Array>).getReader();
    let text = "";
    for (let i = 0; i < 20 && text.length < 20_000; i++) {
      const chunk = await Promise.race([reader.read(), new Promise<{ done: true; value: undefined }>((r) => setTimeout(() => r({ done: true, value: undefined }), 300))]);
      if (chunk.done) break;
      text += new TextDecoder().decode(chunk.value);
    }
    await reader.cancel();
    assert.ok(text.includes("event: marketing"), "the stream replayed events");
    assert.doesNotMatch(text, EMAIL_RE);
    assert.doesNotMatch(text, PHONE_RE);
  });
});

test("contact data never enters the event store, in memory or on disk", () => {
  const { root } = worldWithContacts();
  const e = makeEvent({ source: "t", key: "k", ts: new Date().toISOString(), kind: "credit_spent", data: { purpose: `x ${EMAIL} ${PHONE}` } });
  assert.doesNotMatch(JSON.stringify(e), EMAIL_RE);
  assert.doesNotMatch(JSON.stringify(e), PHONE_RE);
  const store = new EventStore(root);
  syncDashboard(root, store);
  assert.ok(store.size > 0, "the sources produced events");
  const text = JSON.stringify(store.all());
  assert.doesNotMatch(text, EMAIL_RE);
  assert.doesNotMatch(text, PHONE_RE);
  assert.equal(text.includes("João da Silva"), false);
  assert.doesNotMatch(readFileSync(eventsLogPath(root)).toString("latin1"), /joao\.silva@/, "nor on disk");
});

test("the page for a client carries nothing internal, nothing of another client and no contact data", () => {
  const { root, plan } = worldWithContacts();
  const other = planned(root, new Date(), "acme-us");
  const month = plan.slots[0]!.publish_at.slice(0, 7);
  const { html, posts } = buildSnapshot(root, { client: "lothus", month });
  assert.ok(posts > 0 && html.includes("Lothus"), "it lists the client's own posts");
  assert.equal(html.includes("acme"), false, "no trace of another client");
  assert.equal(html.includes(other.slots[0]!.piece_id), false);
  for (const needle of [EMAIL, PHONE, "91234", "João da Silva", "abc123", "layout_changed", "failure_class", "sha256", "credits", "approved_by", "wesley", "dry_run", "publisher", "realoficial"]) assert.equal(html.toLowerCase().includes(needle.toLowerCase()), false, `the client page names "${needle}"`);
  assert.doesNotMatch(html, EMAIL_RE);
  assert.doesNotMatch(html, PHONE_RE);
  assert.doesNotMatch(html, /<script|\son[a-z]+=|https?:\/\//i, "no script, handler or external resource");
});

test("security: the server binds to the loopback only and every route needs the session token", async () => {
  const { root } = emptyHost();
  await withServer(root, async (s) => {
    const url = new URL(s.url);
    assert.equal(url.hostname, "127.0.0.1");
    // the socket is bound to the loopback address: connecting to it works, and the server was not given a wildcard address
    await new Promise<void>((done, fail) => {
      const c = createConnection({ host: "127.0.0.1", port: s.port }, () => { c.destroy(); done(); });
      c.on("error", fail);
    });
    const routes = ["/api/health", "/api/clients", "/api/events", "/api/events?format=json", ...buildViews().map((v) => v.path)];
    for (const path of routes) {
      assert.equal((await fetch(`${s.url}${path}`)).status, 401, `${path} without a token`);
      assert.equal((await fetch(`${s.url}${path}`, { headers: { authorization: "Bearer wrong" } })).status, 401, `${path} with a wrong token`);
      assert.equal((await fetch(`${s.url}${path}`, { headers: { cookie: "sl_session=wrong" } })).status, 401, `${path} with a wrong cookie`);
    }
  });
});

test("security: no route accepts a write, and the panel only ever reaches the read-only Real Oficial tools", async () => {
  const { root } = worldWithContacts();
  const called: string[] = [];
  const ro = createReadOnlyRo({ call: async (tool) => { called.push(tool); return tool === "ro_whoami" ? { credits: 100 } : { accounts: [] }; } });
  await withServer(root, async (s) => {
    s.syncNow();
    const paths = ["/api/health", "/api/clients", "/api/events?format=json", "/api/pieces/lothus-pilot", ...buildViews().map((v) => v.path)];
    for (const path of paths) {
      assert.equal((await get(s, path)).status, 200, path);
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        const res = await fetch(`${s.url}${path}`, { method, headers: { authorization: `Bearer ${s.token}` }, body: method === "DELETE" ? undefined : "{}" });
        assert.equal(res.status, 405, `${method} ${path}`);
      }
    }
    // static files, too
    for (const path of ["/", "/app.js", "/style.css", "/ui/dom.js"]) assert.equal((await fetch(`${s.url}${path}`, { method: "POST" })).status, 405, `POST ${path}`);
  }, ro);
  assert.ok(called.length > 0, "the views did read the account");
  assert.deepEqual(called.filter((t) => !(RO_READ_ONLY_TOOLS as readonly string[]).includes(t)), [], "only read tools");
});

test("security: path traversal and odd paths never read a file outside the panel", async () => {
  const { root } = worldWithContacts();
  await withServer(root, async (s) => {
    const attempts = [
      "/ui/..%2f..%2fpackage.json", "/ui/%2e%2e/%2e%2e/package.json", "/ui/../../package.json", "/..%2f..%2fetc/passwd", "/%2e%2e/%2e%2e/etc/passwd",
      "/api/media/..%2f..%2fetc%2fpasswd/preview", "/api/media/../../preview", "/api/pieces/..%2f..%2fpackage.json", "/api/receipts/..%2f..", "/api/evidence/..%2f..%2f..%2fetc%2fpasswd",
      "/api/clients/..%2f..", "/api/campaigns/..%2f..%2fpackage.json", "/ui/view-credits.js/..%2f..%2f..%2fpackage.json", "/ui/%00.js", "/ui/a.js%00.png",
    ];
    for (const path of attempts) {
      const res = await get(s, path);
      const body = await res.text();
      assert.ok(res.status >= 400 && res.status < 500, `${path} -> ${res.status}`);
      assert.equal(body.includes("root:x:") || body.includes('"name": "marketing-engine"'), false, `${path} leaked a file`);
    }
  });
});

test("security: the page loads no script or style from outside, and sets nothing inline", () => {
  const ui = resolve("lib/dashboard/ui");
  const html = readFileSync(join(ui, "index.html"), "utf8");
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, "no inline script");
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i, "no inline handler");
  assert.doesNotMatch(html, /\sstyle\s*=/i, "no inline style attribute");
  assert.doesNotMatch(html, /(src|href)=["']https?:/i, "no external resource");
  for (const file of readdirSync(ui).filter((f) => f.endsWith(".js"))) {
    const text = readFileSync(join(ui, file), "utf8");
    assert.doesNotMatch(text, /\bstyle:\s*["'`]/, `${file} sets an inline style attribute, which the CSP blocks`);
    assert.doesNotMatch(text, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function\(/, `${file} builds markup from strings`);
    // the SVG namespace is an identifier, not an address anything fetches
    assert.doesNotMatch(text.replaceAll("http://www.w3.org/2000/svg", ""), /https?:\/\//, `${file} names an external address`);
  }
  assert.doesNotMatch(readFileSync(join(ui, "style.css"), "utf8"), /@import|url\(\s*["']?https?:/i, "no external stylesheet or font");
});
