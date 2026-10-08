import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MARKETING_KINDS, eventIdOf, makeEvent, scrubPii, shortKind } from "../../lib/dashboard/events.ts";
import { EventStore } from "../../lib/dashboard/store.ts";
import { parseCsv } from "../../lib/observability/dashboard/csv.ts";
import { parseJson, readLinesFrom } from "../../lib/observability/dashboard/jsonl.ts";
import { mapMarketingEvent } from "../../lib/observability/dashboard/internal.ts";
import { creditsPath, fromCredits, fromTtsQuota, fromTtsUsage, mapStripeEvent } from "../../lib/observability/dashboard/billing.ts";
import { loadSchemaRegistry } from "../../lib/contracts/registry.ts";
import { validateArtifact } from "../../lib/contracts/validate.ts";
import type { MarketingEvent } from "../../lib/observability/events.ts";

const TS = "2026-10-07T12:00:00Z";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "me-dash-"));
}

test("makeEvent builds a valid, deterministic envelope and scrubs contact data", () => {
  const e = makeEvent({ source: "s", key: "k", ts: TS, kind: "published", client: "acme", piece_id: "P1", network: "tiktok", data: { note: "fale com ana@example.com ou +55 11 91234-5678", ok: true, nested: { phone: "(11) 91234-5678" }, list: ["a@b.co"] } });
  assert.deepEqual(validateArtifact(e, loadSchemaRegistry()).errors, []);
  assert.equal(e.kind, "marketing.published");
  assert.equal(shortKind(e), "published");
  assert.equal(e.event_id, eventIdOf("s", "k"));
  assert.notEqual(eventIdOf("s", "k"), eventIdOf("s2", "k"));
  assert.equal(e.data.note, "fale com [email] ou [phone]");
  assert.deepEqual(e.data.nested, { phone: "[phone]" });
  assert.deepEqual(e.data.list, ["[email]"]);
  assert.equal(e.data.ok, true);
  assert.equal(makeEvent({ source: "s", key: "k", ts: "garbage", kind: "scheduled" }).ts, "1970-01-01T00:00:00.000Z");
  assert.throws(() => makeEvent({ source: "s", key: "k", ts: TS, kind: "nope" as never }), /unknown kind/);
  assert.equal(MARKETING_KINDS.length, 21);
});

test("scrubPii keeps ids, hashes and timestamps readable", () => {
  assert.equal(scrubPii("piece PIECE-lothus-20261020-tiktok at 2026-10-20T21:00:00.000Z"), "piece PIECE-lothus-20261020-tiktok at 2026-10-20T21:00:00.000Z");
  assert.equal(scrubPii("sha " + "a".repeat(64)), "sha " + "a".repeat(64));
  assert.equal(scrubPii("tel 11 91234 5678"), "tel [phone]");
  assert.equal(scrubPii("2026 10 08"), "2026 10 08");
});

test("the store is append-only, idempotent, ordered and survives a restart", () => {
  const root = tmp();
  const store = new EventStore(root);
  const a = makeEvent({ source: "s", key: "1", ts: TS, kind: "scheduled", client: "acme", campaign_id: "c1", piece_id: "P1" });
  const b = makeEvent({ source: "s", key: "2", ts: TS, kind: "published", client: "other", piece_id: "P2" });
  const seen: number[] = [];
  store.bus.on("event", (e) => seen.push(e.seq));
  assert.equal(store.ingest([a, b, a]).length, 2);
  assert.equal(store.ingest([a, b]).length, 0, "re-ingesting adds nothing");
  assert.deepEqual(seen, [1, 2]);
  assert.equal(store.lastSeq, 2);

  const reopened = new EventStore(root);
  assert.equal(reopened.size, 2);
  assert.equal(reopened.ingest([a]).length, 0);
  const c = makeEvent({ source: "s", key: "3", ts: TS, kind: "scheduled", client: "acme" });
  assert.equal(reopened.ingest([c])[0]?.seq, 3);

  assert.deepEqual(reopened.query({ client: "acme" }).map((e) => e.seq), [1, 3]);
  assert.deepEqual(reopened.query({ afterSeq: 1 }).map((e) => e.seq), [2, 3]);
  assert.deepEqual(reopened.query({ campaign_id: "c1" }).map((e) => e.seq), [1]);
  assert.deepEqual(reopened.query({ piece_id: "P2" }).map((e) => e.seq), [2]);
  assert.deepEqual(reopened.query({ kinds: ["marketing.published"] }).map((e) => e.seq), [2]);
  assert.deepEqual(reopened.query({ limit: 1 }).map((e) => e.seq), [3]);
  assert.equal(reopened.all().length, 3);
  // a second writer appended behind this instance's back: ingest reloads before it numbers
  const other = new EventStore(root);
  other.ingest([makeEvent({ source: "s", key: "4", ts: TS, kind: "scheduled" })]);
  assert.equal(reopened.ingest([makeEvent({ source: "s", key: "5", ts: TS, kind: "scheduled" })])[0]?.seq, 5);
});

test("the store refuses events that break the contract", () => {
  const store = new EventStore(tmp());
  const bad = { ...makeEvent({ source: "s", key: "x", ts: TS, kind: "scheduled" }), severity: "loud" } as never;
  assert.throws(() => store.ingest([bad]), /invalid event/);
  assert.equal(store.size, 0);
});

test("readLinesFrom is incremental, leaves partial lines and recovers from rotation", () => {
  const dir = tmp();
  const path = join(dir, "log.jsonl");
  assert.deepEqual(readLinesFrom(path, 0), { lines: [], next: 0 });
  writeFileSync(path, '{"a":1}\n{"a":2}\n{"a":');
  const first = readLinesFrom(path, 0);
  assert.deepEqual(first.lines.map((l) => l.text), ['{"a":1}', '{"a":2}']);
  assert.deepEqual(first.lines.map((l) => l.offset), [0, 8]);
  assert.equal(readLinesFrom(path, first.next).lines.length, 0, "the partial line waits");
  appendFileSync(path, "3}\n");
  assert.deepEqual(readLinesFrom(path, first.next).lines.map((l) => l.text), ['{"a":3}']);
  truncateSync(path, 4);
  assert.equal(readLinesFrom(path, 999).next, 0, "a file shorter than the cursor is read from the start");
  assert.equal(parseJson("{nope"), null);
  assert.deepEqual(parseJson('{"x":1}'), { x: 1 });
});

test("parseCsv handles quotes, doubled quotes, CRLF and blank lines", () => {
  const rows = parseCsv('slug,note\r\nacme,"a, b"\r\n\r\nzed,"say ""hi"""\n');
  assert.deepEqual(rows, [{ slug: "acme", note: "a, b" }, { slug: "zed", note: 'say "hi"' }]);
  assert.deepEqual(parseCsv(""), []);
});

test("marketing-event lines map only the kinds no artifact owns; the rest are ignored", () => {
  const ev = (over: Partial<MarketingEvent>): MarketingEvent => ({ schema: "marketing-event/v1", ts: TS, run_id: "r", kind: "x", level: "info", client: "acme", piece_id: "P1", ...over });
  const kindOf = (e: MarketingEvent) => mapMarketingEvent(e, "0")?.kind;
  assert.equal(kindOf(ev({ kind: "profile_built" })), "marketing.prospect_collected");
  assert.equal(kindOf(ev({ kind: "piece_start" })), "marketing.render_started");
  const failed = mapMarketingEvent(ev({ kind: "render_failed", level: "warn" }), "0");
  assert.equal(failed?.kind, "marketing.render_finished");
  assert.equal(failed?.data.ok, false);
  assert.equal(failed?.severity, "warn");
  assert.equal(kindOf(ev({ kind: "publish_verified", verdict: "published", provider: "dry-run" })), "marketing.published");
  // owned by the receipt ledger, the approval log and the piece artifacts: never double counted
  for (const kind of ["scheduled", "publish_failed", "publish_attempt", "approval_requested", "approval_decided", "manifest_written", "gate_pass", "gate_fail", "loop_start"]) {
    assert.equal(kindOf(ev({ kind })), undefined, kind);
  }
});

test("stripe events map to payments and subscription changes, FX is labelled as an estimate", () => {
  const stripe = (type: string, object: object, id = "evt") => ({ id, type, created: 1790000000, data: { object } });
  const checkout = mapStripeEvent(stripe("checkout.session.completed", { amount_total: 35600, currency: "usd", payment_status: "paid", metadata: { client: "wjr" } }));
  assert.equal(checkout?.kind, "marketing.payment_received");
  assert.equal(checkout?.data.amount, 356);
  assert.equal(checkout?.client, "wjr");
  assert.equal(checkout?.data.amount_brl, undefined, "no rate configured: no invented BRL value");
  assert.equal(mapStripeEvent(stripe("checkout.session.completed", { payment_status: "unpaid" })), null);

  process.env.PTAX_USD_BRL = "5.5";
  try {
    const invoice = mapStripeEvent(stripe("invoice.paid", { amount_paid: 10000, currency: "usd", subscription_details: { metadata: { client: "wjr" } } }));
    assert.equal(invoice?.data.amount_brl, 550);
    assert.match(String(invoice?.data.fx), /estimate/);
    const sub = mapStripeEvent(stripe("customer.subscription.created", { status: "active", metadata: { client: "wjr", plan: "pacote-4" }, items: { data: [{ quantity: 2, price: { id: "p", unit_amount: 10000, currency: "usd", recurring: { interval: "month" } } }] } }));
    assert.equal(sub?.data.mrr, 200);
    assert.equal(sub?.data.plan, "pacote-4");
    const brlInvoice = mapStripeEvent(stripe("invoice.paid", { amount_paid: 5000, currency: "brl" }));
    assert.equal(brlInvoice?.data.fx, "native");
  } finally {
    delete process.env.PTAX_USD_BRL;
  }
  const canceled = mapStripeEvent(stripe("customer.subscription.deleted", { status: "active", items: { data: [] } }));
  assert.equal(canceled?.data.status, "canceled");
  assert.equal(canceled?.severity, "warn");
  assert.equal(canceled?.data.mrr, undefined);
  assert.equal(mapStripeEvent(stripe("charge.refunded", {})), null);
});

test("credit rows without an approver are rejected and counted; the rest become credit_spent", () => {
  const root = tmp();
  mkdirSync(join(root, "data"), { recursive: true });
  const rows = [
    { ts: TS, client: "acme", piece_id: "P1", provider: "realoficial", credits: 40, purpose: "clips", approved_by: "wesley" },
    { ts: TS, client: "acme", provider: "realoficial", credits: 10, purpose: "dub" },
    { ts: TS, provider: "realoficial", credits: Number.NaN, purpose: "x", approved_by: "wesley" },
  ];
  writeFileSync(creditsPath(root), `${rows.map((r) => JSON.stringify(r)).join("\n")}\nnot json\n`);
  const result = fromCredits(root, 0);
  assert.equal(result.events.length, 1);
  assert.equal(result.rejected, 3);
  assert.equal(result.events[0]?.kind, "marketing.credit_spent");
  assert.equal(result.events[0]?.data.approved_by, "wesley");
  assert.equal(fromCredits(root, result.next).events.length, 0, "the cursor skips what was read");
});

test("tts quota comes from the blocked-until file and the usage log", () => {
  const root = tmp();
  mkdirSync(join(root, "data"), { recursive: true });
  assert.deepEqual(fromTtsQuota(root), []);
  writeFileSync(join(root, "data", "tts-bloqueado-ate.txt"), "2026-10-07T21:27:00Z\n");
  const quota = fromTtsQuota(root);
  assert.equal(quota[0]?.severity, "warn");
  assert.equal(quota[0]?.data.blocked_until, "2026-10-07T21:27:00.000Z");
  writeFileSync(join(root, "data", "tts-bloqueado-ate.txt"), "not a date");
  assert.deepEqual(fromTtsQuota(root), []);

  writeFileSync(join(root, "data", "tts-usage.jsonl"), `${JSON.stringify({ ts: TS, requests: 3, limit: 10 })}\n${JSON.stringify({ ts: TS, requests: 10, limit: 10 })}\n{"ts":1}\n`);
  const usage = fromTtsUsage(root, 0);
  assert.deepEqual(usage.events.map((e) => [e.severity, e.data.exhausted]), [["info", false], ["warn", true]]);
});
