/* Bytes -> text. Pure and synchronous so it runs the same in a worker, on the
   main thread and under Vitest.

   Decoding with errors ignored (as the former server did) silently
   drops bytes and keeping a UTF-8 BOM means the first line of a
   BOM-prefixed export can fail to match. Here the BOM decides the encoding
   when present, and malformed bytes are reported rather than hidden. */
import type { DecodedExport, TextEncoding } from "@/model";
import { InputError } from "./errors";

export function detectEncoding(bytes: Uint8Array): { encoding: TextEncoding; bomLength: number } {
  const [b0, b1, b2] = bytes;
  if (b0 === 0xef && b1 === 0xbb && b2 === 0xbf) return { encoding: "utf-8", bomLength: 3 };
  if (b0 === 0xff && b1 === 0xfe) return { encoding: "utf-16le", bomLength: 2 };
  if (b0 === 0xfe && b1 === 0xff) return { encoding: "utf-16be", bomLength: 2 };
  // No BOM: UTF-16 without one shows up as a zero byte in every other
  // position of ASCII text. WhatsApp writes UTF-8, so that is the default.
  const sample = bytes.subarray(0, Math.min(bytes.length, 512));
  let evenZeros = 0;
  let oddZeros = 0;
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 0) {
      if (i % 2 === 0) evenZeros++;
      else oddZeros++;
    }
  }
  const half = sample.length / 2;
  if (half > 0 && oddZeros > half * 0.4 && evenZeros === 0) return { encoding: "utf-16le", bomLength: 0 };
  if (half > 0 && evenZeros > half * 0.4 && oddZeros === 0) return { encoding: "utf-16be", bomLength: 0 };
  return { encoding: "utf-8", bomLength: 0 };
}

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

export function isZip(bytes: Uint8Array): boolean {
  return ZIP_MAGIC.every((value, i) => bytes[i] === value);
}

export function decodeText(bytes: Uint8Array, fileName: string): DecodedExport {
  if (bytes.length === 0) throw new InputError("empty_file", "The file is empty.");
  const { encoding, bomLength } = detectEncoding(bytes);
  // ignoreBOM: the BOM is already sliced off, so a second one would be content.
  const text = new TextDecoder(encoding, { ignoreBOM: true }).decode(bytes.subarray(bomLength));
  if (text.includes("\u0000")) {
    throw new InputError("not_text", "This file does not look like a text export.");
  }
  return {
    fileName,
    byteLength: bytes.length,
    encoding,
    hadBom: bomLength > 0,
    hadReplacementChars: text.includes("�"),
    text,
  };
}
