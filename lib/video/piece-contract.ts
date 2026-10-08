import { existsSync } from "node:fs";
import { assertClientSlug } from "../clients/paths";
import { profilePath, readBrandProfile } from "../profile/brand-profile";
import type { VideoContractInput } from "./contract";

export interface PieceForContract {
  id: string;
  client: string;
  locale?: string;
}

function slugOf(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "piece";
}

/** Derive the factory contract from a piece; the brand profile is used when the client has one. */
export function buildPieceContract(
  root: string,
  piece: PieceForContract,
  brief: string,
  format: { aspect: string; duration_s: number },
): VideoContractInput {
  const contract: VideoContractInput = {
    slug: slugOf(piece.id),
    client: piece.client,
    language: piece.locale ?? "pt-BR",
    aspect: format.aspect,
    duration_s: format.duration_s,
    script: brief,
    voice: { provider: "default" },
  };
  try {
    assertClientSlug(piece.client);
  } catch {
    return contract;
  }
  if (existsSync(profilePath(root, piece.client))) {
    const profile = readBrandProfile(root, piece.client);
    contract.brand = { name: profile.name, colors: profile.colors, tone: profile.tone, logo: profile.logo.ref };
  }
  return contract;
}
