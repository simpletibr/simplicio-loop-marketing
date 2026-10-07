import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  loadCampaignBrief,
  planPieceQueue,
  organicPhaseActive,
  reviewCampaign,
} from "../campaigns/campaign";
import { emitEvent } from "../observability/events";
import { loadExtensionManifest } from "../extension/core";
import { planCommand } from "./plan-commands";

export async function cliEntry(argv: string[]): Promise<void> {
  const root = process.cwd();
  const sub = argv[0];

  // Fail before creating work: Loop core owns workflow, queue, leases and budgets.
  loadExtensionManifest();

  if (await planCommand(argv, process.env.MARKETING_ENGINE_HOST_ROOT ?? root)) return;

  if (sub === "review") {
    const campaignId = argv[1];
    if (!campaignId) {
      process.stderr.write("campaign review: missing <campaign-id>\n");
      process.exit(1);
    }
    const summary = reviewCampaign(root, campaignId);
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  // default: create/plan from a brief file
  let briefPath: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--brief" && argv[i + 1]) briefPath = argv[++i];
  }
  if (!briefPath) {
    process.stderr.write(
      "campaign: usage: marketing-engine campaign --brief <path/to/CAMPAIGN.md>\n" +
        "       or: marketing-engine campaign review <campaign-id>\n" +
        "       or: marketing-engine campaign --client <slug> --days 30 [--start YYYY-MM-DD|next-month] [--per-week N] [--networks a,b] [--tz Zone] [--mix hero=0.2,...]\n" +
        "       or: marketing-engine campaign render|approvals|schedule --client <slug> [--plan <id>]\n",
    );
    process.exit(1);
  }
  const resolved = resolve(root, briefPath);
  if (!existsSync(resolved)) {
    process.stderr.write(`campaign: brief not found at ${resolved}\n`);
    process.exit(1);
  }
  const brief = loadCampaignBrief(resolved);
  const queue = planPieceQueue(brief);
  const organic = organicPhaseActive(brief);
  emitEvent(root, {
    kind: "campaign_planned",
    phase: "campaign",
    client: brief.client_id,
    data: { campaign_id: brief.id, pieces_queued: queue.length, organic_phase_active: organic },
  });
  process.stdout.write(
    `campaign: id=${brief.id} pieces_queued=${queue.length} organic_phase_active=${organic}\n`,
  );
  process.stdout.write(`${JSON.stringify(queue, null, 2)}\n`);
}

if (
  import.meta.url ===
  `file://${process.argv[1]?.replace(/\\/g, "/")}`.replace(/^file:\/\/\/\//, "file:///")
) {
  cliEntry(process.argv.slice(2)).catch((err) => {
    process.stderr.write(`campaign failed: ${String(err)}\n`);
    process.exit(1);
  });
}
