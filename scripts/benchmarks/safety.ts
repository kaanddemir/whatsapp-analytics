/* Resource guard for manual benchmarks. Pressure, swap growth, available
   memory, process RSS, timeout, mutual exclusion and retry refusal are checked.
   The lock name is retained for compatibility with previous guarded runs. */
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const NORMAL = 1;

const sh = (cmd: string) => { try { return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString(); } catch { return ""; } };

/** Kernel memory-pressure level; null when unavailable (non-macOS). */
export function pressureLevel(): number | null {
  const v = sh("sysctl -n kern.memorystatus_vm_pressure_level").trim();
  return /^\d+$/.test(v) ? Number(v) : null;
}
export function swapUsedMB(): number | null {
  const m = /used = ([\d.]+)M/.exec(sh("sysctl -n vm.swapusage"));
  return m ? Number(m[1]) : null;
}
export function physicalMB(): number {
  return Number(sh("sysctl -n hw.memsize").trim()) / 2 ** 20 || 8192;
}
/** Memory the kernel can hand out without swapping: free + inactive + speculative + purgeable pages. */
export function availableMB(): number | null {
  const out = sh("vm_stat");
  const page = Number(/page size of (\d+)/.exec(out)?.[1] ?? 0);
  if (!page) return null;
  const pages = (k: string) => Number(new RegExp(`${k}:\\s+(\\d+)`).exec(out)?.[1] ?? 0);
  return ((pages("Pages free") + pages("Pages inactive") + pages("Pages speculative") + pages("Pages purgeable")) * page) / 2 ** 20;
}
/** RSS (MB) of `root` and every descendant (browser, GPU, renderer, utility processes alike). */
export function treeRssMB(root: number): number {
  const rows = sh("ps -axo pid=,ppid=,rss=").trim().split("\n").map((l) => l.trim().split(/\s+/).map(Number));
  const inTree = new Set([root]);
  for (let grew = true; grew;) { grew = false; for (const [pid, ppid] of rows) if (!inTree.has(pid!) && inTree.has(ppid!)) { inTree.add(pid!); grew = true; } }
  return rows.filter(([pid]) => inTree.has(pid!)).reduce((a, r) => a + r[2]! / 1024, 0);
}

export interface Snapshot { pressure: number | null; swapMB: number | null; availableMB: number | null; at: number }
export const snapshot = (): Snapshot => ({ pressure: pressureLevel(), swapMB: swapUsedMB(), availableMB: availableMB(), at: Date.now() });

export type Verdict = { ok: true } | { ok: false; reason: string };

/** One heavy experiment at a time across all benchmark scripts (stale locks of dead processes are taken over). */
const LOCK = join(tmpdir(), "whatsapp-analytics-phase1-bench.lock");
export function acquireLock(label: string): Verdict {
  try {
    mkdirSync(LOCK);
  } catch {
    let owner: { pid: number; label: string } | null = null;
    try { owner = JSON.parse(readFileSync(join(LOCK, "owner.json"), "utf8")); } catch { /* half-written */ }
    const alive = owner ? (() => { try { process.kill(owner!.pid, 0); return true; } catch { return false; } })() : true;
    if (alive) return { ok: false, reason: `another experiment holds the lock: ${owner ? `${owner.label} (pid ${owner.pid})` : "unknown"}` };
    rmSync(LOCK, { recursive: true, force: true });
    mkdirSync(LOCK);
  }
  writeFileSync(join(LOCK, "owner.json"), JSON.stringify({ pid: process.pid, label }));
  const release = () => rmSync(LOCK, { recursive: true, force: true });
  process.once("exit", release);
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.once(sig, () => { release(); process.exit(130); });
  return { ok: true };
}

/* Two named policies (docs/ARCHITECTURE.md):
   measure  (the result is a time, throughput or memory figure): Spectra strict. Start and run
            only at pressure 1, so a figure is never taken on a machine already under pressure.
   evaluate (the result is deterministic quality: recall, rerank, answer correctness): Spectra
            standard. Start at pressure <= 2, stop at 4 (critical); a warning is recorded.
   Both: stop on swap growth > 256 MB, a 0.5 x physical budget on the *experiment process's*
   RSS (not npx / vite-node wrappers), refuse when the estimated working set does not fit in
   available - 512 MB, one experiment at a time, wall-clock timeout, process-group kill. */
export const WARNING = 2;
export const CRITICAL = 4;
export type Policy = "measure" | "evaluate";
export const RESULT_KIND: Record<Policy, "performance" | "accuracy"> = { measure: "performance", evaluate: "accuracy" };
export const RESERVE_MB = 512;
export const SWAP_GROWTH_MB = 256;

/** Highest pressure level a policy tolerates (start and run). */
export const allowedPressure = (p: Policy) => (p === "measure" ? NORMAL : WARNING);
/** Spectra's budget: half of physical memory, for the experiment process itself. */
export const processBudgetMB = (physical = physicalMB()) => physical * 0.5;

export function policyPreflight(p: Policy, s: Snapshot, estimateMB: number | null): Verdict {
  if (s.pressure !== null && s.pressure > allowedPressure(p)) return { ok: false, reason: `not started (${p}): memory pressure level ${s.pressure}` };
  if (s.availableMB !== null) {
    const need = (estimateMB ?? 0) + RESERVE_MB;
    if (s.availableMB < need) return { ok: false, reason: `not started (${p}): ${Math.round(s.availableMB)} MB available < ${estimateMB === null ? "" : `estimated ${Math.round(estimateMB)} MB + `}${RESERVE_MB} MB reserve` };
  }
  return { ok: true };
}

/** In-run check. `processMB` is the experiment process's RSS; `budget` its limit. */
export function policyCheck(p: Policy, start: Snapshot, now: Snapshot, processMB: number, budget: number, timeoutMs: number): Verdict {
  if (now.pressure !== null && now.pressure > allowedPressure(p)) return { ok: false, reason: `memory pressure level ${now.pressure} (${p})` };
  if (start.swapMB !== null && now.swapMB !== null && now.swapMB - start.swapMB > SWAP_GROWTH_MB) return { ok: false, reason: `swap grew ${Math.round(now.swapMB - start.swapMB)} MB` };
  if (processMB > budget) return { ok: false, reason: `experiment process ${Math.round(processMB)} MB > budget ${Math.round(budget)} MB` };
  if (now.at - start.at > timeoutMs) return { ok: false, reason: `timeout after ${Math.round((now.at - start.at) / 1000)} s` };
  return { ok: true };
}

/** Largest single process in the tree: the experiment itself, not the npx / vite-node wrappers above it. */
export function largestProcessMB(root: number): number {
  const rows = sh("ps -axo pid=,ppid=,rss=").trim().split("\n").map((l) => l.trim().split(/\s+/).map(Number));
  const inTree = new Set([root]);
  for (let grew = true; grew;) { grew = false; for (const [pid, ppid] of rows) if (!inTree.has(pid!) && inTree.has(ppid!)) { inTree.add(pid!); grew = true; } }
  return rows.filter(([pid]) => inTree.has(pid!)).reduce((a, r) => Math.max(a, r[2]! / 1024), 0);
}

/** No retry loops: a run identical to one the guard stopped is refused unless something meaningful
    changed: the configuration (a different key), at least RESERVE_MB more available memory, or an
    explicit stated change. Pressure merely settling back to normal is not a change. */
export interface PastRun { key: string; stopped: string | null; availableAtStartMB: number | null }
export function retryGate(key: string, history: readonly PastRun[], now: Snapshot, statedChange: string | null): Verdict {
  const last = [...history].reverse().find((h) => h.key === key);
  if (!last || last.stopped === null || last.stopped.startsWith("not started")) return { ok: true };
  if (statedChange) return { ok: true };
  if (now.availableMB !== null && last.availableAtStartMB !== null && now.availableMB - last.availableAtStartMB >= RESERVE_MB) return { ok: true };
  return { ok: false, reason: `not retried: the last identical run stopped (${last.stopped}) and resource conditions have not meaningfully changed; pass --changed "<what changed>" after changing something` };
}
