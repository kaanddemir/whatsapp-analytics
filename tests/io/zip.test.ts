import { crc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import { extractChat, extractChatFromBlob, listEntries, selectChatEntry, MAX_ZIP_DIRECTORY_BYTES } from "@/io/zip";
import { decodeExport } from "@/io/readExport";
import { InputError } from "@/io/errors";
import { android, lines } from "../support/export";

const encoder = new TextEncoder();

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

interface Entry { name: string; data: Uint8Array; method?: 0 | 8; flags?: number }

/** Minimal ZIP writer for fixtures. Includes CRC-32 checksums for corruption detection. */
async function zip(entries: Entry[]): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const method = entry.method ?? 8;
    const body = method === 8 ? await deflateRaw(entry.data) : entry.data;
    const name = encoder.encode(entry.name);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(6, entry.flags ?? 0x0800, true);
    local.setUint16(8, method, true);
    local.setUint32(14, crc32(entry.data), true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, entry.data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, body);

    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(8, entry.flags ?? 0x0800, true);
    c.setUint16(10, method, true);
    c.setUint32(16, crc32(entry.data), true);
    c.setUint32(20, body.length, true);
    c.setUint32(24, entry.data.length, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), name);
    offset += 30 + name.length + body.length;
  }
  const centralSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) { out.set(p, at); at += p.length; }
  return out;
}

const CHAT = lines(android("01/02/24", "09:00", "Alice", "merhaba 👋"), android("01/02/24", "09:01", "Bob", "selam"));

describe("zip extraction", () => {
  it("extracts an iOS _chat.txt (deflated) and ignores media entries", async () => {
    const bytes = await zip([
      { name: "00000003-PHOTO-2024-01-02.jpg", data: new Uint8Array([1, 2, 3]), method: 0 },
      { name: "_chat.txt", data: encoder.encode(CHAT) },
    ]);
    const decoded = await decodeExport(bytes, "WhatsApp Chat - Trip.zip");
    expect(decoded.text).toBe(CHAT);
    expect(decoded.archiveEntry).toBe("_chat.txt");
  });

  it("extracts an Android chat stored without compression", async () => {
    const bytes = await zip([{ name: "WhatsApp Chat with Alice.txt", data: encoder.encode(CHAT), method: 0 }]);
    const { name, bytes: out } = await extractChat(bytes, 1_000_000);
    expect(name).toBe("WhatsApp Chat with Alice.txt");
    expect(new TextDecoder().decode(out)).toBe(CHAT);
  });

  it("strips a BOM from the extracted text", async () => {
    const bytes = await zip([{ name: "_chat.txt", data: new Uint8Array([0xef, 0xbb, 0xbf, ...encoder.encode(CHAT)]) }]);
    const decoded = await decodeExport(bytes, "x.zip");
    expect(decoded).toMatchObject({ hadBom: true, text: CHAT });
  });

  it("chooses _chat.txt, ignores macOS metadata, and refuses ambiguous archives", () => {
    const e = (name: string) => ({ name, crc32: 0, method: 8, flags: 0, compressedSize: 0, uncompressedSize: 0, localHeaderOffset: 0 });
    expect(selectChatEntry([e("__MACOSX/._chat.txt"), e("_chat.txt")]).name).toBe("_chat.txt");
    expect(selectChatEntry([e("notes.txt"), e("WhatsApp Chat with Bob.txt")]).name).toBe("WhatsApp Chat with Bob.txt");
    expect(() => selectChatEntry([e("a.txt"), e("b.txt")])).toThrowError(expect.objectContaining({ code: "zip_ambiguous" }));
    expect(() => selectChatEntry([e("photo.jpg")])).toThrowError(expect.objectContaining({ code: "zip_without_chat" }));
  });

  it("stops inflating past the size limit (zip-bomb guard)", async () => {
    const big = new Uint8Array(2_000_000).fill(0x61); // compresses to a few KB
    const bytes = await zip([{ name: "_chat.txt", data: big }]);
    // Lie about the uncompressed size so only the streaming guard can catch it.
    const view = new DataView(bytes.buffer);
    const eocd = bytes.length - 22;
    const centralOffset = view.getUint32(eocd + 16, true);
    view.setUint32(centralOffset + 24, 10, true);
    await expect(extractChat(bytes, 1_000_000)).rejects.toMatchObject({ code: "too_large" });
  });

  it("rejects password-protected entries and damaged archives", async () => {
    const encrypted = await zip([{ name: "_chat.txt", data: encoder.encode(CHAT), flags: 0x0801 }]);
    await expect(extractChat(encrypted, 1_000_000)).rejects.toMatchObject({ code: "zip_unsupported" });

    const truncated = (await zip([{ name: "_chat.txt", data: encoder.encode(CHAT) }])).subarray(0, 40);
    expect(() => listEntries(truncated)).toThrow(InputError);
    await expect(decodeExport(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]), "x.zip")).rejects.toMatchObject({ code: "zip_invalid" });
  });
});

describe("adversarial ZIP metadata", () => {
  it("rejects stored entries whose claimed size hides a larger payload before reading it", async () => {
    const bytes = await zip([{ name: "_chat.txt", data: new Uint8Array(20000), method: 0 }]);
    const view = new DataView(bytes.buffer);
    const central = view.getUint32(bytes.length - 6, true);
    view.setUint32(central + 24, 1, true);
    const blob = new Blob([bytes]);
    const reads: number[] = [];
    const input = { size: blob.size, slice: (a?: number, b?: number) => { reads.push((b ?? blob.size) - (a ?? 0)); return blob.slice(a, b); } } as Blob;
    await expect(extractChatFromBlob(input, 1000)).rejects.toMatchObject({ code: "too_large" });
    expect(reads).not.toContain(20000);
  });

  it("refuses oversized directory metadata before allocation", async () => {
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint32(12, MAX_ZIP_DIRECTORY_BYTES + 1, true);
    const size = MAX_ZIP_DIRECTORY_BYTES + 23;
    const tail = new Uint8Array(65557); tail.set(new Uint8Array(end.buffer), tail.length - 22);
    const input = { size, slice: () => new Blob([tail]) } as Blob;
    await expect(extractChatFromBlob(input, 1000)).rejects.toMatchObject({ code: "zip_unsupported" });
  });

  it("rejects stored-byte corruption even when size metadata still matches", async () => {
    const bytes = await zip([{ name: "_chat.txt", data: encoder.encode(CHAT), method: 0 }]);
    bytes[30 + encoder.encode("_chat.txt").length]! ^= 1;
    await expect(extractChat(bytes, 1000000)).rejects.toMatchObject({ code: "zip_invalid" });
  });

  it("rejects truncated directory records and inconsistent inflated lengths", async () => {
    const bytes = await zip([{ name: "_chat.txt", data: encoder.encode(CHAT) }]);
    const view = new DataView(bytes.buffer), central = view.getUint32(bytes.length - 6, true);
    view.setUint16(central + 30, 60000, true);
    await expect(extractChat(bytes, 1000000)).rejects.toMatchObject({ code: "zip_invalid" });
    view.setUint16(central + 30, 0, true);
    view.setUint32(central + 24, 1, true);
    await expect(extractChat(bytes, 1000000)).rejects.toMatchObject({ code: "zip_invalid" });
  });

  it("refuses two competing iOS chat entries", async () => {
    const bytes = await zip([{ name: "one/_chat.txt", data: encoder.encode(CHAT) }, { name: "two/_chat.txt", data: encoder.encode(CHAT) }]);
    await expect(extractChat(bytes, 1000000)).rejects.toMatchObject({ code: "zip_ambiguous" });
  });
});
