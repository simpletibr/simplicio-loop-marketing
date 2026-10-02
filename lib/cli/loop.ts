/**
 * loop.ts — the autonomous marketing loop: drain the piece backlog with
 * durable attempt memory, evidence gates, and auditable state.
 *
 * One iteration = triage (journal verdicts) → generate each actionable
 * draft piece (in-process, same gates as `marketing-engine generate`) →
 * record every attempt in the journal → promote pass at the end.
 *
 * Anti-oscillation: an item whose last K attempts failed with the same
 * fingerprint is STALLED — the loop skips it (and books the avoided
 * re-derivation as an ESTIMATED savings receipt) instead of retrying the
 * same failure forever. Stop conditions: backlog drained, everything
 * remaining STALLED/blocked, or the --max-iter cap.
 *
 * Optional operator bridge (fail-open): with MARKETING_LOOP_PY_WORKERS=1
 * and the simplicio-loop workers resolvable, verdicts are mirrored into
 * the Python journal (.simplicio-loop/orchestrator/loop/) so the agent-session operator
 * sees the same attempt memory. Absence never blocks the TS loop.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { listPieces } from "../pieces/store";
import { transitionStatus } from "../pieces/store";
import type { ParsedPiece } from "../pieces/frontmatter";
import { processPiece } from "./generate";
import { runPromoteLoop } from "./promote";
import { emitEvent } from "../observability/events";
import { appendSavingsEvent, estimateTokens } from "../observability/savings";
import {
  DEFAULT_STALL_K,
  itemVerdict,
  nextAttempt,
  nextStrategy,
  recordAttempt,
} from "../loop/journal";
import { writeTuple, WorkerGovernor } from "../yool/board";
import { publishVerified, receiptPath } from "../publish/verify-pipeline";

export type LoopMode = "drain" | "converge";

export interface LoopOptions {
  root: string;
  mode?: LoopMode;
  maxIter?: number;
  client?: string;
  stallK?: number;
}

export interface LoopSummary {
  mode: LoopMode;
  iterations: number;
  processed: number;
  advanced: number;
  blocked: number;
  failures: number;
  skipped_stalled: number;
  published: number;
  promoted: number;
  stopped_reason: "drained" | "all_stalled" | "max_iter" | "converged";
}

function engineRoot(root: string): string {
  const nested = resolve(root, ".marketing-engine");
  return existsSync(nested) ? nested : root;
}

// --- optional operator bridge (Python loop_journal.py) ---------------------

function resolveOperatorWorker(): string | null {
  if (process.env.MARKETING_LOOP_PY_WORKERS !== "1") return null;
  const candidates = [
    process.env.SIMPLICIO_LOOP_ROOT
      ? join(process.env.SIMPLICIO_LOOP_ROOT, "scripts", "loop_journal.py")
      : null,
    resolve(process.cwd(), "..", "simplicio-loop", "scripts", "loop_journal.py"),
  ].filter((p): p is string => Boolean(p));
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

function mirrorToOperator(
  root: string,
  worker: string | null,
  input: { iteration: number; action: string; gate: string; note: string },
): void {
  if (!worker) return;
  try {
    spawnSync(
      "python3",
      [
        worker,
        "record",
        "--iteration",
        String(input.iteration),
        "--action",
        input.action,
        "--gate",
        input.gate === "pass" ? "pass" : input.gate === "blocked" ? "blocked" : "fail",
        "--note",
        input.note,
      ],
      { cwd: root, timeout: 10_000, stdio: "ignore" },
    );
  } catch {
    // fail-open: the operator mirror is best-effort by contract
  }
}

// --- the loop ---------------------------------------------------------------

export async function runLoop(opts: LoopOptions): Promise<LoopSummary> {
  process.env.DRY_RUN = process.env.DRY_RUN ?? "true";
  const root = opts.root;
  const mode: LoopMode = opts.mode ?? "drain";
  const maxIter = opts.maxIter ?? 10;
  const stallK = opts.stallK ?? DEFAULT_STALL_K;
  const piecesDir = resolve(engineRoot(root), "pieces");
  const boardRoot = engineRoot(root);
  const governor = new WorkerGovernor();
  const operatorWorker = resolveOperatorWorker();

  const summary: LoopSummary = {
    mode,
    iterations: 0,
    processed: 0,
    advanced: 0,
    blocked: 0,
    failures: 0,
    skipped_stalled: 0,
    published: 0,
    promoted: 0,
    stopped_reason: "max_iter",
  };

  emitEvent(root, {
    kind: "loop_start",
    phase: "loop",
    data: {
      mode,
      max_iter: maxIter,
      operator_bridge: operatorWorker ? "python" : "off",
      dry_run: process.env.DRY_RUN === "true",
    },
  });

  const stalledLogged = new Set<string>();

  for (let iter = 1; iter <= maxIter; iter++) {
    summary.iterations = iter;
    let drafts = listPieces({ piecesDir, status: "draft", client: opts.client });
    if (mode === "converge" && drafts.length > 1) {
      drafts = drafts.slice(0, 1);
    }

    const actionable: ParsedPiece[] = [];
    for (const piece of drafts) {
      const id = piece.frontmatter.id;
      const verdict = itemVerdict(root, id, stallK);
      if (verdict.verdict === "STALLED") {
        if (!stalledLogged.has(id)) {
          const strategy = nextStrategy(root, id, stallK);
          stalledLogged.add(id);
          summary.skipped_stalled++;
          if (strategy === "human-review" && piece.frontmatter.status === "draft") {
            transitionStatus(id, "draft", "review", { piecesDir });
          }
          recordAttempt(root, {
            item_id: id,
            attempt: verdict.attempts + 1,
            client: piece.frontmatter.client,
            campaign: piece.frontmatter.campaign,
            date: piece.frontmatter.date,
            action: `generate:${strategy}`,
            gate: strategy === "human-review" ? "blocked" : "skipped",
            stage: "copy",
            strategy,
            fingerprint_override: verdict.last_fingerprint,
            note: strategy === "human-review"
              ? `stalled after ${verdict.attempts} attempts on fingerprint ${verdict.last_fingerprint}; routed to review`
              : `stalled after ${verdict.attempts} attempts on fingerprint ${verdict.last_fingerprint}`,
          });
          emitEvent(root, {
            kind: "stall_detected",
            level: "warn",
            piece_id: id,
            phase: "loop",
            verdict: "STALLED",
            data: { attempts: verdict.attempts, fingerprint: verdict.last_fingerprint, strategy },
          });
          // The skip is a REAL avoided re-derivation: the journal knows this
          // exact attempt fails. Booked as estimated, never measured.
          appendSavingsEvent(root, {
            source: "loop:journal-skip",
            surfaces: ["generate"],
            tokens: {
              baseline_total: estimateTokens(piece.body) + 400,
              actual_total: 0,
            },
            methodology:
              "baseline = estimated LLM re-derivation of a known-failing attempt (heuristic:chars-div-4 of piece body + prompt overhead); actual = 0, attempt skipped by stall verdict",
            piece_id: id,
          });
        }
        continue;
      }
      actionable.push(piece);
    }

    if (actionable.length === 0) {
      // Failing pieces stay in draft, so remaining drafts here means every
      // one of them is STALLED; an empty list means the backlog is drained.
      summary.stopped_reason = drafts.length > 0 ? "all_stalled" : "drained";
      break;
    }

    emitEvent(root, {
      kind: "loop_iteration",
      phase: "loop",
      data: { iteration: iter, actionable: actionable.length },
    });

    let progressed = false;
    for (const piece of actionable) {
      const id = piece.frontmatter.id;
      if (!governor.acquire("copy")) break;
      const attempt = nextAttempt(root, id);
      writeTuple(boardRoot, {
        id: `piece.plan:${id}`,
        class: "piece.plan",
        status: "in_progress",
        lane: "copy",
        payload: { attempt, iteration: iter },
      });
      summary.processed++;
      const strategy = nextStrategy(root, id, stallK);
      emitEvent(root, {
        kind: "piece_start",
        piece_id: id,
        client: piece.frontmatter.client,
        phase: "loop",
        data: { attempt, iteration: iter, strategy },
      });
      let gate: "pass" | "fail" | "blocked" = "pass";
      let failureText: string | undefined;
      try {
        await processPiece(piece, { root });
        summary.advanced++;
        progressed = true;
        emitEvent(root, {
          kind: "piece_advanced",
          piece_id: id,
          client: piece.frontmatter.client,
          phase: "loop",
          verdict: "scheduled",
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        failureText = msg;
        if (msg.startsWith("compliance-block:") || msg.startsWith("tech-specs-block:")) {
          gate = "blocked";
          summary.blocked++;
        } else {
          gate = "fail";
          summary.failures++;
        }
      } finally {
        governor.release("copy");
      }
      recordAttempt(root, {
        item_id: id,
        client: piece.frontmatter.client,
        campaign: piece.frontmatter.campaign,
        date: piece.frontmatter.date,
        attempt,
        action: `generate:${strategy}`,
        gate,
        stage: gate === "blocked" ? "compliance" : "copy",
        strategy,
        ...(failureText !== undefined && { failure_text: failureText, note: failureText.slice(0, 200) }),
      });
      mirrorToOperator(root, operatorWorker, {
        iteration: iter,
        action: `generate:${id}`,
        gate,
        note: failureText?.slice(0, 200) ?? "advanced to scheduled",
      });
      writeTuple(boardRoot, {
        id: `piece.plan:${id}`,
        class: "piece.plan",
        status: gate === "pass" ? "done" : "blocked",
        lane: "copy",
        payload: { attempt, iteration: iter, gate },
      });
    }

    if (mode === "converge" && progressed) {
      summary.stopped_reason = "converged";
      break;
    }
  }

  // Publish pass: every scheduled piece goes through the verified pipeline
  // (manifest contract → claims gate → compliance → publish → receipt).
  // DRY_RUN (default) writes drafts + receipts and never fakes `published`.
  for (const piece of listPieces({ piecesDir, status: "scheduled", client: opts.client })) {
    const fm = piece.frontmatter;
    const rp = receiptPath(root, fm.client, fm.date.slice(0, 10), fm.id);
    if (existsSync(rp)) {
      try {
        const prior = JSON.parse(readFileSync(rp, "utf8"));
        if (prior.verdict === "published") continue;
      } catch {
        // unreadable receipt → run the pipeline again
      }
    }
    const receipt = await publishVerified(fm.id, { root });
    if (receipt.verdict === "published") summary.published++;
  }

  // Promote pass: winners → paused ads drafts, losers → learnings. Runs on
  // whatever analytics exist; a fresh host simply promotes nothing.
  const promoteResult = await runPromoteLoop({ root });
  summary.promoted = promoteResult.promoted;

  emitEvent(root, {
    kind: "loop_complete",
    phase: "loop",
    verdict: summary.stopped_reason,
    data: { ...summary },
  });
  return summary;
}

export async function cliEntry(argv: string[]): Promise<void> {
  const root = process.cwd();
  let maxIter: number | undefined;
  let mode: LoopMode | undefined;
  let client: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--max-iter" && argv[i + 1]) maxIter = Number(argv[++i]);
    if (argv[i] === "--mode" && argv[i + 1]) {
      const v = argv[++i];
      if (v === "drain" || v === "converge") mode = v;
    }
    if (argv[i] === "--client" && argv[i + 1]) client = argv[++i];
  }
  const summary = await runLoop({ root, maxIter, mode, client });
  process.stdout.write(
    `loop: mode=${summary.mode} iterations=${summary.iterations} processed=${summary.processed} ` +
      `advanced=${summary.advanced} blocked=${summary.blocked} failures=${summary.failures} ` +
      `stalled=${summary.skipped_stalled} published=${summary.published} promoted=${summary.promoted} ` +
      `stop=${summary.stopped_reason}\n`,
  );
  if (summary.failures > 0 && summary.advanced === 0) {
    process.exitCode = 2;
  }
}

if (
  import.meta.url ===
  `file://${process.argv[1]?.replace(/\\/g, "/")}`.replace(/^file:\/\/\/\//, "file:///")
) {
  cliEntry(process.argv.slice(2)).catch((err) => {
    process.stderr.write(`loop failed: ${String(err)}\n`);
    process.exit(1);
  });
}
