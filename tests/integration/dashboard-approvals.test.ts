import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { makeEvent } from "../../lib/dashboard/events.ts";
import { EventStore } from "../../lib/dashboard/store.ts";
import { SLA_RED_HOURS, SLA_YELLOW_HOURS, approvals, slaOf } from "../../lib/dashboard/views/approvals.ts";
import { startDashboard } from "../../lib/dashboard/server.ts";
import { syncDashboard, defaultSources } from "../../lib/observability/dashboard/index.ts";
import { evaluateAlerts } from "../../lib/dashboard/alerts.ts";
import { allPlans } from "../../lib/dashboard/model.ts";
import { listReceipts } from "../../lib/publish/publisher.ts";
import { recordDecision, requestApproval, requestToken } from "../../lib/approval/store.ts";
import { writeTuple } from "../../lib/yool/board.ts";
import { HOUR, emptyHost, planned, sha } from "../helpers/dashboard-fixture.ts";
import type { ViewContext } from "../../lib/dashboard/routes.ts";

const NOW = new Date("2026-10-10T12:00:00Z");
const inHours = (h: number): string => new Date(NOW.getTime() + h * HOUR).toISOString();

const saved = process.env.MARKETING_APPROVAL_PAGE_URL;
afterEach(() => (saved === undefined ? delete process.env.MARKETING_APPROVAL_PAGE_URL : (process.env.MARKETING_APPROVAL_PAGE_URL = saved)));

function ask(root: string, client: string, piece: string, hash: number, publishInHours: number | null, requestedHoursAgo = 5) {
  return requestApproval(root, { client, pieceId: piece, month: "2026-10", mediaSha256: sha(hash), preview: "p.mp4", captions: {}, ...(publishInHours === null ? {} : { publishAt: inHours(publishInHours) }), now: new Date(NOW.getTime() - requestedHoursAgo * HOUR) });
}

function ctxOf(root: string, store: EventStore, query = ""): ViewContext {
  return { root, store, sources: defaultSources(root), now: NOW, query: new URLSearchParams(query), alerts: () => [] };
}

function synced(root: string): EventStore {
  const store = new EventStore(root);
  syncDashboard(root, store);
  return store;
}

test("the colour follows the time to the post: red under 24 h or late, yellow under 72 h, green after", () => {
  assert.deepEqual([SLA_RED_HOURS, SLA_YELLOW_HOURS], [24, 72]);
  assert.equal(slaOf(-5), "red");
  assert.equal(slaOf(0), "red");
  assert.equal(slaOf(23.9), "red");
  assert.equal(slaOf(24), "yellow");
  assert.equal(slaOf(71.9), "yellow");
  assert.equal(slaOf(72), "green");
  assert.equal(slaOf(500), "green");
  assert.equal(slaOf(null), "unknown");
});

test("the client queue lists unanswered links with age, time to the post and colour, most urgent first", async () => {
  const { root } = emptyHost();
  ask(root, "lothus", "P-green", 1, 200, 30);
  ask(root, "lothus", "P-yellow", 2, 50);
  ask(root, "acme-us", "P-red", 3, 10, 2);
  ask(root, "acme-us", "P-late", 4, -6);
  ask(root, "acme-us", "P-nodate", 5, null);
  const d = await approvals(ctxOf(root, synced(root)));
  assert.equal(d.read_only, true);
  assert.deepEqual(d.client.map((i) => [i.piece_id, i.sla]), [["P-late", "red"], ["P-red", "red"], ["P-yellow", "yellow"], ["P-nodate", "unknown"], ["P-green", "green"]]);
  const red = d.client.find((i) => i.piece_id === "P-red")!;
  assert.deepEqual([red.age_hours, red.hours_to_post, red.publish_at, red.client], [2, 10, inHours(10), "acme-us"]);
  assert.equal(d.client.find((i) => i.piece_id === "P-green")!.age_hours, 30);
  assert.equal(d.client.find((i) => i.piece_id === "P-late")!.hours_to_post, -6);
  assert.equal(d.client.find((i) => i.piece_id === "P-nodate")!.hours_to_post, null);
  assert.deepEqual([d.summary.client, d.summary.red, d.summary.yellow], [5, 2, 1]);
  assert.deepEqual(d.sla_rule, { red_under_hours: 24, yellow_under_hours: 72 });
  assert.equal((await approvals(ctxOf(root, synced(root), "client=lothus"))).client.length, 2, "the client filter narrows the queue");
});

test("a request that carries no post date takes it from the plan slot", async () => {
  const { root } = emptyHost();
  const plan = planned(root, NOW, "lothus");
  const slot = plan.slots[0]!;
  ask(root, "lothus", slot.piece_id, 7, null);
  const d = await approvals(ctxOf(root, synced(root)));
  assert.equal(d.client[0]?.publish_at, slot.publish_at, "the plan slot dates a request that carries no date");
  assert.equal(d.client[0]?.network, slot.network);
});

test("a decision takes the piece off the client queue; new media needs a new request and shows again", async () => {
  const { root } = emptyHost();
  ask(root, "lothus", "P-1", 1, 10);
  ask(root, "lothus", "P-2", 2, 10);
  ask(root, "lothus", "P-3", 3, 10);
  recordDecision(root, { client: "lothus", pieceId: "P-1", mediaSha256: sha(1), decision: "approved", decidedBy: "client:Ana", now: NOW });
  recordDecision(root, { client: "lothus", pieceId: "P-2", mediaSha256: sha(2), decision: "changes_requested", note: "Troque o gancho. Fale comigo em ana@cliente.com.br ou +55 11 91234-5678.", decidedBy: "client:Ana", now: NOW });
  let d = await approvals(ctxOf(root, synced(root)));
  assert.deepEqual(d.client.map((i) => i.piece_id), ["P-3"]);
  assert.equal(d.adjustments.length, 1);
  const adj = d.adjustments[0]!;
  assert.deepEqual([adj.client, adj.piece_id, adj.decided_by], ["lothus", "P-2", "Ana"]);
  assert.match(adj.note, /Troque o gancho/, "the client's own words are shown");
  assert.doesNotMatch(adj.note, /ana@cliente|91234|5678/, "contact data is removed (LGPD)");
  assert.equal(adj.age_hours, 0);
  // P-2 comes back with new media: the old adjustment is superseded and the new request is waiting
  ask(root, "lothus", "P-2", 22, 10);
  d = await approvals(ctxOf(root, synced(root)));
  assert.deepEqual(d.client.map((i) => i.piece_id).sort(), ["P-2", "P-3"]);
  assert.equal(d.adjustments.length, 0, "a re-request closes the adjustment");
  assert.equal(d.client.filter((i) => i.piece_id === "P-2").length, 1, "the latest request per piece wins");
});

test("the link is only a page address from the operator's setting, never a token, and the page command is always offered", async () => {
  const { root } = emptyHost();
  const req = ask(root, "lothus", "P-1", 1, 10);
  let d = await approvals(ctxOf(root, synced(root)));
  assert.equal(d.client[0]?.link, null, "no page address set, no link invented");
  assert.match(d.client[0]?.page_command ?? "", /^marketing-engine approval page --client lothus --month 2026-10 /);
  process.env.MARKETING_APPROVAL_PAGE_URL = "https://aprovar.example/p/";
  d = await approvals(ctxOf(root, synced(root)));
  assert.equal(d.client[0]?.link, "https://aprovar.example/p/aprovacao-lothus-2026-10.html");
  const text = JSON.stringify(d);
  assert.equal(text.includes(requestToken(root, req.request_id)), false, "the decision token never reaches the panel");
  assert.doesNotMatch(text, /token/i);
});

test("the operator queue lists the owner's decisions with the credit estimate and impact, aged, and drops the done ones", async () => {
  const { root } = emptyHost();
  const store = new EventStore(root);
  const op = (key: string, hoursAgo: number, piece: string | undefined, data: Record<string, unknown>) =>
    makeEvent({ source: "t", key, ts: new Date(NOW.getTime() - hoursAgo * HOUR).toISOString(), kind: "approval_requested", ...(piece ? { piece_id: piece } : {}), data: { queue: "operator", ...data } });
  store.ingest([
    op("a", 2, "P-dub", { request: "Dublar 3 cortes em inglês", credit_estimate: 42.5, impact: "Entrega do cliente de sexta" }),
    op("b", 30, "P-addon", { reason: "Preço do add-on de legendas", credits: 10 }),
    op("c", 80, undefined, { request: "Regra do FINAL-COMANDO.md: publicar sem prévia", impact: "Contato em ceo@exemplo.com" }),
    op("d", 5, "P-done", { request: "Já resolvido", status: "done" }),
    makeEvent({ source: "t", key: "cl", ts: inHours(-1), kind: "approval_requested", client: "lothus", piece_id: "P-client", data: { queue: "client", request_id: "r1", media_sha256: sha(9) } }),
  ]);
  const d = await approvals(ctxOf(root, store));
  assert.deepEqual(d.operator.map((o) => [o.piece_id, o.sla]), [[null, "red"], ["P-addon", "yellow"], ["P-dub", "green"]], "oldest first; a day is yellow, three days red; done is gone; the client queue is not here");
  const dub = d.operator.find((o) => o.piece_id === "P-dub")!;
  assert.deepEqual([dub.request, dub.credit_estimate, dub.impact, dub.age_hours], ["Dublar 3 cortes em inglês", 42.5, "Entrega do cliente de sexta", 2]);
  assert.deepEqual([d.operator[1]?.request, d.operator[1]?.credit_estimate], ["Preço do add-on de legendas", 10], "reason and credits are accepted as the request and the estimate");
  assert.equal(d.operator[0]?.impact, "Contato em [email]", "free text is scrubbed");
  assert.equal(d.operator[0]?.credit_estimate, null, "no estimate is sem dado, not zero");
  assert.deepEqual([d.summary.operator, d.summary.red, d.summary.yellow], [3, 1, 1]);
});

test("an owner decision from the tuple board leaves the operator queue when its tuple is done, with or without a piece", async () => {
  const { root, eRoot } = emptyHost();
  const later = new Date(Date.now() + HOUR);
  const view = async () => approvals({ ...ctxOf(root, synced(root)), now: later });
  writeTuple(eRoot, { id: "human.approval_required", class: "human.approval_required", status: "pending", payload: { request: "Gastar créditos em cortes longos", credit_estimate: 80, impact: "Vídeo de sexta" } });
  writeTuple(eRoot, { id: "human.approval_required:P-9", class: "human.approval_required", status: "pending", payload: { reason: "Enviar prévia" } });
  let d = await view();
  assert.deepEqual(d.operator.map((o) => [o.piece_id, o.request, o.credit_estimate]).sort(), [[null, "Gastar créditos em cortes longos", 80], ["P-9", "Enviar prévia", null]]);
  writeTuple(eRoot, { id: "human.approval_required", class: "human.approval_required", status: "done" });
  writeTuple(eRoot, { id: "human.approval_required:P-9", class: "human.approval_required", status: "done" });
  d = await view();
  assert.deepEqual(d.operator, [], "done on the board clears both");
});

test("a client piece under 24 h without approval is red and becomes an alert", async () => {
  const { root } = emptyHost();
  ask(root, "lothus", "P-red", 1, 12);
  ask(root, "lothus", "P-ok", 2, 100);
  const store = synced(root);
  const d = await approvals(ctxOf(root, store));
  assert.equal(d.client.find((i) => i.piece_id === "P-red")?.sla, "red");
  const found = evaluateAlerts({ root, events: store.all(), plans: allPlans(root), receipts: listReceipts(root), now: NOW }).filter((a) => a.rule === "approval_due");
  assert.deepEqual(found.map((a) => [a.piece_id, a.severity]), [["P-red", "error"]]);
  recordDecision(root, { client: "lothus", pieceId: "P-red", mediaSha256: sha(1), decision: "approved", decidedBy: "client:Ana", now: NOW });
  const after = evaluateAlerts({ root, events: synced(root).all(), plans: [], receipts: [], now: NOW });
  assert.equal(after.some((a) => a.rule === "approval_due"), false, "answered, the alert is gone");
});

test("v1 has no approval action: every write method is refused and the page carries no decision control or token", async () => {
  const { root } = emptyHost();
  ask(root, "lothus", "P-1", 1, 10);
  const server = await startDashboard({ root, pollMs: 50 });
  try {
    const headers = { authorization: `Bearer ${server.token}` };
    const ok = await fetch(`${server.url}/api/approvals`, { headers });
    assert.equal(ok.status, 200);
    assert.equal(((await ok.json()) as { read_only: boolean }).read_only, true);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      for (const path of ["/api/approvals", "/api/approvals/approve", "/api/approve", "/api/approvals/r1/decision"]) {
        const res = await fetch(`${server.url}${path}`, { method, headers, body: method === "DELETE" ? undefined : "{}" });
        assert.ok(res.status === 405 || res.status === 404, `${method} ${path} -> ${res.status}`);
        if (path === "/api/approvals") assert.equal(res.status, 405);
      }
    }
    // the view code has no decision verbs wired to a request
    const view = readFileSync(resolve("lib/dashboard/ui/view-approvals.js"), "utf8");
    assert.doesNotMatch(view, /fetch\(|method:\s*["']POST|<form|createElement\(["']form|"form"/, "no request or form is built by the approvals page");
    assert.match(view, /Copiar link/);
  } finally {
    await server.close();
  }
});
