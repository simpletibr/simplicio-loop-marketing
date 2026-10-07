import { loadPlan } from "../plan/content-plan";
import { planStatus } from "../plan/batch";
import { renderCalendar } from "../plan/calendar";

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export async function cliEntry(argv: string[]): Promise<void> {
  const root = process.env.MARKETING_ENGINE_HOST_ROOT ?? process.cwd();
  const client = flag(argv, "--client");
  if (!client) {
    process.stderr.write("calendar: usage: marketing-engine calendar --client <slug> [--plan <id>] [--format table|markdown]\n");
    process.exitCode = 2;
    return;
  }
  const format = flag(argv, "--format") ?? "table";
  if (format !== "table" && format !== "markdown") throw new Error("calendar: --format must be table or markdown");
  const plan = loadPlan(root, client, flag(argv, "--plan"));
  process.stdout.write(renderCalendar(plan, planStatus(root, plan), format));
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`.replace(/^file:\/\/\/\//, "file:///")) {
  cliEntry(process.argv.slice(2)).catch((err) => {
    process.stderr.write(`calendar failed: ${String(err)}\n`);
    process.exitCode = 1;
  });
}
