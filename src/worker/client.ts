/* Promise API over the analysis worker, used by the UI.

   Cancellation terminates the worker outright: a parse in progress cannot be
   interrupted cooperatively without threading checks through every loop, and
   terminating also frees the chat's memory at once. The next request starts a
   fresh worker, which then has no chat loaded. A worker that crashes is
   treated the same way: it is discarded, pending requests fail with
   "worker_lost", and the UI has to load the chat again. */
import type { AnalysisFilters, ParseReport, Stats } from "@/model";
import type { LoadSummary, RequestId, Stage, WorkerErrorCode, WorkerRequest, WorkerResponse } from "./protocol";

/** Client-side failures that never come from the worker itself. */
export type ClientErrorCode = WorkerErrorCode | "cancelled" | "worker_lost";

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
  onProgress?: (stage: Stage) => void;
}

export class AnalysisClient {
  private worker: Worker | null = null;
  private nextId: RequestId = 1;
  private readonly pending = new Map<RequestId, Pending>();

  private ensureWorker(): Worker {
    if (!this.worker) {
      const worker = new Worker(new URL("./analysis.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.receive(event.data);
      const lost = () => {
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
    const entry = this.pending.get(response.id);
    if (!entry) return; // cancelled or unknown: ignore
    if (response.type === "progress") {
      entry.onProgress?.(response.stage);
      return;
    }
    this.pending.delete(response.id);
    if (response.type === "error") entry.reject(new WorkerRequestError(response.code, response.message, response.report ?? null));
    else entry.resolve(response);
  }

  private send(request: WorkerRequest, onProgress?: (stage: Stage) => void): Promise<WorkerResponse> {
    const worker = this.ensureWorker();
    return new Promise((resolve, reject) => {
      this.pending.set(request.id, onProgress ? { resolve, reject, onProgress } : { resolve, reject });
      worker.postMessage(request);
    });
  }

  private failAll(code: ClientErrorCode, message: string): void {
    for (const entry of this.pending.values()) entry.reject(new WorkerRequestError(code, message));
    this.pending.clear();
  }

  async load(file: File, onProgress?: (stage: Stage) => void): Promise<LoadSummary> {
    const response = await this.send({ type: "load", id: this.nextId++, file }, onProgress);
    if (response.type !== "loaded") throw new WorkerRequestError("internal", "Unexpected worker reply.");
    return response.summary;
  }

  async analyze(filters: AnalysisFilters, onProgress?: (stage: Stage) => void): Promise<Stats> {
    const response = await this.send({ type: "analyze", id: this.nextId++, filters }, onProgress);
    if (response.type !== "stats") throw new WorkerRequestError("internal", "Unexpected worker reply.");
    return response.stats;
  }

  async clear(): Promise<void> {
    if (!this.worker) return;
    await this.send({ type: "clear", id: this.nextId++ });
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
