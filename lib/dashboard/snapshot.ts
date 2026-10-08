/**
 * snapshot.ts — the static month page a client can be sent (sending is always
 * manual). Self-contained HTML, no scripts, no external resources, and a
 * client-safe projection: it never carries costs, credits, tokens, hashes,
 * approver names, failure internals, or anything about another client.
 *
 * Honesty rules: a simulated (DRY_RUN) schedule is labelled as a simulation,
 * "published" is only claimed for posts that already have metrics, and a
 * missing metric is shown as "sem dado", never as zero.
 */

import { readSnapshots } from "../analytics/score";
import { planStatus, type SlotStatus, type SlotView } from "../plan/batch";
import { listPlanIds, loadPlan } from "../plan/content-plan";
import { readBrandProfile } from "../profile/brand-profile";
import { esc } from "../approval/page";
import { assertClientSlug, engineRoot } from "../clients/paths";

export interface SnapshotOptions {
  client: string;
  /** `YYYY-MM`, read in the client's timezone. */
  month: string;
  /** Presentation mode hides the client's name. */
  presentation?: boolean;
  now?: Date;
}

const STATUS_LABEL: Record<SlotStatus, string> = {
  queued_next_cycle: "próximo ciclo",
  planned: "planejado",
  rendering: "em produção",
  render_failed: "em produção",
  rendered: "em aprovação",
  awaiting_approval: "em aprovação",
  changes_requested: "ajuste pedido",
  approved: "aprovado",
  scheduled: "agendado",
  cancelled: "cancelado",
  schedule_failed: "a reagendar",
};

const NETWORK_LABEL: Record<string, string> = { tiktok: "TikTok", ig_reels: "Instagram Reels", yt_shorts: "YouTube Shorts" };
const METRICS: Array<[string, string]> = [["views", "Visualizações"], ["saves", "Salvamentos"], ["shares", "Compartilhamentos"]];

interface Row {
  when: string;
  network: string;
  format: string;
  label: string;
  caption: string;
  metrics: Array<[string, string]>;
  live: boolean;
}

function latestMetrics(root: string): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  const rows = [...readSnapshots(engineRoot(root))].sort((a, b) => a.polled_at.localeCompare(b.polled_at));
  for (const r of rows) {
    const byMetric = out.get(r.piece_id) ?? new Map<string, number>();
    byMetric.set(r.metric, r.value);
    out.set(r.piece_id, byMetric);
  }
  return out;
}

export function buildSnapshot(root: string, opts: SnapshotOptions): { html: string; posts: number; simulated: boolean } {
  assertClientSlug(opts.client);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(opts.month)) throw new Error("snapshot: --month must be YYYY-MM");
  const latest = new Map<string, SlotView>();
  let timezone = "";
  for (const id of listPlanIds(root, opts.client)) {
    const plan = loadPlan(root, opts.client, id);
    timezone = plan.timezone;
    for (const view of planStatus(root, plan)) latest.set(`${view.slot.piece_id}`, view);
  }
  const metrics = latestMetrics(root);
  let name = opts.client;
  try {
    name = readBrandProfile(root, opts.client).name;
  } catch {
    /* no profile: the slug is the name */
  }
  const mask = (text: string): string =>
    opts.presentation ? [name, opts.client].reduce((acc, n) => acc.replace(new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "Cliente"), text) : text;
  let simulated = false;
  const rows: Row[] = [...latest.values()]
    .filter((v) => v.slot.local_time.startsWith(opts.month))
    .sort((a, b) => a.slot.publish_at.localeCompare(b.slot.publish_at))
    .map((v) => {
      const m = metrics.get(v.slot.piece_id);
      const live = Boolean(m && m.size > 0);
      // Metrics only exist for posts that are on the network, so they are what proves "published".
      const simulation = !live && v.status === "scheduled" && v.receipt?.dry_run === true;
      if (simulation) simulated = true;
      const label = live ? "publicado" : simulation ? "agendado (simulação)" : STATUS_LABEL[v.status];
      return {
        when: v.slot.local_time,
        network: NETWORK_LABEL[v.slot.network] ?? v.slot.network,
        format: v.slot.format,
        label,
        caption: mask(v.slot.caption.split("\n")[0] ?? ""),
        metrics: METRICS.map(([key, text]) => [text, m?.has(key) ? String(m.get(key)) : "sem dado"] as [string, string]),
        live,
      };
    });
  const shown = opts.presentation ? "Cliente" : name;
  const counts = (label: string): number => rows.filter((r) => r.label.startsWith(label)).length;
  const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="robots" content="noindex, nofollow">
<title>Calendário ${esc(opts.month)} — ${esc(shown)}</title>
<style>
:root{color-scheme:light dark;--bg:#fff;--fg:#111827;--muted:#4b5563;--line:#d1d5db;--warn:#92400e}
@media (prefers-color-scheme:dark){:root{--bg:#0b1020;--fg:#f3f4f6;--muted:#cbd5e1;--line:#334155;--warn:#fbbf24}}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif;max-width:960px;margin-inline:auto}
table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid var(--line);padding:8px;text-align:left;vertical-align:top}
th{font-size:.85rem;color:var(--muted)}.note{color:var(--warn);font-weight:600}.sum{display:flex;gap:16px;flex-wrap:wrap;margin:12px 0}
@media (max-width:640px){table,thead,tbody,tr,td,th{display:block}thead{display:none}tr{border-bottom:1px solid var(--line);padding:8px 0}td{border:0;padding:2px 0}}
</style>
</head>
<body>
<main>
<h1>Calendário de ${esc(opts.month)} — ${esc(shown)}</h1>
${simulated ? '<p class="note">Rascunho: parte destas datas é uma simulação e ainda não está agendada na rede.</p>' : ""}
<div class="sum"><span>Posts: <strong>${rows.length}</strong></span><span>Agendados: <strong>${counts("agendado")}</strong></span><span>Publicados: <strong>${counts("publicado")}</strong></span><span>Em aprovação: <strong>${counts("em aprovação")}</strong></span></div>
${
  rows.length === 0
    ? "<p>Nenhum post planejado neste mês.</p>"
    : `<table>
<thead><tr><th scope="col">Data e hora${timezone ? ` (${esc(timezone)})` : ""}</th><th scope="col">Rede</th><th scope="col">Formato</th><th scope="col">Situação</th><th scope="col">Legenda</th><th scope="col">Resultados</th></tr></thead>
<tbody>
${rows.map((r) => `<tr><td>${esc(r.when)}</td><td>${esc(r.network)}</td><td>${esc(r.format)}</td><td>${esc(r.label)}</td><td>${esc(r.caption)}</td><td>${r.metrics.map(([k, v]) => `${esc(k)}: ${esc(v)}`).join("<br>")}</td></tr>`).join("\n")}
</tbody>
</table>`
}
<p>Gerado em ${esc((opts.now ?? new Date()).toISOString().slice(0, 10))}.</p>
</main>
</body>
</html>
`;
  return { html, posts: rows.length, simulated };
}
