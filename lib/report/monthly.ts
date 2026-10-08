/**
 * monthly.ts — the monthly report a client keeps: posts, views, the top 3 and
 * what changes next month. Only what the networks reported is printed; a
 * number the source did not give is "sem dado", never zero, and a total only
 * sums the posts that have the number (and says how many that is).
 */

import { engineRoot } from "../clients/paths";
import { latestValues, listWinners } from "../analytics/winners";
import { readSnapshots } from "../analytics/score";
import { METRICS, type Metric } from "../analytics/post-metrics";
import { listReceipts } from "../publish/publisher";
import { DEFAULT_WINNER_SHARE, type ContentPlan } from "../plan/content-plan";

export const NO_DATA = "sem dado";
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const LABEL: Record<Metric, string> = { views: "Visualizações", likes: "Curtidas", comments: "Comentários", shares: "Compartilhamentos", saves: "Salvamentos" };
const nf = new Intl.NumberFormat("pt-BR");

export interface PostRow {
  piece_id: string;
  network: string;
  format: string;
  publish_at: string;
  simulated: boolean;
  metrics: Partial<Record<Metric, number>>;
}

export interface MonthlyReport {
  client: string;
  month: string;
  posts: PostRow[];
  /** Posts with at least a views number. */
  measured: number;
  top: PostRow[];
  markdown: string;
}

const show = (n: number | undefined): string => (n === undefined ? NO_DATA : nf.format(n));

export function buildMonthlyReport(root: string, plans: ContentPlan[], client: string, month: string, name?: string): MonthlyReport {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("report: month must be YYYY-MM");
  const snapshots = readSnapshots(engineRoot(root)).filter((s) => s.piece_id);
  const byMetric = Object.fromEntries(METRICS.map((m) => [m, latestValues(snapshots, m)])) as Record<Metric, ReturnType<typeof latestValues>>;
  const receipts = listReceipts(root, { client });
  const slots = plans.filter((p) => p.client === client).flatMap((p) => p.slots).filter((s) => s.publish_at.startsWith(month));

  const posts: PostRow[] = [];
  for (const slot of slots) {
    const metrics: PostRow["metrics"] = {};
    for (const m of METRICS) {
      const v = byMetric[m].get(`${slot.piece_id}|${slot.network}`)?.value;
      if (v !== undefined) metrics[m] = v;
    }
    const receipt = receipts.find((r) => r.piece_id === slot.piece_id && r.network === slot.network && r.verdict === "scheduled");
    if (!receipt && Object.keys(metrics).length === 0) continue;
    posts.push({ piece_id: slot.piece_id, network: slot.network, format: slot.format, publish_at: slot.publish_at, simulated: receipt?.dry_run ?? false, metrics });
  }
  posts.sort((a, b) => a.publish_at.localeCompare(b.publish_at) || a.piece_id.localeCompare(b.piece_id));
  const withViews = posts.filter((p) => p.metrics.views !== undefined);
  const top = [...withViews].sort((a, b) => (b.metrics.views as number) - (a.metrics.views as number) || a.piece_id.localeCompare(b.piece_id)).slice(0, 3);

  const [y, mo] = month.split("-").map(Number) as [number, number];
  const lines: string[] = [`# Relatório de ${MONTHS[mo - 1]} de ${y}${name ? ` - ${name}` : ""}`, "", `Cliente: ${client}`, ""];
  lines.push("## Resumo", "", `- Posts do mês: ${posts.length} (${withViews.length} com número de visualizações)`);
  for (const m of METRICS) {
    const have = posts.filter((p) => p.metrics[m] !== undefined);
    lines.push(`- ${LABEL[m]}: ${have.length === 0 ? NO_DATA : `${nf.format(have.reduce((a, p) => a + (p.metrics[m] as number), 0))} (soma de ${have.length} de ${posts.length} posts com dado)`}`);
  }
  if (posts.some((p) => p.simulated)) lines.push("", "Posts marcados como simulação não foram enviados a nenhuma rede.");
  lines.push("", "## Os 3 posts com mais visualizações", "");
  if (top.length === 0) lines.push(`${NO_DATA}: nenhum post tem visualizações medidas neste mês.`);
  top.forEach((p, i) => lines.push(`${i + 1}. ${p.piece_id} (${p.network}, ${p.format}): ${show(p.metrics.views)} visualizações`));
  lines.push("", "## Todos os posts", "", `| Data | Rede | Formato | ${METRICS.map((m) => LABEL[m]).join(" | ")} |`, `| --- | --- | --- | ${METRICS.map(() => "---").join(" | ")} |`);
  for (const p of posts) lines.push(`| ${p.publish_at.slice(0, 10)}${p.simulated ? " (simulação)" : ""} | ${p.network} | ${p.format} | ${METRICS.map((m) => show(p.metrics[m])).join(" | ")} |`);
  const winners = listWinners(root, { client, month });
  lines.push("", "## O que muda no mês seguinte", "");
  if (winners.length === 0) lines.push(`- ${NO_DATA}: são necessários pelo menos 3 posts com visualizações para escolher vencedores; o plano segue o mix padrão.`);
  for (const w of winners) lines.push(`- Mais variações de "${w.hook}" (${w.piece_id}, ${nf.format(w.views)} visualizações): ${Math.round(DEFAULT_WINNER_SHARE * 100)}% dos posts do próximo plano variam os vencedores.`);
  lines.push("");
  return { client, month, posts, measured: withViews.length, top, markdown: lines.join("\n") };
}
