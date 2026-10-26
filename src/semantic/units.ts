/* What gets embedded, and how a chat is identified for its stored index.

   One retrieval unit per message. Measured on the bilingual set, single
   messages retrieved far better than 5- or 24-message windows (windows
   dilute the one message that matters, docs/ARCHITECTURE.md), and a unit that
   is one message can never hide which message matched. Context is added
   afterwards, at display time, from the surrounding messages.

   Skipped: media placeholders, deleted and system rows (not text), text with
   no letters or digits (emoji, punctuation), and one- or two-word fillers
   ("tamam", "ok", "haha"). A short message that says something ("özledim",
   "taşınıyoruz") is kept: length alone never excludes a message. */
import type { Message, ParseResult } from "@/model";
import { foldAligned, tokens } from "@/text/fold";
import type { ModelSpec } from "./model";

const FILLER = new Set([
  "ok", "okay", "okey", "oki", "tamam", "tmm", "tm", "tamamdir", "peki", "evet", "yok", "hayir", "he", "hi", "hm", "hmm", "hmmm",
  "aynen", "olur", "tabi", "tabii", "yes", "no", "yeah", "yep", "nope", "k", "kk", "ha", "haha", "hahaha", "hahahaha", "ahah",
  "ahaha", "jsjs", "sjsj", "lol", "lmao", "mm", "mhm", "eh", "ah", "oh", "of", "ya", "yaa", "e", "a", "tsk", "tesekkurler", "sagol", "thanks", "thx",
]);

export function isIndexable(message: Message): boolean {
  if (message.kind !== "text") return false;
  const words = tokens(foldAligned(message.text));
  if (words.length === 0) return false;
  return !(words.length <= 2 && words.every((w) => FILLER.has(w) || /^(ha|he|hi|ah|sj|js)+h?$/.test(w)));
}

/** The text the model reads for a message, prefix included. */
export const passage = (spec: ModelSpec, text: string) => spec.passagePrefix + text.replace(/\s+/g, " ").trim().slice(0, spec.maxChars);
export const query = (spec: ModelSpec, text: string) => spec.queryPrefix + text.replace(/\s+/g, " ").trim().slice(0, spec.maxChars);

/** Message numbers to embed, ascending. */
export function indexableIds(parsed: ParseResult): Int32Array {
  const out: number[] = [];
  parsed.messages.forEach((m, i) => { if (isIndexable(m)) out.push(i); });
  return Int32Array.from(out);
}

/** A 64-bit FNV-1a digest of every message's time, sender, kind and text, as 16 hex digits.
    A stored index is reused only for the identical message sequence. */
export function fingerprint(parsed: ParseResult): string {
  let h1 = 0x811c9dc5 | 0, h2 = 0xcbf29ce4 | 0;
  const mix = (code: number) => {
    h1 = Math.imul(h1 ^ code, 0x01000193);
    h2 = Math.imul(h2 ^ (code + 0x9e37), 0x01000193) ^ (h1 >>> 15);
  };
  for (const m of parsed.messages) {
    const ts = String(m.ts);
    for (let i = 0; i < ts.length; i++) mix(ts.charCodeAt(i));
    mix(0x1f); mix(m.sender); mix(m.kind.length);
    for (let i = 0; i < m.text.length; i++) mix(m.text.charCodeAt(i));
    mix(0x1e);
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  return `${hex(h1)}${hex(h2)}-${parsed.messages.length}`;
}
