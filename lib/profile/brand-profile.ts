/**
 * brand-profile.ts — the brand profile of a client, collected from its public
 * URL by the video factory's collector (which owns robots.txt and LGPD
 * handling) and normalised into the `brand-profile/v1` contract.
 *
 * Every fact keeps the source it came from. A collection that reports PII or
 * ignored robots.txt is rejected instead of stored.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { assertClientSlug, clientDir } from "../clients/paths";
import { readHbi, writeHbiAtomic } from "../formats/binary";
import { loadSchemaRegistry } from "../contracts/registry";
import { validateArtifact } from "../contracts/validate";

const execFileAsync = promisify(execFile);

export const BRAND_PROFILE_SCHEMA = "brand-profile/v1";

export interface CollectedFact {
  field: string;
  value: string;
  source: string;
}

/** What the collector must return; anything else is rejected. */
export interface ProspectCollection {
  name: string;
  sector: string;
  city?: string;
  country: string;
  language: string;
  colors: string[];
  logo: { ref: string; source: string };
  tone: string;
  persona: string;
  pillars: string[];
  pains: string[];
  facts: CollectedFact[];
  robots_respected: boolean;
  pii_collected: boolean;
}

export interface BrandProfile {
  schema: typeof BRAND_PROFILE_SCHEMA;
  generated_at: string;
  client: string;
  name: string;
  url: string;
  sector: string;
  city?: string;
  country: string;
  language: string;
  colors: string[];
  logo: { ref: string; source: string };
  tone: string;
  persona: string;
  pillars: string[];
  pains: string[];
  languages?: string[];
  voice_routes?: Record<string, string>;
  collection: { mode: "dry-run" | "live"; robots_respected: boolean; pii_collected: boolean };
  facts: Array<CollectedFact & { collected_at: string }>;
}

function isDryRun(): boolean {
  const v = process.env.DRY_RUN;
  return v === undefined || v === "" || v === "true";
}

function assertHttpUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`profile: "${url}" is not a valid URL`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("profile: only http(s) URLs are supported");
  return parsed;
}

/** Deterministic dry-run collection: derived from the host, labelled as fixture. */
export function fixtureCollection(url: string): ProspectCollection {
  const host = assertHttpUrl(url).hostname.replace(/^www\./, "");
  const label = host.split(".")[0] ?? host;
  const name = label.charAt(0).toUpperCase() + label.slice(1);
  const source = `fixture:dry-run:${host}`;
  return {
    name,
    sector: "servicos",
    city: "Sao Paulo",
    country: "BR",
    language: "pt-BR",
    colors: ["#0F172A", "#38BDF8"],
    logo: { ref: `fixture://${host}/logo.svg`, source },
    tone: "direto e acolhedor",
    persona: `Cliente local que procura ${label}`,
    pillars: ["educacao", "prova social", "bastidores"],
    pains: ["pouco tempo para criar conteudo"],
    facts: [
      { field: "name", value: name, source },
      { field: "sector", value: "servicos", source },
    ],
    robots_respected: true,
    pii_collected: false,
  };
}

/** Live collection through the factory CLI; never fetches the site from this repo. */
export async function collectProspect(url: string): Promise<{ collection: ProspectCollection; mode: "dry-run" | "live" }> {
  assertHttpUrl(url);
  if (isDryRun()) return { collection: fixtureCollection(url), mode: "dry-run" };
  const bin = process.env.SIMPLICIO_VIDEO_BIN;
  if (!bin) throw new Error("profile: SIMPLICIO_VIDEO_BIN missing (required when DRY_RUN=false)");
  const { stdout } = await execFileAsync(bin, ["prospect", "--json", url], { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
  const last = stdout.trim().split("\n").filter(Boolean).pop() ?? "";
  try {
    return { collection: JSON.parse(last) as ProspectCollection, mode: "live" };
  } catch {
    throw new Error("profile: collector did not print a JSON result on its last stdout line");
  }
}

export function buildBrandProfile(
  collection: ProspectCollection,
  input: { client: string; url: string; mode: "dry-run" | "live"; now?: Date },
): BrandProfile {
  assertClientSlug(input.client);
  assertHttpUrl(input.url);
  if (collection.pii_collected) throw new Error("profile: collection reports PII; refusing to store it (LGPD)");
  if (!collection.robots_respected) throw new Error("profile: collection did not respect robots.txt; refusing to store it");
  const ts = (input.now ?? new Date()).toISOString();
  const profile: BrandProfile = {
    schema: BRAND_PROFILE_SCHEMA,
    generated_at: ts,
    client: input.client,
    name: collection.name,
    url: input.url,
    sector: collection.sector,
    ...(collection.city ? { city: collection.city } : {}),
    country: collection.country,
    language: collection.language,
    colors: collection.colors,
    logo: collection.logo,
    tone: collection.tone,
    persona: collection.persona,
    pillars: collection.pillars,
    pains: collection.pains,
    collection: { mode: input.mode, robots_respected: true, pii_collected: false },
    facts: collection.facts.map((fact) => ({ ...fact, collected_at: ts })),
  };
  const missingSource = profile.facts.filter((fact) => !fact.source);
  if (missingSource.length > 0) throw new Error(`profile: ${missingSource.length} fact(s) without a source`);
  const result = validateArtifact(profile, loadSchemaRegistry());
  if (!result.ok) throw new Error(`profile: invalid brand-profile/v1: ${result.errors.join("; ")}`);
  return profile;
}

export function profilePath(root: string, client: string): string {
  return join(clientDir(root, client), "brand-profile.hbi");
}

export function writeBrandProfile(root: string, profile: BrandProfile): string {
  const path = profilePath(root, profile.client);
  writeHbiAtomic(path, profile);
  return path;
}

export function readBrandProfile(root: string, client: string): BrandProfile {
  const path = profilePath(root, client);
  if (!existsSync(path)) throw new Error(`profile: no brand profile for "${client}"; run \`marketing-engine profile <url> --client ${client}\``);
  const profile = readHbi<BrandProfile>(path);
  const result = validateArtifact(profile, loadSchemaRegistry());
  if (!result.ok) throw new Error(`profile: stored profile is invalid: ${result.errors.join("; ")}`);
  return profile;
}
