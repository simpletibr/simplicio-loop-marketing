/**
 * realoficial-browser.ts — interim Publisher that drives the Real Oficial web
 * app (the only surface that can schedule and publish today) through a
 * `BrowserDriver`.
 *
 * Guardrails (docs/ROADMAP-REALOFICIAL-VIDEOS.md):
 *  - the session is opened by a human in the box's browser; the driver only
 *    attaches to it and this module never reads, copies or stores cookies,
 *    tokens or passwords;
 *  - every step ends in a classified outcome: a screen that is not the
 *    expected one is reported as login_required / captcha / two_factor /
 *    policy_block / platform_rejection, and anything unrecognised as
 *    layout_changed, so a UI change fails closed instead of guessing;
 *  - DOM snapshots go through the browser lane's redaction before they are
 *    written, and the confirmation screenshot is evidence on the receipt.
 *
 * The screen markers below are calibrated by the spike described in
 * docs/evidence/issue-161-realoficial-spike.md; until then they match the
 * fixtures under tests/fixtures/realoficial/.
 */

import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { engineRoot } from "../clients/paths";
import { captureEvidence, classifyFailure, redact } from "../automation/browser-lane";
import {
  MAX_SCHEDULE_DAYS,
  NETWORKS,
  findReceipt,
  type EffectOutcome,
  type Publisher,
  type PublisherCapabilities,
  type ScheduleFailure,
  type ScheduleReceipt,
  type ScheduleRequest,
} from "./publisher";

export interface BrowserDriver {
  open(url: string): Promise<void>;
  html(): Promise<string>;
  fill(fields: Record<string, string>): Promise<void>;
  click(action: "submit" | "cancel"): Promise<void>;
  screenshot(path: string): Promise<void>;
}

export type Screen = "login" | "captcha" | "two_factor" | "schedule_form" | "scheduled" | "cancelled" | "error" | "unknown";

export const SCHEDULE_URL = "https://app.realoficial.com.br/schedule";

const MARKERS: Array<[Screen, RegExp]> = [
  ["captcha", /captcha|n[aã]o sou (um )?rob[oô]|are you a robot/i],
  ["two_factor", /two[- ]factor|2fa|c[oó]digo de verifica[cç][aã]o|verification code/i],
  ["login", /type=["']password["']|data-screen=["']login["']/i],
  ["schedule_form", /data-screen=["']schedule["']/i],
  ["scheduled", /data-screen=["']scheduled["']/i],
  ["cancelled", /data-screen=["']cancelled["']/i],
  ["error", /data-screen=["']error["']/i],
];

export function classifyScreen(html: string): Screen {
  for (const [screen, marker] of MARKERS) if (marker.test(html)) return screen;
  return "unknown";
}

function failureForScreen(screen: Screen, html: string): ScheduleFailure {
  switch (screen) {
    case "login":
      return "login_required";
    case "captcha":
      return "captcha";
    case "two_factor":
      return "two_factor";
    case "error": {
      const mode = classifyFailure(html.replace(/<[^>]+>/g, " "));
      return mode === "policy_block" ? "policy_block" : "platform_rejection";
    }
    default:
      return "layout_changed";
  }
}

function scheduledIdOf(html: string): string | undefined {
  return html.match(/data-scheduled-id=["']([^"']+)["']/i)?.[1];
}

export class RealOficialBrowserPublisher implements Publisher {
  readonly id = "realoficial-browser";

  constructor(
    private readonly driver: BrowserDriver,
    private readonly root: string,
  ) {}

  capabilities(): PublisherCapabilities {
    return { networks: [...NETWORKS], maxScheduleDays: MAX_SCHEDULE_DAYS };
  }

  private async evidence(pieceId: string, network: string, html: string, name: string): Promise<NonNullable<ScheduleReceipt["evidence"]>> {
    const dom = captureEvidence(engineRoot(this.root), { piece_id: pieceId, channel_id: network, kind: "dom_snapshot", rawContent: html });
    const screenshot = resolve(engineRoot(this.root), "data", "evidence", pieceId, `${network}.${name}.png`);
    mkdirSync(dirname(screenshot), { recursive: true });
    await this.driver.screenshot(screenshot);
    return { dom_snapshot: dom.path, screenshot };
  }

  async schedule(req: ScheduleRequest): Promise<EffectOutcome> {
    await this.driver.open(SCHEDULE_URL);
    const before = await this.driver.html();
    const screen = classifyScreen(before);
    if (screen !== "schedule_form") {
      return { ok: false, failure: failureForScreen(screen, before), detail: `expected the schedule form, found "${screen}"`, evidence: await this.evidence(req.pieceId, req.network, before, "blocked") };
    }
    await this.driver.fill({ media: req.mediaPath, caption: req.caption, network: req.network, publish_at: req.publishAt });
    await this.driver.click("submit");
    const after = await this.driver.html();
    const result = classifyScreen(after);
    const evidence = await this.evidence(req.pieceId, req.network, after, result === "scheduled" ? "confirmation" : "failure");
    if (result !== "scheduled") {
      return { ok: false, failure: failureForScreen(result, after), detail: redact(`expected the confirmation, found "${result}"`), evidence };
    }
    const id = scheduledIdOf(after);
    if (!id) return { ok: false, failure: "layout_changed", detail: "confirmation screen carries no scheduled id", evidence };
    return { ok: true, post_ref: `realoficial://scheduled/${id}`, detail: "scheduled in Real Oficial", evidence };
  }

  async status(root: string, receiptId: string): Promise<ScheduleReceipt | null> {
    // The web app has no read API; the ledger is the last confirmed state.
    return findReceipt(root, receiptId);
  }

  async cancel(root: string, receiptId: string): Promise<EffectOutcome> {
    const receipt = findReceipt(root, receiptId);
    if (!receipt?.post_ref) return { ok: false, failure: "not_found", detail: "unknown receipt or no remote reference" };
    await this.driver.open(`${SCHEDULE_URL}/${encodeURIComponent(receipt.post_ref.split("/").pop() ?? "")}`);
    const html = await this.driver.html();
    const screen = classifyScreen(html);
    if (screen !== "scheduled") return { ok: false, failure: failureForScreen(screen, html), detail: `expected the scheduled item, found "${screen}"` };
    await this.driver.click("cancel");
    const after = await this.driver.html();
    return classifyScreen(after) === "cancelled"
      ? { ok: true, detail: "cancelled in Real Oficial" }
      : { ok: false, failure: failureForScreen(classifyScreen(after), after), detail: "cancellation was not confirmed" };
  }
}
