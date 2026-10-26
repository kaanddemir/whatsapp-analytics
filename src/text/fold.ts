/* Text folding shared by search, behaviour and event detection.

   Turkish and English are matched the same way: lower-cased with Turkish
   rules (I -> ı, İ -> i), then Turkish and common Latin diacritics removed
   (ç -> c, ğ -> g, ı -> i, ö -> o, ş -> s, ü -> u, â -> a, é -> e …). People
   type Turkish without its letters all the time ("gorusuruz" for
   "görüşürüz"), so both spellings must meet.

   `foldAligned` keeps one output code unit per input code unit, so a match
   found in the folded text marks the same span of the original message
   (used to highlight search hits). */

const MAP: Record<string, string> = {
  ç: "c", ć: "c", č: "c", ğ: "g", ı: "i", ö: "o", ô: "o", ó: "o", ò: "o", ş: "s", ś: "s", š: "s", ü: "u", û: "u", ú: "u", ù: "u",
  â: "a", á: "a", à: "a", ä: "a", ã: "a", å: "a", î: "i", í: "i", ì: "i", ï: "i", é: "e", è: "e", ê: "e", ë: "e", ñ: "n", ý: "y", ÿ: "y",
  "’": "'", "‘": "'", "`": "'", "´": "'",
};

function foldChar(c: string): string {
  const lower = c.toLocaleLowerCase("tr");
  // Lower-casing never changes length under the Turkish locale for the
  // letters that matter; keep alignment for anything that would.
  const one = lower.length === 1 ? lower : c;
  return MAP[one] ?? one;
}

const charCache = new Map<string, string>();
const ASCII = /^[\x00-\x7f]*$/;

/** Same length as the input; position i of the result folds position i of the input. */
export function foldAligned(text: string): string {
  // ASCII folds to its plain lower case (the Turkish dotless ı folds back to i anyway).
  if (ASCII.test(text)) return text.toLowerCase();
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    let f = charCache.get(c);
    if (f === undefined) {
      f = foldChar(c);
      charCache.set(c, f);
    }
    out += f;
  }
  return out;
}

/** Word tokens of folded text, with their start offsets. Apostrophes split ("ali'nin" -> ali, nin). */
export const TOKEN_RE = /[\p{L}\p{N}]+/gu;

export function tokens(folded: string): string[] {
  return folded.match(TOKEN_RE) ?? [];
}

/** Collapse letters repeated 3+ times ("özüüür" -> "özür", "sorryyy" -> "sorry"); keeps real doubles. */
export function collapseStretch(text: string): string {
  return text.replace(/(\p{L})\1{2,}/gu, "$1");
}
