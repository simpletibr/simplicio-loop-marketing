/**
 * page.ts — the static approval page a client opens on the phone.
 *
 * One self-contained HTML file per client and month: light 540x960 previews
 * (never the final render), captions per network with the date, and two
 * buttons per piece. No scripts, no external resources, no internal data
 * (costs, tokens, other clients). Hosting and delivery are decided by the
 * operator; this module only produces the file.
 */

import type { ApprovalRequest } from "./store";

export function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export interface PageInput {
  client: string;
  clientName: string;
  month: string;
  requests: ApprovalRequest[];
  /** Endpoint that records the decision (absolute URL, or a path served next to the page). */
  actionUrl: string;
  /** Per request token from `requestToken`. */
  tokenOf: (requestId: string) => string;
}

const NETWORK_LABEL: Record<string, string> = { tiktok: "TikTok", ig_reels: "Instagram Reels", yt_shorts: "YouTube Shorts" };

function formAction(actionUrl: string): string {
  if (/^https?:\/\//.test(actionUrl)) return new URL(actionUrl).origin;
  return "'self'";
}

function card(r: ApprovalRequest, input: PageInput): string {
  const token = input.tokenOf(r.request_id);
  const when = r.publish_at ? `<p class="when">Data prevista: <time datetime="${esc(r.publish_at)}">${esc(r.publish_at.replace("T", " ").slice(0, 16))} UTC</time></p>` : "";
  const captions = Object.entries(r.captions)
    .map(([network, text]) => `<li><strong>${esc(NETWORK_LABEL[network] ?? network)}</strong><span>${esc(text)}</span></li>`)
    .join("");
  const hidden = `<input type="hidden" name="client" value="${esc(r.client)}"><input type="hidden" name="piece_id" value="${esc(r.piece_id)}"><input type="hidden" name="media_sha256" value="${esc(r.media_sha256)}"><input type="hidden" name="request_id" value="${esc(r.request_id)}"><input type="hidden" name="token" value="${esc(token)}">`;
  return `<article class="card" aria-labelledby="t-${esc(r.request_id)}">
<h2 id="t-${esc(r.request_id)}">${esc(r.piece_id)}</h2>
${when}
<video controls playsinline preload="none" width="540" height="960" src="${esc(r.preview)}" aria-label="Prévia da peça ${esc(r.piece_id)}"></video>
<ul class="captions">${captions}</ul>
<form method="post" action="${esc(input.actionUrl)}">
${hidden}
<label>Seu nome <input name="approver_name" required maxlength="80" autocomplete="name"></label>
<label>Pedir ajuste (descreva o que mudar) <textarea name="note" rows="3" maxlength="1000"></textarea></label>
<div class="actions">
<button type="submit" name="decision" value="approved" class="ok">Aprovar</button>
<button type="submit" name="decision" value="changes_requested" class="ask">Pedir ajuste</button>
</div>
</form>
</article>`;
}

export function renderApprovalPage(input: PageInput): string {
  const title = `Aprovação de ${input.month} — ${input.clientName}`;
  const csp = `default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; form-action ${formAction(input.actionUrl)}; base-uri 'none'`;
  const body = input.requests.length
    ? input.requests.map((r) => card(r, input)).join("\n")
    : "<p>Nenhuma peça aguardando aprovação neste mês.</p>";
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${esc(csp)}">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<style>
:root{color-scheme:light dark;--bg:#fff;--fg:#111827;--muted:#4b5563;--line:#d1d5db;--ok:#166534;--ask:#92400e}
@media (prefers-color-scheme:dark){:root{--bg:#0b1020;--fg:#f3f4f6;--muted:#cbd5e1;--line:#334155;--ok:#4ade80;--ask:#fbbf24}}
*{box-sizing:border-box}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif;max-width:640px;margin-inline:auto}
h1{font-size:1.25rem}h2{font-size:1.05rem;margin:0 0 4px}
.card{border:1px solid var(--line);border-radius:12px;padding:12px;margin:16px 0}
video{width:100%;height:auto;aspect-ratio:9/16;background:#000;border-radius:8px}
.captions{list-style:none;padding:0;margin:8px 0}.captions li{display:flex;flex-direction:column;margin:6px 0}.captions span{color:var(--muted)}
label{display:block;margin:8px 0}input,textarea{width:100%;padding:10px;border:1px solid var(--line);border-radius:8px;background:transparent;color:inherit;font:inherit}
.actions{display:flex;gap:8px}button{flex:1;min-height:44px;border-radius:8px;border:2px solid currentColor;background:transparent;font:inherit;font-weight:600;cursor:pointer}
.ok{color:var(--ok)}.ask{color:var(--ask)}button:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid currentColor;outline-offset:2px}
.when{color:var(--muted);margin:0 0 8px}
</style>
</head>
<body>
<main>
<h1>${esc(title)}</h1>
<p>Veja cada peça, aprove ou peça ajuste. Nada é publicado sem a sua aprovação.</p>
${body}
</main>
</body>
</html>
`;
}
