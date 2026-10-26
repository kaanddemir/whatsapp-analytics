/* Promise API over the analysis worker, used by the UI.

   Cancellation terminates the worker outright: a parse in progress cannot be
   interrupted cooperatively without threading checks through every loop, and
   terminating also frees the chat's memory at once. The next request starts a
   fresh worker, which then has no chat loaded. A worker that crashes is
   treated the same way: it is discarded, pending requests fail with
   "worker_lost", and the UI has to load the chat again.

   A single question is stopped without that: aborting its signal fails it
   at once with "cancelled" and asks the worker to drop it (worker/handler.ts),
   keeping the chat and its indexes. */
import type { AnalysisFilters, ParseReport, Stats } from "@/model";
import type { SavedChat } from "@/store/chatStore";
import type { Evidence, MessageView } from "@/conversation/types";
import type { Answer } from "@/ask/types";
import type { Behaviour } from "@/behaviour/rules";
import type { SearchSort } from "@/search/keywordIndex";
import type { SearchPage, TimelinePage } from "@/conversation/results";
import type { LoadSummary, RequestId, Stage, WorkerErrorCode, WorkerRequest, WorkerResponse } from "./protocol";
import type { SemanticState } from "@/semantic/indexer";

/** Stage reports; `fraction` (0–1) when the stage can measure its progress. */
export type ProgressFn = (stage: Stage, fraction?: number) => void;
/** A request as the client builds it; the id is added when it is sent. */
type Body<R = WorkerRequest> = R extends WorkerRequest ? Omit<R, "id"> : never;

/** Client-side failures that never come from the worker itself. */
export type ClientErrorCode = WorkerErrorCode | "worker_lost";

export class WorkerRequestError extends Error {
  readonly code: ClientErrorCode;
  /** Why parsing found nothing (code "no_messages"); counts only, no content. */
  readonly report: ParseReport | null;

  constructor(code: ClientErrorCode, message: string, report: ParseReport | null = null) {
    super(message);
    this.name = "WorkerRequestError";
    this.code = code;
    this.report = report;
  }
}

interface Pending {
  resolve: (response: WorkerResponse) => void;
  reject: (error: WorkerRequestError) => void;
  onProgress?: ProgressFn;
}

export class AnalysisClient {
  private worker: Worker | null = null;
  private nextId: RequestId = 1;
  private readonly pending = new Map<RequestId, Pending>();
  private readonly semanticListeners = new Set<(state: SemanticState) => void>();

  private ensureWorker(): Worker {
    if (!this.worker) {
      const worker = new Worker(new URL("./analysis.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => { if (this.worker === worker) this.receive(event.data); };
      const lost = () => {
        if (this.worker !== worker) return;
        worker.terminate();
        if (this.worker === worker) this.worker = null;
        this.failAll("worker_lost", "The analysis stopped unexpectedly. Please load the chat again.");
      };
      worker.onerror = (event) => {
        event.preventDefault();
        lost();
      };
      worker.onmessageerror = lost;
      this.worker = worker;
    }
    return this.worker;
  }

  private receive(response: WorkerResponse): void {
    if (response.type === "semanticStatus" && response.id === 0) {
      for (const l of this.semanticListeners) l(response.state);
      return;
    }
    const entry = this.pending.get(response.id);
    if (!entry) return; // cancelled or unknown: ignore
    if (response.type === "progress") {
      entry.onProgress?.(response.stage, response.fraction);
      return;
    }
    this.pending.delete(response.id);
    if (response.type === "error") entry.reject(new WorkerRequestError(response.code, response.message, response.report ?? null));
    else entry.resolve(response);
  }

  private send(body: Body, onProgress?: ProgressFn, signal?: AbortSignal): Promise<WorkerResponse> {
    if (signal?.aborted) return Promise.reject(new WorkerRequestError("cancelled", "Cancelled."));
    const worker = this.ensureWorker();
    const request = { ...body, id: this.nextId++ } as WorkerRequest;
    return new Promise((resolve, reject) => {
      const stop = () => {
        if (!this.pending.delete(request.id)) return;
        reject(new WorkerRequestError("cancelled", "Cancelled."));
        if (this.worker === worker) worker.postMessage({ type: "cancel", id: this.nextId++, target: request.id } satisfies WorkerRequest);
      };
      const settle = <T,>(done: (value: T) => void) => (value: T) => { signal?.removeEventListener("abort", stop); done(value); };
      this.pending.set(request.id, { resolve: settle(resolve), reject: settle(reject), ...(onProgress ? { onProgress } : {}) });
      signal?.addEventListener("abort", stop, { once: true });
      try { worker.postMessage(request); }
      catch {
        worker.terminate();
        if (this.worker === worker) this.worker = null;
        this.failAll("worker_lost", "The analysis stopped unexpectedly. Please load the chat again.");
      }
    });
  }

  private failAll(code: ClientErrorCode, message: string): void {
    for (const entry of this.pending.values()) entry.reject(new WorkerRequestError(code, message));
    this.pending.clear();
  }

  /** Typed round trip: the reply must have the expected type. */
  async call<T extends WorkerResponse["type"]>(body: Body, expect: T, onProgress?: ProgressFn, signal?: AbortSignal): Promise<Extract<WorkerResponse, { type: T }>> {
    const response = await this.send(body, onProgress, signal);
    if (response.type !== expect) throw new WorkerRequestError("internal", "Unexpected worker reply.");
    return response as Extract<WorkerResponse, { type: T }>;
  }

  async load(file: File, onProgress?: ProgressFn, dateOrder?: "dmy" | "mdy", persist = false): Promise<LoadSummary> {
    this.cancel();
    return (await this.call({ type: "load", file, ...(dateOrder ? { dateOrder } : {}), ...(persist ? { persist } : {}) }, "loaded", onProgress)).summary;
  }

  async openSaved(chatId: string, onProgress?: ProgressFn, dateOrder?: "dmy" | "mdy"): Promise<LoadSummary> {
    this.cancel();
    return (await this.call({ type: "openSaved", chatId, ...(dateOrder ? { dateOrder } : {}) }, "loaded", onProgress)).summary;
  }

  async listSaved(): Promise<readonly SavedChat[]> {
    return (await this.call({ type: "listSaved" }, "savedList")).chats;
  }

  async deleteSaved(chatId: string): Promise<void> {
    await this.call({ type: "deleteSaved", chatId }, "deleted");
  }

  async search(query: string, filters: AnalysisFilters, sort: SearchSort, offset: number, limit: number, onProgress?: ProgressFn): Promise<SearchPage> {
    return (await this.call({ type: "search", query, filters, sort, offset, limit }, "searchResults", onProgress)).page;
  }

  async context(messageId: number, before = 3, after = 3): Promise<readonly MessageView[]> {
    return (await this.call({ type: "context", messageId, before, after }, "messages")).messages;
  }


  async behaviourEvidence(behaviour: Behaviour, sender: number | null, filters: AnalysisFilters, offset: number, limit: number): Promise<{ total: number; items: readonly Evidence[] }> {
    const r = await this.call({ type: "behaviourEvidence", behaviour, sender, filters, offset, limit }, "evidencePage");
    return { total: r.total, items: r.items };
  }

  async timeline(filters: AnalysisFilters, order: "newest" | "oldest", offset: number, limit: number, onProgress?: ProgressFn): Promise<TimelinePage> {
    return (await this.call({ type: "timeline", filters, order, offset, limit }, "timelinePage", onProgress)).page;
  }

  async dateEvidence(day: number, month: number, year: number | null, filters: AnalysisFilters, offset: number, limit: number): Promise<{ total: number; items: readonly Evidence[] }> {
    const r = await this.call({ type: "dateEvidence", day, month, year, filters, offset, limit }, "evidencePage");
    return { total: r.total, items: r.items };
  }

  /** `signal`: stops this question only; the chat stays loaded. */
  async ask(question: string, filters: AnalysisFilters, onProgress?: ProgressFn, locale: "en" | "tr" = "en", signal?: AbortSignal): Promise<Answer> {
    return (await this.call({ type: "ask", question, filters, locale }, "answer", onProgress, signal)).answer;
  }

  /** Search by meaning: start or resume ("enable"), pause, read its state, or remove its data ("forget"). */
  async semantic(action: "enable" | "pause" | "status" | "forget"): Promise<SemanticState> {
    return (await this.call({ type: "semantic", action }, "semanticStatus")).state;
  }

  /** Indexing progress and state changes; returns the unsubscribe function. */
  onSemantic(listener: (state: SemanticState) => void): () => void {
    this.semanticListeners.add(listener);
    return () => { this.semanticListeners.delete(listener); };
  }

  async analyze(filters: AnalysisFilters, onProgress?: ProgressFn): Promise<Stats> {
    const response = await this.send({ type: "analyze", filters }, onProgress);
    if (response.type !== "stats") throw new WorkerRequestError("internal", "Unexpected worker reply.");
    return response.stats;
  }

  async clear(): Promise<void> {
    // Closing must not wait behind a model query or a stalled read.
    this.cancel();
  }

  /** Abort everything in flight and drop the chat from memory. */
  cancel(): void {
    this.worker?.terminate();
    this.worker = null;
    this.failAll("cancelled", "Cancelled.");
  }

  dispose(): void {
    this.cancel();
  }
}
