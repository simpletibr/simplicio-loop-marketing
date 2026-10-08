/**
 * pdf.ts — a plain-text PDF of the monthly report, with no dependency.
 *
 * Headings (`#`) are bold, everything else is Helvetica 10 pt on A4, wrapped
 * and paginated. Latin-1 text (Portuguese accents) is written as WinAnsi;
 * other characters are replaced. The output is a pure function of the
 * markdown: no dates or ids are embedded, so the same report is the same file.
 */

const PAGE = { width: 595, height: 842, margin: 56, size: 10, lead: 14, wrap: 92 };

const REPLACE: Record<string, string> = { "—": "-", "–": "-", "“": '"', "”": '"', "‘": "'", "’": "'", "•": "-", "…": "...", "·": "-", "≥": ">=", "≤": "<=" };

function toLatin1(text: string): string {
  return [...text].map((ch) => REPLACE[ch] ?? (ch.charCodeAt(0) <= 0xff ? ch : "?")).join("");
}

function escape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrap(line: string, width: number): string[] {
  if (line.length <= width) return [line];
  const out: string[] = [];
  let cur = "";
  for (const word of line.split(" ")) {
    if (cur && cur.length + 1 + word.length > width) {
      out.push(cur);
      cur = word;
    } else cur = cur ? `${cur} ${word}` : word;
  }
  if (cur) out.push(cur);
  return out;
}

interface Row {
  text: string;
  bold: boolean;
  size: number;
}

function rows(markdown: string): Row[] {
  const out: Row[] = [];
  for (const raw of markdown.split("\n")) {
    const heading = /^(#{1,3})\s+(.*)$/.exec(raw);
    const plain = toLatin1(raw.replace(/\*\*/g, "").replace(/^\|\s*-+.*$/, ""));
    if (heading) {
      out.push({ text: "", bold: false, size: PAGE.size });
      for (const l of wrap(toLatin1((heading[2] as string).replace(/\*\*/g, "")), heading[1]!.length === 1 ? 60 : 75)) out.push({ text: l, bold: true, size: heading[1]!.length === 1 ? 16 : 12 });
    } else if (raw.trim().startsWith("|")) {
      const cells = plain.split("|").map((c) => c.trim()).filter(Boolean);
      if (cells.length) for (const l of wrap(cells.join("  |  "), PAGE.wrap)) out.push({ text: l, bold: false, size: PAGE.size });
    } else {
      for (const l of wrap(plain, PAGE.wrap)) out.push({ text: l, bold: false, size: PAGE.size });
    }
  }
  return out;
}

export function markdownToPdf(markdown: string): Buffer {
  const perPage = Math.floor((PAGE.height - 2 * PAGE.margin) / PAGE.lead);
  const all = rows(markdown);
  const pages: Row[][] = [];
  for (let i = 0; i < all.length; i += perPage) pages.push(all.slice(i, i + perPage));
  if (pages.length === 0) pages.push([]);

  // Objects: 1 catalog, 2 pages, 3 regular, 4 bold, then (content, page) per page.
  const objects: string[] = [];
  const pageIds = pages.map((_, i) => 6 + i * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  pages.forEach((page, i) => {
    let y = PAGE.height - PAGE.margin;
    const ops = page.map((row) => {
      const op = `BT /${row.bold ? "F2" : "F1"} ${row.size} Tf ${PAGE.margin} ${y} Td (${escape(row.text)}) Tj ET`;
      y -= PAGE.lead;
      return op;
    });
    const stream = ops.join("\n");
    objects[5 + i * 2] = `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`;
    objects[6 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${5 + i * 2} 0 R >>`;
  });

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(body, "latin1");
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) body += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}
