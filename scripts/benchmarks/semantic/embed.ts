/* Node embedding helper for the benchmark, with a content-addressed
   vector cache (one per model and text preparation) outside the repo, so a
   ranking variant or a second corpus re-embeds only texts never seen.

   Models are read in place from ~/.cache/wa-phase2/models (already on disk);
   nothing is downloaded. One model per process. */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { E5_SMALL, indexKey } from "@/semantic/model";

export interface BenchModel {
  readonly key: string;
  readonly repo: string;
  readonly pooling: "mean" | "cls";
  readonly dim: number;
  readonly queryPrefix: string;
  readonly passagePrefix: string;
  /** Ranking parameters, as in ModelSpec; the floor is calibrated only for the shipped preparation (E5_SMALL). */
  readonly params: { readonly lexicalWeight: number; readonly minSimilarity: number };
}

const m: BenchModel = {
  key: indexKey(E5_SMALL), repo: E5_SMALL.repo, pooling: E5_SMALL.pooling,
  dim: E5_SMALL.dim, queryPrefix: E5_SMALL.queryPrefix, passagePrefix: E5_SMALL.passagePrefix,
  params: { lexicalWeight: E5_SMALL.lexicalWeight, minSimilarity: E5_SMALL.minSimilarity },
};
const ROOT = join(homedir(), ".cache", "wa-phase2");

export async function cachedEmbedder(threads = 2) {
  const dir = join(ROOT, "emb-bench", m.key);
  mkdirSync(dir, { recursive: true });
  const keysFile = join(dir, "keys.txt"), vecFile = join(dir, "vectors.f32");
  const keys = existsSync(keysFile) ? readFileSync(keysFile, "utf8").split("\n").filter(Boolean) : [];
  const raw = existsSync(vecFile) ? readFileSync(vecFile) : Buffer.alloc(0);
  const stored = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  const usable = Math.min(keys.length, Math.floor(stored.length / m.dim));
  const row = new Map<string, number>();
  for (let i = 0; i < usable; i++) row.set(keys[i]!, i);
  let mem = stored.slice(0, usable * m.dim);
  let fe: ((t: string[], o: object) => Promise<{ data: Float32Array }>) | null = null;
  let embedMs = 0, embedded = 0;
  const hash = (s: string) => createHash("sha1").update(s).digest("hex");
  const load = async () => {
    if (fe) return fe;
    const { pipeline, env } = await import("@huggingface/transformers");
    env.allowRemoteModels = false;
    env.useFSCache = false;
    const modelRoot = process.env.SEMANTIC_MODELS_DIR ?? join(ROOT, "models");
    // Never download or evaluate unverified weights.
    for (const file of E5_SMALL.files) {
      const digest = createHash("sha256").update(readFileSync(join(modelRoot, E5_SMALL.repo, file.path))).digest("hex");
      if (digest !== file.sha256) throw new Error(`Model integrity failure: ${file.path}`);
    }
    env.localModelPath = modelRoot + "/";
    fe = (await pipeline("feature-extraction", m.repo, { dtype: "int8", device: "cpu", session_options: { enableCpuMemArena: false, intraOpNumThreads: threads } as never })) as never;
    return fe!;
  };
  /** Vectors for already-prefixed texts, row-major. Missing texts are embedded in length-sorted batches. */
  async function vectors(texts: readonly string[], batch = 16): Promise<Float32Array> {
    const missing = [...new Set(texts.filter((t) => !row.has(hash(t))))].sort((a, b) => a.length - b.length);
    if (missing.length) {
      // BENCH_CACHE_ONLY=1: re-score cached vectors only; never load a model as a side effect.
      if (process.env.BENCH_CACHE_ONLY === "1") throw new Error(`${missing.length} texts not cached for ${m.key} (BENCH_CACHE_ONLY=1); first: ${JSON.stringify(missing[0]!.slice(0, 80))}`);
      const f = await load();
      const add = new Float32Array(missing.length * m.dim);
      const t0 = performance.now();
      for (let i = 0; i < missing.length; i += batch) {
        const out = await f(missing.slice(i, i + batch), { pooling: m.pooling, normalize: true });
        add.set(out.data, i * m.dim);
      }
      embedMs += performance.now() - t0; embedded += missing.length;
      appendFileSync(keysFile, missing.map(hash).join("\n") + "\n");
      appendFileSync(vecFile, Buffer.from(add.buffer));
      const next = new Float32Array(mem.length + add.length);
      next.set(mem); next.set(add, mem.length);
      const base = mem.length / m.dim;
      missing.forEach((t, i) => row.set(hash(t), base + i));
      mem = next;
    }
    const out = new Float32Array(texts.length * m.dim);
    texts.forEach((t, i) => { const r = row.get(hash(t))!; out.set(mem.subarray(r * m.dim, (r + 1) * m.dim), i * m.dim); });
    return out;
  }
  return { vectors, stats: () => ({ embedded, embedMs: Math.round(embedMs), perS: embedded ? +(embedded / (embedMs / 1000)).toFixed(1) : null }), dispose: async () => { await (fe as unknown as { dispose?: () => Promise<void> })?.dispose?.(); } };
}
