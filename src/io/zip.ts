/* Extracting the chat text from a WhatsApp .zip export, with no dependency.

   WhatsApp zips hold one chat text file ("_chat.txt" on iOS, "WhatsApp Chat
   with X.txt" / "WhatsApp Sohbeti - X.txt" on Android) plus media. Only that
   one entry is read. Inflation uses the platform's DecompressionStream
   ("deflate-raw"), available in current browsers and Node 22, and stops
   reading once the output passes the text size limit, so a zip bomb cannot
   exhaust memory.

   Supported: stored (0) and deflate (8) entries, archives under 4 GB.
   Not supported, reported as errors: ZIP64, encryption, other methods. */
import { InputError } from "./errors";

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
// Directory names/comments are untrusted too; bound metadata independently of chat size.
export const MAX_ZIP_DIRECTORY_BYTES = 16 * 1024 * 1024;

export interface ZipEntry {
  readonly name: string;
  readonly crc32: number;
  readonly method: number;
  readonly flags: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
}

function invalid(): never {
  throw new InputError("zip_invalid", "This ZIP file is damaged or incomplete.");
}

function findEndOfCentralDirectory(view: DataView): number {
  // The record is 22 bytes plus a comment of up to 65,535 bytes.
  const earliest = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let i = view.byteLength - 22; i >= earliest; i--) {
    if (view.getUint32(i, true) === EOCD_SIG && i + 22 + view.getUint16(i + 20, true) === view.byteLength) return i;
  }
  return invalid();
}

interface Directory { readonly count: number; readonly offset: number; readonly size: number; readonly end: number }

function readEndOfCentralDirectory(tail: Uint8Array, base = 0): Directory {
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  if (tail.byteLength < 22) invalid();
  const eocd = findEndOfCentralDirectory(view);
  const count = view.getUint16(eocd + 10, true);
  const size = view.getUint32(eocd + 12, true);
  const offset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || offset === 0xffffffff || size === 0xffffffff) {
    throw new InputError("zip_unsupported", "This ZIP format (ZIP64) is not supported.");
  }
  if (view.getUint16(eocd + 4, true) !== 0 || view.getUint16(eocd + 6, true) !== 0
    || view.getUint16(eocd + 8, true) !== count) invalid();
  if (offset + size > base + eocd || count * 46 > size) invalid();
  if (size > MAX_ZIP_DIRECTORY_BYTES) throw new InputError("zip_unsupported", "This ZIP has too much directory metadata to read safely.");
  return { count, offset, size, end: base + eocd };
}

/** Entries of a central directory; `bytes` holds the archive from absolute offset `base`. */
function parseCentralDirectory(bytes: Uint8Array, base: number, dir: Directory): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder("utf-8");
  const entries: ZipEntry[] = [];
  let p = dir.offset - base;
  const end = p + dir.size;
  if (p < 0 || end > bytes.byteLength) invalid();
  for (let i = 0; i < dir.count; i++) {
    if (p + 46 > end || view.getUint32(p, true) !== CENTRAL_SIG) invalid();
    const nameLength = view.getUint16(p + 28, true);
    const extraLength = view.getUint16(p + 30, true);
    const commentLength = view.getUint16(p + 32, true);
    if (p + 46 + nameLength + extraLength + commentLength > end || view.getUint16(p + 34, true) !== 0) invalid();
    if ([20, 24, 42].some((at) => view.getUint32(p + at, true) === 0xffffffff))
      throw new InputError("zip_unsupported", "This ZIP format (ZIP64) is not supported.");
    entries.push({
      crc32: view.getUint32(p + 16, true),
      flags: view.getUint16(p + 8, true),
      method: view.getUint16(p + 10, true),
      compressedSize: view.getUint32(p + 20, true),
      uncompressedSize: view.getUint32(p + 24, true),
      localHeaderOffset: view.getUint32(p + 42, true),
      name: decoder.decode(bytes.subarray(p + 46, p + 46 + nameLength)),
    });
    p += 46 + nameLength + extraLength + commentLength;
  }
  if (p !== end) invalid();
  return entries;
}

export function listEntries(bytes: Uint8Array): ZipEntry[] {
  return parseCentralDirectory(bytes, 0, readEndOfCentralDirectory(bytes));
}

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** The chat text entry: "_chat.txt", else the only .txt, else the one named like a WhatsApp chat. */
export function selectChatEntry(entries: readonly ZipEntry[]): ZipEntry {
  const texts = entries.filter((e) => {
    const name = baseName(e.name);
    return name.toLowerCase().endsWith(".txt") && !name.startsWith("._") && !e.name.startsWith("__MACOSX/");
  });
  const ios = texts.filter((e) => baseName(e.name) === "_chat.txt");
  if (ios.length === 1) return ios[0]!;
  if (ios.length > 1) throw new InputError("zip_ambiguous", "This ZIP holds more than one chat text file.");
  if (texts.length === 1 && texts[0]) return texts[0];
  const named = texts.filter((e) => /^whatsapp/i.test(baseName(e.name)));
  if (named.length === 1 && named[0]) return named[0];
  if (texts.length === 0) throw new InputError("zip_without_chat", "This ZIP file has no WhatsApp chat text in it.");
  throw new InputError("zip_ambiguous", "This ZIP file holds more than one chat text file. Unzip it and choose the chat's .txt file.");
}

/** Inflate a raw-deflate stream, stopping as soon as the output passes `limit`. */
async function inflateRaw(source: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> {
  const reader = source.pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new InputError("too_large", `The chat inside this ZIP is larger than ${Math.round(limit / 1024 / 1024)} MB.`);
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof InputError) throw error;
    invalid();
  }
  finally { reader.releaseLock(); }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

const slice = async (blob: Blob, start: number, end: number) => new Uint8Array(await blob.slice(start, end).arrayBuffer());

/**
 * Extract the chat text bytes from an archive without reading it whole: the
 * central directory, one local header and the chat entry are the only parts
 * read, so an export with gigabytes of media costs no more than its chat.
 * `limit` caps the uncompressed size.
 */
export async function extractChatFromBlob(blob: Blob, limit: number): Promise<{ name: string; bytes: Uint8Array }> {
  // The end record is 22 bytes plus a comment of up to 65,535 bytes.
  const tailStart = Math.max(0, blob.size - 22 - 0xffff);
  const dir = readEndOfCentralDirectory(await slice(blob, tailStart, blob.size), tailStart);
  if (dir.offset + dir.size > blob.size) invalid();
  const entry = selectChatEntry(parseCentralDirectory(await slice(blob, dir.offset, dir.offset + dir.size), dir.offset, dir));
  if (entry.flags & 0x1) {
    throw new InputError("zip_unsupported", "This ZIP file is password-protected.");
  }
  if (entry.uncompressedSize > limit) {
    throw new InputError("too_large", `The chat inside this ZIP is larger than ${Math.round(limit / 1024 / 1024)} MB.`);
  }
  if (entry.method === 0 && entry.compressedSize > limit)
    throw new InputError("too_large", "The chat inside this ZIP exceeds this device's text budget.");
  if (entry.method === 0 && entry.compressedSize !== entry.uncompressedSize) invalid();
  const local = entry.localHeaderOffset;
  if (local + 30 > dir.offset) invalid();
  const header = await slice(blob, local, local + 30);
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (header.byteLength < 30 || view.getUint32(0, true) !== LOCAL_SIG) invalid();
  const start = local + 30 + view.getUint16(26, true) + view.getUint16(28, true);
  const end = start + entry.compressedSize;
  if (end > dir.offset || view.getUint16(8, true) !== entry.method || view.getUint16(6, true) !== entry.flags) invalid();
  const localName = new TextDecoder().decode(await slice(blob, local + 30, local + 30 + view.getUint16(26, true)));
  if (localName !== entry.name) invalid();

  let bytes: Uint8Array;
  if (entry.method === 0) bytes = await slice(blob, start, end);
  else if (entry.method === 8) bytes = await inflateRaw(blob.slice(start, end).stream(), limit);
  else throw new InputError("zip_unsupported", "This ZIP file uses an unsupported compression method.");
  if (bytes.length !== entry.uncompressedSize || crc32(bytes) !== entry.crc32) invalid();
  return { name: entry.name, bytes };
}

/** Extract the chat text bytes from an archive already in memory. */
export async function extractChat(bytes: Uint8Array, limit: number): Promise<{ name: string; bytes: Uint8Array }> {
  return extractChatFromBlob(new Blob([bytes]), limit);
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let crc = n;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  return crc >>> 0;
});

/** ZIP's IEEE CRC-32 detects corruption independently of deflate's framing. */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff]!;
  return (crc ^ 0xffffffff) >>> 0;
}
