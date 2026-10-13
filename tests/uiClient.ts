/* An in-process stand-in for AnalysisClient: the real worker handler (real
   parser and engine) without a Worker, so UI tests exercise the same request
   flow the browser does. File contents are looked up by name, because the
   test DOM's File cannot be read. Records every request for assertions. */
import type { AnalysisFilters, Stats } from "@/model";
import { parseExport } from "@/parser";
import { WorkerRequestError, type ClientErrorCode } from "@/worker/client";
import { createHandler } from "@/worker/handler";
import type { LoadSummary, Stage, WorkerRequest, WorkerResponse } from "@/worker/protocol";
import type { AnalysisPort } from "@/ui/App";

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
  private handle = this.makeHandler();
  private nextId = 1;

  private makeHandler() {
    return createHandler({
      read: async (file, stage) => {
        stage("reading");
        const text = this.files.get(file.name);
        if (text === undefined) throw new Error("unknown test file");
        if (this.hold) await new Promise<void>((r) => (this.release_ = r));
        stage("decoding");
        return { fileName: file.name, byteLength: text.length, encoding: "utf-8", hadBom: false, hadReplacementChars: false, text };
      },
      parse: (text) => {
        this.parses++;
        return parseExport(text);
      },
    });
  }

  release() {
    this.release_?.();
  }

  private async send(request: WorkerRequest, onProgress?: (stage: Stage) => void): Promise<WorkerResponse> {
    const out: WorkerResponse[] = [];
    await this.handle(request, (r) => {
      if (r.type === "progress") onProgress?.(r.stage);
      else out.push(r);
    });
    const last = out[out.length - 1]!;
    if (last.type === "error") throw new WorkerRequestError(last.code, last.message, last.report ?? null);
    return last;
  }

  async load(file: File, onProgress?: (stage: Stage) => void): Promise<LoadSummary> {
    const r = await this.send({ type: "load", id: this.nextId++, file }, onProgress);
    if (r.type !== "loaded") throw new Error("unexpected");
    return r.summary;
  }

  async analyze(filters: AnalysisFilters, onProgress?: (stage: Stage) => void): Promise<Stats> {
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

  cancel(): void {
    this.cancelled++;
    this.handle = this.makeHandler();
  }
}
