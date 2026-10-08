import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { RoAnswer, RoArgs, RoToolTransport } from "../../lib/realoficial/transport.ts";

export function roAnswer(name: string): RoAnswer {
  return JSON.parse(readFileSync(resolve("tests/fixtures/realoficial/ro-answers", `${name}.json`), "utf8")) as RoAnswer;
}

/** Replays recorded answers per tool (in order, the last one repeats) and records every call. */
export class ReplayTransport implements RoToolTransport {
  readonly calls: Array<{ tool: string; args: RoArgs }> = [];
  private readonly queues = new Map<string, RoAnswer[]>();
  constructor(answers: Record<string, string | string[]>) {
    for (const [tool, names] of Object.entries(answers)) this.queues.set(tool, (Array.isArray(names) ? names : [names]).map(roAnswer));
  }
  async call(tool: string, args: RoArgs): Promise<RoAnswer> {
    this.calls.push({ tool, args });
    const queue = this.queues.get(tool);
    if (!queue) throw new Error(`no recorded answer for ${tool}`);
    return (queue.length > 1 ? queue.shift() : queue[0]) as RoAnswer;
  }
  get tools(): string[] {
    return this.calls.map((c) => c.tool);
  }
}
