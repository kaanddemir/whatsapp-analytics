/* The embedding contract every runtime implements: the browser model worker,
   Node (evaluation and the real-model integration test) and test doubles.
   Vectors come back row-major in one Float32Array, L2-normalised. */
import type { ModelSpec } from "./model";

export type Device = "webgpu" | "wasm" | "cpu";

export interface Embedder {
  readonly device: Device;
  readonly dim: number;
  /** Texts already carry their "query: " / "passage: " prefix. */
  embed(texts: readonly string[]): Promise<Float32Array>;
  dispose(): Promise<void>;
}

/** Real work done so far, for progress: bytes while downloading or verifying, files while loading. */
export interface ModelProgress { readonly phase: "download" | "verify" | "load"; readonly loaded: number; readonly total: number }

export type EmbedderFactory = (onProgress?: (p: ModelProgress) => void, signal?: AbortSignal) => Promise<Embedder>;

/** Why the model could not be made ready; the chat and keyword search are unaffected. */
export type ModelFailure = "unsupported" | "model_missing" | "integrity" | "storage_full" | "memory" | "failed";

export class ModelError extends Error {
  constructor(readonly code: ModelFailure, message: string) {
    super(message);
    this.name = "ModelError";
  }
}

/** Minimal slice of a Transformers.js feature-extraction pipeline. */
export type FeatureExtractor = ((texts: string[], options: { pooling: "mean"; normalize: true }) => Promise<{ data: Float32Array | ArrayLike<number> }>) & { dispose?: () => Promise<unknown> };

export function pipelineEmbedder(fe: FeatureExtractor, spec: ModelSpec, device: Device): Embedder {
  return {
    device,
    dim: spec.dim,
    async embed(texts) {
      if (!texts.length) return new Float32Array();
      const out = await fe([...texts], { pooling: spec.pooling, normalize: true });
      const data = out.data instanceof Float32Array ? out.data : Float32Array.from(out.data);
      if (data.length !== texts.length * spec.dim) throw new ModelError("failed", `expected ${texts.length * spec.dim} values, got ${data.length}`);
      return data;
    },
    async dispose() { await fe.dispose?.(); },
  };
}
