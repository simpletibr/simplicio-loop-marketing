import { join, normalize } from "node:path";
import { writeHbiAtomic } from "../formats/binary";
import { releaseIdentity, type ReleaseIdentity } from "../release-train/receipt";

export interface ProviderDescriptor {
  name: string;
  version?: string;
}

export interface ManifestPayload {
  piece_id: string;
  client: string;
  date: string;
  providers: {
    llm?: string | ProviderDescriptor;
    image?: string | ProviderDescriptor;
    video?: string | ProviderDescriptor;
  };
  prompts: {
    script?: string;
    caption?: string;
    image?: string;
    video?: string;
  };
  seeds?: {
    image?: number;
    video?: number;
  };
  cost_estimate_usd: number;
  tokens_in?: number;
  tokens_out?: number;
  compliance_report_path: string;
  qa_report_path?: string;
  watcher_report_path?: string;
  outputs?: string[];
  fallback_used?: boolean;
  /** Render manifest of the video factory and the sha256 of the MP4 it vouches for. */
  render_manifest_path?: string;
  render_sha256?: string;
}

export const MANIFEST_SCHEMA = "marketing-manifest/v1";

export interface ManifestDocument extends Omit<ManifestPayload, "providers"> {
  schema: typeof MANIFEST_SCHEMA;
  generated_at: string;
  providers: {
    llm?: ProviderDescriptor;
    image?: ProviderDescriptor;
    video?: ProviderDescriptor;
  };
  release_identity: ReleaseIdentity;
}

function normalizeProvider(
  provider?: string | ProviderDescriptor,
): ProviderDescriptor | undefined {
  if (!provider) {
    return undefined;
  }

  if (typeof provider === "string") {
    return { name: provider };
  }

  return provider;
}

function manifestPath(target: string): string {
  return target.endsWith(".hbi") ? target : join(target, "manifest.hbi");
}

function normalizeStoredPath(path?: string): string | undefined {
  return path ? path.replace(/\\/g, "/") : undefined;
}

export function writeManifest(
  target: string,
  payload: ManifestPayload,
): ManifestDocument {
  const path = manifestPath(target);
  const document: ManifestDocument = {
    schema: MANIFEST_SCHEMA,
    generated_at: new Date().toISOString(),
    piece_id: payload.piece_id,
    client: payload.client,
    date: payload.date,
    providers: {
      llm: normalizeProvider(payload.providers.llm),
      image: normalizeProvider(payload.providers.image),
      video: normalizeProvider(payload.providers.video),
    },
    prompts: payload.prompts,
    seeds: payload.seeds,
    cost_estimate_usd: payload.cost_estimate_usd,
    tokens_in: payload.tokens_in ?? 0,
    tokens_out: payload.tokens_out ?? 0,
    compliance_report_path: normalizeStoredPath(payload.compliance_report_path) ?? "",
    qa_report_path: normalizeStoredPath(payload.qa_report_path),
    watcher_report_path: normalizeStoredPath(payload.watcher_report_path),
    outputs: (payload.outputs ?? []).map((output) => normalize(output)),
    fallback_used: payload.fallback_used ?? false,
    ...(payload.render_manifest_path ? { render_manifest_path: normalizeStoredPath(payload.render_manifest_path) } : {}),
    ...(payload.render_sha256 ? { render_sha256: payload.render_sha256 } : {}),
    release_identity: releaseIdentity(),
  };

  writeHbiAtomic(path, document);
  return document;
}
