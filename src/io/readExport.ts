/* File -> DecodedExport. The single entry point for everything the user drops
   in. Runs inside the analysis worker: File objects are structured-cloneable,
   so the main thread never holds the bytes.

   Size is checked against the device's memory budget (limits.ts) before any
   bytes are read: for a .txt the file size is the text size; for a .zip only
   the chat entry's uncompressed size counts, read from the archive directory,
   and media in the archive is never read. */
import type { DecodedExport } from "@/model";
import { decodeText, isZip } from "./decode";
import { InputError } from "./errors";
import { MAX_TEXT_BYTES, MAX_ZIP_BYTES, textBudgetBytes } from "./limits";
import { extractChat, extractChatFromBlob } from "./zip";

const mb = (bytes: number) => Math.max(1, Math.round(bytes / 1024 / 1024));

function tooLarge(limit: number, what = "This chat"): InputError {
  return limit >= MAX_TEXT_BYTES
    ? new InputError("too_large", `${what} is larger than ${mb(limit)} MB, more than the app can hold in a browser tab.`)
    : new InputError("too_large", `${what} is larger than ${mb(limit)} MB, the most this device can analyse safely. Try a computer with more memory, or export a shorter period.`);
}

/** Cheap checks before any bytes are read. `budget` is the most chat text this device may import. */
export function validateFileMeta(file: Pick<File, "name" | "size">, budget: number = textBudgetBytes()): void {
  const name = file.name.toLowerCase();
  const isTxt = name.endsWith(".txt");
  const isZipName = name.endsWith(".zip");
  if (!isTxt && !isZipName) {
    throw new InputError("unsupported_type", "Choose a WhatsApp export (.txt or .zip).");
  }
  if (file.size === 0) throw new InputError("empty_file", "The file is empty.");
  if (isZipName && file.size > MAX_ZIP_BYTES) throw new InputError("zip_unsupported", "ZIP files over 4 GB are not supported.");
  if (isTxt && file.size > Math.min(budget, MAX_TEXT_BYTES)) throw tooLarge(Math.min(budget, MAX_TEXT_BYTES));
}

/** Bytes (already in memory) -> DecodedExport; zips are detected by signature. */
export async function decodeExport(bytes: Uint8Array, fileName: string, budget: number = textBudgetBytes()): Promise<DecodedExport> {
  const limit = Math.min(budget, MAX_TEXT_BYTES);
  if (isZip(bytes)) {
    const chat = await extractChat(bytes, limit).catch(rethrowSize(limit));
    return { ...decodeText(chat.bytes, fileName), archiveEntry: chat.name };
  }
  if (bytes.length > limit) throw tooLarge(limit);
  return decodeText(bytes, fileName);
}

/** The zip reader's own too_large message names the raw limit; replace it with the device wording. */
const rethrowSize = (limit: number) => (error: unknown): never => {
  if (error instanceof InputError && error.code === "too_large") throw tooLarge(limit, "The chat inside this ZIP");
  throw error;
};

/** Read a Blob in pieces into one buffer, reporting the share read so far. */
export async function readWithProgress(blob: Blob, onProgress?: (fraction: number) => void): Promise<Uint8Array> {
  const out = new Uint8Array(blob.size);
  const reader = blob.stream().getReader();
  let at = 0;
  let reported = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (at + value.byteLength > out.length) throw new InputError("not_text", "The file changed while it was being read.");
      out.set(value, at);
      at += value.byteLength;
      if (onProgress && at - reported >= out.length / 100) {
        reported = at;
        onProgress(at / out.length);
      }
    }
    if (at !== out.length) throw new InputError("not_text", "The file changed while it was being read.");
    return out;
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }

}

export type ReadStage = "reading" | "decoding";

/** File -> DecodedExport with stage and read progress. */
export async function readExport(
  file: File,
  stage: (stage: ReadStage, fraction?: number) => void = () => {},
  budget: number = textBudgetBytes(),
): Promise<DecodedExport> {
  validateFileMeta(file, budget);
  const limit = Math.min(budget, MAX_TEXT_BYTES);
  stage("reading", 0);
  // Sniff the signature, not the name: a renamed zip still opens.
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (isZip(head)) {
    const chat = await extractChatFromBlob(file, limit).catch(rethrowSize(limit));
    stage("decoding");
    return { ...decodeText(chat.bytes, file.name), archiveEntry: chat.name };
  }
  if (file.size > limit) throw tooLarge(limit);
  const bytes = await readWithProgress(file, (f) => stage("reading", f));
  stage("decoding");
  return decodeText(bytes, file.name);
}
