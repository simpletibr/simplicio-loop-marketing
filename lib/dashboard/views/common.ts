import { maskAlias } from "../model";
import type { StoredEvent } from "../store";

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Presentation mode replaces client slugs with stable aliases (by sorted order). */
export function aliasMap(slugs: Iterable<string>): Map<string, string> {
  return new Map([...new Set(slugs)].sort().map((slug, i) => [slug, maskAlias(i)]));
}

export function inWindow(e: StoredEvent, fromMs: number, toMs: number): boolean {
  const t = Date.parse(e.ts);
  return t > fromMs && t <= toMs;
}

export function round(value: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** Deep-copies a value replacing every occurrence of the aliases' keys (client slugs) in strings and `client` fields. */
export function maskTree<T>(value: T, aliases: Map<string, string>, names: Map<string, string> = new Map()): T {
  const swap = (text: string): string => {
    let out = text;
    for (const [slug, alias] of aliases) out = out.split(slug).join(alias);
    for (const [name, alias] of names) out = out.split(name).join(alias);
    return out;
  };
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return swap(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [swap(k), walk(x)]));
    return v;
  };
  return walk(value) as T;
}
