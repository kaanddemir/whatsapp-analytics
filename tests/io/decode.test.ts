import { describe, expect, it } from "vitest";
import { decodeText, detectEncoding, isZip } from "@/io/decode";
import { InputError } from "@/io/errors";
import { validateFileMeta } from "@/io/readExport";
import { MAX_TEXT_BYTES } from "@/io/limits";

// Synthetic, non-private sample line in Android format.
const LINE = "01/02/24, 09:00 - Alice: merhaba çok güzel\n";

const utf8 = (s: string) => new TextEncoder().encode(s);
function utf16le(s: string, bom: boolean): Uint8Array {
  const out = new Uint8Array((bom ? 2 : 0) + s.length * 2);
  let o = 0;
  if (bom) { out[o++] = 0xff; out[o++] = 0xfe; }
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out[o++] = c & 0xff;
    out[o++] = c >> 8;
  }
  return out;
}

describe("detectEncoding / decodeText", () => {
  it("decodes plain UTF-8", () => {
    const result = decodeText(utf8(LINE), "chat.txt");
    expect(result).toMatchObject({ encoding: "utf-8", hadBom: false, hadReplacementChars: false, text: LINE });
  });

  it("strips a UTF-8 BOM so the first line can match", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8(LINE)]);
    const result = decodeText(bytes, "chat.txt");
    expect(result.hadBom).toBe(true);
    expect(result.text.startsWith("01/02/24")).toBe(true);
  });

  it("decodes UTF-16LE with and without a BOM", () => {
    expect(decodeText(utf16le(LINE, true), "a.txt")).toMatchObject({ encoding: "utf-16le", text: LINE });
    expect(detectEncoding(utf16le(LINE, false)).encoding).toBe("utf-16le");
    expect(decodeText(utf16le(LINE, false), "a.txt").text).toBe(LINE);
  });

  it("reports malformed bytes instead of dropping them silently", () => {
    const bytes = new Uint8Array([...utf8("01/02/24, 09:00 - A: x"), 0xff, 0x0a]);
    expect(decodeText(bytes, "a.txt").hadReplacementChars).toBe(true);
  });

  it("rejects empty and binary input", () => {
    expect(() => decodeText(new Uint8Array(), "a.txt")).toThrow(InputError);
    expect(() => decodeText(new Uint8Array([0x41, 0x00, 0x00, 0x00, 0x42]), "a.txt")).toThrowError(
      expect.objectContaining({ code: "not_text" }),
    );
  });

  it("recognises zip archives by signature", () => {
    expect(isZip(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]))).toBe(true);
    expect(isZip(utf8(LINE))).toBe(false);
  });
});

describe("validateFileMeta", () => {
  it("accepts .txt and .zip, rejects others", () => {
    expect(() => validateFileMeta({ name: "Chat.TXT", size: 10 })).not.toThrow();
    expect(() => validateFileMeta({ name: "export.zip", size: 10 })).not.toThrow();
    expect(() => validateFileMeta({ name: "notes.pdf", size: 10 })).toThrowError(
      expect.objectContaining({ code: "unsupported_type" }),
    );
  });

  it("enforces the size limit", () => {
    expect(() => validateFileMeta({ name: "a.txt", size: MAX_TEXT_BYTES + 1 })).toThrowError(
      expect.objectContaining({ code: "too_large" }),
    );
  });
});
