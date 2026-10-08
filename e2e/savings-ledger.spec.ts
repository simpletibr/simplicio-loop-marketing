import { test, expect } from "@playwright/test";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendSavingsEvent,
  estimateTokens,
  marketingLedgerPath,
  savingsSummary,
  verifyChain,
  ESTIMATOR,
  SAVINGS_SCHEMA,
} from "../lib/observability/savings";
import { encodeEnvelope, readHbp } from "../lib/formats/binary";

function seed(root: string, n: number): void {
  for (let i = 1; i <= n; i++) {
    const ev = appendSavingsEvent(root, {
      source: "loop:journal-skip",
      surfaces: ["generate"],
      tokens: { baseline_total: 1000 * i, actual_total: 100 * i },
      methodology: `baseline = estimated re-derivation cost (${ESTIMATOR})`,
      piece_id: `PIECE-sv-${i}`,
    });
    expect(ev).not.toBeNull();
  }
}

test("appendSavingsEvent builds an intact hash chain with estimated proof", () => {
  const root = mkdtempSync(join(tmpdir(), "me-savings-"));
  seed(root, 3);
  const lines = readHbp<any>(marketingLedgerPath(root));
  expect(lines).toHaveLength(3);
  expect(lines[0].prev_event_hash).toBeNull();
  expect(lines[1].prev_event_hash).toBe(lines[0].event_hash);
  expect(lines[2].prev_event_hash).toBe(lines[1].event_hash);
  for (const rec of lines) {
    expect(rec.schema).toBe(SAVINGS_SCHEMA);
    expect(rec.proof.kind).toBe("estimated");
    expect(rec.estimator).toBe(ESTIMATOR);
    expect(rec.tokens.saved_total).toBe(
      rec.tokens.baseline_total - rec.tokens.actual_total,
    );
  }
  const chain = verifyChain(root);
  expect(chain).toMatchObject({ ok: true, count: 3 });
});

test("verifyChain detects tampering", () => {
  const root = mkdtempSync(join(tmpdir(), "me-savings-tamper-"));
  seed(root, 2);
  const path = marketingLedgerPath(root);
  // Re-encode a valid envelope around a mutated body: the envelope checksum
  // passes, so only the hash chain can catch the edit.
  const rows = readHbp<any>(path);
  rows[0].tokens.baseline_total = 999999;
  writeFileSync(path, Buffer.concat(rows.map((row) => encodeEnvelope("HBP", row))));
  const chain = verifyChain(root);
  expect(chain.ok).toBe(false);
  expect(chain.reason).toBe("event_hash mismatch");
});

test("verifyChain rejects a raw byte flip through the envelope checksum", () => {
  const root = mkdtempSync(join(tmpdir(), "me-savings-flip-"));
  seed(root, 2);
  const path = marketingLedgerPath(root);
  const bytes = readFileSync(path);
  bytes[bytes.length - 3] ^= 0xff;
  writeFileSync(path, bytes);
  const chain = verifyChain(root);
  expect(chain.ok).toBe(false);
  expect(chain.reason).toBe("binary envelope checksum mismatch");
});

test("savingsSummary aggregates by source and never inflates", () => {
  const root = mkdtempSync(join(tmpdir(), "me-savings-sum-"));
  seed(root, 3);
  const s = savingsSummary(root);
  expect(s.count).toBe(3);
  expect(s.saved_total).toBe(900 + 1800 + 2700);
  expect(s.by_source["loop:journal-skip"].count).toBe(3);
  expect(s.chain.ok).toBe(true);
});

test("kill-switch suppresses writes; negative saved clamps to zero", () => {
  const root = mkdtempSync(join(tmpdir(), "me-savings-kill-"));
  process.env.SIMPLICIO_DISABLE_RUN_LOG = "1";
  try {
    expect(
      appendSavingsEvent(root, {
        source: "x",
        surfaces: [],
        tokens: { baseline_total: 10, actual_total: 1 },
        methodology: "m",
      }),
    ).toBeNull();
    expect(existsSync(marketingLedgerPath(root))).toBe(false);
  } finally {
    delete process.env.SIMPLICIO_DISABLE_RUN_LOG;
  }
  // Spending MORE than baseline is not "negative savings" — it clamps to 0.
  const ev = appendSavingsEvent(root, {
    source: "x",
    surfaces: [],
    tokens: { baseline_total: 10, actual_total: 50 },
    methodology: "m",
  });
  expect(ev?.tokens.saved_total).toBe(0);
  expect(ev?.tokens.pct_saved).toBe(0);
});

test("engine ledger never touches the runtime's savings-events.jsonl", () => {
  const root = mkdtempSync(join(tmpdir(), "me-savings-sep-"));
  seed(root, 1);
  expect(existsSync(join(root, ".simplicio", "ledger", "savings-events.jsonl"))).toBe(false);
  expect(existsSync(marketingLedgerPath(root))).toBe(true);
});

test("estimateTokens uses the labeled chars/4 heuristic", () => {
  expect(estimateTokens("x".repeat(400))).toBe(100);
  expect(estimateTokens("")).toBe(0);
});
