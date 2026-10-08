/**
 * realoficial.ts — the dashboard's read-only window on Real Oficial.
 *
 * Only three tools may ever be called from the panel, and none of them spends
 * credits. Anything else, including the tools that create clips, render or
 * start a purchase, is refused here, before a transport is touched. Results
 * are cached so an open panel does not poll the account.
 */

export const RO_READ_ONLY_TOOLS = ["ro_whoami", "ro_list_projects", "ro_list_renders"] as const;
export type RoReadTool = (typeof RO_READ_ONLY_TOOLS)[number];

/** Tools that spend credits or money. Listed so tests can prove the panel never reaches them. */
export const RO_SPENDING_TOOLS = ["ro_create_clips", "ro_render_clip", "ro_render_clips", "ro_start_purchase", "ro_dub_clip", "ro_translate_clips", "ro_confirm_spend", "ro_confirm_publishing"] as const;

/** Implemented by the caller (an MCP session); the panel never opens its own connection. */
export interface RoTransport {
  call(tool: RoReadTool): Promise<unknown>;
}

export interface ReadOnlyRo {
  get(tool: RoReadTool): Promise<{ data: unknown; cached: boolean; fetched_at: string }>;
}

export function createReadOnlyRo(transport: RoTransport, opts: { ttlMs?: number; now?: () => number } = {}): ReadOnlyRo {
  const ttl = opts.ttlMs ?? 5 * 60_000;
  const now = opts.now ?? Date.now;
  const cache = new Map<string, { at: number; data: unknown }>();
  return {
    async get(tool) {
      if (!(RO_READ_ONLY_TOOLS as readonly string[]).includes(tool)) {
        throw new Error(`dashboard: "${tool}" is not on the read-only allowlist`);
      }
      const hit = cache.get(tool);
      if (hit && now() - hit.at < ttl) return { data: hit.data, cached: true, fetched_at: new Date(hit.at).toISOString() };
      const data = await transport.call(tool);
      const at = now();
      cache.set(tool, { at, data });
      return { data, cached: false, fetched_at: new Date(at).toISOString() };
    },
  };
}
