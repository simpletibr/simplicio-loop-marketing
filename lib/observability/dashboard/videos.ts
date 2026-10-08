/**
 * videos.ts — adapters for the video factory's output folders and the
 * operator's control spreadsheet (exported as CSV).
 *
 * Layout read (documented in docs/DASHBOARD_EVENTS.md; nothing here writes):
 *
 *   <out>/lote.csv                         slug,country,batch,status
 *   <out>/<slug>/coleta.json               { country?, batch?, status?, collected_at? }
 *   <out>/<slug>/preview.manifest.json     { output: { sha256, duration_s? }, generated_at? }
 *   <out>/<slug>/result.json               { passed, resolution?, lufs?, freeze_s?, cuts?, generated_at? }
 *   <out>/<slug>/render.manifest.json      RenderManifest (final render + voice)
 *   <out>/<slug>/venda.json                { status, amount, currency, processor, paid_at? }
 *
 * Contact data (phone, e-mail, names) is never read into events; `coleta.json`
 * is read through an allow-list of fields.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { makeEvent, type DashboardEvent } from "../../dashboard/events";
import { parseCsv } from "./csv";
import { parseJson } from "./jsonl";

const SOURCE = "simplicio-videos";

function read(path: string): { text: string; ts: string } | null {
  if (!existsSync(path)) return null;
  return { text: readFileSync(path, "utf8"), ts: statSync(path).mtime.toISOString() };
}

function fingerprint(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function fxToBrl(amount: number, currency: string): { amount_brl?: number; fx?: string } {
  if (currency === "BRL") return { amount_brl: amount, fx: "native" };
  const rate = Number(process.env.PTAX_USD_BRL);
  if (currency === "USD" && Number.isFinite(rate) && rate > 0) return { amount_brl: Math.round(amount * rate * 100) / 100, fx: "estimate:env PTAX_USD_BRL" };
  return {};
}

export function fromVideosDir(dir: string): DashboardEvent[] {
  if (!existsSync(dir)) return [];
  const out: DashboardEvent[] = [];
  const slugs = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  for (const slug of slugs) {
    const folder = join(dir, slug);
    const id = (file: string, text: string) => `${slug}|${file}|${fingerprint(text)}`;

    const coleta = read(join(folder, "coleta.json"));
    if (coleta) {
      const raw = parseJson<{ country?: string; batch?: string; status?: string; collected_at?: string }>(coleta.text) ?? {};
      out.push(makeEvent({ source: SOURCE, key: id("coleta.json", coleta.text), ts: raw.collected_at ?? coleta.ts, kind: "prospect_collected", client: slug, piece_id: slug, data: { country: raw.country, batch: raw.batch, status: raw.status ?? "coletado" } }));
    }
    const preview = read(join(folder, "preview.manifest.json"));
    if (preview) {
      const raw = parseJson<{ output?: { sha256?: string; duration_s?: number }; generated_at?: string }>(preview.text) ?? {};
      out.push(makeEvent({ source: SOURCE, key: id("preview.manifest.json", preview.text), ts: raw.generated_at ?? preview.ts, kind: "render_finished", client: slug, piece_id: slug, data: { stage: "preview", ok: true, sha256: raw.output?.sha256, duration_s: raw.output?.duration_s } }));
    }
    const result = read(join(folder, "result.json"));
    if (result) {
      const raw = parseJson<{ passed?: boolean; resolution?: string; lufs?: number; freeze_s?: number; cuts?: number; generated_at?: string }>(result.text) ?? {};
      out.push(makeEvent({ source: SOURCE, key: id("result.json", result.text), ts: raw.generated_at ?? result.ts, kind: "qa_result", client: slug, piece_id: slug, severity: raw.passed === false ? "warn" : "info", data: { passed: raw.passed === true, resolution: raw.resolution, lufs: raw.lufs, freeze_s: raw.freeze_s, cuts: raw.cuts } }));
    }
    const finalManifest = read(join(folder, "render.manifest.json"));
    if (finalManifest) {
      const raw = parseJson<{ generated_at?: string; output?: { sha256?: string; duration_s?: number }; voice?: { provider?: string; seconds?: number; cost_usd?: number; cache_hit?: boolean } }>(finalManifest.text) ?? {};
      const finalTs = raw.generated_at ?? finalManifest.ts;
      if (raw.voice) out.push(makeEvent({ source: SOURCE, key: id("render.manifest.json#voice", finalManifest.text), ts: finalTs, kind: "voice_rendered", client: slug, piece_id: slug, data: { ...raw.voice } }));
      out.push(makeEvent({ source: SOURCE, key: id("render.manifest.json", finalManifest.text), ts: finalTs, kind: "render_finished", client: slug, piece_id: slug, data: { stage: "final", ok: true, sha256: raw.output?.sha256, duration_s: raw.output?.duration_s } }));
    }
    const venda = read(join(folder, "venda.json"));
    if (venda) {
      const raw = parseJson<{ status?: string; amount?: number; currency?: string; processor?: string; paid_at?: string }>(venda.text) ?? {};
      if (raw.status === "pago" || raw.status === "paid" || raw.status === "entregue") {
        const currency = (raw.currency ?? "BRL").toUpperCase();
        const amount = Number(raw.amount ?? 0);
        out.push(makeEvent({ source: SOURCE, key: id("venda.json", venda.text), ts: raw.paid_at ?? venda.ts, kind: "payment_received", client: slug, piece_id: slug, data: { amount, currency, processor: raw.processor ?? "abacatepay", delivered: raw.status === "entregue", ...fxToBrl(amount, currency) } }));
      }
    }
  }
  return out;
}

/** `lote.csv` and the control spreadsheet export share the columns slug,country,batch,status[,updated_at]. */
export function fromProspectCsv(path: string, source: string): DashboardEvent[] {
  const file = read(path);
  if (!file) return [];
  return parseCsv(file.text)
    .filter((row) => row.slug)
    .map((row) =>
      makeEvent({
        source,
        key: `${row.slug}|${row.status}|${row.updated_at ?? ""}|${row.batch ?? ""}`,
        ts: row.updated_at || file.ts,
        kind: "prospect_collected",
        client: row.slug,
        piece_id: row.slug,
        data: { country: row.country, batch: row.batch, status: row.status },
      }),
    );
}
