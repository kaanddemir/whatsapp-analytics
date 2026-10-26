/* Hybrid retrieval: messages close in meaning, and messages sharing the
   question's informative words, ranked on one score.

   Candidates: the nearest message vectors, and the messages containing any
   content word of the question (a question rarely repeats every word of the
   message it is about). Every candidate is scored by its exact similarity to
   the question, plus a bonus for the share of the question's word weight
   (idf, whole word above prefix) it contains:

     score = similarity + lexicalWeight * coverage

   This replaced weighted Reciprocal Rank Fusion. RRF credits a message for
   its rank in the word list however weak the word match is, so for a
   paraphrase (no shared content words) chatter that shares one common word
   and is vaguely close in meaning outranked the right message: hybrid
   paraphrase recall fell below meaning alone (the conversational retrieval evaluation, and the
   earlier semanticEval). With a stronger model RRF lost 0.09 Recall@10
   against meaning alone. A coverage bonus is small for a weak word match and
   large when a message carries most of the question's rare words (names,
   codes), so exact matches still rise. The weight is per model (ModelSpec).

   Deterministic: ties go to higher coverage, then the newer message. */
import type { Message } from "@/model";
import { foldAligned, tokens } from "@/text/fold";
import { matchingWords, type KeywordIndex } from "@/search/keywordIndex";
import type { Hit } from "./vectors";

/** Candidates taken from each list. */
export const CANDIDATES = 200;

/** Question words that say what to do, not what it is about (folded). */
const STOP = new Set([
  // Turkish request and function words
  "bul", "bulur", "musun", "misin", "goster", "ara", "hangi", "ne", "zaman", "nezaman", "nerede", "nasil", "kim", "kimin", "biz", "bizim", "ben", "benim", "sen", "senin",
  "o", "ona", "onu", "onun", "bana", "sana", "mi", "mu", "mı", "da", "de", "ki", "ve", "ile", "icin", "bir", "bu", "su", "sey", "gibi", "kadar", "daha", "cok", "en",
  "konusma", "konusmayi", "konusmamizi", "konusmamizda", "konusmalari", "konusmalarimizi", "konustugumuz", "konustuk", "konusmustuk", "mesaj", "mesajlar", "mesajlari",
  "mesajlarini", "bahsettik", "bahsetmistik", "bahsettigimiz", "dedik", "dedigim", "dedigimiz", "dedigi", "soyledim", "soyledigim", "soyledigimde", "soyledi", "soyledigi",
  "zamanlar", "zamanlari", "zaman", "gecen", "yil", "yilki", "sene", "yaz", "kis", "bahar", "ay", "hafta", "cevap", "vermisti", "verdi", "yanit", "dedi", "demisti", "hatirliyor",
  "hatirla", "olan", "oldugu", "ettigimiz", "yaptigimiz", "tum", "hepsi",
  // English
  "find", "show", "search", "the", "a", "an", "of", "in", "on", "to", "and", "or", "about", "when", "what", "which", "where", "how", "who", "did", "do", "does", "we",
  "us", "our", "i", "me", "my", "you", "your", "she", "he", "her", "him", "they", "them", "it", "that", "this", "conversation", "conversations", "message", "messages",
  "talked", "talk", "said", "say", "told", "tell", "reply", "replied", "answer", "answered", "respond", "responded", "last", "year", "summer", "time", "times", "remember",
  "was", "were", "is", "are", "be", "have", "had", "has",
]);

/** Folded content words of a question, in order, without request words. */
export function contentTerms(question: string): string[] {
  return [...new Set(tokens(foldAligned(question)).filter((w) => !STOP.has(w) && !/^\d+$/.test(w)))];
}

export interface CandidateFilter { readonly from: number; readonly to: number; readonly sender: number | null }

export const passes = (m: Message, f: CandidateFilter) => m.ts >= f.from && m.ts < f.to && (f.sender === null || m.sender === f.sender);

/** Messages containing any of `terms`, best first. */
export function lexicalCandidates(index: KeywordIndex, messages: readonly Message[], terms: readonly string[], filter: CandidateFilter, limit = CANDIDATES): number[] {
  if (!terms.length) return [];
  const N = Math.max(1, index.messageCount);
  const scores = new Map<number, number>();
  for (const term of terms) {
    // Two-letter words match whole words only (keyword index rule); single letters are noise.
    if (term.length < 2) continue;
    const ws = matchingWords(index, term);
    let df = 0;
    for (const w of ws) df += index.offsets[w + 1]! - index.offsets[w]!;
    if (!df) continue;
    const idf = Math.log(1 + N / df);
    const best = new Map<number, number>();
    for (const w of ws) {
      const weight = (index.words[w] === term ? 1 : 0.7) * idf;
      for (let p = index.offsets[w]!; p < index.offsets[w + 1]!; p++) {
        const m = index.postings[p]!;
        if ((best.get(m) ?? 0) < weight) best.set(m, weight);
      }
    }
    for (const [m, s] of best) scores.set(m, (scores.get(m) ?? 0) + s);
  }
  const kept: [number, number][] = [];
  for (const [m, s] of scores) if (passes(messages[m]!, filter)) kept.push([m, s / (1 + Math.log(1 + index.lengths[m]!) * 0.15)]);
  kept.sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  return kept.slice(0, limit).map(([m]) => m);
}

/** Share of the question's word weight each message contains: the sum of the idf of the terms it
    matches (whole word 1, prefix 0.7, as in keyword search), divided by the idf of all the terms. */
export function coverage(index: KeywordIndex, terms: readonly string[]): Map<number, number> {
  const N = Math.max(1, index.messageCount);
  const out = new Map<number, number>();
  let total = 0;
  for (const term of terms) {
    if (term.length < 2) continue;
    const ws = matchingWords(index, term);
    let df = 0;
    for (const w of ws) df += index.offsets[w + 1]! - index.offsets[w]!;
    // A term found nowhere still counts in the total: a message cannot cover what the chat never says.
    const idf = Math.log(1 + N / Math.max(1, df));
    total += idf;
    if (!df) continue;
    const best = new Map<number, number>();
    for (const w of ws) {
      const weight = index.words[w] === term ? 1 : 0.7;
      for (let p = index.offsets[w]!; p < index.offsets[w + 1]!; p++) {
        const m = index.postings[p]!;
        if ((best.get(m) ?? 0) < weight) best.set(m, weight);
      }
    }
    for (const [m, s] of best) out.set(m, (out.get(m) ?? 0) + s * idf);
  }
  if (total > 0) for (const [m, s] of out) out.set(m, s / total);
  return out;
}

/** What the semantic tier offers a ranking: the nearest vectors, and the similarity of any other message. */
export interface Meaning {
  readonly hits: readonly Hit[];
  /** Similarity of a message to the question; null when it has no vector (yet). */
  similarity(id: number): number | null;
  readonly lexicalWeight: number;
  /** Below this similarity a message is not considered related by meaning. */
  readonly minSimilarity: number;
}

export interface Ranked {
  readonly id: number;
  readonly score: number;
  /** Null when the message was not scored by meaning. */
  readonly similarity: number | null;
  readonly coverage: number;
}

/** Recall candidates, best first. Without `meaning`, the word ranking alone. */
export function rank(index: KeywordIndex, messages: readonly Message[], terms: readonly string[], filter: CandidateFilter, meaning: Meaning | null): Ranked[] {
  const cov = coverage(index, terms);
  if (!meaning) return lexicalCandidates(index, messages, terms, filter).map((id, i, all) => ({ id, score: all.length - i, similarity: null, coverage: cov.get(id) ?? 0 }));
  const pool = new Map<number, number>();
  for (const h of meaning.hits) if (h.score >= meaning.minSimilarity && passes(messages[h.id]!, filter)) pool.set(h.id, h.score);
  const lexical = [...cov].filter(([id]) => passes(messages[id]!, filter)).sort((a, b) => b[1] - a[1] || b[0] - a[0]).slice(0, CANDIDATES);
  const out: Ranked[] = [];
  for (const [id, c] of lexical) {
    if (pool.has(id)) continue;
    // A message found by its words but not (yet) indexed keeps its word score; one indexed but unrelated is still ranked.
    const s = meaning.similarity(id);
    out.push({ id, similarity: s, coverage: c, score: (s ?? meaning.minSimilarity) + meaning.lexicalWeight * c });
  }
  for (const [id, s] of pool) { const c = cov.get(id) ?? 0; out.push({ id, similarity: s, coverage: c, score: s + meaning.lexicalWeight * c }); }
  return out.sort((a, b) => b.score - a.score || b.coverage - a.coverage || b.id - a.id);
}
