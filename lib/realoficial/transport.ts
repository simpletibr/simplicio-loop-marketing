/**
 * transport.ts — the seam to the Real Oficial MCP tools.
 *
 * The engine never opens its own connection: the caller (an MCP session)
 * injects a transport for live runs, and DRY_RUN uses the in-repo dry-run
 * transports of each lane. Answers are plain JSON objects shaped like the
 * `ro_*` tool results.
 */

export type RoArgs = Record<string, unknown>;
export type RoAnswer = Record<string, unknown>;

export interface RoToolTransport {
  call(tool: string, args: RoArgs): Promise<RoAnswer>;
}

export function isDryRun(): boolean {
  const v = process.env.DRY_RUN;
  return v === undefined || v === "" || v === "true";
}

export function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
