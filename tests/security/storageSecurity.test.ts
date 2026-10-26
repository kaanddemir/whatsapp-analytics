import { describe, expect, it, vi } from "vitest";
import { OpfsSemanticStore, MemorySemanticStore } from "@/semantic/store";
import { SemanticIndexer } from "@/semantic/indexer";
import { OpfsChatStore } from "@/store/chatStore";
import { createHandler } from "@/worker/handler";
import type { WorkerRequest, WorkerResponse } from "@/worker/protocol";
import { NO_FILTERS } from "@/model";
import { parseExport } from "@/parser";
import { FakeFs } from "../support/fakeOpfs";
import { fakeModel } from "../support/fakeEmbedder";
import { android, lines } from "../support/export";

const CHAT = lines(android("13/02/24", "09:00", "Alice", "A private synthetic message about coffee"));
const META = { fileName: "chat.txt", archiveEntry: null, messageCount: 1, firstMessageAt: "2024-02-13T09:00:00", lastMessageAt: "2024-02-13T09:00:00", dateOrder: null };
async function run(handle: ReturnType<typeof createHandler>, request: WorkerRequest) {
  const out: WorkerResponse[] = [];
  await handle(request, (r) => out.push(r));
  return out;
}

describe("stored data deletion and corruption", () => {
  it("forgets model files even if no semantic index directory exists", async () => {
    const fs = new FakeFs();
    await fs.root.getDirectoryHandle("semantic-models", { create: true });
    await new OpfsSemanticStore(fs.handle).removeAll();
    expect(fs.root.entries.has("semantic-models")).toBe(false);
  });

  it("attempts both deletions and reports real storage errors", async () => {
    const fs = new FakeFs();
    await fs.root.getDirectoryHandle("semantic-models", { create: true });
    const original = fs.root.removeEntry.bind(fs.root);
    vi.spyOn(fs.root, "removeEntry").mockImplementation(async (name, options) => {
      if (name === "semantic") throw new DOMException("permission denied", "NotAllowedError");
      return original(name, options);
    });
    await expect(new OpfsSemanticStore(fs.handle).removeAll()).rejects.toMatchObject({ name: "NotAllowedError" });
    expect(fs.root.entries.has("semantic-models")).toBe(false);
  });

  it("waits for an in-flight index commit before detaching persistence", async () => {
    const store = new MemorySemanticStore();
    let entered!: () => void, release!: () => void;
    const committing = new Promise<void>((r) => { entered = r; });
    const gate = new Promise<void>((r) => { release = r; });
    const commit = store.commit.bind(store);
    vi.spyOn(store, "commit").mockImplementation(async (...args) => { entered(); await gate; return commit(...args); });
    const ix = new SemanticIndexer(parseExport(CHAT), { factory: fakeModel().factory, store, chatId: "chat-1" });
    const indexing = ix.start();
    await committing;
    let detached = false;
    const detaching = ix.forget().then(() => { detached = true; });
    await Promise.resolve();
    expect(detached).toBe(false);
    release(); await detaching;
    await store.remove("chat-1"); await indexing;
    expect(await store.manifest("chat-1")).toBeNull();
    await ix.dispose();
  });

  it("checks the vector budget before restoring a previously saved index", async () => {
    const parsed = parseExport(CHAT), store = new MemorySemanticStore();
    const first = new SemanticIndexer(parsed, { factory: fakeModel().factory, store, chatId: "chat-1" });
    await first.start(); await first.dispose();
    const read = vi.spyOn(store, "readSegment");
    const model = fakeModel();
    const constrained = new SemanticIndexer(parsed, { factory: model.factory, store, chatId: "chat-1", budgetBytes: 1 });
    expect(await constrained.restore()).toBe(true);
    expect(constrained.state).toMatchObject({ status: "failed", reason: "too_large" });
    expect(read).not.toHaveBeenCalled();
    expect(model.loads).toBe(0);
    await constrained.dispose();
  });

  it("rejects corrupted or oversized saved manifests without decompressing", async () => {
    const fs = new FakeFs(), store = new OpfsChatStore(fs.handle);
    const saved = await store.save(CHAT, META);
    const dir = await (await fs.root.getDirectoryHandle("chats")).getDirectoryHandle(saved.id);
    const handle = await dir.getFileHandle("manifest.json");
    for (const patch of [{ fileName: "x".repeat(65536) }, { savedAt: null }, { id: "another-chat" }, { textBytes: 1 }, { textBytes: 2 ** 40 }]) {
      const writable = await handle.createWritable();
      await writable.write(new TextEncoder().encode(JSON.stringify({ ...saved, ...patch }))); await writable.close();
      await expect(store.read(saved.id)).rejects.toMatchObject({ code: expect.stringMatching(/storage_failed|not_found/) });
    }
  });
});

describe("worker request isolation", () => {
  it("rejects malformed and abandoned requests without hanging or quoting payloads", async () => {
    const handle = createHandler();
    for (const request of [null, {}, { id: 9, type: "generate", question: "SECRET" }, { id: 8, type: "context", messageId: 0, before: Infinity, after: -1 }]) {
      const out = await run(handle, request as WorkerRequest);
      expect(out).toHaveLength(1);
      expect(out[0]?.type).toBe("error");
      expect(JSON.stringify(out)).not.toContain("SECRET");
    }
  });

  it("clears after a pending import rather than letting that import resurrect the chat", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const handle = createHandler({ read: async () => {
      await gate;
      return { text: CHAT, fileName: "chat.txt", byteLength: CHAT.length, encoding: "utf-8", hadBom: false, hadReplacementChars: false };
    } });
    const loading = run(handle, { id: 1, type: "load", file: new File([CHAT], "chat.txt") });
    const clearing = run(handle, { id: 2, type: "clear" });
    release(); await loading; await clearing;
    expect((await run(handle, { id: 3, type: "analyze", filters: NO_FILTERS })).at(-1)).toMatchObject({ code: "no_chat_loaded" });
  });
});
