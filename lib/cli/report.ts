import { buildReport, EvidenceRequiredError } from "../report/builder";

export function cliEntry(argv: string[]): void {
  const pieceId = argv[0];
  if (!pieceId) throw new Error("usage: report build <piece-id> [--require-evidence]");
  try {
    process.stdout.write(buildReport(process.env.MARKETING_ENGINE_HOST_ROOT ?? process.cwd(), pieceId, { requireEvidence: argv.includes("--require-evidence") }));
  } catch (error) {
    if (error instanceof EvidenceRequiredError) { process.stderr.write(`${error.message}\n`); process.exitCode = error.exitCode; return; }
    throw error;
  }
}


if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`.replace(/^file:\/\/\/\//, "file:///")) {
  try {
    cliEntry(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`report failed: ${String(err)}\n`);
    process.exitCode = 1;
  }
}
