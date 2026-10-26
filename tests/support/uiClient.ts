/* An in-process stand-in for AnalysisClient: the real worker handler (real
   parser and engine) without a Worker, so UI tests exercise the same request
   flow the browser does. File contents are looked up by name, because the
   test DOM's File cannot be read. Records every request for assertions.
   Ask requests can be held or failed to drive the conversation's states. */
import type { AnalysisFilters, Stats } from "@/model";
import type { Answer } from "@/ask/types";
import type { Behaviour } from "@/behaviour/rules";
import type { Evidence, MessageView } from "@/conversation/types";
import type { SearchPage, TimelinePage } from "@/conversation/results";
import type { SearchSort } from "@/search/keywordIndex";
import type { EmbedderFactory } from "@/semantic/embedder";
import type { SemanticState } from "@/semantic/indexer";
import { parseExport } from "@/parser";
import { WorkerRequestError, type ClientErrorCode } from "@/worker/client";
import { createHandler } from "@/worker/handler";
import type { LoadSummary, WorkerRequest, WorkerResponse } from "@/worker/protocol";
import type { ProgressFn } from "@/worker/client";
import { MemoryChatStore, type SavedChat } from "@/store/chatStore";
import type { AnalysisPort } from "@/ui/App";

/** The test DOM’s File has no text(); FileReader works. */
const readText = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error);
  reader.readAsText(file);
});

export class FakeClient implements AnalysisPort {
  readonly files = new Map<string, string>();
  readonly analyses: AnalysisFilters[] = [];
  parses = 0;
  cleared = 0;
  cancelled = 0;
  /** Makes the next analyze fail with this code. */
  failNext: ClientErrorCode | null = null;
  /** Holds load requests until release() is called. */
  hold = false;
  private release_: (() => void) | null = null;
  /** Every question asked, with its scope and language. */
  readonly asks: { question: string; filters: AnalysisFilters; locale: "en" | "tr" }[] = [];
  /** Makes the next ask fail with this code. */
  failNextAsk: ClientErrorCode | null = null;
  /** Holds ask requests until releaseAsk() is called. */
  holdAsk = false;
  private releaseAsk_: (() => void) | null = null;
  private readonly semanticListeners = new Set<(state: SemanticState) => void>();

  /** `embedder`: the model behind search by meaning; the tests' fake, so nothing is downloaded. */
  constructor(private readonly embedder?: EmbedderFactory) {}
  /** Chats "kept on this device": shared by every handler, as OPFS outlives a worker. */
  readonly store = new MemoryChatStore();
  private handle: ReturnType<FakeClient["makeHandler"]> | null = null;
  private get handler() { return (this.handle ??= this.makeHandler()); }
  private nextId = 1;

  private makeHandler() {
    return createHandler({
      read: async (file, stage) => {
        stage("reading");
        // Test files are looked up by name; a file built in memory (the demo) is read as it is.
        const text = this.files.get(file.name) ?? (file.size ? await readText(file) : undefined);
        if (text === undefined) throw new Error("unknown test file");
        if (this.hold) await new Promise<void>((r) => (this.release_ = r));
        stage("decoding");
        return { fileName: file.name, byteLength: text.length, encoding: "utf-8", hadBom: false, hadReplacementChars: false, text };
      },
      parse: (text, options) => {
        this.parses++;
        return parseExport(text, options);
      },
      store: this.store,
      semanticStore: null,
      ...(this.embedder ? { embedder: this.embedder } : {}),
      notify: (r) => { if (r.type === "semanticStatus") for (const l of this.semanticListeners) l(r.state); },
    });
  }

  release() {
    this.release_?.();
  }

  releaseAsk() {
    this.releaseAsk_?.();
  }

  private async send(request: WorkerRequest, onProgress?: ProgressFn): Promise<WorkerResponse> {
    const out: WorkerResponse[] = [];
    await this.handler(request, (r) => {
      if (r.type === "progress") onProgress?.(r.stage, r.fraction);
      else out.push(r);
    });
    const last = out[out.length - 1]!;
    if (last.type === "error") throw new WorkerRequestError(last.code, last.message, last.report ?? null);
    return last;
  }

  async load(file: File, onProgress?: ProgressFn, dateOrder?: "dmy" | "mdy", persist = false): Promise<LoadSummary> {
    const r = await this.send({ type: "load", id: this.nextId++, file, ...(dateOrder ? { dateOrder } : {}), ...(persist ? { persist } : {}) }, onProgress);
    if (r.type !== "loaded") throw new Error("unexpected");
    return r.summary;
  }

  async openSaved(chatId: string, onProgress?: ProgressFn, dateOrder?: "dmy" | "mdy"): Promise<LoadSummary> {
    const r = await this.send({ type: "openSaved", id: this.nextId++, chatId, ...(dateOrder ? { dateOrder } : {}) }, onProgress);
    if (r.type !== "loaded") throw new Error("unexpected");
    return r.summary;
  }

  async listSaved(): Promise<readonly SavedChat[]> {
    const r = await this.send({ type: "listSaved", id: this.nextId++ });
    if (r.type !== "savedList") throw new Error("unexpected");
    return r.chats;
  }

  async deleteSaved(chatId: string): Promise<void> {
    await this.send({ type: "deleteSaved", id: this.nextId++, chatId });
  }

  async analyze(filters: AnalysisFilters, onProgress?: ProgressFn): Promise<Stats> {
    this.analyses.push(filters);
    if (this.failNext) {
      const code = this.failNext;
      this.failNext = null;
      if (code === "worker_lost") this.handle = this.makeHandler(); // the chat dies with the worker
      throw new WorkerRequestError(code, "failed");
    }
    const r = await this.send({ type: "analyze", id: this.nextId++, filters }, onProgress);
    if (r.type !== "stats") throw new Error("unexpected");
    return r.stats;
  }

  async clear(): Promise<void> {
    this.cleared++;
    await this.send({ type: "clear", id: this.nextId++ });
  }

  /** As AnalysisClient.ask: aborting fails it at once and sends the worker handler a real "cancel". */
  async ask(question: string, filters: AnalysisFilters, onProgress?: ProgressFn, locale: "en" | "tr" = "en", signal?: AbortSignal): Promise<Answer> {
    this.asks.push({ question, filters, locale });
    const cancelled = () => new WorkerRequestError("cancelled", "Cancelled.");
    if (this.holdAsk) await new Promise<void>((r) => { this.releaseAsk_ = r; signal?.addEventListener("abort", () => r(), { once: true }); });
    if (signal?.aborted) throw cancelled();
    if (this.failNextAsk) {
      const code = this.failNextAsk;
      this.failNextAsk = null;
      if (code === "worker_lost") this.handle = this.makeHandler();
      throw new WorkerRequestError(code, "failed");
    }
    const id = this.nextId++;
    const reply = this.send({ type: "ask", id, question, filters, locale }, onProgress);
    return new Promise<Answer>((resolve, reject) => {
      const stop = () => {
        reject(cancelled());
        void this.handler({ type: "cancel", id: this.nextId++, target: id }, () => {});
      };
      signal?.addEventListener("abort", stop, { once: true });
      reply.then((r) => (r.type === "answer" ? resolve(r.answer) : reject(new Error("unexpected"))), reject)
        .finally(() => signal?.removeEventListener("abort", stop));
    });
  }

  async context(messageId: number, before = 3, after = 3): Promise<readonly MessageView[]> {
    const r = await this.send({ type: "context", id: this.nextId++, messageId, before, after });
    if (r.type !== "messages") throw new Error("unexpected");
    return r.messages;
  }

  async search(query: string, filters: AnalysisFilters, sort: SearchSort, offset: number, limit: number): Promise<SearchPage> {
    const r = await this.send({ type: "search", id: this.nextId++, query, filters, sort, offset, limit });
    if (r.type !== "searchResults") throw new Error("unexpected");
    return r.page;
  }

  async behaviourEvidence(behaviour: Behaviour, sender: number | null, filters: AnalysisFilters, offset: number, limit: number): Promise<{ total: number; items: readonly Evidence[] }> {
    const r = await this.send({ type: "behaviourEvidence", id: this.nextId++, behaviour, sender, filters, offset, limit });
    if (r.type !== "evidencePage") throw new Error("unexpected");
    return { total: r.total, items: r.items };
  }

  async dateEvidence(day: number, month: number, year: number | null, filters: AnalysisFilters, offset: number, limit: number): Promise<{ total: number; items: readonly Evidence[] }> {
    const r = await this.send({ type: "dateEvidence", id: this.nextId++, day, month, year, filters, offset, limit });
    if (r.type !== "evidencePage") throw new Error("unexpected");
    return { total: r.total, items: r.items };
  }

  async timeline(filters: AnalysisFilters, order: "newest" | "oldest", offset: number, limit: number): Promise<TimelinePage> {
    const r = await this.send({ type: "timeline", id: this.nextId++, filters, order, offset, limit });
    if (r.type !== "timelinePage") throw new Error("unexpected");
    return r.page;
  }

  async semantic(action: "enable" | "pause" | "status" | "forget"): Promise<SemanticState> {
    const r = await this.send({ type: "semantic", id: this.nextId++, action });
    if (r.type !== "semanticStatus") throw new Error("unexpected");
    return r.state;
  }

  onSemantic(listener: (state: SemanticState) => void): () => void {
    this.semanticListeners.add(listener);
    return () => { this.semanticListeners.delete(listener); };
  }

  cancel(): void {
    this.cancelled++;
    this.handle = this.makeHandler();
  }
}
