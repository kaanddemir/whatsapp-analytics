/* Resource policy tests. Process-killing integration cases are opt-in:
   BENCH_GUARD_TEST=1 npm test -- tests/infrastructure/benchmarkGuard.test.ts */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allowedPressure, policyCheck, policyPreflight, processBudgetMB, retryGate, type Snapshot } from "../../scripts/benchmarks/safety";

const snap = (o: Partial<Snapshot> = {}): Snapshot => ({ pressure: 1, swapMB: 2000, availableMB: 2400, at: 0, ...o });

describe("policies", () => {
  it("measure is strict, evaluate tolerates warning but never critical", () => {
    expect(allowedPressure("measure")).toBe(1);
    expect(allowedPressure("evaluate")).toBe(2);
    for (const [p, level, ok] of [["measure", 1, true], ["measure", 2, false], ["measure", 4, false], ["evaluate", 1, true], ["evaluate", 2, true], ["evaluate", 4, false]] as const) {
      expect(policyPreflight(p, snap({ pressure: level }), null).ok).toBe(ok);
      expect(policyCheck(p, snap(), snap({ pressure: level, at: 1 }), 100, 4096, 60_000).ok).toBe(ok);
    }
  });
  it("swap growth > 256 MB stops both policies", () => {
    for (const p of ["measure", "evaluate"] as const) {
      expect(policyCheck(p, snap(), snap({ swapMB: 2256 }), 100, 4096, 60_000).ok).toBe(true);
      expect(policyCheck(p, snap(), snap({ swapMB: 2257 }), 100, 4096, 60_000)).toMatchObject({ ok: false, reason: expect.stringMatching(/swap grew/) });
    }
  });
  it("budget is half of physical, on the experiment process; timeout applies", () => {
    expect(processBudgetMB(8192)).toBe(4096);
    expect(policyCheck("evaluate", snap(), snap(), 4097, 4096, 60_000).ok).toBe(false);
    expect(policyCheck("evaluate", snap(), snap({ at: 60_001 }), 100, 4096, 60_000)).toMatchObject({ ok: false, reason: expect.stringMatching(/timeout/) });
  });
  it("preflight keeps a 512 MB reserve over the estimate", () => {
    expect(policyPreflight("evaluate", snap({ availableMB: 1100 }), 600).ok).toBe(false);
    expect(policyPreflight("evaluate", snap({ availableMB: 1112 }), 600).ok).toBe(true);
    expect(policyPreflight("evaluate", snap({ availableMB: 500 }), null).ok).toBe(false);
  });
  it("retry gate: no rerun after a stop unless something meaningful changed", () => {
    const h = [{ key: "k", stopped: "memory pressure level 2 (measure)", availableAtStartMB: 2300 }];
    expect(retryGate("k", h, snap({ availableMB: 2400 }), null).ok).toBe(false); // pressure back to 1 is not a change
    expect(retryGate("k", h, snap({ availableMB: 2812 }), null).ok).toBe(true); // +512 MB freed
    expect(retryGate("k", h, snap(), "closed Google Chrome").ok).toBe(true);
    expect(retryGate("other", h, snap(), null).ok).toBe(true); // different configuration
    expect(retryGate("k", [...h, { key: "k", stopped: null, availableAtStartMB: 2300 }], snap(), null).ok).toBe(true);
  });
});

// End-to-end through guard.ts with fixture scripts. Real pressure is whatever the machine reports,
// so these use the evaluate policy (runs through warning) and a forced small budget.
const root = join(__dirname, "../..");
const guard = (out: string, extra: string[], env: Record<string, string> = {}) =>
  spawnSync(join(root, "node_modules/.bin/vite-node"), ["--root", ".", "scripts/benchmarks/guard.ts", "--", out, ...extra], { cwd: root, env: { ...process.env, ...env }, encoding: "utf8", timeout: 90_000 });
const last = (out: string) => JSON.parse(readFileSync(out, "utf8").trim().split("\n").pop()!);
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const F = "tests/fixtures/guard";

describe.skipIf(!process.env.BENCH_GUARD_TEST)("guard", { timeout: 120_000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), "wa-guard-test-"));
  it("records policy and result kind", () => {
    const out = join(dir, "ok.jsonl");
    guard(out, ["evaluate", `${F}/ok.mjs`]);
    expect(last(out)).toMatchObject({ policy: "evaluate", resultKind: "accuracy", stopped: null, result: { fixture: "ok" } });
    guard(out, ["measure", `${F}/ok.ts`]); // TypeScript path goes through vite-node
    const ts = last(out);
    if (!ts.skipped) expect(ts).toMatchObject({ policy: "measure", resultKind: "performance", stopped: null, result: { fixture: "ok-ts" } });
    const r = guard(out, ["bogus", `${F}/ok.mjs`]);
    expect(r.status).toBe(2);
  });
  it("stops a process over budget, then refuses an identical retry", () => {
    const out = join(dir, "hog.jsonl");
    guard(out, ["evaluate", `${F}/hog.mjs`, "400"], { PHASE2_BUDGET_MB: "150" });
    expect(last(out).stopped).toMatch(/experiment process \d+ MB > budget 150 MB/);
    guard(out, ["evaluate", `${F}/hog.mjs`, "400"], { PHASE2_BUDGET_MB: "150" });
    expect(last(out).skipped).toMatch(/not retried/);
    guard(out, ["evaluate", "--changed", "test: stated change", `${F}/hog.mjs`, "400"], { PHASE2_BUDGET_MB: "150" });
    expect(last(out)).toMatchObject({ changed: "test: stated change", stopped: expect.stringMatching(/budget/) });
  });
  it("timeout kills the whole process group, grandchildren included", () => {
    const out = join(dir, "gc.jsonl"), pidFile = join(dir, "gc.pid");
    guard(out, ["measure", "--timeout", "3", `${F}/grandchild.mjs`, pidFile]);
    const rec = last(out);
    if (rec.skipped) return void console.warn(`measure policy refused to start here: ${rec.skipped}`);
    expect(rec.stopped).toMatch(/timeout|pressure/);
    expect(alive(Number(readFileSync(pidFile, "utf8")))).toBe(false);
  });
  it("cancellation (SIGTERM to the guard) kills the experiment and releases the lock", async () => {
    const out = join(dir, "cancel.jsonl"), pidFile = join(dir, "cancel.pid");
    const g = spawn(join(root, "node_modules/.bin/vite-node"), ["--root", ".", "scripts/benchmarks/guard.ts", "--", out, "evaluate", `${F}/grandchild.mjs`, pidFile], { cwd: root, stdio: "ignore" });
    for (let i = 0; i < 100 && !existsSync(pidFile); i++) await new Promise((r) => setTimeout(r, 100));
    const gc = Number(readFileSync(pidFile, "utf8"));
    // vite-node runs the guard in-process, so signalling it signals the guard.
    g.kill("SIGTERM");
    await new Promise((r) => g.once("exit", r));
    await new Promise((r) => setTimeout(r, 500));
    expect(alive(gc)).toBe(false);
    expect(existsSync(join(tmpdir(), "whatsapp-analytics-phase1-bench.lock"))).toBe(false);
  });
  it("preserves retry refusal from a historical entry-point path", () => {
    for (const prefix of ["", "./", `${root}/`]) {
      const out = join(dir, `renamed-${prefix.length}.jsonl`);
      const key = JSON.stringify(["evaluate", `${prefix}docs/ai/experiments/phase2/fixtures/ok.mjs`, [], ""]);
      writeFileSync(out, JSON.stringify({ key, exit: 1, stopped: "budget exceeded", availableAtStartMB: Number.MAX_SAFE_INTEGER }) + "\n");
      guard(out, ["evaluate", `${prefix}${F}/ok.mjs`], { PHASE2_ENV_KEY: "" });
      expect(last(out).key).toBe(key);
      expect(last(out).skipped).toMatch(/not retried/);
    }
  });
  it("lock refuses a second concurrent experiment", async () => {
    const out = join(dir, "lock.jsonl"), pidFile = join(dir, "lock.pid");
    const g = spawn(join(root, "node_modules/.bin/vite-node"), ["--root", ".", "scripts/benchmarks/guard.ts", "--", out, "evaluate", `${F}/grandchild.mjs`, pidFile], { cwd: root, stdio: "ignore" });
    for (let i = 0; i < 100 && !existsSync(pidFile); i++) await new Promise((r) => setTimeout(r, 100));
    const r = guard(join(dir, "lock2.jsonl"), ["evaluate", `${F}/ok.mjs`]);
    expect(r.status).toBe(2);
    expect(last(join(dir, "lock2.jsonl")).refused).toMatch(/another experiment holds the lock/);
    g.kill("SIGTERM");
    await new Promise((r) => g.once("exit", r));
    rmSync(dir, { recursive: true, force: true });
  });
});
