/**
 * calendar.ts — the month of a client as a table or markdown.
 *
 * Markdown is meant to be pasted into a ticket or a note; nothing here creates
 * cards or sends anything anywhere.
 */

import type { SlotView } from "./batch";
import type { ContentPlan } from "./content-plan";
import { formatLocal } from "./content-plan";

const BRT = "America/Sao_Paulo";

function brt(iso: string): string {
  return formatLocal(new Date(iso), BRT).slice(11);
}

function row(view: SlotView, plan: ContentPlan): string[] {
  const { slot } = view;
  return [slot.local_time, `${brt(slot.publish_at)} BRT`, slot.network, slot.format, view.status, slot.piece_id, plan.timezone];
}

const HEADER = ["local", "BRT", "network", "format", "status", "piece", "timezone"];

export function renderCalendar(plan: ContentPlan, views: SlotView[], format: "table" | "markdown" = "table"): string {
  const rows = views.map((v) => row(v, plan));
  if (format === "markdown") {
    const lines = [`# Calendário ${plan.client} (${plan.start}, ${plan.days} dias)`, "", `| ${HEADER.join(" | ")} |`, `| ${HEADER.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.join(" | ")} |`)];
    const queued = views.filter((v) => v.status === "queued_next_cycle").length;
    if (queued > 0) lines.push("", `${queued} post(s) além da janela de ${plan.window_days} dias ficam na fila do próximo ciclo.`);
    return `${lines.join("\n")}\n`;
  }
  const widths = HEADER.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] as string).length)));
  const fmt = (cells: string[]): string => cells.map((c, i) => c.padEnd(widths[i] as number)).join("  ").trimEnd();
  return `${[fmt(HEADER), fmt(widths.map((w) => "-".repeat(w))), ...rows.map(fmt)].join("\n")}\n`;
}

export function statusCounts(views: SlotView[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const v of views) counts[v.status] = (counts[v.status] ?? 0) + 1;
  return counts;
}
