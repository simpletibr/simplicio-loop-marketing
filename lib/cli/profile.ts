import { emitEvent } from "../observability/events";
import { buildBrandProfile, collectProspect, writeBrandProfile } from "../profile/brand-profile";

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export async function cliEntry(argv: string[]): Promise<void> {
  const root = process.env.MARKETING_ENGINE_HOST_ROOT ?? process.cwd();
  const url = argv.find((a) => !a.startsWith("--") && a !== flag(argv, "--client"));
  const client = flag(argv, "--client");
  if (!url || !client) {
    process.stderr.write("profile: usage: marketing-engine profile <url> --client <slug>\n");
    process.exitCode = 2;
    return;
  }
  const { collection, mode } = await collectProspect(url);
  const profile = buildBrandProfile(collection, { client, url, mode });
  const path = writeBrandProfile(root, profile);
  emitEvent(root, { kind: "profile_built", client, phase: "profile", verdict: mode, data: { facts: profile.facts.length } });
  process.stderr.write(`profile: wrote ${path}\n`);
  process.stdout.write(`${JSON.stringify(profile, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`.replace(/^file:\/\/\/\//, "file:///")) {
  cliEntry(process.argv.slice(2)).catch((err) => {
    process.stderr.write(`profile failed: ${String(err)}\n`);
    process.exitCode = 1;
  });
}
