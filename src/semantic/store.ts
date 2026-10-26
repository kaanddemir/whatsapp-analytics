/* Where message vectors of a saved chat are kept, so indexing is not
   repeated on every visit. Only chats the user chose to keep on this device
   get a stored index: a chat that is not saved leaves nothing on disk, its
   vectors live in memory until it is closed.

   Layout, in the Origin Private File System beside the chat itself:
     semantic/<chatId>/manifest.json   what the segments are valid for
     semantic/<chatId>/sNNNNN.bin      sealed segments, in order

   A segment is written before the manifest that lists it, so an interrupted
   write leaves at most an unlisted file that the next run overwrites. The
   manifest names the model, the text preparation, the index schema and a
   fingerprint of the exact message sequence; any difference means the
   stored vectors are not reused but rebuilt. */
import { decodeSegment, encodeSegment, SEGMENT_SIZE, type Segment } from "./vectors";

export const INDEX_SCHEMA = 1;

export interface IndexManifest {
  readonly schema: number;
  readonly model: string;
  readonly fingerprint: string;
  readonly dim: number;
  /** Messages the finished index will hold. */
  readonly planned: number;
  /** Sealed segments written so far, in order. */
  readonly segments: number;
  /** Vectors in those segments. */
  readonly vectors: number;
  readonly complete: boolean;
}

export interface SemanticStore {
  /** The manifest, when it exists and is readable. */
  manifest(chatId: string): Promise<IndexManifest | null>;
  readSegment(chatId: string, n: number, dim: number): Promise<Segment | null>;
  /** Writes segment `n`, then the manifest that lists it. */
  commit(chatId: string, n: number, segment: Segment | null, manifest: IndexManifest): Promise<void>;
  remove(chatId: string): Promise<void>;
  /** Every chat's stored vectors. */
  removeAll(): Promise<void>;
}

export const compatible = (m: IndexManifest | null, expect: Pick<IndexManifest, "model" | "fingerprint" | "dim" | "planned">): m is IndexManifest =>
  !!m && m.schema === INDEX_SCHEMA && m.model === expect.model && m.fingerprint === expect.fingerprint && m.dim === expect.dim && m.planned === expect.planned
  && Number.isInteger(m.segments) && m.segments >= 0 && Number.isInteger(m.vectors) && m.vectors >= 0 && m.vectors <= m.planned;

const name = (n: number) => `s${String(n).padStart(5, "0")}.bin`;
export const isQuota = (e: unknown) => e instanceof DOMException && (e.name === "QuotaExceededError" || e.code === 22);

export class OpfsSemanticStore implements SemanticStore {
  constructor(private readonly root: () => Promise<FileSystemDirectoryHandle> = () => navigator.storage.getDirectory()) {}

  private async dir(chatId: string, create: boolean): Promise<FileSystemDirectoryHandle | null> {
    try {
      const top = await (await this.root()).getDirectoryHandle("semantic", { create });
      return await top.getDirectoryHandle(chatId, { create });
    } catch {
      return null;
    }
  }

  async manifest(chatId: string): Promise<IndexManifest | null> {
    const dir = await this.dir(chatId, false);
    if (!dir) return null;
    try {
      const file = await (await dir.getFileHandle("manifest.json")).getFile();
      if (file.size > 64 * 1024) return null;
      return JSON.parse(await file.text()) as IndexManifest;
    } catch {
      return null;
    }
  }

  async readSegment(chatId: string, n: number, dim: number): Promise<Segment | null> {
    const dir = await this.dir(chatId, false);
    if (!dir) return null;
    try {
      const file = await (await dir.getFileHandle(name(n))).getFile();
      if (file.size > 12 + SEGMENT_SIZE * (8 + dim)) return null;
      return decodeSegment(new Uint8Array(await file.arrayBuffer()), dim);
    } catch {
      return null;
    }
  }

  async commit(chatId: string, n: number, segment: Segment | null, manifest: IndexManifest): Promise<void> {
    const dir = await this.dir(chatId, true);
    if (!dir) throw new DOMException("no storage", "NotAllowedError");
    if (segment) await write(dir, name(n), encodeSegment(segment, manifest.dim));
    await write(dir, "manifest.json", new TextEncoder().encode(JSON.stringify(manifest)));
  }

  async remove(chatId: string): Promise<void> {
    const root = await this.root();
    try {
      const top = await root.getDirectoryHandle("semantic");
      await top.removeEntry(chatId, { recursive: true });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error;
    }
  }

  async removeAll(): Promise<void> {
    const root = await this.root();
    // Either directory may be absent. Attempt both, and never report a failed deletion as success.
    const results = await Promise.allSettled(["semantic", "semantic-models"].map(async (name) => {
      try { await root.removeEntry(name, { recursive: true }); }
      catch (error) { if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error; }
    }));
    const failed = results.find((r) => r.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  }

}

async function write(dir: FileSystemDirectoryHandle, file: string, data: Uint8Array): Promise<void> {
  const handle = await dir.getFileHandle(file, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(data);
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => {});
    throw error;
  }
}

/** Same contract in memory, for tests; `failAfter` makes the Nth commit throw a quota error. */
export class MemorySemanticStore implements SemanticStore {
  readonly data = new Map<string, { manifest: IndexManifest | null; segments: Map<number, Uint8Array> }>();
  commits = 0;
  constructor(public failAfter: number | null = null) {}
  private entry(id: string) {
    let e = this.data.get(id);
    if (!e) this.data.set(id, (e = { manifest: null, segments: new Map() }));
    return e;
  }
  async manifest(id: string) { return this.data.get(id)?.manifest ?? null; }
  async readSegment(id: string, n: number, dim: number) {
    const bytes = this.data.get(id)?.segments.get(n);
    return bytes ? decodeSegment(bytes, dim) : null;
  }
  async commit(id: string, n: number, segment: Segment | null, manifest: IndexManifest) {
    if (this.failAfter !== null && ++this.commits > this.failAfter) throw new DOMException("quota", "QuotaExceededError");
    const e = this.entry(id);
    if (segment) e.segments.set(n, encodeSegment(segment, manifest.dim));
    e.manifest = manifest;
  }
  async remove(id: string) { this.data.delete(id); }
  async removeAll() { this.data.clear(); }
}
