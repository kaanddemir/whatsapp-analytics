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

export interface ZipEntry {
  readonly name: string;
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
    if (view.getUint32(i, true) === EOCD_SIG) return i;
  }
  return invalid();
}

export function listEntries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 22) invalid();
  const eocd = findEndOfCentralDirectory(view);
  const count = view.getUint16(eocd + 10, true);
  const offset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || offset === 0xffffffff) {
    throw new InputError("zip_unsupported", "This ZIP format (ZIP64) is not supported.");
  }
  const decoder = new TextDecoder("utf-8");
  const entries: ZipEntry[] = [];
  let p = offset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.byteLength || view.getUint32(p, true) !== CENTRAL_SIG) invalid();
    const nameLength = view.getUint16(p + 28, true);
    const extraLength = view.getUint16(p + 30, true);
    const commentLength = view.getUint16(p + 32, true);
    if (p + 46 + nameLength > bytes.byteLength) invalid();
    entries.push({
      flags: view.getUint16(p + 8, true),
      method: view.getUint16(p + 10, true),
      compressedSize: view.getUint32(p + 20, true),
      uncompressedSize: view.getUint32(p + 24, true),
      localHeaderOffset: view.getUint32(p + 42, true),
      name: decoder.decode(bytes.subarray(p + 46, p + 46 + nameLength)),
    });
    p += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** The chat text entry: "_chat.txt", else the only .txt, else the one named like a WhatsApp chat. */
export function selectChatEntry(entries: readonly ZipEntry[]): ZipEntry {
  const texts = entries.filter((e) => {
    const name = baseName(e.name);
    return name.toLowerCase().endsWith(".txt") && !name.startsWith("._") && !e.name.startsWith("__MACOSX/");
  });
  const ios = texts.find((e) => baseName(e.name) === "_chat.txt");
  if (ios) return ios;
  if (texts.length === 1 && texts[0]) return texts[0];
  const named = texts.filter((e) => /^whatsapp/i.test(baseName(e.name)));
  if (named.length === 1 && named[0]) return named[0];
  if (texts.length === 0) throw new InputError("zip_without_chat", "This ZIP file has no WhatsApp chat text in it.");
  throw new InputError("zip_ambiguous", "This ZIP file holds more than one chat text file. Unzip it and choose the chat's .txt file.");
}

async function inflateRaw(data: Uint8Array, limit: number): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
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
    if (error instanceof InputError) throw error;
    invalid();
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

/** Extract the chat text bytes. `limit` caps the uncompressed size. */
export async function extractChat(bytes: Uint8Array, limit: number): Promise<{ name: string; bytes: Uint8Array }> {
  const entry = selectChatEntry(listEntries(bytes));
  if (entry.flags & 0x1) {
    throw new InputError("zip_unsupported", "This ZIP file is password-protected.");
  }
  if (entry.uncompressedSize > limit) {
    throw new InputError("too_large", `The chat inside this ZIP is larger than ${Math.round(limit / 1024 / 1024)} MB.`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const local = entry.localHeaderOffset;
  if (local + 30 > bytes.byteLength || view.getUint32(local, true) !== LOCAL_SIG) invalid();
  const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
  const end = start + entry.compressedSize;
  if (end > bytes.byteLength) invalid();
  const data = bytes.subarray(start, end);

  if (entry.method === 0) return { name: entry.name, bytes: data };
  if (entry.method === 8) return { name: entry.name, bytes: await inflateRaw(data, limit) };
  throw new InputError("zip_unsupported", "This ZIP file uses an unsupported compression method.");
}
