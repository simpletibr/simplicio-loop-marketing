import { test, expect } from "@playwright/test";
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { parseCampaignBrief, planPieceQueue } from "../lib/campaigns/campaign";
import { getChannel } from "../lib/channels/registry";
import { loadTemplate, renderTemplate } from "../lib/content/templates";
import { auditSync, writeReport } from "../lib/compliance/generic";
import { auditCommunityPost, writeCommunityReport } from "../lib/compliance/community";
import { runGate, writeWatcherReport } from "../lib/gate/watcher-gate";
import { writeManifest } from "../lib/data/manifest";
import { simulate } from "../lib/integrations/broker";
import { runBrowserLane } from "../lib/automation/browser-lane";
import { appendSnapshot, readSnapshots, computeAccrual, classifyByAccrual } from "../lib/analytics/score";
import { checkGuardrails, recordPromotionAttempt, DEFAULT_GUARDRAILS } from "../lib/promotion/budget-guardrail";
import { appendLearning } from "../lib/cli/promote";
import { writeTuple, readBoard } from "../lib/yool/board";
import { runLoop } from "../lib/cli/loop";
import { serializePiece } from "../lib/pieces/frontmatter";

/**
 * Issue #58 — end-to-end mocked SaaS launch loop.
 *
 * campaign brief -> channel plan -> pieces -> copy -> compliance ->
 * browser evidence -> dry-run publish manifests -> mocked analytics ->
 * winner/loser classification -> paused ad draft -> learning log
 *
 * Never makes a live provider/platform call: DRY_RUN=true throughout,
 * lib/integrations/broker.ts's `simulate()` is used for publish (never a
 * real fetch), and the browser lane only records a redacted evidence
 * snapshot of simulated page content. Exercises the runtime-first stack
 * (lib/yool/board.ts, lib/campaigns/campaign.ts, lib/channels/registry.ts,
 * lib/integrations/broker.ts) directly — no simplicio-sprint or
 * simplicio-prompt import anywhere in this chain.
 */

const SAMPLE_BRIEF = `
\`\`\`yaml
id: 2026-Q3-mock-launch
client_id: mock-saas
title: Mock SaaS launch
status: active
\`\`\`
\`\`\`yaml
channels:
  primary: hackernews
  secondary: [devto, x, linkedin, tiktok, reddit-programming]
  test: []
\`\`\`
\`\`\`yaml
budget:
  total: 200
  phases:
    - { name: organic-only, weeks: "1-4", paid_amount: 0 }
\`\`\`
\`\`\`yaml
pieces_per_week: 6
distribution:
  - { pillar: build-in-public, pieces: 1 }
\`\`\`
`;

function templateIdFor(channelId: string): string {
  if (channelId === "hackernews") return "launch-thread";
  if (channelId === "devto") return "dev-article";
  if (channelId === "reddit-programming") return "reddit-forum-answer";
  if (channelId === "tiktok") return "video-script";
  return "social-derivative";
}

function sampleDataFor(templateId: string): Record<string, string> {
  const common = {
    hook_line: "We shipped a provider-agnostic marketing loop for SaaS launches.",
    key_insight: "Switching providers is a config change, not a rewrite.",
    screenshot_or_metric: "manifest.json shows 6 pieces generated in dry-run in under a minute.",
    one_screenshot_or_metric: "manifest.json shows 6 pieces generated in dry-run in under a minute.",
    cta_line: "Repo + docs linked below.",
    title: "How we built a provider-agnostic SaaS marketing loop",
    hook_paragraph: "We kept hitting vendor lock-in every time a provider changed pricing.",
    problem_description: "Every skill hardcoded a vendor SDK, so switching providers meant rewriting skills.",
    failure_or_tradeoff: "First tried a single mega-prompt per piece; split into copy+caption+creative stages instead after quality regressed.",
    solution_description: "A routing matrix resolves task type -> provider at runtime; skills never import an SDK directly.",
    next_steps: "Load-testing the campaign loop against a real multi-channel launch.",
    what_it_does_plainly: "A CLI that generates, gates, and dry-run publishes marketing content across social + dev community channels.",
    how_its_built: "Provider-agnostic router, capability-based integration broker, tuple-space work board.",
    architecture_or_metric_summary: "Generate loop processed 6 queued pieces in dry-run with full compliance + watcher gate reports.",
    what_was_hard_or_rejected: "Rejected a hardcoded per-platform client approach after the second vendor migration took a week.",
    link_and_cta: "github.com/example/repo",
    direct_answer_to_the_question: "You can route publish/schedule/metrics per channel through a capability broker instead of hardcoding each platform's SDK — see lib/integrations/broker.ts for the pattern.",
    technical_answer: "Resolve channel capabilities first, persist the selected adapter in the receipt, and reject a transition when no adapter satisfies the contract.",
    caveats_or_alternatives: "This assumes you're comfortable maintaining a routing matrix; a single-platform tool may not need it.",
    optional_mention_of_own_product_with_disclosure: "(Disclosure: I work on this project.) We open-sourced our version if useful.",
    hook_line_video: "Watch us gate a marketing piece live.",
    problem_statement: "Most SaaS launch content either overclaims or ships unverified.",
    on_screen_demo_or_metric: "Screen recording of `marketing-engine generate` producing a watcher-gate report with MEASURED tag.",
    failure_or_limitation: "Compliance gate blocked our first draft for an unsourced comparison claim — kept it in as an example.",
  };
  return common;
}

test("mocked SaaS launch loop wires campaign -> pieces -> compliance -> gate -> publish dry-run -> analytics -> promote -> learn", async () => {
  process.env.DRY_RUN = "true";
  const host = mkdtempSync(join(tmpdir(), "me-launch-loop-"));
  const root = join(host, ".marketing-engine");
  mkdirSync(join(root, "data"), { recursive: true });

  // 1. campaign brief -> channel plan -> pieces
  const brief = parseCampaignBrief(SAMPLE_BRIEF);
  const queue = planPieceQueue(brief);
  expect(queue.length).toBe(6); // 1 pillar * 6 channels (1 primary + 5 secondary)

  const pieceResults: Array<{
    piece_id: string;
    channel_id: string;
    manifest_path: string;
    compliance_pass: boolean;
    watcher_tag: string;
  }> = [];

  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    const pieceId = `p-${item.channel_id}`;
    const channel = getChannel(item.channel_id);
    expect(channel).toBeDefined();

    // 2. copy: render the channel-appropriate content template, English-first
    const templateId = templateIdFor(item.channel_id);
    const { text, meta } = loadTemplate(
      resolve(process.cwd(), ".specs", "pieces", "templates", `${templateId}.md`),
    );
    const data = sampleDataFor(templateId);
    const { rendered, missing_evidence } = renderTemplate(text, meta, data);
    expect(missing_evidence).toHaveLength(0); // every requires_evidence field was supplied

    // 3. compliance — generic always; community gate additionally for community channels
    const genericReport = auditSync({ piece_id: pieceId, text: rendered });
    const genericReportPath = writeReport(root, genericReport);
    expect(genericReport.pass).toBe(true);

    let communityStatus: string | undefined;
    if (channel!.kind === "community") {
      const communityReport = auditCommunityPost({
        piece_id: pieceId,
        channel_id: item.channel_id,
        title: data.title ?? data.hook_line,
        body: rendered,
        link_url: "https://example.com/mock-saas",
        discloses_affiliation: true,
      });
      writeCommunityReport(root, communityReport);
      communityStatus = communityReport.status;
      expect(communityStatus).toBe("pass");
    }

    // 4. watcher gate — independent verification pass
    const watcherReport = runGate({
      piece_id: pieceId,
      script: rendered,
      caption: rendered.slice(0, 200),
      brief: data.problem_description ?? data.problem_statement ?? "mock brief",
      platform: item.channel_id,
      pillar: item.pillar,
    });
    writeWatcherReport(root, watcherReport);

    // 5. manifest under outputs/<client>/<date>/<piece-id>/manifest.hbi
    const outDir = resolve(root, "outputs", brief.client_id, "2026-07-02", pieceId);
    mkdirSync(outDir, { recursive: true });
    writeManifest(join(outDir, "manifest.hbi"), {
      piece_id: pieceId,
      client: brief.client_id,
      date: "2026-07-02",
      providers: { llm: "mock-llm" },
      prompts: { script: rendered.slice(0, 100) },
      cost_estimate_usd: 0,
      compliance_report_path: genericReportPath,
      watcher_report_path: resolve(root, "data", "gate", `${pieceId}.json`),
      outputs: [outDir],
    });

    // 6. dry-run publish via the integration broker — never a live call
    const publishSim = simulate(item.channel_id, "publish", { caption: rendered.slice(0, 100) });
    expect(publishSim.dry_run).toBe(true);
    expect(publishSim.ok).toBe(true);

    // Yool board: record this piece's stage tuples
    writeTuple(root, { id: `piece.plan:${pieceId}`, class: "piece.plan", status: "done", lane: "strategy" });
    writeTuple(root, { id: `piece.compliance:${pieceId}`, class: "piece.compliance", status: "done", lane: "compliance" });
    writeTuple(root, { id: `publish.dry_run:${pieceId}`, class: "publish.dry_run", status: "done", lane: "publish" });

    pieceResults.push({
      piece_id: pieceId,
      channel_id: item.channel_id,
      manifest_path: join(outDir, "manifest.hbi"),
      compliance_pass: genericReport.pass,
      watcher_tag: watcherReport.tag,
    });
  }

  // Every generated piece has a manifest and a compliance report.
  for (const r of pieceResults) {
    expect(existsSync(r.manifest_path)).toBe(true);
    expect(r.compliance_pass).toBe(true);
  }

  // 7. browser/computer-use evidence for the primary (browser-method) channel
  const hnPiece = pieceResults.find((r) => r.channel_id === "hackernews")!;
  const evidenceResult = runBrowserLane(root, {
    piece_id: hnPiece.piece_id,
    channel_id: "hackernews",
    capability: "evidence_capture",
    simulatedPageContent: "Show HN: mock SaaS launch is live",
  });
  expect(evidenceResult.ok).toBe(true);
  expect(evidenceResult.evidence).toHaveLength(1);
  expect(existsSync(evidenceResult.evidence[0].path)).toBe(true);
  writeTuple(root, {
    id: `metrics.snapshot:evidence:${hnPiece.piece_id}`,
    class: "metrics.snapshot",
    status: "done",
    lane: "evidence",
    evidence_path: evidenceResult.evidence[0].path,
  });

  // 8. mocked analytics — one clear winner (compounding), one clear loser (flat)
  const winnerPiece = pieceResults.find((r) => r.channel_id === "devto")!;
  const loserPiece = pieceResults.find((r) => r.channel_id === "reddit-programming")!;
  appendSnapshot(root, { piece_id: winnerPiece.piece_id, channel_id: "devto", metric: "reactions", value: 4, polled_at: "2026-07-02T00:00:00Z" });
  appendSnapshot(root, { piece_id: winnerPiece.piece_id, channel_id: "devto", metric: "reactions", value: 40, polled_at: "2026-07-03T00:00:00Z" });
  appendSnapshot(root, { piece_id: loserPiece.piece_id, channel_id: "reddit-programming", metric: "reactions", value: 2, polled_at: "2026-07-02T00:00:00Z" });
  appendSnapshot(root, { piece_id: loserPiece.piece_id, channel_id: "reddit-programming", metric: "reactions", value: 2, polled_at: "2026-07-03T00:00:00Z" });

  const scores = computeAccrual(readSnapshots(root));
  const classified = classifyByAccrual(scores);
  expect(classified.winners.map((w) => w.piece_id)).toContain(winnerPiece.piece_id);
  expect(classified.losers.map((l) => l.piece_id)).toContain(loserPiece.piece_id);

  // 9. winner -> paused ad draft with budget guardrails
  const winnerScore = classified.winners.find((w) => w.piece_id === winnerPiece.piece_id)!;
  const guardrailCheck = checkGuardrails({ piece_id: winnerScore.piece_id, daily_budget_usd: 10 });
  expect(guardrailCheck.ok).toBe(true);

  const adsDraftDir = resolve(root, "outputs", brief.client_id, "2026-07-02", winnerPiece.piece_id);
  const adsDraftPath = resolve(adsDraftDir, "ads-draft.json");
  writeFileSync(
    adsDraftPath,
    JSON.stringify(
      { piece_id: winnerPiece.piece_id, paused: true, daily_budget_usd: 10, guardrails: DEFAULT_GUARDRAILS },
      null,
      2,
    ),
  );
  recordPromotionAttempt(root, {
    piece_id: winnerPiece.piece_id,
    timestamp: new Date().toISOString(),
    metric: "reactions_accrual_rate",
    channel: "devto",
    audience: "devto",
    hypothesis: "Compounding technical reactions signal a piece worth a paused paid test",
    guardrails: DEFAULT_GUARDRAILS,
    paused: true,
  });
  writeTuple(root, { id: `winner.promote:${winnerPiece.piece_id}`, class: "winner.promote", status: "done", lane: "paid-growth" });

  const draft = JSON.parse(readFileSync(adsDraftPath, "utf8"));
  expect(draft.paused).toBe(true);

  // 10. loser -> learning entry
  appendLearning(root, {
    date: "2026-07-02",
    piece_id: loserPiece.piece_id,
    channel: "reddit-programming",
    reason: "flat accrual rate across two polls",
  });
  writeTuple(root, { id: `loser.learning:${loserPiece.piece_id}`, class: "loser.learning", status: "done", lane: "analytics" });

  const learnings = readFileSync(resolve(root, "data", "learnings.md"), "utf8");
  expect(learnings).toContain(loserPiece.piece_id);

  // Final: the Yool board recorded a tuple trail for the whole loop.
  const board = readBoard(root);
  expect(board.some((t) => t.class === "piece.plan")).toBe(true);
  expect(board.some((t) => t.class === "publish.dry_run")).toBe(true);
  expect(board.some((t) => t.class === "winner.promote")).toBe(true);
  expect(board.some((t) => t.class === "loser.learning")).toBe(true);
});

/**
 * The same journey, driven by the ONE command the loop protocol binds:
 * `marketing-engine loop` (runLoop). Pieces drain through generate's real
 * gates, scheduled pieces go through the verified publish pipeline, and
 * the promote pass turns the analytics winner into a paused ads draft —
 * no manual lane chaining, all state auditable (events, journal, board,
 * receipts).
 */
test("capstone: the autonomous loop command drives brief -> publish -> promote end-to-end", async () => {
  process.env.DRY_RUN = "true";
  const host = mkdtempSync(join(tmpdir(), "me-capstone-"));
  const ws = join(host, ".marketing-engine");
  mkdirSync(join(ws, "pieces"), { recursive: true });
  mkdirSync(join(ws, "data"), { recursive: true });

  for (const id of ["PIECE-cap-winner", "PIECE-cap-loser"]) {
    writeFileSync(
      join(ws, "pieces", `${id}.md`),
      serializePiece(
        {
          id,
          client: "mock-saas",
          date: "2026-07-02",
          status: "draft",
          type: "reel",
          pillar: "education",
          platforms: ["instagram"],
          locale: "en",
        },
        "# Brief\n\nLaunch our new product.\n",
      ),
    );
  }
  // Mocked analytics: one clear winner, one clear loser (>=100 impressions).
  const analytics = [
    { piece_id: "PIECE-cap-winner", client: "mock-saas", channel: "instagram", impressions: 1000, saves: 90, captured_at: new Date().toISOString() },
    { piece_id: "PIECE-cap-loser", client: "mock-saas", channel: "instagram", impressions: 1000, saves: 1, captured_at: new Date().toISOString() },
  ];
  writeFileSync(
    join(ws, "data", "analytics.jsonl"),
    analytics.map((r) => JSON.stringify(r)).join("\n") + "\n",
  );

  const prevCwd = process.cwd();
  process.chdir(host);
  let summary;
  try {
    summary = await runLoop({ root: host, mode: "drain", maxIter: 5 });
  } finally {
    process.chdir(prevCwd);
  }

  // Both pieces advanced through generate's gates and the publish pipeline.
  expect(summary.advanced).toBe(2);
  expect(summary.published).toBe(2);
  expect(summary.stopped_reason).toBe("drained");
  for (const id of ["PIECE-cap-winner", "PIECE-cap-loser"]) {
    const dir = join(ws, "outputs", "mock-saas", "2026-07-02", id);
    expect(existsSync(join(dir, "manifest.hbi"))).toBe(true);
    const receipt = JSON.parse(readFileSync(join(dir, "publish-receipt.json"), "utf8"));
    expect(receipt.verdict).toBe("published");
    expect(receipt.dry_run).toBe(true);
    expect(receipt.claims_tag).toBe("MEASURED");
  }

  // The promote pass turned the winner into a PAUSED ads draft with
  // guardrails, and the loser into a learning entry.
  expect(summary.promoted).toBe(1);
  const draft = JSON.parse(
    readFileSync(
      join(ws, "outputs", "mock-saas", "2026-07-02", "PIECE-cap-winner", "ads-draft.json"),
      "utf8",
    ),
  );
  expect(draft.paused).toBe(true);
  expect(draft.guardrails).toBeDefined();
  const learnings = readFileSync(join(ws, "data", "learnings.md"), "utf8");
  expect(learnings).toContain("PIECE-cap-loser");

  // Auditable state: yool tuples per piece, journal attempts, event stream.
  const board = readBoard(ws);
  expect(board.filter((t) => t.class === "piece.plan" && t.status === "done")).toHaveLength(2);
});
