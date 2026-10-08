/**
 * webhook.ts — the endpoint behind the approval page form.
 *
 * A plain `node:http` request handler: it accepts only POST bodies that carry
 * the per-request token, caps the body size, and records the decision through
 * the same store the CLI uses. It binds nowhere by itself; `approval serve`
 * binds it to 127.0.0.1 and the operator decides how it is exposed.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { listRequests, recordDecision, tokenMatches, type Decision } from "./store";

const MAX_BODY = 16 * 1024;

class BodyTooLarge extends Error {}

/** Reads at most MAX_BODY bytes; extra bytes are drained and dropped so the reply still reaches the client. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_BODY) chunks.push(chunk);
    });
    req.on("end", () => (size > MAX_BODY ? reject(new BodyTooLarge("body too large")) : resolveBody(Buffer.concat(chunks).toString("utf8"))));
    req.on("error", reject);
  });
}

function parseBody(raw: string, contentType: string): Record<string, string> {
  if (contentType.includes("application/json")) {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)]));
  }
  return Object.fromEntries(new URLSearchParams(raw));
}

function reply(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
  res.end(text);
}

export function createApprovalHandler(root: string): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    if (req.method !== "POST") return reply(res, 405, "method not allowed");
    let fields: Record<string, string>;
    try {
      fields = parseBody(await readBody(req), String(req.headers["content-type"] ?? ""));
    } catch (error) {
      return error instanceof BodyTooLarge ? reply(res, 413, "body too large") : reply(res, 400, "invalid body");
    }
    const { request_id, token, decision, piece_id, media_sha256, client } = fields;
    if (!request_id || !token || !tokenMatches(root, request_id, token)) return reply(res, 403, "invalid token");
    if (decision !== "approved" && decision !== "changes_requested") return reply(res, 400, "invalid decision");
    const request = listRequests(root).find((r) => r.request_id === request_id);
    if (!request || request.piece_id !== piece_id || request.media_sha256 !== media_sha256 || request.client !== client) {
      return reply(res, 400, "request does not match");
    }
    try {
      recordDecision(root, {
        client: request.client,
        pieceId: request.piece_id,
        mediaSha256: request.media_sha256,
        decision: decision as Decision,
        note: fields.note,
        decidedBy: `client:${(fields.approver_name ?? "").slice(0, 80) || "unnamed"}`,
      });
    } catch (error) {
      return reply(res, 400, error instanceof Error ? error.message : "could not record the decision");
    }
    reply(res, 200, decision === "approved" ? "Aprovado. Obrigado!" : "Pedido de ajuste registrado. Obrigado!");
  };
}
