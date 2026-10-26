/* Keyword search over one chat's messages.

   Index: every distinct folded word of the typed text messages (media
   placeholders, deleted and missing messages carry no words) with the list
   of messages it occurs in, in compressed-sparse-row form: one Int32Array of
   message numbers for all words, and per word an offset into it. Words are
   kept sorted, so all words beginning with a query word form one range found
   by binary search.

   Matching rules, chosen for Turkish (a suffixing language) and informal
   spelling:
   - Each query word matches any word that begins with it after folding:
     "kahve" finds "kahveye", "Kahveci", "kahvede"; "gorus" finds "görüşürüz".
     Query words of one or two letters must match a whole word.
   - All query words must occur in the message (AND).
   - "A quoted phrase" must occur as written (folded) in the message.
   - Participant and date filters narrow the set before ranking.

   Ranking (sort "relevance"): rarer words weigh more; a whole-word match
   beats a longer word that merely begins with the query; shorter messages
   win ties, then newer ones. Sort "newest"/"oldest" ignore relevance. The
   total is exact: every matching message is counted, not just the first page.

   Message numbers are indexes into ParseResult.messages, the same numbers
   used everywhere a message is cited. */
import type { Message } from "@/model";
import { foldAligned, tokens, TOKEN_RE } from "@/text/fold";

export interface KeywordIndex {
  /** Sorted distinct words. */
  readonly words: readonly string[];
  /** words[w] occurs in messages postings[offsets[w] .. offsets[w+1]), ascending, no duplicates. */
  readonly offsets: Int32Array;
  readonly postings: Int32Array;
  /** Word count per message (0 for non-text). */
  readonly lengths: Uint16Array;
  readonly messageCount: number;
  readonly buildMs: number;
}

export function buildKeywordIndex(messages: readonly Message[]): KeywordIndex {
  const t0 = performance.now();
  const ids = new Map<string, number>();
  // (word, message) pairs in message order; grown by doubling.
  let pairW = new Int32Array(1 << 16);
  let pairM = new Int32Array(1 << 16);
  let n = 0;
  const lengths = new Uint16Array(messages.length);
  const seen = new Set<number>();
  for (let m = 0; m < messages.length; m++) {
    const msg = messages[m]!;
    if (msg.kind !== "text") continue;
    const ws = tokens(foldAligned(msg.text));
    lengths[m] = Math.min(ws.length, 65535);
    seen.clear();
    for (const w of ws) {
      let id = ids.get(w);
      if (id === undefined) {
        id = ids.size;
        ids.set(w, id);
      }
      if (seen.has(id)) continue;
      seen.add(id);
      if (n === pairW.length) {
        const w2 = new Int32Array(n * 2); w2.set(pairW); pairW = w2;
        const m2 = new Int32Array(n * 2); m2.set(pairM); pairM = m2;
      }
      pairW[n] = id;
      pairM[n] = m;
      n++;
    }
  }
  // Sort words, renumber, then counting sort of the pairs by word (stable: messages stay ascending).
  const unsorted = [...ids.keys()];
  const order = unsorted.map((_, i) => i).sort((a, b) => (unsorted[a]! < unsorted[b]! ? -1 : unsorted[a]! > unsorted[b]! ? 1 : 0));
  const rank = new Int32Array(order.length);
  order.forEach((old, i) => { rank[old] = i; });
  const words = order.map((i) => unsorted[i]!);
  const offsets = new Int32Array(words.length + 1);
  for (let i = 0; i < n; i++) offsets[rank[pairW[i]!]! + 1]!++;
  for (let w = 0; w < words.length; w++) offsets[w + 1]! += offsets[w]!;
  const fill = offsets.slice(0, words.length);
  const postings = new Int32Array(n);
  for (let i = 0; i < n; i++) postings[fill[rank[pairW[i]!]!]!++] = pairM[i]!;
  return { words, offsets, postings, lengths, messageCount: messages.length, buildMs: Math.round(performance.now() - t0) };
}

/** Bytes held by the index's typed arrays (words excluded). */
export const indexBytes = (index: KeywordIndex) => index.offsets.byteLength + index.postings.byteLength + index.lengths.byteLength;

export interface ParsedQuery {
  /** Folded query words (outside quotes). */
  readonly terms: readonly string[];
  /** Folded phrases (inside quotes). */
  readonly phrases: readonly string[];
}

export function parseQuery(query: string): ParsedQuery {
  const phrases: string[] = [];
  const rest = query.replace(/["“”«»]([^"“”«»]+)["“”«»]/g, (_, p: string) => {
    const f = foldAligned(p).replace(/\s+/g, " ").trim();
    if (f) phrases.push(f);
    return " ";
  });
  const terms = [...new Set(tokens(foldAligned(rest)))];
  // Phrase words also narrow the candidates through the index.
  for (const p of phrases) for (const w of tokens(p)) if (!terms.includes(w)) terms.push(w);
  return { terms, phrases };
}

function lowerBound(words: readonly string[], key: string): number {
  let lo = 0, hi = words.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid]! < key) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Word ids matching a query term: whole word for 1–2 letters, else every word starting with it. */
export function matchingWords(index: KeywordIndex, term: string): number[] {
  const start = lowerBound(index.words, term);
  if (term.length <= 2) return index.words[start] === term ? [start] : [];
  const out: number[] = [];
  for (let w = start; w < index.words.length && index.words[w]!.startsWith(term); w++) out.push(w);
  return out;
}

export interface SearchFilter {
  /** Inclusive start / exclusive end, in message time (ms, UTC-as-local). */
  readonly from?: number | null;
  readonly to?: number | null;
  readonly sender?: number | null;
}

export type SearchSort = "relevance" | "newest" | "oldest";

export interface SearchHits {
  /** All matching message numbers, in the requested order. */
  readonly ids: Int32Array;
  readonly total: number;
  readonly terms: readonly string[];
  readonly phrases: readonly string[];
}

export function search(index: KeywordIndex, messages: readonly Message[], query: string, filter: SearchFilter = {}, sort: SearchSort = "relevance"): SearchHits {
  const q = parseQuery(query);
  if (q.terms.length === 0) return { ids: new Int32Array(), total: 0, terms: q.terms, phrases: q.phrases };
  // Per term: score contribution per matching message (whole word 1, prefix 0.7), times idf.
  const N = Math.max(1, index.messageCount);
  let scores: Map<number, number> | null = null;
  // Rarest term first keeps the intersection small.
  const perTerm = q.terms.map((term) => {
    const ws = matchingWords(index, term);
    let df = 0;
    for (const w of ws) df += index.offsets[w + 1]! - index.offsets[w]!;
    return { term, ws, df };
  }).sort((a, b) => a.df - b.df);
  for (const { term, ws, df } of perTerm) {
    if (df === 0) return { ids: new Int32Array(), total: 0, terms: q.terms, phrases: q.phrases };
    const idf = Math.log(1 + N / df);
    const next = new Map<number, number>();
    for (const w of ws) {
      const weight = (index.words[w] === term ? 1 : 0.7) * idf;
      for (let p = index.offsets[w]!; p < index.offsets[w + 1]!; p++) {
        const m = index.postings[p]!;
        if (scores && !scores.has(m)) continue;
        // A message can match a term through several words; keep the best.
        const prev = next.get(m);
        const base = scores ? scores.get(m)! : 0;
        const value = base + weight;
        if (prev === undefined || value > prev) next.set(m, value);
      }
    }
    scores = next;
    if (scores.size === 0) break;
  }
  const from = filter.from ?? -Infinity, to = filter.to ?? Infinity, sender = filter.sender ?? null;
  const kept: number[] = [];
  for (const m of scores!.keys()) {
    const msg = messages[m]!;
    if (msg.ts < from || msg.ts >= to || (sender !== null && msg.sender !== sender)) continue;
    if (q.phrases.length) {
      const f = foldAligned(msg.text).replace(/\s+/g, " ");
      if (!q.phrases.every((p) => f.includes(p))) continue;
    }
    kept.push(m);
  }
  if (sort === "newest") kept.sort((a, b) => b - a);
  else if (sort === "oldest") kept.sort((a, b) => a - b);
  else {
    const s = scores!;
    const score = (m: number) => s.get(m)! / (1 + Math.log(1 + index.lengths[m]!) * 0.15);
    kept.sort((a, b) => score(b) - score(a) || b - a);
  }
  return { ids: Int32Array.from(kept), total: kept.length, terms: q.terms, phrases: q.phrases };
}

/** Spans [start, end) of `text` to highlight for a search: words that begin with a query term, and phrases. */
export function highlights(text: string, terms: readonly string[], phrases: readonly string[] = []): [number, number][] {
  const folded = foldAligned(text);
  const spans: [number, number][] = [];
  for (const m of folded.matchAll(TOKEN_RE)) {
    const w = m[0];
    if (terms.some((t) => (t.length <= 2 ? w === t : w.startsWith(t)))) spans.push([m.index!, m.index! + w.length]);
  }
  for (const p of phrases) {
    let at = folded.indexOf(p);
    while (at >= 0) {
      spans.push([at, at + p.length]);
      at = folded.indexOf(p, at + 1);
    }
  }
  spans.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else merged.push([s[0], s[1]]);
  }
  return merged;
}
