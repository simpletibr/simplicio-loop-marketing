/**
 * alerts.ts — the alert centre: every active alert, most urgent first. This
 * is the only view that also reads the Real Oficial balance and accounts
 * (read-only, cached), so the credit and capacity rules can fire.
 */

import { currentAlerts, thresholdsFromEnv, type RoSnapshot } from "../alerts";
import { capacityOf } from "./status";
import type { ViewContext, ViewRoute } from "../routes";

export async function roSnapshot(ctx: ViewContext): Promise<RoSnapshot | undefined> {
  if (!ctx.ro) return undefined;
  const who = await ctx.ro.get("ro_whoami").catch(() => null);
  const credits = (who?.data as { credits?: unknown } | undefined)?.credits;
  const capacity = await capacityOf(ctx).catch(() => null);
  if (!who && !capacity) return undefined;
  return { balance: typeof credits === "number" ? credits : null, capacity: capacity?.platforms ?? null, fetched_at: who?.fetched_at ?? capacity?.fetched_at ?? ctx.now.toISOString() };
}

export async function alerts(ctx: ViewContext) {
  const list = currentAlerts(ctx.root, ctx.store.all(), ctx.now, await roSnapshot(ctx));
  const only = ctx.query.get("client");
  const shown = list.filter((a) => (!only || a.client === only || !a.client) && (!ctx.query.get("severity") || a.severity === ctx.query.get("severity")));
  return {
    generated_at: ctx.now.toISOString(),
    alerts: shown,
    counts: { error: shown.filter((a) => a.severity === "error").length, warn: shown.filter((a) => a.severity === "warn").length, info: shown.filter((a) => a.severity === "info").length },
    thresholds: thresholdsFromEnv(),
    external_delivery: process.env.MARKETING_DASHBOARD_ALERT_WEBHOOK ? "webhook" : "off",
  };
}

export const alertsRoute: ViewRoute = { path: "/api/alerts", handle: alerts };
