// Pure mapping from the dashboard's data to the kit's attributes. No DOM here, so node can test it.
import { fmtNumber, fmtDelta, fmtDate, STAGE_LABEL } from "./dom.js";

export const SLOT_LABEL = { queued_next_cycle: "fila do próximo ciclo", planned: "planejado", rendering: "em produção", render_failed: "em produção", rendered: "em aprovação", awaiting_approval: "em aprovação", changes_requested: "ajuste pedido", approved: "aprovado", scheduled: "agendado", cancelled: "cancelado", schedule_failed: "falhou" };

// How the kit draws a post. Only a real schedule is "passed": a simulation is an estimate, and a post that waits for the
// next cycle is never drawn as scheduled.
export const SLOT_STATE = { queued_next_cycle: "PENDING", planned: "PENDING", rendering: "RUNNING", render_failed: "RUNNING", rendered: "UNVERIFIED", awaiting_approval: "UNVERIFIED", changes_requested: "FAIL", approved: "PENDING", scheduled: "PASS", cancelled: "BLOCKED", schedule_failed: "FAIL" };
export const slotState = (entry) => (entry.simulated ? "ESTIMADO" : SLOT_STATE[entry.status]);

// The seal of a gate on a piece. "na" (does not apply) is not a gate, so it has no state.
export const SEAL_STATE = { pass: "PASS", fail: "FAIL", pending: "PENDING", none: "UNVERIFIED" };

// Which way is better for a KPI that has a side. The funnel and the voice quota have none: they show the change as plain text.
export const KPI_BETTER = { scheduled_30d: "up", published_today: "up", published_week: "up", publish_failures: "down", approvals_client: "down", approvals_operator: "down", credits_ro: "up", mrr: "up", sales_month: "up" };

const signed = (delta) => `${delta > 0 ? "+" : "-"}${fmtNumber(Math.abs(delta), 2)}`;

/** The attributes of the kit's KPI card for one cockpit KPI. A change of zero, or none, has nothing to improve: plain text. */
export function kpiAttrs(k) {
  const detail = k.detail ?? {};
  const bits = [];
  if (k.id === "pieces_in_funnel") bits.push(Object.entries(detail.by_stage ?? {}).filter(([, n]) => n > 0).map(([s, n]) => `${STAGE_LABEL[s]} ${n}`).join(" · "));
  if (k.id === "tts_quota" && detail.limit !== null && detail.limit !== undefined) bits.push(`limite ${fmtNumber(detail.limit)}${detail.blocked_until ? ` · volta ${fmtDate(detail.blocked_until)}` : ""}`);
  if (detail.source) bits.push(detail.source);
  if (detail.currency && k.value !== null) bits.push(detail.currency);
  const directed = Object.hasOwn(KPI_BETTER, k.id) && k.delta !== null && k.delta !== undefined && k.delta !== 0;
  bits.push(directed ? "vs semana passada" : fmtDelta(k.delta));
  return { label: k.label, value: fmtNumber(k.value, 2), delta: directed ? signed(k.delta) : null, good: KPI_BETTER[k.id] ?? "up", detail: bits.join(" · ") };
}
