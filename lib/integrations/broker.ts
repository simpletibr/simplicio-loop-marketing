/**
 * broker.ts — REST/MCP/browser/computer-use/manual integration broker.
 *
 * Skills and CLI loops ask the broker for a capability against a channel id;
 * the broker picks the safest available adapter method and explains why.
 * No skill or agent code should hardcode a platform-specific client — this
 * module is the single place that resolves "how do we talk to channel X".
 */

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { getChannel } from "../channels/registry";
import type { PublishMethod } from "../channels/types";

export type Capability =
  | "publish"
  | "schedule"
  | "fetch_metrics"
  | "draft_ad"
  | "comment_monitor"
  | "evidence_capture";

export interface AdapterDecision {
  channel_id: string;
  capability: Capability;
  method: PublishMethod;
  rationale: string;
}

export interface AdapterFailure {
  channel_id: string;
  capability: Capability;
  method: PublishMethod;
  error: string;
  occurred_at: string;
}

export interface AdapterCallResult<T = unknown> {
  ok: boolean;
  decision: AdapterDecision;
  dry_run: boolean;
  payload_preview?: T;
  screenshot_path?: string;
  error?: string;
}

function isDryRun(): boolean {
  const v = process.env.DRY_RUN;
  return v === undefined || v === "" || v === "true";
}

// ---------------------------------------------------------------------------
// Capability support matrix
// ---------------------------------------------------------------------------
// Every channel's `publish_method` is its preferred route for `publish`.
// Other capabilities may downgrade to a safer/more available method — for
// example, a channel published via `api` might still need `browser` for
// evidence_capture of the rendered post, or `manual` for comment_monitor
// when no read API exists.

const CAPABILITY_FALLBACK: Record<Capability, PublishMethod[]> = {
  publish: ["api", "mcp", "browser", "computer-use", "manual"],
  schedule: ["api", "mcp", "manual"],
  fetch_metrics: ["api", "mcp", "browser", "manual"],
  draft_ad: ["api", "mcp", "manual"],
  comment_monitor: ["api", "mcp", "browser", "manual"],
  evidence_capture: ["browser", "computer-use", "api"],
};

const METHOD_RATIONALE: Record<PublishMethod, string> = {
  api: "Direct REST API is available and is the safest, most auditable route.",
  mcp: "An MCP connector exposes this capability without custom API glue code.",
  browser: "No safe API/MCP route exists; browser automation drives the logged-in UI.",
  "computer-use": "UI requires visual interaction beyond DOM automation (canvas/captcha-adjacent flows).",
  manual: "No safe automated route exists for this community; a human performs the action following the playbook.",
};

/**
 * Choose the adapter method for a channel/capability pair.
 * Prefers the channel's declared `publish_method`, but capabilities like
 * `evidence_capture` may need a different (usually browser) route even when
 * publish itself goes through an API.
 */
export function chooseAdapter(channelId: string, capability: Capability): AdapterDecision {
  const channel = getChannel(channelId);
  if (!channel) {
    return {
      channel_id: channelId,
      capability,
      method: "manual",
      rationale: `Unknown channel "${channelId}" — no registry entry; defaulting to manual review.`,
    };
  }

  const preferredOrder = CAPABILITY_FALLBACK[capability];
  // If the channel's own publish_method is in the capability's viable list, use it.
  if (preferredOrder.includes(channel.publish_method)) {
    return {
      channel_id: channelId,
      capability,
      method: channel.publish_method,
      rationale: `${channel.name} declares "${channel.publish_method}" as its publish method. ${METHOD_RATIONALE[channel.publish_method]}`,
    };
  }
  // Otherwise fall back to the first viable method for this capability.
  const method = preferredOrder[0];
  return {
    channel_id: channelId,
    capability,
    method,
    rationale: `${channel.name}'s declared method "${channel.publish_method}" does not support ${capability}; falling back to "${method}". ${METHOD_RATIONALE[method]}`,
  };
}

function failuresPath(root: string): string {
  return resolve(root, "data", "integration-failures.jsonl");
}

export function recordFailure(root: string, failure: AdapterFailure): void {
  const path = failuresPath(root);
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(failure)}\n`);
}

/**
 * Dry-run simulation for any adapter call. Always returns a payload preview
 * instead of performing a live publish/spend action. Real (non-dry-run)
 * execution is intentionally not implemented here: each concrete adapter
 * (adaptlypost, meta-ads, future channel-specific clients) owns its own
 * live-call path and is invoked by callers after `chooseAdapter` resolves
 * the method — this broker only decides *how*, never performs the *call*.
 */
export function simulate<T>(
  channelId: string,
  capability: Capability,
  payload: T,
): AdapterCallResult<T> {
  const decision = chooseAdapter(channelId, capability);
  return {
    ok: true,
    decision,
    dry_run: true,
    payload_preview: payload,
  };
}

export type PublisherId = "dry-run" | "realoficial-browser" | "realoficial-api";

const PUBLISHER_IDS: readonly PublisherId[] = ["dry-run", "realoficial-browser", "realoficial-api"];

/**
 * Picks the scheduling implementation. `DRY_RUN` (the default) always resolves
 * to the dry-run publisher; a live run must name its publisher explicitly in
 * `PUBLISHER`, so a missing or unknown value fails closed instead of guessing.
 */
export function choosePublisher(
  channelId: string,
  env: NodeJS.ProcessEnv = process.env,
): { publisher: PublisherId; channel_id: string; rationale: string } {
  const dry = env.DRY_RUN === undefined || env.DRY_RUN === "" || env.DRY_RUN === "true";
  if (dry) return { publisher: "dry-run", channel_id: channelId, rationale: "DRY_RUN is on: receipts are written, nothing is sent." };
  const wanted = env.PUBLISHER;
  if (!wanted || !PUBLISHER_IDS.includes(wanted as PublisherId) || wanted === "dry-run") {
    throw new Error(`broker: live scheduling needs PUBLISHER set to one of ${PUBLISHER_IDS.filter((p) => p !== "dry-run").join(", ")}`);
  }
  return {
    publisher: wanted as PublisherId,
    channel_id: channelId,
    rationale:
      wanted === "realoficial-api"
        ? "Official Real Oficial API/MCP route (reserved: not available yet)."
        : "Interim route: the Real Oficial web app driven through the governed browser lane.",
  };
}

export function explain(channelId: string, capability: Capability): string {
  return chooseAdapter(channelId, capability).rationale;
}

export function isBrokerDryRun(): boolean {
  return isDryRun();
}
