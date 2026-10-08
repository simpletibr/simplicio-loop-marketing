/**
 * post-metrics.ts — what a network reports about one post.
 *
 * A metric the source did not report is absent from the object, never zero:
 * the reports and the dashboard print "sem dado" for it. Sources are
 * read-only; credentials come from the caller and never appear in URLs or
 * error messages.
 */

export const METRICS = ["views", "likes", "comments", "shares", "saves"] as const;
export type Metric = (typeof METRICS)[number];
export type PostMetrics = Partial<Record<Metric, number>>;

export interface FetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}
export interface FetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}
/** The shape of `fetch` the fetchers need, so tests replay recorded responses without a network. */
export type Fetcher = (url: string, init?: FetchInit) => Promise<FetchResponse>;

export const defaultFetcher: Fetcher = (url, init) => fetch(url, init as RequestInit);

/** A count the source reported: a finite number or a numeric string, never negative. */
export function count(value: unknown): number | undefined {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : undefined;
}

export function pick(target: PostMetrics, metric: Metric, value: unknown): void {
  const n = count(value);
  if (n !== undefined) target[metric] = n;
}
