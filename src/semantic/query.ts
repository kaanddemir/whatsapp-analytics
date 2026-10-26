/* What a recall question is about, for the embedding model.

   A question carries request framing ("find the message where she said…",
   "…söylediği mesajı bul", "what did he answer when…") that is not what the
   wanted message says. Embedded whole, the framing pulls the question
   toward chatter shaped like it (other questions, messages about messages).
   Only framing at the start (English) or the end (Turkish) is removed, and
   only as whole words; what remains is the content, with its own inflection
   kept ("akşam gelemeyeceğini"). An empty result falls back to the question.

   Word matching and the keyword index still use the whole question; this
   text is only what the model reads. */

const EN_LEAD: readonly RegExp[] = [
  /^(?:can you |could you |please )?(?:find|show|search(?: for)?|look for|get|give)(?: me)?(?: all)?\s+/u,
  /^(?:the |a |an |all )?(?:messages?|conversations?|chats?|texts?|times?|moments?|days?|exchanges?)(?:\s+(?:where|when|in which|that|about|of))?\s+/u,
  /^(?:remember|do you remember)(?:\s+(?:when|the time))?\s+/u,
  /^(?:what|how) (?:did|does|do|had) [\p{L}']+ (?:say|answer|reply|respond|react|tell me|write|text)(?: back)?(?: to me)?(?:\s+(?:when|after|about|to))?\s+/u,
  /^(?:when|where|what time)(?: (?:did|does|do|was|were|is|are|had|will))?\s+/u,
  /^the (?:time|day|moment)(?: when| that)?\s+/u,
  /^(?:i|we|you|she|he|they) (?:said|told (?:me|her|him|them|you|us)|texted(?: me| her| him)?|wrote(?: to (?:me|her|him))?|mentioned|messaged(?: me| her| him)?|asked(?: me| her| him)?)(?: that)?\s+/u,
  /^(?:about|regarding)\s+(?:the |our |my )?/u,
];

const TR_TAIL: readonly RegExp[] = [
  /\s+(?:bul|göster|getir|ara)(?:\s*(?:bana|lütfen))?$/u,
  /\s+ne zaman(?:dı|di)?$/u,
  /\s+(?:ne (?:cevap|yanıt|tavsiye|tepki) (?:ver|et)\p{L}*|ne (?:dedi|demişti|demiş|söyledi|söylemişti|yazdı|yazmıştı)|nasıl (?:cevap|yanıt|tepki) ver\p{L}*|ne düşündü\p{L}*)$/u,
  /\s+(?:mesaj|konuşma|sohbet|zaman|an|gün|dönem)(?:lar)?\p{L}{0,6}$/u,
  /\s+(?:söyle|de|yaz|anlat|açıkla|bahset|konuş|sor|mesaj at)\p{L}*(?:dığ|diğ|duğ|düğ|tığ|tiğ|tuğ|tüğ|ince|ınca|unca|ünce|yince|yınca)\p{L}*$/u,
];

/** The question with request framing removed, for the embedding model. */
export function meaningText(question: string): string {
  let s = question.replace(/\s+/g, " ").trim().replace(/[?!.]+$/u, "").trim();
  const lower = () => s.toLocaleLowerCase("en");
  for (let changed = true; changed;) {
    changed = false;
    for (const re of EN_LEAD) {
      const m = lower().match(re);
      if (m && m[0].length < s.length) { s = s.slice(m[0].length).trim(); changed = true; }
    }
    for (const re of TR_TAIL) {
      const m = s.toLocaleLowerCase("tr").match(re);
      if (m && m.index! > 0) { s = s.slice(0, m.index).trim(); changed = true; }
    }
  }
  return s || question.trim();
}
