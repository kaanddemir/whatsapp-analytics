import { afterEach, expect, it, vi } from "vitest";
import { workerEmbedderFactory } from "@/semantic/workerEmbedder";
import { SemanticIndexer } from "@/semantic/indexer";
import { AnalysisClient } from "@/worker/client";
import { parseExport } from "@/parser";

class WorkerDouble {
  static instances: WorkerDouble[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { preventDefault(): void }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  messages: { id: number; type: string }[] = [];
  terminated = false;
  constructor() { WorkerDouble.instances.push(this); }
  postMessage(message: { id: number; type: string }) { this.messages.push(message); }
  terminate() { this.terminated = true; }
  reply(data: unknown) { this.onmessage?.({ data }); }
}
afterEach(() => { vi.unstubAllGlobals(); WorkerDouble.instances = []; });

it("closing during model initialization terminates the worker and settles without waiting for model loading", async () => {
  vi.stubGlobal("Worker", WorkerDouble);
  const ix = new SemanticIndexer(parseExport("13/02/2024, 09:00 - Alice: hello private conversation"), { factory: workerEmbedderFactory("/app/"), store: null, chatId: null });
  const running = ix.start();
  await vi.waitFor(() => expect(WorkerDouble.instances).toHaveLength(1));
  await ix.dispose(); await running;
  expect(WorkerDouble.instances[0]!.terminated).toBe(true);
});

it("a model message-deserialization failure rejects current and future requests", async () => {
  vi.stubGlobal("Worker", WorkerDouble);
  const starting = workerEmbedderFactory("/app/")();
  const worker = WorkerDouble.instances[0]!;
  worker.reply({ type: "ready", id: 1, device: "wasm" });
  const embedder = await starting;
  const embedding = embedder.embed(["query: private message"]);
  worker.onmessageerror?.();
  await expect(embedding).rejects.toMatchObject({ code: "failed" });
  await expect(embedder.embed(["another"])).rejects.toMatchObject({ code: "failed" });
  expect(worker.terminated).toBe(true);
});

it("an old terminated analysis worker cannot fail requests in its replacement", async () => {
  vi.stubGlobal("Worker", WorkerDouble);
  const client = new AnalysisClient();
  const first = client.listSaved();
  const old = WorkerDouble.instances[0]!;
  client.cancel();
  await expect(first).rejects.toMatchObject({ code: "cancelled" });
  const second = client.listSaved();
  const current = WorkerDouble.instances[1]!;
  old.onerror?.({ preventDefault() {} });
  current.reply({ type: "savedList", id: current.messages[0]!.id, chats: [] });
  await expect(second).resolves.toEqual([]);
  client.dispose();
});

it("clears immediately even when a request has no reply", async () => {
  vi.stubGlobal("Worker", WorkerDouble);
  const client = new AnalysisClient();
  const pending = client.listSaved();
  await client.clear();
  await expect(pending).rejects.toMatchObject({ code: "cancelled" });
  expect(WorkerDouble.instances[0]!.terminated).toBe(true);
});

it("replacing a chat cannot wait behind a stalled old request", async () => {
  vi.stubGlobal("Worker", WorkerDouble);
  const client = new AnalysisClient();
  const oldRequest = client.listSaved();
  const replacing = client.load(new File(["chat"], "chat.txt"));
  await expect(oldRequest).rejects.toMatchObject({ code: "cancelled" });
  expect(WorkerDouble.instances[0]!.terminated).toBe(true);
  const next = WorkerDouble.instances[1]!;
  next.reply({ type: "error", id: next.messages[0]!.id, code: "no_messages", message: "No messages" });
  await expect(replacing).rejects.toMatchObject({ code: "no_messages" });
  client.dispose();
});
