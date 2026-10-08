import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { appendSnapshot } from "../analytics/score";
import { collectMetrics, linkPost, SOURCES, type MetricSource } from "../analytics/collect";
import { METRICS, type Metric } from "../analytics/post-metrics";
import { recordWinners, selectWinners } from "../analytics/winners";
import { assertClientSlug, engineRoot } from "../clients/paths";
import { allPlans } from "../dashboard/model";
import { NETWORKS, type Network } from "../publish/publisher";
import { readBrandProfile } from "../profile/brand-profile";
import { buildMonthlyReport } from "../report/monthly";
import { markdownToPdf } from "../report/pdf";

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function need(argv: string[], name: string): string {
  const v = flag(argv, name);
  if (!v) throw new Error(`metrics: ${name} is required`);
  return v;
}

function out(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

const USAGE = [
  "metrics: usage:",
  "  marketing-engine metrics link --client <slug> --piece <id> --network <n> --publish-at <iso> --source <realoficial|youtube|instagram|tiktok> --id <post id>",
  "  marketing-engine metrics collect --client <slug>              (read-only; DRY_RUN does not touch the network)",
  "  marketing-engine metrics import --client <slug> --file <json> (manual numbers: [{piece_id,network,metric,value,polled_at?}])",
  "  marketing-engine metrics winners --client <slug> --month <YYYY-MM>",
  "  marketing-engine metrics report --client <slug> --month <YYYY-MM> [--pdf]",
  "",
].join("\n");

export async function cliEntry(argv: string[]): Promise<void> {
  const root = process.env.MARKETING_ENGINE_HOST_ROOT ?? process.cwd();
  const sub = argv[0];
  if (!sub || !flag(argv, "--client")) {
    process.stderr.write(USAGE);
    process.exitCode = 2;
    return;
  }
  const client = need(argv, "--client");
  assertClientSlug(client);

  if (sub === "link") {
    const network = need(argv, "--network") as Network;
    const source = need(argv, "--source") as MetricSource;
    if (!NETWORKS.includes(network)) throw new Error(`metrics: --network must be one of ${NETWORKS.join(", ")}`);
    if (!SOURCES.includes(source)) throw new Error(`metrics: --source must be one of ${SOURCES.join(", ")}`);
    out(linkPost(root, { client, pieceId: need(argv, "--piece"), network, publishAt: need(argv, "--publish-at"), source, externalId: need(argv, "--id") }));
    return;
  }
  if (sub === "collect") {
    // Credentials come from the environment; Real Oficial needs an MCP transport, so the CLI cannot read it.
    out(await collectMetrics(root, { client, credentials: { youtubeApiKey: process.env.YOUTUBE_API_KEY, instagramToken: process.env.META_ACCESS_TOKEN, tiktokToken: process.env.TIKTOK_ACCESS_TOKEN } }));
    return;
  }
  if (sub === "import") {
    const rows = JSON.parse(readFileSync(resolve(need(argv, "--file")), "utf8")) as Array<{ piece_id: string; network: string; metric: string; value: number; polled_at?: string }>;
    if (!Array.isArray(rows)) throw new Error("metrics: the file must hold an array");
    const pieces = new Set(allPlans(root).filter((p) => p.client === client).flatMap((p) => p.slots.map((s) => s.piece_id)));
    for (const r of rows) {
      if (!pieces.has(r.piece_id)) throw new Error(`metrics: ${r.piece_id} is not a piece of ${client}`);
      if (!(METRICS as readonly string[]).includes(r.metric) || !NETWORKS.includes(r.network as Network) || !Number.isFinite(r.value) || r.value < 0) throw new Error(`metrics: invalid row for ${r.piece_id}`);
    }
    const now = new Date().toISOString();
    for (const r of rows) appendSnapshot(engineRoot(root), { piece_id: r.piece_id, channel_id: r.network, metric: r.metric as Metric, value: r.value, polled_at: r.polled_at ?? now, source: "manual" });
    out({ imported: rows.length });
    return;
  }
  const month = need(argv, "--month");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("metrics: --month must be YYYY-MM");
  const plans = allPlans(root);
  if (sub === "winners") {
    const winners = selectWinners(root, plans, client, month);
    recordWinners(root, winners);
    out({ month, winners, note: winners.length === 0 ? "sem dado: fewer than 3 pieces have views, so nothing was marked" : undefined });
    return;
  }
  if (sub === "report") {
    let name: string | undefined;
    try {
      name = readBrandProfile(root, client).name;
    } catch {
      name = undefined;
    }
    const report = buildMonthlyReport(root, plans, client, month, name);
    const base = resolve(engineRoot(root), "outputs", client, "reports", month);
    mkdirSync(dirname(base), { recursive: true });
    writeFileSync(`${base}.md`, report.markdown);
    if (argv.includes("--pdf")) writeFileSync(`${base}.pdf`, markdownToPdf(report.markdown));
    out({ markdown: `${base}.md`, ...(argv.includes("--pdf") ? { pdf: `${base}.pdf` } : {}), posts: report.posts.length, measured: report.measured, top: report.top.map((p) => p.piece_id) });
    return;
  }
  process.stderr.write(USAGE);
  process.exitCode = 2;
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`.replace(/^file:\/\/\/\//, "file:///")) {
  cliEntry(process.argv.slice(2)).catch((err) => {
    process.stderr.write(`metrics failed: ${String(err)}\n`);
    process.exitCode = 1;
  });
}
