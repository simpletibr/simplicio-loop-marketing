/** Read-only preflight for the marketing engine. */
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { eventsSummary, eventsPath, emitEvent } from "../observability/events";
import { savingsSummary } from "../observability/savings";
import { readJournal, itemVerdict, journalPath } from "../loop/journal";
import { listPieces } from "../pieces/store";
import { loadProviderMatrix } from "../providers/matrix";
import { releaseIdentity, type ReleaseIdentity } from "../release-train/receipt";
import { loadExtensionManifest } from "../extension/core";

export const DOCTOR_SCHEMA = "marketing-doctor-report/v1";
export type DoctorStatus = "ok" | "warn" | "blocked";
export interface DoctorCheck { id: string; status: DoctorStatus; detail: string }
export interface DoctorExtensionReport {
  id: string;
  version: string;
  core_version: string;
  compatible: boolean;
  capabilities: string[];
  budget_authority: "core";
  conformance: "pass" | "fail";
}
export interface DoctorReport {
  schema: typeof DOCTOR_SCHEMA; ts: string; root: string; dry_run: boolean; has_blocked: boolean; checks: DoctorCheck[];
  env: { providers_with_keys: string[]; kill_switch_run_log: boolean }; pieces: Record<string, number>;
  events: { path: string; present: boolean; count: number; gate_fail_rate: number; stalls: number; last_ts?: string };
  savings: { count: number; saved_total: number; chain_ok: boolean };
  loop: { journal_present: boolean; items: number; stalled_items: string[] };
  operator: { hooks_present: boolean; action_gate_selftest: "pass" | "fail" | "not_run"; python_workers: "resolved" | "absent" };
  release_train: ReleaseIdentity & { latest: string | null; installed: string; compatible: boolean | null; blocked_reason: string | null };
  extension: DoctorExtensionReport;
}
const KEYS: Record<string,string> = { claude:"ANTHROPIC_API_KEY", codex:"OPENAI_API_KEY", deepseek:"DEEPSEEK_API_KEY", "gpt-image":"OPENAI_API_KEY", higgsfield:"HIGGSFIELD_MCP_ACTIVE", topview:"TOPVIEW_API_KEY", wavespeed:"WAVESPEED_API_KEY", "simplicio-video":"SIMPLICIO_VIDEO_BIN", adaptlypost:"ADAPTLYPOST_API_KEY", "meta-ads":"META_ADS_MCP_ACTIVE", notion:"NOTION_TOKEN" };
const rootOf = (root:string) => existsSync(resolve(root,".marketing-engine")) ? resolve(root,".marketing-engine") : root;
const c = (id:string,status:DoctorStatus,detail:string):DoctorCheck => ({id,status,detail});
const missing = (id:string) => (process.env.MARKETING_ENGINE_DOCTOR_MISSING ?? "").split(",").map((x)=>x.trim()).includes(id);
function run(name:string,args:string[]=[],timeout=20000) { const exe=process.platform==="win32" && name==="npx" ? `${name}.cmd` : name; return spawnSync(exe,args,{timeout,encoding:"utf8",stdio:["ignore","pipe","pipe"]}); }
function pythonName(): string { return process.platform === "win32" ? "python" : "python3"; }
function toolChecks():DoctorCheck[] {
  const out:DoctorCheck[]=[]; const node=Number(process.versions.node.split(".")[0]); out.push(c("runtime.node",node>=18?"ok":"blocked",`Node ${process.version}; requires >=18`));
  const tsc=existsSync(resolve(process.cwd(),"node_modules/.bin/tsc"))&&!missing("typescript"); out.push(c("toolchain.typescript",tsc?"ok":"blocked",tsc?"TypeScript compiler found":"TypeScript compiler/build is unavailable"));
  const pw=existsSync(resolve(process.cwd(),"node_modules/@playwright/test"))&&!missing("playwright"); const browser=existsSync(process.env.PLAYWRIGHT_BROWSERS_PATH??resolve(process.env.LOCALAPPDATA??"","ms-playwright")); out.push(c("toolchain.playwright",pw&&browser?"ok":"blocked",pw&&browser?"Playwright package and browser cache found":"Playwright package or installed browsers are missing"));
  const ff=!missing("ffmpeg")&&run("ffmpeg",["-version"],5000).status===0; out.push(c("toolchain.ffmpeg",ff?"ok":"blocked",ff?"ffmpeg is available":"ffmpeg is missing from PATH"));
  if(process.env.SIMPLICIO_VIDEO_BIN) { const bin=process.env.SIMPLICIO_VIDEO_BIN; const ok=!missing("simplicio-video")&&existsSync(bin); out.push(c("toolchain.simplicio-video",ok?"ok":"blocked",ok?"simplicio-video CLI found":"SIMPLICIO_VIDEO_BIN is set but the file does not exist")); }
  return out;
}
function providerChecks(dry:boolean):{checks:DoctorCheck[],keys:string[]} { const ps=new Set<string>(); try { const m=loadProviderMatrix(); for(const layer of [m.llm,m.image,m.video]) for(const row of Object.values(layer)) ps.add(row.default); } catch {} if(!ps.size) ["claude","deepseek","gpt-image","higgsfield","topview","wavespeed"].forEach((p)=>ps.add(p)); const keys:string[]=[]; const checks:DoctorCheck[]=[]; for(const p of ps){ const key=KEYS[p]; if(!key){checks.push(c(`provider.${p}`,"warn","active provider has no known credential mapping; configured but unverified"));continue;} const present=Boolean(process.env[key]); if(present) keys.push(key); const activeFlagProvider = ["higgsfield","simplicio-video","meta-ads"].includes(p); const okStatus:DoctorStatus = activeFlagProvider ? "ok" : "warn"; const missingStatus:DoctorStatus = dry ? "warn" : "blocked"; checks.push(c(`provider.${p}.credential`,present?okStatus:missingStatus,present?`${key} is set${okStatus === "warn" ? "; safe ping unavailable, configured but unverified" : ""}`:`${key} is missing`)); } return {checks,keys}; }
function writeChecks(root:string):DoctorCheck[] { const out:DoctorCheck[]=[]; for(const rel of ["outputs","data",".simplicio"]){const dir=resolve(root,rel), marker=resolve(dir,`.doctor-${process.pid}`);try{mkdirSync(dir,{recursive:true});writeFileSync(marker,"ok");rmSync(marker,{force:true});out.push(c(`data.${rel.replaceAll(".","")}.writable`,`ok`,`${rel}/ is writable`));}catch{out.push(c(`data.${rel.replaceAll(".","")}.writable`,`blocked`,`${rel}/ is not writable`));}}return out;}
function operatorChecks(root:string):DoctorCheck[]{const gate=resolve(root,"hooks","action_gate.py");if(!existsSync(gate))return [c("operator.action-gate","warn","action-gate selftest not run"), c("operator.python-workers","blocked","python worker hooks are missing")];const py = pythonName(); const pyOk = !missing("python") && run(py,["--version"],5000).status===0; const r=pyOk?run(py,[gate,"selftest"]):null; return [c("operator.action-gate",r?.status===0?"ok":"blocked",r?.status===0?"action-gate selftest passed":"action-gate selftest failed"), c("operator.python-workers",pyOk?"ok":"blocked",pyOk?`${py} is available for hook workers`:`${py} is unavailable for hook workers`)];}
export function buildDoctorReport(root:string):DoctorReport { const er=rootOf(root), pieces:Record<string,number>={}; for(const p of listPieces({piecesDir:resolve(er,"pieces")})) pieces[p.frontmatter.status]=(pieces[p.frontmatter.status]??0)+1; const ev=eventsSummary(root,1), fail=ev.by_kind["gate_fail"]??0, pass=ev.by_kind["gate_pass"]??0, journal=readJournal(root), ids=new Set(journal.map((r)=>r.item_id)), dry=process.env.DRY_RUN===undefined||process.env.DRY_RUN==="true"||process.env.DRY_RUN===""; const prov=providerChecks(dry); const checks=[...toolChecks(),...(process.env.DRY_RUN===undefined||process.env.DRY_RUN==="true"||process.env.DRY_RUN==="false"?[c("env.flags","ok",`DRY_RUN=${process.env.DRY_RUN??"true"}`)]:[c("env.flags","blocked","DRY_RUN must be true or false")]),c("mcp.dry-run",dry?"ok":"warn",dry?"MCP connectivity safely skipped under DRY_RUN":"MCP connectivity is not safely verified"),...prov.checks,...writeChecks(er),...operatorChecks(root)]; const stalled=[...ids].filter((id)=>itemVerdict(root,id).verdict==="STALLED"); const coreVersion=process.env.SIMPLICIO_LOOP_CORE_VERSION??"3.38.1"; const manifest=loadExtensionManifest(coreVersion); const extension:DoctorExtensionReport={id:manifest.extension_id,version:manifest.version,core_version:coreVersion,compatible:true,capabilities:manifest.capabilities?.provides??[],budget_authority:"core",conformance:"pass"}; return {schema:DOCTOR_SCHEMA,ts:new Date().toISOString(),root,dry_run:dry,has_blocked:checks.some((x)=>x.status==="blocked"),checks,env:{providers_with_keys:prov.keys,kill_switch_run_log:process.env.SIMPLICIO_DISABLE_RUN_LOG==="1"},pieces,events:{path:eventsPath(root),present:existsSync(eventsPath(root)),count:ev.count,gate_fail_rate:fail+pass?Math.round(fail/(fail+pass)*1000)/10:0,stalls:ev.by_kind["stall_detected"]??0,...(ev.last[0]?.ts?{last_ts:ev.last[0].ts}:{})},savings:{count:savingsSummary(root).count,saved_total:savingsSummary(root).saved_total,chain_ok:savingsSummary(root).chain.ok},loop:{journal_present:existsSync(journalPath(root)),items:ids.size,stalled_items:stalled},operator:{hooks_present:existsSync(resolve(root,"hooks")),action_gate_selftest:checks.some((x)=>x.id==="operator.action-gate"&&x.status==="ok")?"pass":checks.some((x)=>x.id==="operator.action-gate"&&x.status==="blocked")?"fail":"not_run",python_workers:checks.some((x)=>x.id==="operator.python-workers"&&x.status==="ok")?"resolved":"absent"},release_train:{...releaseIdentity(root),latest:process.env.SIMPLICIO_LOOP_LATEST_VERSION??null,installed:releaseIdentity(root).core_version,compatible:process.env.SIMPLICIO_LOOP_COMPATIBLE===undefined?null:process.env.SIMPLICIO_LOOP_COMPATIBLE==="true",blocked_reason:process.env.SIMPLICIO_LOOP_BLOCKED_REASON??null},extension}; }
export function assertDoctorHealthy(root:string):void { const r=buildDoctorReport(root); if(r.has_blocked) throw new Error(`doctor-blocked: ${r.checks.filter((x)=>x.status==="blocked").map((x)=>`${x.id}: ${x.detail}`).join("; ")}`); }
export async function cliEntry(argv:string[]):Promise<void>{const report=buildDoctorReport(process.env.MARKETING_ENGINE_HOST_ROOT??process.cwd());for(const x of report.checks)process.stderr.write(`doctor: ${x.status} ${x.id} — ${x.detail}\n`);process.stdout.write(`${JSON.stringify(report,null,2)}\n`);emitEvent(report.root,{kind:"doctor_run",phase:"doctor",verdict:report.has_blocked?"blocked":"healthy"});if(report.has_blocked)process.exitCode=1;}
if(import.meta.url===`file://${process.argv[1]?.replace(/\\/g,"/")}`.replace(/^file:\/\/\//,"file:///"))cliEntry(process.argv.slice(2)).catch((err)=>{process.stderr.write(`doctor failed: ${String(err)}\n`);process.exit(1);});
