/* A minimal in-memory Origin Private File System for tests: directories,
   files, createWritable (data lands on close, as in browsers), recursive
   removal, async iteration, and an optional byte quota that fails writes with
   QuotaExceededError. `failAfterWrites` makes the Nth close throw, to simulate
   a tab killed mid-save. */

class FakeFile {
  data = new Uint8Array();
}

export class FakeDir {
  readonly kind = "directory";
  readonly entries = new Map<string, FakeDir | FakeFile>();
  constructor(readonly name: string, private readonly fs: FakeFs) {}

  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    const e = this.entries.get(name);
    if (e instanceof FakeDir) return e;
    if (e || !options?.create) throw new DOMException("missing", "NotFoundError");
    const d = new FakeDir(name, this.fs);
    this.entries.set(name, d);
    return d;
  }

  async getFileHandle(name: string, options?: { create?: boolean }) {
    let e = this.entries.get(name);
    if (e instanceof FakeDir) throw new DOMException("dir", "TypeMismatchError");
    if (!e) {
      if (!options?.create) throw new DOMException("missing", "NotFoundError");
      e = new FakeFile();
      this.entries.set(name, e);
    }
    const file = e;
    const fs = this.fs;
    return {
      kind: "file" as const,
      name,
      async getFile() { return new Blob([file.data]); },
      async createWritable() {
        const parts: Uint8Array[] = [];
        return {
          async write(d: Uint8Array) { parts.push(d); },
          async close() {
            const size = parts.reduce((n, p) => n + p.byteLength, 0);
            fs.closes++;
            if (fs.failAfterWrites !== null && fs.closes > fs.failAfterWrites) throw new DOMException("killed", "AbortError");
            if (fs.used() - file.data.byteLength + size > fs.quota) throw new DOMException("quota", "QuotaExceededError");
            const out = new Uint8Array(size);
            let at = 0;
            for (const p of parts) { out.set(p, at); at += p.byteLength; }
            file.data = out;
          },
          async abort() {},
        };
      },
    };
  }

  async removeEntry(name: string, _options?: { recursive?: boolean }) {
    if (!this.entries.delete(name)) throw new DOMException("missing", "NotFoundError");
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<[string, { kind: string }]> {
    for (const [name, e] of this.entries) yield [name, e instanceof FakeDir ? e : { kind: "file" }];
  }

  bytes(): number {
    let n = 0;
    for (const e of this.entries.values()) n += e instanceof FakeDir ? e.bytes() : e.data.byteLength;
    return n;
  }
}

export class FakeFs {
  closes = 0;
  failAfterWrites: number | null = null;
  readonly root: FakeDir = new FakeDir("", this);
  constructor(public quota = Infinity) {}
  used() { return this.root.bytes(); }
  handle = async () => this.root as unknown as FileSystemDirectoryHandle;
}
