/* run one Node experiment script under the resource guard (Spectra's
   run_isolated pattern: one child process at a time, preflight, budget, pressure,
   swap growth and timeout checks; the child's process group is killed on a breach).

   node_modules/.bin/vite-node --root . scripts/benchmarks/guard.ts -- <out.jsonl> <measure|evaluate> [--estimate MB] [--timeout s] [--changed "why"] <script> [args...]

   The policy is required and recorded with every result (safety.ts): `measure` for timing,
   throughput and memory figures (strict, pressure 1 only), `evaluate` for accuracy-only results
   (runs through warning, stops at critical). A run identical to one the guard stopped is not
   re-run unless the configuration, available memory or a stated condition has changed. */
import entrypoints from "./entrypoints.json";
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  RESULT_KIND, acquireLock, availableMB, largestProcessMB, policyCheck, policyPreflight, processBudgetMB, retryGate,
  snapshot, treeRssMB, type PastRun, type Policy,
} from "./safety";

const argv = process.argv.slice(2);
const outFile = argv.shift()!;
const policy = argv.shift() as Policy;
if (policy !== "measure" && policy !== "evaluate") { console.error(`policy must be measure or evaluate, got ${policy}`); process.exit(2); }
const opt: Record<string, string> = {};
while (argv[0]?.startsWith("--")) { const k = argv.shift()!.slice(2); opt[k] = argv.shift()!; }
const [script, ...args] = argv as [string, ...string[]];
const estimate = opt.estimate ? Number(opt.estimate) : null;
const timeoutMs = Number(opt.timeout ?? 30 * 60) * 1000;
// Historical records key runs by their original entry point; a rename must not bypass retry refusal.
const movedEntry = Object.entries(entrypoints).find(([, current]) => script === current || script.endsWith(`/${current}`));
const canonicalScript = movedEntry ? script.slice(0, -movedEntry[1].length) + movedEntry[0] : script;
const key = JSON.stringify([policy, canonicalScript, args, process.env.PHASE2_ENV_KEY ?? ""]);
const base = { policy, resultKind: RESULT_KIND[policy], script, args, key, changed: opt.changed ?? null };
const write = (o: Record<string, unknown>) => { appendFileSync(outFile, JSON.stringify(o) + "\n"); console.log(JSON.stringify(o).slice(0, 600)); };

const lock = acquireLock(`guardNode ${policy} ${script} ${args.join(" ")}`);
if (!lock.ok) { write({ ...base, refused: lock.reason }); process.exit(2); }
const pre = snapshot();
const history: PastRun[] = existsSync(outFile)
  ? readFileSync(outFile, "utf8").trim().split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } })
    .filter((r) => r.key && "exit" in r).map((r) => ({ key: r.key, stopped: r.stopped ?? null, availableAtStartMB: r.availableAtStartMB ?? null }))
  : [];
const gate = retryGate(key, history, pre, opt.changed ?? null);
if (!gate.ok) { write({ ...base, skipped: gate.reason, availableAtStartMB: pre.availableMB && Math.round(pre.availableMB) }); process.exit(0); }
const v = policyPreflight(policy, pre, estimate);
if (!v.ok) { write({ ...base, skipped: v.reason, pressureAtStart: pre.pressure, availableAtStartMB: pre.availableMB && Math.round(pre.availableMB) }); process.exit(0); }
const budget = process.env.PHASE2_BUDGET_MB ? Number(process.env.PHASE2_BUDGET_MB) : processBudgetMB();

// Plain .mjs scripts run on node directly; TypeScript goes through the local vite-node binary (no npx layer).
const viteNode = fileURLToPath(new URL("../../node_modules/.bin/vite-node", import.meta.url));
const child = script.endsWith(".mjs")
  ? spawn(process.execPath, [script, ...args], { stdio: ["ignore", "pipe", "inherit"], detached: true })
  : spawn(viteNode, ["--root", ".", script, "--", ...args], { stdio: ["ignore", "pipe", "inherit"], detached: true });
// Kill the whole process group, not just the direct child.
const killTree = () => { try { process.kill(-child.pid!, "SIGKILL"); } catch { /* gone */ } };
process.once("exit", killTree);
for (const sig of ["SIGINT", "SIGTERM"] as const) process.once(sig, () => { stopped = `cancelled (${sig})`; killTree(); });
child.on("error", (e) => { write({ ...base, exit: null, stopped: `failed to start: ${e.message}` }); process.exit(1); });
let stdout = "";
child.stdout!.on("data", (d) => (stdout += d));
let peakProc = 0, peakTree = 0, pressureMax = pre.pressure, stopped: string | null = null;
const timer = setInterval(() => {
  const proc = largestProcessMB(child.pid!);
  peakProc = Math.max(peakProc, proc);
  peakTree = Math.max(peakTree, treeRssMB(child.pid!));
  const now = snapshot();
  if (now.pressure !== null) pressureMax = Math.max(pressureMax ?? 0, now.pressure);
  const r = policyCheck(policy, pre, now, proc, budget, timeoutMs);
  if (!r.ok && !stopped) { stopped = r.reason; killTree(); }
}, 500);
child.on("exit", (code) => {
  killTree();
  clearInterval(timer);
  const end = snapshot();
  const last = stdout.trim().split("\n").filter((l) => l.startsWith("{")).pop();
  write({ ...base, exit: code, stopped, budgetMB: Math.round(budget), peakProcessMB: Math.round(peakProc), peakTreeMB: Math.round(peakTree),
    pressureAtStart: pre.pressure, pressureMax, pressureAfter: end.pressure,
    warningDuringRun: (pressureMax ?? 1) > 1 ? (policy === "measure" ? "stopped: figures invalid" : "continued (accuracy unaffected)") : null,
    availableAtStartMB: pre.availableMB && Math.round(pre.availableMB), availableAfterMB: Math.round(availableMB() ?? 0),
    swapDeltaMB: pre.swapMB !== null && end.swapMB !== null ? Math.round(end.swapMB - pre.swapMB) : null,
    durationS: Math.round((end.at - pre.at) / 1000), result: last ? JSON.parse(last) : null });
  process.exit(0);
});
