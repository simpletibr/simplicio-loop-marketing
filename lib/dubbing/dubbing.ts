/**
 * dubbing.ts — versions of a piece in the languages of the target countries.
 *
 * The language decides the lane (see `routeFor`):
 *   tts              the voice provider re-records the translated script (best
 *                    quality, minimal cost): handed to the video factory
 *   realoficial-dub  AI dub of the rendered clip by Real Oficial
 *   subtitle-only    translated captions only
 *
 * `estimate()` never spends or changes anything. `dub()` fails closed unless
 * `approvedByWesley` is `true`: a dub copies real voices, and the one-time
 * voice-rights consent is given by the owner in the app, never here. Every
 * outcome is a `dubbing-receipt/v1` in `data/dubbing.hbp`; a dubbed MP4 is
 * always labelled `ai_generated_voice`.
 */

import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { engineRoot } from "../clients/paths";
import { appendHbp, readHbp } from "../formats/binary";
import { loadSchemaRegistry } from "../contracts/registry";
import { validateArtifact } from "../contracts/validate";
import type { BrandProfile } from "../profile/brand-profile";
import { isDryRun, str, type RoAnswer, type RoToolTransport } from "../realoficial/transport";

export const DUBBING_SCHEMA = "dubbing-receipt/v1";

export type DubRoute = "tts" | "realoficial-dub" | "subtitle-only";
export const DUB_ROUTES: readonly DubRoute[] = ["tts", "realoficial-dub", "subtitle-only"];

/**
 * Default language -> lane matrix. Languages the voice provider covers well
 * are re-recorded; the rest are dubbed by Real Oficial. A client overrides any
 * entry in the `voice_routes` of its brand profile (`{"ar": "subtitle-only"}`).
 * To be calibrated by the one-video-per-language review before scaling.
 */
export const DEFAULT_DUBBING_MATRIX: Readonly<Record<string, DubRoute>> = {
  pt: "tts",
  en: "tts",
  es: "tts",
  de: "tts",
  fr: "tts",
  it: "tts",
  ja: "tts",
  zh: "realoficial-dub",
  ar: "realoficial-dub",
  hi: "realoficial-dub",
};

function base(language: string): string {
  return language.toLowerCase().split(/[-_]/)[0] as string;
}

/** Dub codes can be longer than caption codes (`ar` and `arb`), so a prefix match counts. */
function sameLanguage(a: string | undefined, b: string): boolean {
  if (!a) return false;
  const x = base(a);
  const y = base(b);
  return x.startsWith(y) || y.startsWith(x);
}

/** profile override (exact tag, then base language) -> default matrix -> Real Oficial dub. */
export function routeFor(language: string, profile?: Pick<BrandProfile, "voice_routes">): DubRoute {
  const lang = language.toLowerCase();
  const own = profile?.voice_routes ?? {};
  for (const key of [language, lang, base(language)]) {
    const v = own[key];
    if (v && (DUB_ROUTES as readonly string[]).includes(v)) return v as DubRoute;
  }
  return DEFAULT_DUBBING_MATRIX[lang] ?? DEFAULT_DUBBING_MATRIX[base(language)] ?? "realoficial-dub";
}

export interface DubRequest {
  client: string;
  pieceId: string;
  language: string;
  /** Real Oficial ids of the rendered clip (required for the Real Oficial lanes). */
  projectId?: string;
  clipId?: string;
  /** Also translate the captions (when the client asks for subtitles in every case). */
  subtitles?: boolean;
  route?: DubRoute;
  /** The owner's explicit OK. Without it `dub()` is blocked. */
  approvedByWesley?: boolean;
}

export interface DubEstimate {
  route: DubRoute;
  language: string;
  /** Real Oficial dubs and caption translations are free; the field exists so a price change is visible. */
  credits: number;
  spends: boolean;
  needs_voice_rights_consent: boolean;
  notes: string[];
}

export type DubFailure = "approval_missing" | "consent_required" | "driver_unavailable" | "invalid_request" | "remote_error" | "not_ready";

export interface DubReceipt {
  schema: typeof DUBBING_SCHEMA;
  ts: string;
  receipt_id: string;
  client: string;
  piece_id: string;
  language: string;
  route: DubRoute;
  implementation: "dry-run" | "realoficial";
  dry_run: boolean;
  verdict: "dubbed" | "handoff" | "blocked" | "failed";
  failure_class?: DubFailure;
  credits_spent: number;
  approved_by?: string;
  ai_generated_voice: boolean;
  dub_id?: string;
  translation_id?: string;
  render_id?: string;
  stages: Array<{ stage: string; ok: boolean; detail?: string }>;
}

export interface Dubbing {
  readonly id: string;
  estimate(req: DubRequest, profile?: Pick<BrandProfile, "voice_routes">): Promise<DubEstimate>;
  dub(req: DubRequest, profile?: Pick<BrandProfile, "voice_routes">): Promise<DubReceipt>;
}

// --- ledger -----------------------------------------------------------------

export function dubbingLedgerPath(root: string): string {
  return resolve(engineRoot(root), "data", "dubbing.hbp");
}

export function dubReceiptId(req: Pick<DubRequest, "client" | "pieceId" | "language">): string {
  return createHash("sha256").update([req.client, req.pieceId, req.language.toLowerCase()].join("\u0000")).digest("hex").slice(0, 20);
}

export function listDubReceipts(root: string, filter: { client?: string; pieceId?: string } = {}): DubReceipt[] {
  const latest = new Map<string, DubReceipt>();
  for (const r of readHbp<DubReceipt>(dubbingLedgerPath(root))) latest.set(r.receipt_id, r);
  return [...latest.values()].filter((r) => (!filter.client || r.client === filter.client) && (!filter.pieceId || r.piece_id === filter.pieceId));
}

export function appendDubReceipt(root: string, receipt: DubReceipt): void {
  const valid = validateArtifact(receipt, loadSchemaRegistry());
  if (!valid.ok) throw new Error(`dubbing: invalid receipt: ${valid.errors.join("; ")}`);
  appendHbp(dubbingLedgerPath(root), receipt);
}

// --- shared flow ------------------------------------------------------------

function estimateOf(req: DubRequest, profile?: Pick<BrandProfile, "voice_routes">): DubEstimate {
  const route = req.route ?? routeFor(req.language, profile);
  return {
    route,
    language: req.language,
    credits: 0,
    spends: false,
    needs_voice_rights_consent: route === "realoficial-dub",
    notes: route === "tts" ? ["re-recorded from the translated script by the voice provider; no Real Oficial call"] : route === "subtitle-only" ? ["captions only; the original audio is kept"] : ["AI voices copy the speakers' own voices; the dubbed MP4 must be labelled as AI-generated"],
  };
}

export interface FlowOptions {
  root: string;
  implementation: DubReceipt["implementation"];
  transport: RoToolTransport | undefined;
  now?: Date;
}

/** Gates, ledger and idempotency; the lanes only perform their effect. */
async function runDub(req: DubRequest, profile: Pick<BrandProfile, "voice_routes"> | undefined, o: FlowOptions): Promise<DubReceipt> {
  const route = req.route ?? routeFor(req.language, profile);
  const dryRun = isDryRun();
  const receipt_id = dubReceiptId(req);
  const prior = listDubReceipts(o.root).find((r) => r.receipt_id === receipt_id);
  if (prior && (prior.verdict === "dubbed" || prior.verdict === "handoff") && prior.dry_run === dryRun) return prior;

  const stages: DubReceipt["stages"] = [];
  const finish = (verdict: DubReceipt["verdict"], extra: Partial<DubReceipt> = {}): DubReceipt => {
    const r: DubReceipt = {
      schema: DUBBING_SCHEMA,
      ts: (o.now ?? new Date()).toISOString(),
      receipt_id,
      client: req.client,
      piece_id: req.pieceId,
      language: req.language,
      route,
      implementation: o.implementation,
      dry_run: dryRun,
      verdict,
      credits_spent: 0,
      ai_generated_voice: route === "realoficial-dub",
      stages,
      ...extra,
    };
    appendDubReceipt(o.root, r);
    return r;
  };
  const block = (stage: string, failure: DubFailure, detail: string): DubReceipt => {
    stages.push({ stage, ok: false, detail });
    return finish(failure === "remote_error" || failure === "driver_unavailable" ? "failed" : "blocked", { failure_class: failure });
  };

  if (req.approvedByWesley !== true) return block("approval", "approval_missing", "dubbing copies voices: approvedByWesley is required");
  if (!req.language.trim() || !/^[a-zA-Z]{2,3}([-_][A-Za-z0-9]{2,8})*$/.test(req.language)) return block("request", "invalid_request", "language must be an ISO tag such as en or zh-Hans");
  stages.push({ stage: "approval", ok: true });
  const approved = { approved_by: "wesley" };

  if (route === "tts") {
    stages.push({ stage: "handoff", ok: true, detail: "re-record from the translated script through the video factory (intl)" });
    return finish("handoff", approved);
  }
  if (!req.projectId || !req.clipId) return block("request", "invalid_request", "projectId and clipId of the rendered clip are required for this route");
  const t = o.transport;
  if (!t) return block("driver", "driver_unavailable", "live runs need a Real Oficial transport injected by the caller");

  try {
    let dub_id: string | undefined;
    let translation_id: string | undefined;
    if (route === "realoficial-dub") {
      const started = await t.call("ro_dub_clip", { project_id: req.projectId, clip_id: req.clipId, language: base(req.language) });
      if (started.consent_required === true || str(started.consent_url)) return block("dub", "consent_required", "the owner must give the voice-rights consent once, in the Real Oficial app");
      stages.push({ stage: "dub", ok: true });
    }
    if (route === "subtitle-only" || req.subtitles) {
      await t.call("ro_translate_clips", { project_id: req.projectId, clip_ids: [req.clipId], languages: [req.language] });
      stages.push({ stage: "translate", ok: true });
    }
    const listed = await t.call("ro_list_translations_and_dubs", { project_id: req.projectId, clip_id: req.clipId, wait_seconds: 20 });
    for (const row of rows(listed)) {
      if (row.status !== "completed") continue;
      if (route === "realoficial-dub" && str(row.dub_id) && sameLanguage(str(row.language), req.language)) dub_id = str(row.dub_id);
      if ((route === "subtitle-only" || req.subtitles) && str(row.subtitle_translation_id ?? row.translation_id) && sameLanguage(str(row.language), req.language)) translation_id = str(row.subtitle_translation_id ?? row.translation_id);
    }
    const ready = route === "realoficial-dub" ? Boolean(dub_id) : Boolean(translation_id);
    stages.push({ stage: "wait", ok: ready, detail: ready ? undefined : "not completed yet; run again later" });
    if (!ready) return finish("blocked", { failure_class: "not_ready", ...approved });
    const rendered = await t.call("ro_render_clip", { project_id: req.projectId, clip_id: req.clipId, ...(dub_id ? { dub_id } : {}), ...(translation_id ? { subtitle_translation_id: translation_id } : {}) });
    stages.push({ stage: "render", ok: true });
    return finish("dubbed", { ...approved, ...(dub_id ? { dub_id } : {}), ...(translation_id ? { translation_id } : {}), ...(str(rendered.render_id) ? { render_id: str(rendered.render_id) as string } : {}) });
  } catch (error) {
    return block("remote", "remote_error", error instanceof Error ? error.message.slice(0, 200) : "remote call failed");
  }
}

function rows(answer: RoAnswer): RoAnswer[] {
  const list = answer.items ?? answer.rows ?? answer.translations_and_dubs;
  return Array.isArray(list) ? list.filter((r): r is RoAnswer => Boolean(r) && typeof r === "object") : [];
}

// --- implementations --------------------------------------------------------

/** Nothing leaves the machine: the whole flow and its receipts, with canned answers. */
export class DryRunDubbing implements Dubbing {
  readonly id = "dry-run";
  constructor(private readonly root: string, private readonly now?: Date) {}
  async estimate(req: DubRequest, profile?: Pick<BrandProfile, "voice_routes">): Promise<DubEstimate> {
    return estimateOf(req, profile);
  }
  async dub(req: DubRequest, profile?: Pick<BrandProfile, "voice_routes">): Promise<DubReceipt> {
    const id = createHash("sha256").update(`${req.pieceId}|${req.language}`).digest("hex").slice(0, 26).toUpperCase();
    const transport: RoToolTransport = {
      async call(tool) {
        if (tool === "ro_dub_clip") return { status: "queued" };
        if (tool === "ro_translate_clips") return { status: "queued" };
        if (tool === "ro_list_translations_and_dubs") return { items: [{ status: "completed", dub_id: id, subtitle_translation_id: id, language: base(req.language) }, { status: "completed", subtitle_translation_id: id, language: req.language }] };
        return { render_id: id, status: "queued" };
      },
    };
    return runDub({ ...req, projectId: req.projectId ?? "DRYRUN", clipId: req.clipId ?? "DRYRUN" }, profile, { root: this.root, implementation: "dry-run", transport, now: this.now });
  }
}

/** Real Oficial through the injected transport (the official tools); never consents on the owner's behalf. */
export class RealOficialDubbing implements Dubbing {
  readonly id = "realoficial";
  constructor(private readonly root: string, private readonly transport: RoToolTransport | undefined, private readonly now?: Date) {}
  async estimate(req: DubRequest, profile?: Pick<BrandProfile, "voice_routes">): Promise<DubEstimate> {
    return estimateOf(req, profile);
  }
  async dub(req: DubRequest, profile?: Pick<BrandProfile, "voice_routes">): Promise<DubReceipt> {
    return runDub(req, profile, { root: this.root, implementation: "realoficial", transport: this.transport, now: this.now });
  }
}

/** DRY_RUN selects the dry-run lane; a live run gets Real Oficial and must bring a transport. */
export function dubbingFor(root: string, transport?: RoToolTransport): Dubbing {
  return isDryRun() ? new DryRunDubbing(root) : new RealOficialDubbing(root, transport);
}
