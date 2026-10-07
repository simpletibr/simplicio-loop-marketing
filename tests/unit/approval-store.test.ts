import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import {
  findApproval,
  listDecisions,
  listRequests,
  openAdjustments,
  recordDecision,
  requestApproval,
  requestIdOf,
  requestToken,
  tokenMatches,
  mediaSha256Of,
  verifyApproval,
} from "../../lib/approval/store.ts";
import { renderApprovalPage } from "../../lib/approval/page.ts";
import { createApprovalHandler } from "../../lib/approval/webhook.ts";
import { checkActionGate } from "../../lib/gate/action-gate.ts";
import { loadSchemaRegistry } from "../../lib/contracts/registry.ts";
import { validateArtifact } from "../../lib/contracts/validate.ts";

const H1 = "a".repeat(64);
const H2 = "b".repeat(64);

function root(): string {
  return mkdtempSync(join(tmpdir(), "me-approval-"));
}

function req(r: string, hash = H1, piece = "PIECE-1") {
  return requestApproval(r, { client: "acme", pieceId: piece, month: "2026-10", mediaSha256: hash, preview: "p.mp4", captions: { tiktok: "legenda" } });
}

test("requests validate their inputs and are idempotent per piece and hash", () => {
  const r = root();
  const a = req(r);
  assert.equal(a.request_id, requestIdOf("acme", "PIECE-1", H1));
  assert.deepEqual(req(r), a);
  assert.equal(listRequests(r).length, 1);
  assert.throws(() => requestApproval(r, { client: "acme", pieceId: "p", month: "2026-10", mediaSha256: "short", preview: "x", captions: {} }), /64 hex/);
  assert.throws(() => requestApproval(r, { client: "acme", pieceId: "p", month: "2026-13", mediaSha256: H1, preview: "x", captions: {} }), /YYYY-MM/);
  assert.throws(() => requestApproval(r, { client: "../x", pieceId: "p", month: "2026-10", mediaSha256: H1, preview: "x", captions: {} }), /invalid client slug/);
});

test("decisions need a matching request, a name, and the client's text for change requests", () => {
  const r = root();
  req(r);
  assert.throws(() => recordDecision(r, { client: "acme", pieceId: "PIECE-1", mediaSha256: H2, decision: "approved", decidedBy: "ana" }), /no request/);
  assert.throws(() => recordDecision(r, { client: "acme", pieceId: "PIECE-1", mediaSha256: H1, decision: "approved", decidedBy: " " }), /decided_by/);
  assert.throws(() => recordDecision(r, { client: "acme", pieceId: "PIECE-1", mediaSha256: H1, decision: "changes_requested", decidedBy: "ana" }), /client's text/);
  const ok = recordDecision(r, { client: "acme", pieceId: "PIECE-1", mediaSha256: H1, decision: "approved", decidedBy: "ana" });
  assert.deepEqual(validateArtifact(ok, loadSchemaRegistry()).errors, []);
  assert.equal(listDecisions(r, { client: "acme" }).length, 1);
  assert.equal(listDecisions(r, { client: "other" }).length, 0);
});

test("verifyApproval binds the approval to piece, hash and the latest decision", () => {
  const r = root();
  req(r);
  assert.equal(verifyApproval(r, { pieceId: "PIECE-1", mediaSha256: H1, approvalRef: "nope" }).failure, "approval_missing");
  const a = recordDecision(r, { client: "acme", pieceId: "PIECE-1", mediaSha256: H1, decision: "approved", decidedBy: "ana" });
  assert.equal(verifyApproval(r, { pieceId: "PIECE-1", mediaSha256: H1, approvalRef: a.approval_id }).ok, true);
  assert.equal(findApproval(r, "PIECE-1", H1)?.approval_id, a.approval_id);
  assert.equal(verifyApproval(r, { pieceId: "PIECE-1", mediaSha256: H2, approvalRef: a.approval_id }).failure, "approval_hash_mismatch");
  assert.equal(verifyApproval(r, { pieceId: "OTHER", mediaSha256: H1, approvalRef: a.approval_id }).failure, "approval_missing");
  recordDecision(r, { client: "acme", pieceId: "PIECE-1", mediaSha256: H1, decision: "changes_requested", note: "trocar a musica", decidedBy: "ana" });
  assert.equal(verifyApproval(r, { pieceId: "PIECE-1", mediaSha256: H1, approvalRef: a.approval_id }).failure, "approval_not_approved");
  assert.equal(findApproval(r, "PIECE-1", H1), null);
});

test("change requests return to the queue with the client's text until the media is re-requested", () => {
  const r = root();
  req(r);
  recordDecision(r, { client: "acme", pieceId: "PIECE-1", mediaSha256: H1, decision: "changes_requested", note: "mais curto", decidedBy: "client:Ana" });
  const open = openAdjustments(r, "acme");
  assert.equal(open.length, 1);
  assert.equal(open[0]?.note, "mais curto");
  assert.equal(openAdjustments(r, "other").length, 0);
  req(r, H2);
  assert.equal(openAdjustments(r).length, 0, "a new render supersedes the open adjustment");
});

test("tokens are stable per request, differ across requests and reject tampering", () => {
  const r = root();
  const t = requestToken(r, "req-1");
  assert.equal(requestToken(r, "req-1"), t);
  assert.notEqual(requestToken(r, "req-2"), t);
  assert.equal(tokenMatches(r, "req-1", t), true);
  assert.equal(tokenMatches(r, "req-1", `${t.slice(0, -1)}0`), t.endsWith("0"));
  assert.equal(tokenMatches(r, "req-1", "short"), false);
});

test("mediaSha256Of hashes file contents", () => {
  const r = root();
  const file = join(r, "m.mp4");
  writeFileSync(file, "abc");
  assert.equal(mediaSha256Of(file), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("the approval page escapes client content, ships no scripts and no internal data", () => {
  const r = root();
  const request = requestApproval(r, {
    client: "acme",
    pieceId: "PIECE-<1>",
    month: "2026-10",
    mediaSha256: H1,
    preview: "previews/a.mp4",
    captions: { tiktok: '<script>alert("x")</script>', ig_reels: "ok" },
    publishAt: "2026-10-20T18:00:00.000Z",
  });
  const html = renderApprovalPage({ client: "acme", clientName: "Acme & Filhos", month: "2026-10", requests: [request], actionUrl: "https://forms.example.com/decide", tokenOf: (id) => requestToken(r, id) });
  assert.ok(!/<script/i.test(html), "no script tags");
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("Acme &amp; Filhos"));
  assert.ok(html.includes("form-action https://forms.example.com"));
  assert.ok(html.includes('name="decision" value="approved"') && html.includes('value="changes_requested"'));
  assert.ok(html.includes('width="540" height="960"'));
  assert.ok(!/cost|token_usage|llm-usage/i.test(html.replace(/name="token"/g, "")), "no internal fields");
  const empty = renderApprovalPage({ client: "acme", clientName: "Acme", month: "2026-10", requests: [], actionUrl: "/decide", tokenOf: () => "t" });
  assert.ok(empty.includes("Nenhuma peça aguardando") && empty.includes("form-action &#39;self&#39;"));
});

async function post(port: number, body: string, contentType = "application/x-www-form-urlencoded", method = "POST"): Promise<{ status: number; text: string }> {
  return new Promise((resolveReq, reject) => {
    const r = httpRequest({ host: "127.0.0.1", port, method, headers: { "content-type": contentType, "content-length": Buffer.byteLength(body) } }, (res) => {
      let text = "";
      res.on("data", (c) => (text += c));
      res.on("end", () => resolveReq({ status: res.statusCode ?? 0, text }));
    });
    r.on("error", reject);
    r.end(body);
  });
}

test("the webhook records valid decisions and refuses everything else", async () => {
  const r = root();
  const request = req(r);
  const server = createServer((rq, rs) => void createApprovalHandler(r)(rq, rs));
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const port = (server.address() as AddressInfo).port;
  try {
    const base = { client: "acme", piece_id: "PIECE-1", media_sha256: H1, request_id: request.request_id, token: requestToken(r, request.request_id), approver_name: "Ana" };
    const form = (o: Record<string, string>) => new URLSearchParams(o).toString();
    assert.equal((await post(port, "", undefined, "GET")).status, 405);
    assert.equal((await post(port, "{nope", "application/json")).status, 400);
    assert.equal((await post(port, form({ ...base, decision: "approved", token: "bad" }))).status, 403);
    assert.equal((await post(port, form({ ...base, decision: "maybe" }))).status, 400);
    assert.equal((await post(port, form({ ...base, decision: "approved", media_sha256: H2 }))).status, 400);
    assert.equal((await post(port, form({ ...base, decision: "changes_requested" }))).status, 400, "change request without text");
    assert.equal((await post(port, "a".repeat(20 * 1024))).status, 413);
    assert.equal(listDecisions(r).length, 0, "refused requests record nothing");

    const ok = await post(port, JSON.stringify({ ...base, decision: "approved" }), "application/json");
    assert.equal(ok.status, 200);
    assert.match(ok.text, /Aprovado/);
    const adj = await post(port, form({ ...base, decision: "changes_requested", note: "mudar o final" }));
    assert.equal(adj.status, 200);
    assert.match(adj.text, /ajuste/);
    assert.equal(listDecisions(r).at(0)?.decided_by, "client:Ana");
    assert.equal(listDecisions(r).length, 2);
  } finally {
    server.close();
  }
});

test("the action gate blocks schedule without a valid approval for this exact media", () => {
  const r = root();
  const base = { root: r, action: "schedule" as const, pieceId: "PIECE-1", mediaSha256: H1 };
  assert.match(checkActionGate({ ...base, approvalRef: undefined }).reasons.join(";"), /needs pieceId, approvalRef and mediaSha256/);
  assert.match(checkActionGate({ ...base, approvalRef: "x" }).reasons.join(";"), /approval_missing/);
  req(r);
  const a = recordDecision(r, { client: "acme", pieceId: "PIECE-1", mediaSha256: H1, decision: "approved", decidedBy: "ana" });
  const prev = process.env.DRY_RUN;
  try {
    process.env.DRY_RUN = "true";
    assert.equal(checkActionGate({ ...base, approvalRef: a.approval_id }).ok, true);
    assert.match(checkActionGate({ ...base, mediaSha256: H2, approvalRef: a.approval_id }).reasons.join(";"), /approval_hash_mismatch/);
    process.env.DRY_RUN = "false";
    assert.match(checkActionGate({ ...base, approvalRef: a.approval_id }).reasons.join(";"), /no valid human approval in data\/promotions\.jsonl/);
  } finally {
    if (prev === undefined) delete process.env.DRY_RUN; else process.env.DRY_RUN = prev;
  }
});
