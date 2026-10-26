/* The semantic index of one open chat, built in the background.

   Messages are taken in message order, a window at a time. Within a window
   the distinct texts are embedded shortest first, 16 at a time: a batch is
   padded to its longest text, and in message order one long message made
   the whole batch slow (length order embedded twice as fast in Chrome, 62 vs
   30 messages/s, the conversational retrieval evaluation). A text seen recently ("geliyorum",
   "günaydın") reuses its vector instead of being embedded again. Vectors
   are then added in message order, so every message still has its own
   entry and stored segments keep their format. Between batches the job
   yields, so the worker keeps answering questions and keyword searches
   while it runs; whatever is indexed so far is searchable at once, and the
   answer says how much of the chat that covers. Sealed segments of a saved
   chat are committed as they fill, so closing the tab, cancelling or a
   crash loses at most one unsealed segment, and reopening resumes from the
   last commit. A storage failure (full quota) stops persisting but not
   indexing; a model failure stops indexing but never touches the chat or
   the keyword search.

   Memory: vectors take dim + 8 bytes per message. Before starting, the total
   is checked against a share of device memory; above it, the chat is too
   large for this device and indexing does not start. */
import type { ParseResult } from "@/model";
import { runtimeMemoryEnv, type MemoryEnv } from "@/io/limits";
import { E5_SMALL, indexKey, type ModelSpec } from "./model";
import { ModelError, type Device, type Embedder, type EmbedderFactory, type ModelFailure } from "./embedder";
import { compatible, INDEX_SCHEMA, isQuota, type IndexManifest, type SemanticStore } from "./store";
import { fingerprint, indexableIds, passage, query } from "./units";
import { SEGMENT_SIZE, VectorIndex, type Hit } from "./vectors";

export const BATCH = 16;
/** Messages per window: the unit of length ordering and of progress. */
export const WINDOW = 256;
/** Recently embedded texts whose vectors are reused (distinct texts, most recent kept). */
export const REUSE = 4096;
/** Share of device memory the vectors may take, and an absolute ceiling. */
export const VECTOR_SHARE = 0.08;
export const VECTOR_CEILING_MB = 400;

export type SemanticFailure = ModelFailure | "too_large";

export type SemanticState =
  | { readonly status: "off" }
  | { readonly status: "preparing"; readonly phase: "download" | "verify" | "load"; readonly loaded: number; readonly total: number }
  | { readonly status: "indexing"; readonly done: number; readonly total: number; readonly device: Device | null }
  | { readonly status: "paused"; readonly done: number; readonly total: number }
  | { readonly status: "ready"; readonly done: number; readonly total: number; readonly device: Device | null }
  | { readonly status: "failed"; readonly reason: SemanticFailure; readonly done: number; readonly total: number };

export function vectorBudgetBytes(env: MemoryEnv = runtimeMemoryEnv()): number {
  const device = (env.deviceMemoryGB && env.deviceMemoryGB > 0 ? env.deviceMemoryGB : 4) * 1024 ** 3;
  return Math.min(device * VECTOR_SHARE, VECTOR_CEILING_MB * 1024 ** 2);
}

const nextTick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export interface IndexerOptions {
  readonly factory: EmbedderFactory;
  /** Present only for a chat kept on this device. */
  readonly store: SemanticStore | null;
  readonly chatId: string | null;
  readonly spec?: ModelSpec;
  readonly onState?: (state: SemanticState) => void;
  readonly budgetBytes?: number;
}

export class SemanticIndexer {
  readonly spec: ModelSpec;
  readonly ids: Int32Array;
  index: VectorIndex;
  private readonly key: string;
  private readonly print: string;
  private store: SemanticStore | null;
  private embedder: Embedder | null = null;
  private loading: Promise<Embedder> | null = null;
  private running: Promise<void> | null = null;
  private pendingWrite: Promise<void> | null = null;
  private cancelled = false;
  private disposed = false;
  private readonly modelAbort = new AbortController();
  private stateValue: SemanticState = { status: "off" };
  /** Set when a commit failed: vectors stay in memory only for this visit. */
  persistFailed = false;

  constructor(readonly parsed: ParseResult, private readonly options: IndexerOptions) {
    this.spec = options.spec ?? E5_SMALL;
    this.ids = indexableIds(parsed);
    this.index = new VectorIndex(this.spec.dim);
    this.key = indexKey(this.spec);
    this.print = fingerprint(parsed);
    this.store = options.store && options.chatId ? options.store : null;
  }

  get state(): SemanticState { return this.stateValue; }
  get done(): number { return this.index.size; }
  get total(): number { return this.ids.length; }
  /** Fraction of indexable messages already searchable. */
  get coverage(): number { return this.total ? this.done / this.total : 1; }

  private set(state: SemanticState) {
    this.stateValue = state;
    if (!this.disposed) this.options.onState?.(state);
  }

  private manifest(complete: boolean): IndexManifest {
    return { schema: INDEX_SCHEMA, model: this.key, fingerprint: this.print, dim: this.spec.dim, planned: this.total, segments: this.index.sealed.length, vectors: this.index.size, complete };
  }

  /** Reads a stored index back, when one exists for exactly this chat and model. True if indexing had been enabled. */
  async restore(): Promise<boolean> {
    const store = this.store, id = this.options.chatId;
    if (!store || !id) return false;
    const m = await store.manifest(id).catch(() => null);
    if (!m) return false;
    const budget = this.options.budgetBytes ?? vectorBudgetBytes();
    if (this.total * (this.spec.dim + 8) > budget) {
      this.set({ status: "failed", reason: "too_large", done: 0, total: this.total });
      return true;
    }
    if (!compatible(m, { model: this.key, fingerprint: this.print, dim: this.spec.dim, planned: this.total })) {
      // Another model, schema or message sequence: never reused.
      await store.remove(id).catch(() => {});
      return true;
    }
    const count = m.complete ? m.segments + (m.vectors % SEGMENT_SIZE ? 1 : 0) : m.segments;
    let at = 0;
    for (let n = 0; n < count; n++) {
      const s = await store.readSegment(id, n, this.spec.dim);
      // Segments must continue the planned order exactly; anything else means a damaged index.
      if (!s || s.ids.some((v, i) => v !== this.ids[at + i])) { await store.remove(id).catch(() => {}); this.rebuild(); return true; }
      this.index.adopt(s);
      at += s.count;
    }
    this.set(at >= this.total ? { status: "ready", done: at, total: this.total, device: null } : { status: "paused", done: at, total: this.total });
    return true;
  }

  private rebuild() {
    this.index = new VectorIndex(this.spec.dim);
  }

  private async model(): Promise<Embedder> {
    if (this.disposed) throw new ModelError("failed", "The model was closed.");
    if (this.embedder) return this.embedder;
    this.loading ??= this.options.factory((p) => this.set({ status: "preparing", ...p }), this.modelAbort.signal).then(async (e) => {
      if (this.disposed) { await e.dispose(); throw new ModelError("failed", "The model was closed."); }
      return (this.embedder = e);
    }).finally(() => { this.loading = null; });
    return this.loading;
  }

  /** Starts or resumes indexing; resolves when it stops (finished, cancelled or failed). */
  start(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.running) return this.running;
    if (this.done >= this.total && this.total > 0) { this.set({ status: "ready", done: this.done, total: this.total, device: this.embedder?.device ?? null }); return Promise.resolve(); }
    const budget = this.options.budgetBytes ?? vectorBudgetBytes();
    if (this.total * (this.spec.dim + 8) > budget) {
      this.set({ status: "failed", reason: "too_large", done: this.done, total: this.total });
      return Promise.resolve();
    }
    this.cancelled = false;
    this.running = this.run().finally(() => { this.running = null; });
    return this.running;
  }

  cancel(): void {
    this.cancelled = true;
  }

  /** The saved copy was deleted: keep the vectors in memory, store nothing more. */
  async forget(): Promise<void> {
    this.store = null;
    // A commit already in flight must finish before its directory can be deleted.
    await this.pendingWrite?.catch(() => {});
  }

  private async run(): Promise<void> {
    try {
      const embedder = await this.model();
      let last = 0;
      this.set({ status: "indexing", done: this.done, total: this.total, device: embedder.device });
      const dim = this.spec.dim;
      const recent = new Map<string, Float32Array>();
      while (this.done < this.total) {
        if (this.cancelled || this.disposed) { this.set({ status: "paused", done: this.done, total: this.total }); return; }
        const window = this.ids.subarray(this.done, Math.min(this.total, this.done + WINDOW));
        const texts = [...window].map((i) => passage(this.spec, this.parsed.messages[i]!.text));
        const vectors = new Float32Array(window.length * dim);
        const distinct = [...new Set(texts)];
        // Reused texts become the most recent, so adding this window's new ones (at most WINDOW < REUSE) cannot evict them.
        for (const t of distinct) { const v = recent.get(t); if (v) { recent.delete(t); recent.set(t, v); } }
        const todo = distinct.filter((t) => !recent.has(t)).sort((a, b) => a.length - b.length || (a < b ? -1 : 1));
        for (let b = 0; b < todo.length; b += BATCH) {
          const batch = todo.slice(b, b + BATCH);
          const out = await embedder.embed(batch);
          if (this.disposed) return;
          batch.forEach((t, k) => {
            recent.delete(t);
            recent.set(t, out.slice(k * dim, (k + 1) * dim));
            if (recent.size > REUSE) recent.delete(recent.keys().next().value!);
          });
          // A cancelled window is dropped whole: at most one window of work is lost.
          if (this.cancelled) { this.set({ status: "paused", done: this.done, total: this.total }); return; }
          await nextTick();
        }
        texts.forEach((t, k) => vectors.set(recent.get(t)!, k * dim));
        const sealed = this.index.add(window, vectors);
        for (const s of sealed) await this.persist(this.index.sealed.indexOf(s), s, false);
        const now = Date.now();
        if (now - last > 250) { last = now; this.set({ status: "indexing", done: this.done, total: this.total, device: embedder.device }); }
        await nextTick();
      }
      await this.persist(this.index.sealed.length, this.index.tail(), true);
      this.set({ status: "ready", done: this.done, total: this.total, device: embedder.device });
    } catch (error) {
      const reason: SemanticFailure = error instanceof ModelError ? error.code : error instanceof RangeError ? "memory" : "failed";
      this.set({ status: "failed", reason, done: this.done, total: this.total });
    }
  }

  private async persist(n: number, segment: Parameters<SemanticStore["commit"]>[2], complete: boolean) {
    if (!this.store || !this.options.chatId || this.persistFailed) return;
    try {
      const write = this.store.commit(this.options.chatId, n, segment, this.manifest(complete));
      this.pendingWrite = write;
      try { await write; } finally { if (this.pendingWrite === write) this.pendingWrite = null; }
    } catch (error) {
      // Keep indexing in memory; this visit's vectors are simply not kept.
      this.persistFailed = true;
      if (!isQuota(error)) return;
    }
  }

  /** The query's vector; loads the model if a stored index was restored without it. */
  async queryVector(text: string): Promise<Float32Array> {
    return (await this.model()).embed([query(this.spec, text)]);
  }

  search(q: Float32Array, k: number, keep: (id: number) => boolean): Hit[] {
    return this.index.search(q, k, keep);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.cancelled = true;
    this.modelAbort.abort();
    // Terminate inference first: waiting for it before termination can make closing hang.
    const e = this.embedder;
    this.embedder = null;
    await e?.dispose().catch(() => {});
    await this.running?.catch(() => {});
    const loading = await this.loading?.catch(() => null);
    if (loading && loading !== e) await loading.dispose().catch(() => {});
  }
}
