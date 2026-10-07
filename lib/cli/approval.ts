import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { engineRoot } from "../clients/paths";
import { createApprovalHandler } from "../approval/webhook";
import { renderApprovalPage } from "../approval/page";
import {
  listRequests,
  mediaSha256Of,
  openAdjustments,
  recordDecision,
  requestApproval,
  requestToken,
  type Decision,
} from "../approval/store";
import { emitEvent } from "../observability/events";

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function need(argv: string[], name: string): string {
  const v = flag(argv, name);
  if (!v) throw new Error(`approval: missing ${name}`);
  return v;
}

const USAGE = `approval: usage:
  approval request --client <slug> --piece <id> --month <YYYY-MM> --media <file> --preview <file> [--publish-at <ISO>] [--caption <network>=<text>]...
  approval page    --client <slug> --month <YYYY-MM> --out <dir> --action-url <url> [--name <display name>]
  approval record  --client <slug> --piece <id> --media-sha256 <hex> --decision approved|changes_requested --by <name> [--note <text>]
  approval serve   [--port 8788]
  approval adjustments [--client <slug>]
`;

export async function cliEntry(argv: string[]): Promise<void> {
  const root = process.env.MARKETING_ENGINE_HOST_ROOT ?? process.cwd();
  const sub = argv[0];
  if (sub === "request") {
    const captions: Record<string, string> = {};
    argv.forEach((a, i) => {
      if (a === "--caption") {
        const [network, ...rest] = (argv[i + 1] ?? "").split("=");
        if (network && rest.length) captions[network] = rest.join("=");
      }
    });
    const media = resolve(root, need(argv, "--media"));
    if (!existsSync(media)) throw new Error(`approval: media not found: ${media}`);
    const request = requestApproval(root, {
      client: need(argv, "--client"),
      pieceId: need(argv, "--piece"),
      month: need(argv, "--month"),
      mediaSha256: mediaSha256Of(media),
      preview: resolve(root, need(argv, "--preview")),
      captions,
      publishAt: flag(argv, "--publish-at"),
    });
    emitEvent(root, { kind: "approval_requested", client: request.client, piece_id: request.piece_id, phase: "approval" });
    process.stdout.write(`${JSON.stringify(request, null, 2)}\n`);
    return;
  }
  if (sub === "page") {
    const client = need(argv, "--client");
    const month = need(argv, "--month");
    const out = resolve(root, need(argv, "--out"));
    const requests = listRequests(root, { client, month });
    mkdirSync(join(out, "previews"), { recursive: true });
    const withLocalPreview = requests.map((r) => {
      const source = isAbsolute(r.preview) ? r.preview : resolve(engineRoot(root), r.preview);
      if (!existsSync(source)) throw new Error(`approval: preview missing for ${r.piece_id}: ${source}`);
      const name = `${basename(r.piece_id)}.mp4`;
      copyFileSync(source, join(out, "previews", name));
      return { ...r, preview: `previews/${name}` };
    });
    const html = renderApprovalPage({
      client,
      clientName: flag(argv, "--name") ?? client,
      month,
      requests: withLocalPreview,
      actionUrl: need(argv, "--action-url"),
      tokenOf: (id) => requestToken(root, id),
    });
    const file = join(out, `aprovacao-${client}-${month}.html`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, html);
    process.stdout.write(`${JSON.stringify({ page: file, pieces: requests.length })}\n`);
    return;
  }
  if (sub === "record") {
    const approval = recordDecision(root, {
      client: need(argv, "--client"),
      pieceId: need(argv, "--piece"),
      mediaSha256: need(argv, "--media-sha256"),
      decision: need(argv, "--decision") as Decision,
      decidedBy: need(argv, "--by"),
      note: flag(argv, "--note"),
    });
    emitEvent(root, { kind: "approval_decided", client: approval.client, piece_id: approval.piece_id, phase: "approval", verdict: approval.decision });
    process.stdout.write(`${JSON.stringify(approval, null, 2)}\n`);
    return;
  }
  if (sub === "adjustments") {
    process.stdout.write(`${JSON.stringify(openAdjustments(root, flag(argv, "--client")), null, 2)}\n`);
    return;
  }
  if (sub === "serve") {
    const port = Number(flag(argv, "--port") ?? 8788);
    const server = createServer((req, res) => void createApprovalHandler(root)(req, res));
    await new Promise<void>((done) => server.listen(port, "127.0.0.1", done));
    process.stderr.write(`approval: listening on http://127.0.0.1:${port} (expose it yourself; nothing is sent to clients)\n`);
    return;
  }
  process.stderr.write(USAGE);
  process.exitCode = 2;
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`.replace(/^file:\/\/\/\//, "file:///")) {
  cliEntry(process.argv.slice(2)).catch((err) => {
    process.stderr.write(`approval failed: ${String(err)}\n`);
    process.exitCode = 1;
  });
}
