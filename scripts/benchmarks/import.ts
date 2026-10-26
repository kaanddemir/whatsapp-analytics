/* the production import path at scale, on synthetic exports.

   gen   <n> <format> <lengthFactor> <file>   write an export (separate process, so generation is not measured)
   run   <file>                               readExport -> parseExport -> analyze -> optional derived stages

   Stages are timed one by one; memory is sampled every 25 ms (RSS and JS heap), so the peak
   per stage is visible. Also checks the import gate: the measured peak against the estimate
   limits.ts uses to admit a file. Run under guard.ts (measure policy). */
import { createWriteStream, openAsBlob, statSync } from "node:fs";
import { synthExport, type Format } from "../../tests/fixtures/syntheticExport";
import { readExport } from "@/io/readExport";
import { estimateWorkingSetMB, MAX_TEXT_BYTES } from "@/io/limits";
import { parseExport } from "@/parser";
import { analyze } from "@/analytics";
import { NO_FILTERS } from "@/model";

const [mode, ...args] = process.argv.slice(2);
const mb = (b: number) => Math.round(b / 1024 / 1024);

if (mode === "gen") {
  const [n, format, lengthFactor, file] = args as [string, Format, string, string];
  const ws = createWriteStream(file);
  for (const piece of synthExport({ n: Number(n), format, lang: "mix", seed: 7, lengthFactor: Number(lengthFactor), noise: Number(lengthFactor) > 1 })) {
    if (!ws.write(piece)) await new Promise((r) => ws.once("drain", r));
  }
  await new Promise((r) => ws.end(r));
  console.log(JSON.stringify({ gen: file, bytes: statSync(file).size }));
  process.exit(0);
}

const file = args[0]!;
const peak = { rss: 0, heap: 0 };
const sample = () => { const m = process.memoryUsage(); peak.rss = Math.max(peak.rss, m.rss); peak.heap = Math.max(peak.heap, m.heapUsed); };
const timer = setInterval(sample, 25);
const stages: Record<string, { ms: number; peakRssMB: number; peakHeapMB: number }> = {};
async function stage<T>(name: string, fn: () => T | Promise<T>): Promise<T> {
  peak.rss = 0; peak.heap = 0; sample();
  const t = performance.now();
  const out = await fn();
  sample();
  stages[name] = { ms: Math.round(performance.now() - t), peakRssMB: mb(peak.rss), peakHeapMB: mb(peak.heap) };
  return out;
}

const bytes = statSync(file).size;
const blob = await openAsBlob(file);
const decoded = await stage("read", () => readExport(new File([blob], "chat.txt"), () => {}, MAX_TEXT_BYTES));
const parsed = await stage("parse", () => parseExport(decoded.text));
// The handler drops the text after parsing; do the same so retained memory is realistic.
(decoded as { text: string }).text = "";
const stats = await stage("analyze", () => analyze(parsed, NO_FILTERS));
// Optional search, behavior, timeline and question stages are measured separately.
const extraMod = process.env.BENCH_STAGES ? await import("./stages") : null;
if (extraMod) await extraMod.run(parsed, stage);
clearInterval(timer);
global.gc?.();
const retainedMB = mb(process.memoryUsage().heapUsed);
const overallPeak = Math.max(...Object.values(stages).map((s) => s.peakRssMB));
console.log(JSON.stringify({
  file, exportMB: +(bytes / 1024 / 1024).toFixed(1), messages: parsed.messages.length, totalMessages: stats.kpis.totalMessages,
  stages, importMs: stages.read!.ms + stages.parse!.ms + stages.analyze!.ms, peakRssMB: overallPeak, retainedHeapMB: retainedMB,
  gateEstimateMB: Math.round(estimateWorkingSetMB(decoded.byteLength)), estimateCoversPeak: estimateWorkingSetMB(decoded.byteLength) >= overallPeak,
  ...(extraMod?.extraResults ?? {}),
}));
