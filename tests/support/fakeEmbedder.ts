/* A deterministic stand-in for the embedding model, for unit tests only.
   Words map to "concepts" (a few groups of paraphrases share one), each
   concept to a fixed direction; a text's vector is the normalised sum. So
   "seni özledim" and "keşke yanımda olsaydın" point the same way without a
   model, while unrelated words stay apart. Real-model quality is measured
   separately (tests/retrieval/semanticModel.test.ts). */
import { foldAligned, tokens } from "@/text/fold";
import { ModelError, type Embedder, type EmbedderFactory, type ModelProgress } from "@/semantic/embedder";

const DIM = 384;
const CONCEPTS: Record<string, string> = {
  ozledim: "miss", ozledigimi: "miss", ozlemek: "miss", yanimda: "miss", olsaydin: "miss", miss: "miss", missed: "miss",
  tasinma: "move", tasinmayi: "move", tasinmaktan: "move", ev: "move", eve: "move", gecsek: "move", move: "move", moving: "move",
  gitmek: "go", istemiyorum: "notgo", istemedigimi: "notgo",
};

function direction(key: string): Float32Array {
  const v = new Float32Array(DIM);
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  for (let j = 0; j < 8; j++) { h = Math.imul(h ^ (h >>> 13), 0x5bd1e995); v[(h >>> 0) % DIM]! += (h & 1) ? 1 : -1; }
  return v;
}

export function fakeVector(text: string): Float32Array {
  const v = new Float32Array(DIM);
  const words = tokens(foldAligned(text.replace(/^(query|passage): /, "")));
  for (const w of words) {
    const d = direction(CONCEPTS[w] ?? w);
    for (let j = 0; j < DIM; j++) v[j]! += d[j]! * (CONCEPTS[w] ? 8 : 1);
  }
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  for (let j = 0; j < DIM; j++) v[j]! /= n;
  return v;
}

export interface FakeModel {
  factory: EmbedderFactory;
  /** Texts embedded so far (passages and queries). */
  readonly calls: string[];
  /** Makes the Nth embed call (1-based) throw. */
  failAt: number | null;
  /** Holds every embed call until released. */
  gate: Promise<void> | null;
  loads: number;
}

export function fakeModel(options: { failLoad?: ModelError["code"] } = {}): FakeModel {
  const model: FakeModel = {
    calls: [], failAt: null, gate: null, loads: 0,
    factory: async (onProgress?: (p: ModelProgress) => void) => {
      model.loads++;
      if (options.failLoad) throw new ModelError(options.failLoad, "fake load failure");
      onProgress?.({ phase: "load", loaded: 1, total: 1 });
      const embedder: Embedder = {
        device: "wasm",
        dim: DIM,
        async embed(texts) {
          if (model.gate) await model.gate;
          model.calls.push(...texts);
          if (model.failAt !== null && model.calls.length >= model.failAt) throw new ModelError("failed", "fake failure");
          const out = new Float32Array(texts.length * DIM);
          texts.forEach((t, i) => out.set(fakeVector(t), i * DIM));
          return out;
        },
        async dispose() {},
      };
      return embedder;
    },
  };
  return model;
}
