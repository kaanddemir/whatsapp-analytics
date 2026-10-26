import { crc32 } from "node:zlib";
/* Resource-aware import: the resource-aware import gate, archive reading without loading
   media, and chats kept on the device (atomic saves, interrupted saves,
   quota, reload parity). */
import { describe, expect, it } from "vitest";
import { estimateWorkingSetMB, importBudgetMB, MAX_TEXT_BYTES, textBudgetBytes } from "@/io/limits";
import { readExport, readWithProgress, validateFileMeta } from "@/io/readExport";
import { extractChatFromBlob } from "@/io/zip";
import { MemoryChatStore, OpfsChatStore, StoreError } from "@/store/chatStore";
import { createHandler } from "@/worker/handler";
import type { WorkerRequest, WorkerResponse } from "@/worker/protocol";
import { analyze } from "@/analytics";
import { parseExport } from "@/parser";
import { NO_FILTERS } from "@/model";
import { FakeFs } from "../support/fakeOpfs";
import { android, lines } from "../support/export";

const CHAT = lines(
  android("01/02/24", "09:00", "Alice", "merhaba 👋 yarın buluşalım mı?"),
  android("01/02/24", "09:01", "Bob", "olur, saat 19:30"),
  android("02/02/24", "10:00", "Alice", "<Media omitted>"),
);

async function run(handle: ReturnType<typeof createHandler>, request: WorkerRequest) {
  const out: WorkerResponse[] = [];
  await handle(request, (r) => out.push(r));
  return out;
}

describe("import budget", () => {
  it("scales with device memory and the JS heap limit", () => {
    expect(importBudgetMB({ deviceMemoryGB: 8 })).toBeCloseTo(8 * 1024 * 0.4);
    expect(importBudgetMB({})).toBeCloseTo(4 * 1024 * 0.4); // unknown device: 4 GB assumed
    expect(importBudgetMB({ deviceMemoryGB: 8, heapLimitMB: 2048 })).toBeCloseTo(1536);
  });

  it("admits a 113 MB chat (2M messages, measured synthetic export) on an 8 GB device, and refuses it on a 2 GB one", () => {
    const bytes = 113 * 1024 * 1024;
    expect(estimateWorkingSetMB(bytes)).toBeLessThan(importBudgetMB({ deviceMemoryGB: 8 }));
    expect(textBudgetBytes({ deviceMemoryGB: 8 })).toBeGreaterThan(bytes);
    expect(textBudgetBytes({ deviceMemoryGB: 2 })).toBeLessThan(bytes);
  });

  it("never exceeds the absolute string ceiling", () => {
    expect(textBudgetBytes({ deviceMemoryGB: 64 })).toBe(MAX_TEXT_BYTES);
  });

  it("refuses a text file over the budget before reading it, with a device-specific message", () => {
    expect(() => validateFileMeta({ name: "chat.txt", size: 2_000_001 }, 2_000_000)).toThrowError(expect.objectContaining({ code: "too_large" }));
    expect(() => validateFileMeta({ name: "chat.txt", size: 2_000_000 }, 2_000_000)).not.toThrow();
    // A zip's own size does not count against the text budget: its media is never read.
    expect(() => validateFileMeta({ name: "export.zip", size: 900_000_000 }, 2_000_000)).not.toThrow();
  });

  it("rejects truncated reads instead of silently analysing a partial byte stream", async () => {
    const input = { size: 10, stream: () => new Blob(["short"]).stream() } as Blob;
    await expect(readWithProgress(input)).rejects.toMatchObject({ code: "not_text" });
  });

  it("reports read progress as fractions ending at 1", async () => {
    const big = CHAT.repeat(2000);
    const fractions: number[] = [];
    const decoded = await readExport(new File([big], "chat.txt"), (stage, f) => stage === "reading" && f !== undefined && fractions.push(f), 10_000_000);
    expect(decoded.text).toBe(big);
    expect(fractions[0]).toBe(0);
    expect(fractions.at(-1)).toBe(1);
    expect(fractions.every((f, i) => i === 0 || f >= fractions[i - 1]!)).toBe(true);
  });
});

/** Stored (method 0) zip with the chat and a large "media" entry. */
function zipStored(entries: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint32(14, crc32(e.data), true);
    local.setUint32(18, e.data.length, true);
    local.setUint32(22, e.data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, e.data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint32(16, crc32(e.data), true);
    c.setUint32(20, e.data.length, true);
    c.setUint32(24, e.data.length, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), name);
    offset += 30 + name.length + e.data.length;
  }
  const size = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) { out.set(p, at); at += p.length; }
  return out;
}

describe("archives", () => {
  it("reads only the directory and the chat entry, never the media", async () => {
    const media = new Uint8Array(3_000_000).fill(7);
    const bytes = zipStored([{ name: "IMG-0001.jpg", data: media }, { name: "_chat.txt", data: new TextEncoder().encode(CHAT) }]);
    const blob = new Blob([bytes]);
    let read = 0;
    const spy = {
      size: blob.size,
      slice: (a?: number, b?: number) => { const s = blob.slice(a, b); read += s.size; return s; },
    } as unknown as Blob;
    const chat = await extractChatFromBlob(spy, 1_000_000);
    expect(new TextDecoder().decode(chat.bytes)).toBe(CHAT);
    expect(read).toBeLessThan(media.length / 20);
  });

  it("refuses a chat entry larger than the budget from the directory alone", async () => {
    const bytes = zipStored([{ name: "_chat.txt", data: new TextEncoder().encode(CHAT) }]);
    await expect(extractChatFromBlob(new Blob([bytes]), 10)).rejects.toMatchObject({ code: "too_large" });
  });
});

const META = { fileName: "chat.txt", archiveEntry: null, messageCount: 3, firstMessageAt: "2024-02-01T09:00:00", lastMessageAt: "2024-02-02T10:00:00", dateOrder: null };

describe("OPFS chat store", () => {
  it("saves, lists, reads back the exact text, and deletes", async () => {
    const fs = new FakeFs();
    const store = new OpfsChatStore(fs.handle);
    const saved = await store.save(CHAT, META);
    expect(saved.storedBytes).toBeGreaterThan(0);
    expect((await store.list()).map((c) => c.id)).toEqual([saved.id]);
    expect((await store.read(saved.id)).text).toBe(CHAT);
    await store.remove(saved.id);
    expect(await store.list()).toEqual([]);
    expect(fs.used()).toBe(0);
  });

  it("an interrupted save (killed before the manifest) is never listed and is cleaned up", async () => {
    const fs = new FakeFs();
    const store = new OpfsChatStore(fs.handle);
    const kept = await store.save(CHAT, META);
    fs.failAfterWrites = fs.closes + 1; // the data file lands, the manifest write dies
    await expect(store.save(CHAT, META)).rejects.toBeInstanceOf(StoreError);
    // A crash can also leave a folder behind without running the catch: simulate it.
    const chats = await fs.root.getDirectoryHandle("chats");
    const orphan = await chats.getDirectoryHandle("orphan", { create: true });
    await (await (await orphan.getFileHandle("chat.txt.gz", { create: true })).createWritable()).close().catch(() => {});
    fs.failAfterWrites = null;
    expect((await store.list()).map((c) => c.id)).toEqual([kept.id]);
    await store.cleanup();
    expect([...chats.entries.keys()]).toEqual([kept.id]);
    expect((await store.read(kept.id)).text).toBe(CHAT);
  });

  it("a full disk fails with storage_full and leaves nothing behind", async () => {
    const fs = new FakeFs(50);
    const store = new OpfsChatStore(fs.handle);
    await expect(store.save(CHAT, META)).rejects.toMatchObject({ code: "storage_full" });
    expect(fs.used()).toBe(0);
    expect(await store.list()).toEqual([]);
  });

  it("reports storage_unavailable when the browser has no OPFS", async () => {
    const store = new OpfsChatStore(async () => { throw new Error("no OPFS"); });
    await expect(store.list()).rejects.toMatchObject({ code: "storage_unavailable" });
  });
});

describe("handler: keep on device", () => {
  it("a saved chat reopens with identical messages and statistics", async () => {
    const store = new MemoryChatStore();
    const handle = createHandler({ store });
    const first = await run(handle, { type: "load", id: 1, file: new File([CHAT], "chat.txt"), persist: true });
    const loaded = first.at(-1)!;
    expect(loaded.type).toBe("loaded");
    const saved = loaded.type === "loaded" ? loaded.summary.saved : null;
    expect(saved?.messageCount).toBe(3);
    const statsA = await run(handle, { type: "analyze", id: 2, filters: NO_FILTERS });

    // A new worker (a reload) with the same device storage.
    const reloaded = createHandler({ store });
    const list = await run(reloaded, { type: "listSaved", id: 3 });
    expect(list.at(-1)).toMatchObject({ type: "savedList", chats: [expect.objectContaining({ id: saved!.id })] });
    const reopened = await run(reloaded, { type: "openSaved", id: 4, chatId: saved!.id });
    expect(reopened.at(-1)).toMatchObject({ type: "loaded", summary: { saved: { id: saved!.id }, report: { messages: 3 } } });
    const statsB = await run(reloaded, { type: "analyze", id: 5, filters: NO_FILTERS });
    expect(statsB.at(-1)).toEqual({ ...statsA.at(-1), id: 5 });
    expect(statsB.at(-1)).toEqual({ type: "stats", id: 5, stats: analyze(parseExport(CHAT), NO_FILTERS) });
  });

  it("a failed save keeps the chat open and says why", async () => {
    const handle = createHandler({ store: new MemoryChatStore(10) });
    const out = await run(handle, { type: "load", id: 1, file: new File([CHAT], "chat.txt"), persist: true });
    expect(out.at(-1)).toMatchObject({ type: "loaded", summary: { saved: null, saveError: "storage_full" } });
    expect((await run(handle, { type: "analyze", id: 2, filters: NO_FILTERS })).at(-1)?.type).toBe("stats");
  });

  it("nothing is stored unless asked", async () => {
    const store = new MemoryChatStore();
    await run(createHandler({ store }), { type: "load", id: 1, file: new File([CHAT], "chat.txt") });
    expect(await store.list()).toEqual([]);
  });

  it("an allocation failure becomes out_of_memory and drops the chat", async () => {
    const handle = createHandler({ parse: () => { throw new RangeError("Invalid string length"); } });
    const out = await run(handle, { type: "load", id: 1, file: new File([CHAT], "chat.txt") });
    expect(out.at(-1)).toMatchObject({ type: "error", code: "out_of_memory" });
    expect((await run(handle, { type: "analyze", id: 2, filters: NO_FILTERS })).at(-1)).toMatchObject({ code: "no_chat_loaded" });
  });

  it("deleting a saved chat removes it; opening it afterwards fails cleanly", async () => {
    const store = new MemoryChatStore();
    const handle = createHandler({ store });
    const out = await run(handle, { type: "load", id: 1, file: new File([CHAT], "chat.txt"), persist: true });
    const id = out.at(-1)!.type === "loaded" ? (out.at(-1) as Extract<WorkerResponse, { type: "loaded" }>).summary.saved!.id : "";
    expect((await run(handle, { type: "deleteSaved", id: 2, chatId: id })).at(-1)?.type).toBe("deleted");
    expect((await run(handle, { type: "openSaved", id: 3, chatId: id })).at(-1)).toMatchObject({ type: "error", code: "not_found" });
  });
});
