import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface PublishPiece {
  id: string;
  client?: string;
  platforms: string[];
  caption: string;
  media_paths: string[];
  scheduled_at: string;
}

export interface PublishResult {
  ok: boolean;
  draft_url: string;
  error?: string;
}

export interface PublishClient {
  schedule(piece: PublishPiece): Promise<PublishResult>;
}

function isDryRun(): boolean {
  const v = process.env.DRY_RUN;
  return v === undefined || v === "" || v === "true";
}

/**
 * @deprecated Scheduling goes through the `Publisher` seam
 * (lib/publish/publisher.ts), which binds every post to a client approval and
 * the media hash. This client stays until its callers migrate; do not add new ones.
 */
export class AdaptlyPostClient implements PublishClient {
  readonly name = "adaptlypost";

  async schedule(piece: PublishPiece): Promise<PublishResult> {
    const dry_run = isDryRun();
    if (dry_run) {
      const draftDir = resolve(
        process.cwd(),
        "outputs",
        piece.client ?? "unknown",
        piece.scheduled_at.slice(0, 10),
        piece.id,
      );
      if (!existsSync(draftDir)) mkdirSync(draftDir, { recursive: true });
      writeFileSync(
        resolve(draftDir, "adaptlypost-draft.json"),
        JSON.stringify(piece, null, 2),
      );
      return {
        ok: true,
        draft_url: `https://adaptlypost.test/drafts/${piece.id}`,
      };
    }
    const apiKey = process.env.ADAPTLYPOST_API_KEY;
    if (!apiKey) {
      return {
        ok: false,
        draft_url: "",
        error: "adaptlypost: ADAPTLYPOST_API_KEY missing",
      };
    }
    const maxAttempts = 3;
    let lastErr: string | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await fetch("https://api.adaptlypost.com/v1/drafts", {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(piece),
        });
        if (!res.ok) {
          lastErr = `HTTP ${res.status}: ${await res.text()}`;
          if (res.status >= 500 && attempt < maxAttempts) {
            await new Promise((r) => setTimeout(r, 2000 * Math.pow(2, attempt - 1)));
            continue;
          }
          break;
        }
        const data = (await res.json()) as { id?: string; url?: string };
        return {
          ok: true,
          draft_url: data.url ?? `https://adaptlypost.com/drafts/${data.id}`,
        };
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err);
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 2000 * Math.pow(2, attempt - 1)));
          continue;
        }
      }
    }
    return { ok: false, draft_url: "", error: lastErr };
  }
}

export function getPublishClient(): PublishClient {
  return new AdaptlyPostClient();
}

void dirname;
