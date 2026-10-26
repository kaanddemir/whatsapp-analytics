/* A light per-message language guess, Turkish vs English, used only to
   decide which validated accuracy applies to a chat (behaviour catalog).
   Turkish letters or common Turkish function words mean Turkish; Latin text
   without them is English; anything else (emoji, numbers, other scripts) is
   "other". Code-switched messages lean Turkish, the stricter case for the
   behaviours whose Turkish accuracy is the one that passed. */
import { foldAligned } from "./fold";

export type MessageLang = "tr" | "en" | "other";

const TR_LETTERS = /[çğışöüÇĞİŞÖÜ]/u;
const TR_WORDS = /\b(ve|bir|bu|da|de|mi|mı|mu|mü|ne|ben|sen|biz|ama|için|icin|çok|cok|var|yok|tamam|evet|hayır|hayir|ya|abi|olur|gibi|şimdi|simdi|yarın|yarin|bugün|bugun|neden|nasıl|nasil|değil|degil|daha|sonra|hadi|bence|artık|artik)\b/u;
const EN_WORDS = /\b(the|and|you|is|are|to|of|in|it|for|on|that|this|with|i|we|be|have|was|not|what|can|will|just|so|my|your|do|ok|yes|no|me)\b/u;

export function messageLang(text: string): MessageLang {
  if (TR_LETTERS.test(text)) return "tr";
  const f = foldAligned(text);
  if (TR_WORDS.test(f)) return "tr";
  if (EN_WORDS.test(f) || /[a-z]{3,}/.test(f)) return "en";
  return "other";
}

/** Share of Turkish and English among text messages (other excluded). */
export function languageMix(texts: Iterable<string>): { tr: number; en: number; counted: number } {
  let tr = 0, en = 0;
  for (const t of texts) {
    const l = messageLang(t);
    if (l === "tr") tr++;
    else if (l === "en") en++;
  }
  const counted = tr + en;
  return { tr: counted ? tr / counted : 0, en: counted ? en / counted : 0, counted };
}
