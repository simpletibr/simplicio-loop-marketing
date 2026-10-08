import { existsSync, openSync, readSync, closeSync, statSync } from "node:fs";

export interface JsonlLine {
  /** Byte offset of the line: a stable identity for the line within its file. */
  offset: number;
  text: string;
}

/**
 * Reads the complete lines after `from`. A trailing partial line (a writer is
 * mid-append) is left for the next read. A file smaller than the cursor was
 * rotated or truncated, so it is read from the start.
 */
export function readLinesFrom(path: string, from: number): { lines: JsonlLine[]; next: number } {
  if (!existsSync(path)) return { lines: [], next: 0 };
  const size = statSync(path).size;
  const start = size < from ? 0 : from;
  if (size === start) return { lines: [], next: start };
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    const lines: JsonlLine[] = [];
    let cursor = 0;
    for (;;) {
      const nl = buf.indexOf(0x0a, cursor);
      if (nl === -1) break;
      const text = buf.subarray(cursor, nl).toString("utf8").trim();
      if (text) lines.push({ offset: start + cursor, text });
      cursor = nl + 1;
    }
    return { lines, next: start + cursor };
  } finally {
    closeSync(fd);
  }
}

export function parseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
