import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BrowserDriver } from "../../publish/realoficial-browser";

export interface FixtureScript {
  /** Fixture names (without .html) returned by successive `open` calls; the last one repeats. */
  onOpen: string[];
  onSubmit?: string;
  onCancel?: string;
}

/** Serves recorded screens instead of a browser: no network, no session. */
export class FixtureBrowserDriver implements BrowserDriver {
  readonly opened: string[] = [];
  readonly filled: Array<Record<string, string>> = [];
  readonly clicks: string[] = [];
  readonly screenshots: string[] = [];
  private opens = 0;
  private current = "";

  constructor(
    private readonly dir: string,
    private readonly script: FixtureScript,
  ) {}

  async open(url: string): Promise<void> {
    this.opened.push(url);
    this.current = this.script.onOpen[Math.min(this.opens, this.script.onOpen.length - 1)] ?? "";
    this.opens++;
  }

  async html(): Promise<string> {
    return readFileSync(join(this.dir, `${this.current}.html`), "utf8");
  }

  async fill(fields: Record<string, string>): Promise<void> {
    this.filled.push(fields);
  }

  async click(action: "submit" | "cancel"): Promise<void> {
    this.clicks.push(action);
    const next = action === "submit" ? this.script.onSubmit : this.script.onCancel;
    if (next) this.current = next;
  }

  async screenshot(path: string): Promise<void> {
    this.screenshots.push(path);
    writeFileSync(path, "fixture screenshot");
  }
}
