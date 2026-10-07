import { gateEvidence } from "../gate/evidence";

export function cliEntry(argv: string[]): void {
  const pieceId = argv[0];
  if (!pieceId) throw new Error("usage: evidence gate <piece-id>");
  const result = gateEvidence(process.env.MARKETING_ENGINE_HOST_ROOT ?? process.cwd(), pieceId);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.pass) process.exitCode = 3;
}


if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`.replace(/^file:\/\/\/\//, "file:///")) {
  try {
    cliEntry(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`evidence failed: ${String(err)}\n`);
    process.exitCode = 1;
  }
}
