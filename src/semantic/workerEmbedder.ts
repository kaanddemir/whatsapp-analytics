/* An Embedder backed by the model worker, created by the analysis worker
   when semantic search is first needed. Terminating it frees the model's
   memory at once; a crashed model worker fails its pending requests with
   ModelError and leaves the analysis worker (and the chat) untouched. */
import { ModelError, type Device, type Embedder, type EmbedderFactory } from "./embedder";
import { E5_SMALL } from "./model";
import type { ModelRequest, ModelResponse } from "./model.worker";

type Body = ModelRequest extends infer R ? R extends ModelRequest ? Omit<R, "id"> : never : never;

/** WebGPU is off by default: with this int8 model it embedded slower than WASM (52 vs 62 messages/s, headless
    Chrome 155 on an M1) and took about 180 MB more, because its quantized operators are not GPU kernels. */
export const workerEmbedderFactory = (baseUrl: string, preferWebGpu = false): EmbedderFactory => async (onProgress, signal) => {
  const worker = new Worker(new URL("./model.worker.ts", import.meta.url), { type: "module" });
  const pending = new Map<number, { resolve: (r: ModelResponse) => void; reject: (e: ModelError) => void }>();
  let next = 1;
  let closed = false;
  const failAll = (e: ModelError) => { for (const p of pending.values()) p.reject(e); pending.clear(); };
  worker.onmessage = (event: MessageEvent<ModelResponse>) => {
    const r = event.data;
    if (r.type === "progress") { onProgress?.(r.progress); return; }
    const p = pending.get(r.id);
    if (!p) return;
    pending.delete(r.id);
    if (r.type === "error") p.reject(new ModelError(r.code, r.message));
    else p.resolve(r);
  };
  const stop = () => {
    closed = true;
    worker.terminate();
    failAll(new ModelError("failed", "The model worker stopped."));
  };
  worker.onerror = (event) => { event.preventDefault(); stop(); };
  worker.onmessageerror = stop;
  signal?.addEventListener("abort", stop, { once: true });
  if (signal?.aborted) stop();
  const send = (body: Body) => new Promise<ModelResponse>((resolve, reject) => {
    if (closed) return reject(new ModelError("failed", "The model was closed."));
    const id = next++;
    pending.set(id, { resolve, reject });
    try { worker.postMessage({ ...body, id } as ModelRequest); } catch { stop(); }
  });
  let device: Device;
  try {
    const ready = await send({ type: "init", baseUrl, preferWebGpu });
    if (ready.type !== "ready") throw new ModelError("failed", "Unexpected model reply.");
    device = ready.device;
  } catch (error) {
    signal?.removeEventListener("abort", stop);
    worker.terminate();
    throw error;
  }
  const embedder: Embedder = {
    device,
    dim: E5_SMALL.dim,
    async embed(texts) {
      const r = await send({ type: "embed", texts });
      if (r.type !== "vectors") throw new ModelError("failed", "Unexpected model reply.");
      return r.data;
    },
    async dispose() {
      signal?.removeEventListener("abort", stop);
      stop();
    },
  };
  return embedder;
};
