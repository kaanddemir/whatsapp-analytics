/* The model worker: one embedding model, loaded on demand, in its own
   worker so inference never blocks the analysis worker's other requests.

   Transformers.js is configured to read only the verified copies of the
   model files on this device (a custom cache over OPFS); remote models are
   disabled and the ONNX Runtime WASM files are served from this app's
   origin as bundled assets, never a CDN. WebGPU, when requested, is used if the browser offers an adapter and
   a test embedding succeeds on it; otherwise, or when it fails, WASM on one
   thread (the app is not cross-origin isolated, so no threads). The analysis
   worker asks for WASM: see workerEmbedder.ts for why WebGPU is not preferred. */
import { E5_SMALL } from "./model";
// The ONNX Runtime build Transformers.js expects, as bundled same-origin assets.
import ortWasm from "ort-dist/ort-wasm-simd-threaded.asyncify.wasm?url";
import ortMjs from "ort-dist/ort-wasm-simd-threaded.asyncify.mjs?url";
import { ensureModelFiles } from "./modelFiles";
import { ModelError, pipelineEmbedder, type Device, type Embedder, type FeatureExtractor, type ModelProgress } from "./embedder";

export type ModelRequest =
  | { readonly type: "init"; readonly id: number; readonly baseUrl: string; readonly preferWebGpu: boolean }
  | { readonly type: "embed"; readonly id: number; readonly texts: readonly string[] }
  | { readonly type: "dispose"; readonly id: number };
export type ModelResponse =
  | { readonly type: "progress"; readonly id: number; readonly progress: ModelProgress }
  | { readonly type: "ready"; readonly id: number; readonly device: Device }
  | { readonly type: "vectors"; readonly id: number; readonly data: Float32Array }
  | { readonly type: "done"; readonly id: number }
  | { readonly type: "error"; readonly id: number; readonly code: ModelError["code"]; readonly message: string };

interface Scope { onmessage: ((e: MessageEvent<ModelRequest>) => void) | null; postMessage(m: ModelResponse, transfer?: Transferable[]): void }
const scope = self as unknown as Scope;
const spec = E5_SMALL;
let embedder: Embedder | null = null;

async function init(id: number, baseUrl: string, preferWebGpu: boolean): Promise<Device> {
  if (typeof navigator === "undefined" || !navigator.storage?.getDirectory) throw new ModelError("unsupported", "This browser cannot keep model files.");
  const root = await navigator.storage.getDirectory();
  const read = await ensureModelFiles(spec, baseUrl, root, (progress) => scope.postMessage({ type: "progress", id, progress }));
  scope.postMessage({ type: "progress", id, progress: { phase: "load", loaded: 0, total: 1 } });
  const { env, pipeline } = await import("@huggingface/transformers");
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = `${baseUrl}models/`;
  env.useBrowserCache = false;
  env.useCustomCache = true;
  const suffix = `${spec.repo}/`;
  env.customCache = {
    async match(request: string | Request) {
      const url = typeof request === "string" ? request : request.url;
      const at = url.indexOf(suffix);
      const path = at >= 0 ? url.slice(at + suffix.length).split("?")[0]! : "";
      if (!spec.files.some((f) => f.path === path)) return undefined;
      return new Response(await read(path));
    },
    async put() { /* files are written by ensureModelFiles only */ },
  } as never;
  const onnx = env.backends.onnx as { wasm?: { wasmPaths?: unknown; numThreads?: number; proxy?: boolean } };
  if (onnx.wasm) {
    onnx.wasm.wasmPaths = { mjs: new URL(ortMjs, self.location.href).href, wasm: new URL(ortWasm, self.location.href).href };
    onnx.wasm.numThreads = 1;
    onnx.wasm.proxy = false;
  }
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  const devices: Device[] = preferWebGpu && gpu && (await gpu.requestAdapter().catch(() => null)) ? ["webgpu", "wasm"] : ["wasm"];
  let last: unknown = null;
  for (const device of devices) {
    try {
      const fe = await pipeline("feature-extraction", spec.repo, { dtype: spec.dtype, device } as never);
      const candidate = pipelineEmbedder(fe as unknown as FeatureExtractor, spec, device);
      // A device that loads but computes garbage (or nothing) is not used.
      const probe = await candidate.embed([`${spec.queryPrefix}merhaba`]);
      let norm = 0;
      for (const x of probe) norm += x * x;
      if (!Number.isFinite(norm) || Math.abs(norm - 1) > 0.01) { await candidate.dispose(); throw new Error("invalid output"); }
      embedder = candidate;
      return device;
    } catch (error) {
      last = error;
    }
  }
  if (last instanceof RangeError) throw new ModelError("memory", "Not enough memory for the model.");
  throw new ModelError("failed", "The model could not be started.");
}

scope.onmessage = async (event) => {
  const request = event.data;
  try {
    if (request.type === "init") scope.postMessage({ type: "ready", id: request.id, device: await init(request.id, request.baseUrl, request.preferWebGpu) });
    else if (request.type === "embed") {
      if (!embedder) throw new ModelError("failed", "The model is not loaded.");
      const data = await embedder.embed(request.texts);
      scope.postMessage({ type: "vectors", id: request.id, data }, [data.buffer]);
    } else {
      await embedder?.dispose();
      embedder = null;
      scope.postMessage({ type: "done", id: request.id });
    }
  } catch (error) {
    const e = error instanceof ModelError ? error : new ModelError(error instanceof RangeError ? "memory" : "failed", "The model stopped.");
    scope.postMessage({ type: "error", id: request.id, code: e.code, message: e.message });
  }
};
