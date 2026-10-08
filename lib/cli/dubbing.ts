import { assertClientSlug } from "../clients/paths";
import { DEFAULT_DUBBING_MATRIX, dubbingFor, listDubReceipts, routeFor, type DubRequest } from "../dubbing/dubbing";
import { readBrandProfile, type BrandProfile } from "../profile/brand-profile";

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

const USAGE = "dubbing: usage: marketing-engine dubbing estimate|dub|list|matrix --client <slug> [--piece <id> --language <tag> --project <id> --clip <id> --subtitles --approved-by-wesley]\n";

function out(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

/**
 * `estimate` never changes anything. `dub` is blocked without
 * `--approved-by-wesley`, and a live run needs a Real Oficial transport that
 * only an MCP session can inject, so the CLI never dubs live on its own.
 */
export async function cliEntry(argv: string[]): Promise<void> {
  const root = process.env.MARKETING_ENGINE_HOST_ROOT ?? process.cwd();
  const sub = argv[0];
  const client = flag(argv, "--client");
  if (!sub || !client) {
    process.stderr.write(USAGE);
    process.exitCode = 2;
    return;
  }
  assertClientSlug(client);
  let profile: BrandProfile | undefined;
  try {
    profile = readBrandProfile(root, client);
  } catch {
    profile = undefined;
  }
  if (sub === "matrix") {
    const languages = new Set([...Object.keys(DEFAULT_DUBBING_MATRIX), ...Object.keys(profile?.voice_routes ?? {}), ...(profile?.languages ?? [])]);
    out(Object.fromEntries([...languages].sort().map((l) => [l, routeFor(l, profile)])));
    return;
  }
  if (sub === "list") {
    out(listDubReceipts(root, { client, pieceId: flag(argv, "--piece") }));
    return;
  }
  const piece = flag(argv, "--piece");
  const language = flag(argv, "--language");
  if ((sub !== "estimate" && sub !== "dub") || !piece || !language) {
    process.stderr.write(USAGE);
    process.exitCode = 2;
    return;
  }
  const req: DubRequest = { client, pieceId: piece, language, projectId: flag(argv, "--project"), clipId: flag(argv, "--clip"), subtitles: argv.includes("--subtitles"), approvedByWesley: argv.includes("--approved-by-wesley") };
  const dubbing = dubbingFor(root);
  if (sub === "estimate") return out(await dubbing.estimate(req, profile));
  const receipt = await dubbing.dub(req, profile);
  out(receipt);
  if (receipt.verdict === "blocked" || receipt.verdict === "failed") process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`.replace(/^file:\/\/\/\//, "file:///")) {
  cliEntry(process.argv.slice(2)).catch((err) => {
    process.stderr.write(`dubbing failed: ${String(err)}\n`);
    process.exitCode = 1;
  });
}
