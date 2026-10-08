import { loadPlan } from "../plan/content-plan";
import { assertClientSlug } from "../clients/paths";
import { cutLongVideo, estimateClips, DryRunClipsTransport } from "../clips/realoficial-clips";
import { isDryRun } from "../realoficial/transport";

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

const USAGE = "clips: usage: marketing-engine clips --client <slug> --url <youtube-or-twitch-url> [--plan <id>] [--estimate] [--approved-by-wesley] [--accept-terms a,b]\n";

/**
 * Cuts the client's long video into the `long_cut` slots of its plan.
 * `--estimate` only quotes. Without DRY_RUN the run is blocked unless the
 * owner passes `--approved-by-wesley`, and it needs a transport that only an
 * MCP session can inject, so the CLI never spends credits on its own.
 */
export async function cliEntry(argv: string[]): Promise<void> {
  const root = process.env.MARKETING_ENGINE_HOST_ROOT ?? process.cwd();
  const client = flag(argv, "--client");
  const url = flag(argv, "--url");
  if (!client || !url) {
    process.stderr.write(USAGE);
    process.exitCode = 2;
    return;
  }
  assertClientSlug(client);
  const plan = loadPlan(root, client, flag(argv, "--plan"));
  const pieceIds = plan.slots.filter((s) => s.format === "long_cut" && s.window === "in_window").map((s) => s.piece_id);
  if (pieceIds.length === 0) throw new Error(`clips: plan ${plan.plan_id} has no long_cut slot inside the window (use --mix long_cut=...)`);
  const request = { client, url, pieceIds };
  if (argv.includes("--estimate")) {
    if (!isDryRun()) throw new Error("clips: a live estimate needs a Real Oficial transport injected by an MCP session");
    process.stdout.write(`${JSON.stringify(await estimateClips(request, new DryRunClipsTransport(pieceIds.length)), null, 2)}\n`);
    return;
  }
  const receipt = await cutLongVideo({ root, request, approvedByWesley: argv.includes("--approved-by-wesley"), acceptTerms: flag(argv, "--accept-terms")?.split(",") });
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  if (receipt.verdict === "blocked" || receipt.verdict === "failed") process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`.replace(/^file:\/\/\/\//, "file:///")) {
  cliEntry(process.argv.slice(2)).catch((err) => {
    process.stderr.write(`clips failed: ${String(err)}\n`);
    process.exitCode = 1;
  });
}
