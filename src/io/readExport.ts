/* File -> DecodedExport. The single entry point for everything the user drops
   in. Runs inside the analysis worker: File objects are structured-cloneable,
   so the main thread never holds the bytes. */
import type { DecodedExport } from "@/model";
import { decodeText, isZip } from "./decode";
import { InputError } from "./errors";
import { MAX_TEXT_BYTES, MAX_ZIP_BYTES } from "./limits";
import { extractChat } from "./zip";

/** Cheap checks before any bytes are read. */
export function validateFileMeta(file: Pick<File, "name" | "size">): void {
  const name = file.name.toLowerCase();
  const isTxt = name.endsWith(".txt");
  const isZipName = name.endsWith(".zip");
  if (!isTxt && !isZipName) {
    throw new InputError("unsupported_type", "Choose a WhatsApp export (.txt or .zip).");
  }
  if (file.size === 0) throw new InputError("empty_file", "The file is empty.");
  const limit = isZipName ? MAX_ZIP_BYTES : MAX_TEXT_BYTES;
  if (file.size > limit) {
    throw new InputError("too_large", `This file is larger than ${Math.round(limit / 1024 / 1024)} MB.`);
  }
}

/** Bytes (already in memory) -> DecodedExport; zips are detected by signature. */
export async function decodeExport(bytes: Uint8Array, fileName: string): Promise<DecodedExport> {
  if (isZip(bytes)) {
    const chat = await extractChat(bytes, MAX_TEXT_BYTES);
    return { ...decodeText(chat.bytes, fileName), archiveEntry: chat.name };
  }
  if (bytes.length > MAX_TEXT_BYTES) {
    throw new InputError("too_large", `This file is larger than ${MAX_TEXT_BYTES / 1024 / 1024} MB.`);
  }
  return decodeText(bytes, fileName);
}

export async function readExport(file: File): Promise<DecodedExport> {
  validateFileMeta(file);
  return decodeExport(new Uint8Array(await file.arrayBuffer()), file.name);
}
