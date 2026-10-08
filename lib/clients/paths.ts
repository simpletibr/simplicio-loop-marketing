import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** The engine workspace of a host project: `.marketing-engine/` when present, else the root. */
export function engineRoot(root: string): string {
  const nested = resolve(root, ".marketing-engine");
  return existsSync(nested) ? nested : resolve(root);
}

export function assertClientSlug(slug: string): string {
  if (!SLUG.test(slug)) throw new Error(`invalid client slug "${slug}": use lowercase letters, digits and dashes`);
  return slug;
}

export function clientDir(root: string, slug: string): string {
  return join(engineRoot(root), "clients", assertClientSlug(slug));
}
