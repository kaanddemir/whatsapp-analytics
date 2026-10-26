import { textBudgetBytes } from "@/io/limits";
/* Chats kept on this device, at the user's request only.

   What is stored: the decoded chat text, gzip-compressed, plus a small
   manifest (file name, sizes, date order, when it was saved). Nothing derived
   is stored. Opening a saved chat re-runs the same parser on the same text, so
   statistics, search results and message numbers are identical to the first
   import, and a parser fix applies to saved chats too.

   Layout, in the Origin Private File System (private to this site, never
   uploaded): chats/<id>/chat.txt.gz and chats/<id>/manifest.json. The
   manifest is written last, so a save interrupted by a closed tab, a crash or
   a full disk leaves a folder without a manifest; `cleanup` deletes those, and
   `list` never shows them. Delete removes the folder. */

export interface SavedChat {
  readonly id: string;
  readonly fileName: string;
  /** Archive entry the text came from, for a .zip. */
  readonly archiveEntry: string | null;
  /** Uncompressed chat text in bytes (UTF-8). */
  readonly textBytes: number;
  /** Bytes used on disk. */
  readonly storedBytes: number;
  readonly messageCount: number;
  readonly firstMessageAt: string;
  readonly lastMessageAt: string;
  readonly dateOrder: "dmy" | "mdy" | null;
  /** ISO time of the save. */
  readonly savedAt: string;
  readonly version: 1;
}

export type StoreErrorCode = "storage_unavailable" | "storage_full" | "storage_failed" | "not_found";

export class StoreError extends Error {
  readonly code: StoreErrorCode;
  constructor(code: StoreErrorCode, message: string) {
    super(message);
    this.name = "StoreError";
    this.code = code;
  }
}

export interface ChatStore {
  list(): Promise<SavedChat[]>;
  /** Save `text`; resolves with the stored record. Throws StoreError("storage_full") when the quota runs out. */
  save(text: string, meta: Omit<SavedChat, "id" | "storedBytes" | "savedAt" | "version" | "textBytes">): Promise<SavedChat>;
  read(id: string): Promise<{ chat: SavedChat; text: string }>;
  remove(id: string): Promise<void>;
  /** Delete interrupted saves. */
  cleanup(): Promise<void>;
}

const isQuota = (e: unknown) => e instanceof DOMException && (e.name === "QuotaExceededError" || e.code === 22);

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function gunzip(data: Blob, expectedBytes: number): Promise<string> {
  const reader = data.stream().pipeThrough(new DecompressionStream("gzip")).getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const parts: string[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > expectedBytes) throw new Error("saved text exceeds manifest");
      parts.push(decoder.decode(value, { stream: true }));
    }
    if (bytes !== expectedBytes) throw new Error("saved text is truncated");
    parts.push(decoder.decode());
    return parts.join("");
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
}

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

function validManifest(value: unknown): value is SavedChat {
  const m = value as SavedChat | null;
  const count = (n: unknown) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
  const timestamp = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v));
  return !!m && m.version === 1 && typeof m.id === "string" && /^[a-z0-9]+-[a-z0-9]+$/.test(m.id)
    && typeof m.fileName === "string" && (m.archiveEntry === null || typeof m.archiveEntry === "string")
    && count(m.messageCount) && count(m.textBytes) && count(m.storedBytes)
    && timestamp(m.savedAt) && timestamp(m.firstMessageAt) && timestamp(m.lastMessageAt)
    && (m.dateOrder === null || m.dateOrder === "dmy" || m.dateOrder === "mdy");
}

/** OPFS-backed store. `root` is injectable for tests. */
export class OpfsChatStore implements ChatStore {
  constructor(private readonly root: () => Promise<FileSystemDirectoryHandle> = defaultRoot) {}

  private async chats(): Promise<FileSystemDirectoryHandle> {
    try {
      return await (await this.root()).getDirectoryHandle("chats", { create: true });
    } catch {
      throw new StoreError("storage_unavailable", "This browser cannot keep chats on the device.");
    }
  }

  async list(): Promise<SavedChat[]> {
    const dir = await this.chats();
    const out: SavedChat[] = [];
    for await (const [name, handle] of dir as unknown as AsyncIterable<[string, FileSystemHandle]>) {
      if (handle.kind !== "directory") continue;
      const manifest = await readManifest(handle as FileSystemDirectoryHandle);
      if (manifest && manifest.id === name) out.push(manifest);
    }
    return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }

  async save(text: string, meta: Parameters<ChatStore["save"]>[1]): Promise<SavedChat> {
    const dir = await this.chats();
    const id = newId();
    const folder = await dir.getDirectoryHandle(id, { create: true });
    try {
      const data = await gzip(text);
      // Refuse up front when the quota visibly cannot hold it; a write can still hit the quota.
      const estimate = await navigator.storage?.estimate?.().catch(() => null);
      if (estimate?.quota !== undefined && estimate.usage !== undefined && estimate.quota - estimate.usage < data.byteLength * 1.1 + 64 * 1024) {
        throw new DOMException("quota", "QuotaExceededError");
      }
      await writeFile(folder, "chat.txt.gz", data);
      const chat: SavedChat = { ...meta, id, textBytes: new TextEncoder().encode(text).byteLength, storedBytes: data.byteLength, savedAt: new Date().toISOString(), version: 1 };
      // Written last: its presence marks the save as complete.
      await writeFile(folder, "manifest.json", new TextEncoder().encode(JSON.stringify(chat)));
      return chat;
    } catch (error) {
      await dir.removeEntry(id, { recursive: true }).catch(() => {});
      if (isQuota(error)) throw new StoreError("storage_full", "There is not enough storage space on this device to keep the chat.");
      throw new StoreError("storage_failed", "The chat could not be saved on this device.");
    }
  }

  async read(id: string): Promise<{ chat: SavedChat; text: string }> {
    const dir = await this.chats();
    let folder: FileSystemDirectoryHandle;
    try {
      folder = await dir.getDirectoryHandle(id);
    } catch {
      throw new StoreError("not_found", "This saved chat no longer exists.");
    }
    const chat = await readManifest(folder);
    if (!chat || chat.id !== id) throw new StoreError("not_found", "This saved chat is incomplete.");
    try {
      if (chat.textBytes > textBudgetBytes() || chat.storedBytes > textBudgetBytes()) throw new Error("saved chat exceeds device budget");
      const file = await (await folder.getFileHandle("chat.txt.gz")).getFile();
      if (file.size !== chat.storedBytes) throw new Error("saved file size mismatch");
      return { chat, text: await gunzip(file, chat.textBytes) };
    } catch {
      throw new StoreError("storage_failed", "This saved chat could not be read.");
    }
  }

  async remove(id: string): Promise<void> {
    const dir = await this.chats();
    try {
      await dir.removeEntry(id, { recursive: true });
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") return;
      throw new StoreError("storage_failed", "The saved chat could not be deleted.");
    }
  }

  async cleanup(): Promise<void> {
    const dir = await this.chats();
    const stale: string[] = [];
    for await (const [name, handle] of dir as unknown as AsyncIterable<[string, FileSystemHandle]>) {
      if (handle.kind !== "directory" || !(await readManifest(handle as FileSystemDirectoryHandle))) stale.push(name);
    }
    for (const name of stale) await dir.removeEntry(name, { recursive: true }).catch(() => {});
  }
}

async function defaultRoot(): Promise<FileSystemDirectoryHandle> {
  if (typeof navigator === "undefined" || !navigator.storage?.getDirectory) throw new Error("no OPFS");
  return navigator.storage.getDirectory();
}

async function readManifest(folder: FileSystemDirectoryHandle): Promise<SavedChat | null> {
  try {
    const file = await (await folder.getFileHandle("manifest.json")).getFile();
    if (file.size > 64 * 1024) return null;
    const parsed: unknown = JSON.parse(await file.text());
    return validManifest(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function writeFile(folder: FileSystemDirectoryHandle, name: string, data: Uint8Array): Promise<void> {
  const handle = await folder.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(data);
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => {});
    throw error;
  }
}

/** In-memory store with the same contract, for tests and browsers without OPFS. */
export class MemoryChatStore implements ChatStore {
  private readonly chats = new Map<string, { chat: SavedChat; text: string }>();
  /** Bytes the store may hold; exceeded saves fail like a full disk. */
  constructor(private readonly quota = Infinity) {}

  async list() { return [...this.chats.values()].map((c) => c.chat).sort((a, b) => b.savedAt.localeCompare(a.savedAt)); }

  async save(text: string, meta: Parameters<ChatStore["save"]>[1]) {
    // Uncompressed: the in-memory store only has to keep the contract, and
    // some test environments have no CompressionStream.
    const bytes = new TextEncoder().encode(text).byteLength;
    const used = [...this.chats.values()].reduce((n, c) => n + c.chat.storedBytes, 0);
    if (used + bytes > this.quota) throw new StoreError("storage_full", "There is not enough storage space on this device to keep the chat.");
    const chat: SavedChat = { ...meta, id: newId(), textBytes: bytes, storedBytes: bytes, savedAt: new Date().toISOString(), version: 1 };
    this.chats.set(chat.id, { chat, text });
    return chat;
  }

  async read(id: string) {
    const c = this.chats.get(id);
    if (!c) throw new StoreError("not_found", "This saved chat no longer exists.");
    return c;
  }

  async remove(id: string) { this.chats.delete(id); }
  async cleanup() {}
}
