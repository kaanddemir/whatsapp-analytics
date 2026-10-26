/* Manual benchmark: semantic tier at scale. Synthetic data only.

   NOT run automatically. On the 8 GB reference machine, run it only with
   explicit approval, one size at a time, under the guard (policy "measure"
   for timing and memory figures):

     node_modules/.bin/vite-node --root . scripts/benchmarks/guard.ts -- ~/.cache/wa-phase2/guard.jsonl measure \
       --estimate <MB> scripts/benchmarks/semantic-scale.ts <messages> [sample]

   Suggested estimates: 100k ~ 900 MB, 500k ~ 1.6 GB, 1M ~ 2.6 GB (parse + keyword index + vectors + model).

   What it measures, with the production code:
   - parse + keyword index of <messages> synthetic messages;
   - indexable units and the vector memory they need (int8, dim + 8 bytes each), against the
     in-app budget (src/semantic/indexer.ts), i.e. whether the app would start indexing at all;
   - embedding throughput on Node CPU for `sample` messages (default 2,000) through the real model,
     extrapolated to the whole chat (the browser's WASM path measured ~13.5-13.8 messages/s, see
     docs/ARCHITECTURE.md: divide accordingly);
   - exact-scan search latency over all units with synthetic unit vectors (no inference needed).
   Results are one JSON line on stdout. */
import { homedir } from "node:os";
import { join } from "node:path";
import { parseExport } from "@/parser";
import { buildKeywordIndex } from "@/search/keywordIndex";
import { E5_SMALL } from "@/semantic/model";
import { indexableIds, passage } from "@/semantic/units";
import { VectorIndex } from "@/semantic/vectors";
import { vectorBudgetBytes } from "@/semantic/indexer";
import { pipelineEmbedder, type FeatureExtractor } from "@/semantic/embedder";
import { synthExport } from "../../tests/fixtures/syntheticExport";

const [nArg = "100000", sampleArg = "2000"] = process.argv.slice(2);
const N = Number(nArg), SAMPLE = Number(sampleArg);
const mb = (b: number) => Math.round(b / 2 ** 20);
const out: Record<string, unknown> = { n: N, sample: SAMPLE };

let t = performance.now();
const text = [...synthExport({ n: N, format: "android24", lang: "mix", lengthFactor: 1 })].join("");
const parsed = parseExport(text);
out.parseMs = Math.round(performance.now() - t);
t = performance.now();
buildKeywordIndex(parsed.messages);
out.keywordMs = Math.round(performance.now() - t);
const ids = indexableIds(parsed);
out.units = ids.length;
out.vectorMB = mb(ids.length * (E5_SMALL.dim + 8));
out.budgetMB8GB = mb(vectorBudgetBytes({ deviceMemoryGB: 8 }));
out.withinBudget = ids.length * (E5_SMALL.dim + 8) <= vectorBudgetBytes({ deviceMemoryGB: 8 });

// Search latency over all units, with synthetic normalised vectors (the scan cost does not depend on content).
const index = new VectorIndex(E5_SMALL.dim);
const batch = new Float32Array(4096 * E5_SMALL.dim);
let s = 7;
for (let at = 0; at < ids.length; at += 4096) {
  const n = Math.min(4096, ids.length - at);
  for (let i = 0; i < n * E5_SMALL.dim; i++) { s = (s * 1103515245 + 12345) >>> 0; batch[i] = s / 2 ** 32 - 0.5; }
  index.add(ids.subarray(at, at + n), batch.subarray(0, n * E5_SMALL.dim));
}
const q = batch.slice(0, E5_SMALL.dim);
const lat: number[] = [];
for (let r = 0; r < 5; r++) { t = performance.now(); index.search(q, 200); lat.push(performance.now() - t); }
out.searchMs = Math.round(lat.sort((a, b) => a - b)[2]!);
out.rssAfterVectorsMB = mb(process.memoryUsage().rss);

// Real-model throughput on a sample.
const { pipeline, env } = await import("@huggingface/transformers");
env.allowRemoteModels = false;
env.useFSCache = false; // read the model in place; never copy it into a cache folder
env.localModelPath = (process.env.SEMANTIC_MODELS_DIR ?? join(homedir(), ".cache", "wa-phase2", "models")) + "/";
const fe = await pipeline("feature-extraction", E5_SMALL.repo, { dtype: E5_SMALL.dtype, device: "cpu", session_options: { intraOpNumThreads: 1 } as never });
const embedder = pipelineEmbedder(fe as unknown as FeatureExtractor, E5_SMALL, "cpu");
const sample = [...ids.subarray(0, Math.min(SAMPLE, ids.length))].map((i) => passage(E5_SMALL, parsed.messages[i]!.text));
t = performance.now();
for (let i = 0; i < sample.length; i += 16) await embedder.embed(sample.slice(i, i + 16));
const perS = sample.length / ((performance.now() - t) / 1000);
out.nodeEmbedPerS = Math.round(perS);
out.nodeHoursWhole = +(ids.length / perS / 3600).toFixed(2);
out.browserHoursWholeAt13_5 = +(ids.length / 13.5 / 3600).toFixed(1);
out.rssPeakMB = mb(process.memoryUsage().rss);
await embedder.dispose();
console.log(JSON.stringify(out));
