/* Current e5-small retrieval evaluation on bilingual synthetic conversations.
   Run only with authorization and scripts/benchmarks/guard.ts (evaluate policy):
     scripts/benchmarks/semantic/run.ts dev|test [messages=8000]
   BENCH=chat (family split) or hard (held-out only). Reports ranking and full
   Ask pipeline accuracy, including misleading results for unrelated questions.
   No model or dataset downloads; BENCH_CACHE_ONLY=1 refuses uncached texts. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { buildKeywordIndex } from "@/search/keywordIndex";
import { isIndexable } from "@/semantic/units";
import { VectorIndex } from "@/semantic/vectors";
import { CANDIDATES, contentTerms, rank, passes, type CandidateFilter } from "@/semantic/hybrid";
import { meaningText } from "@/semantic/query";
import { NO_FILTERS, type Message, type ParseResult } from "@/model";
import { answer, type SemanticInput } from "@/ask/answer";
import { E5_SMALL } from "@/semantic/model";
import { route } from "@/ask/router";
import { ChatSession } from "@/conversation/session";
import { NEGATIVES, split } from "./families";
import { buildCorpus } from "./corpus";
import { cachedEmbedder } from "./embed";
import { CHATTER, HARD_CASES } from "./cases";

const [splitArg = "dev", nArg = "8000"] = process.argv.slice(2);
if (!["dev", "test"].includes(splitArg)) throw new Error("split must be dev or test");
if (!Number.isInteger(Number(nArg)) || Number(nArg) < 100 || Number(nArg) > 100000) throw new Error("messages must be 100–100000");
const mode = process.env.BENCH ?? "chat";
const model = { ...E5_SMALL, params: { lexicalWeight: E5_SMALL.lexicalWeight, minSimilarity: E5_SMALL.minSimilarity } };
const ALL: CandidateFilter = { from: -Infinity, to: Infinity, sender: null };
const frozen = createHash("sha256").update(readFileSync(new URL("./families.ts", import.meta.url))).digest("hex").slice(0, 16);
if (!["chat", "hard"].includes(mode)) throw new Error("BENCH must be chat or hard");
if (mode === "hard" && splitArg !== "test") throw new Error("the hard cases are a test set only");

interface Q { filter: CandidateFilter; seed: number; id: string; kind: string; lang: "tr" | "en"; factLang: "tr" | "en" | null; text: string; relevant: number[]; traps: number[] }
const emb = await cachedEmbedder();
const participants = [{ id: 0, name: "Ali", isMetaAI: false }, { id: 1, name: "Ayşe", isMetaAI: false }];
type Score = { r1: number; r5: number; r10: number; rr: number; ndcg: number; trap: number };
const rows: Record<string, { q: Q; s: Score }[]> = {};
const negTop: Record<string, number[]> = {}, posTop: number[] = [], goldSim: number[] = [];
const routed: Record<string, number> = {};
type E2E = { q: Q; shown5: number; shown: number; anything: number };
const e2e: E2E[] = [];

const seeds = mode === "hard" ? [1] : [1, 2];
for (const seed of seeds) {
  const corpus = mode === "hard" ? hardSet(seed) : chatSet(seed);
  const { messages, qs } = corpus;
  const units = messages.flatMap((m, i) => (isIndexable(m) ? [i] : []));
  const vecs = await emb.vectors(units.map((i) => model.passagePrefix + messages[i]!.text.replace(/\s+/g, " ").trim().slice(0, 1000)));
  const vindex = new VectorIndex(model.dim);
  vindex.add(units, vecs);
  const kindex = buildKeywordIndex(messages);
  const session = new ChatSession({ messages, participants, systemEvents: [], report: {} } as unknown as ParseResult);
  const embedQuery = async (t: string) => emb.vectors([model.queryPrefix + t.replace(/\s+/g, " ").trim()], 1);
  const seen = (ids: readonly number[]) => { const said = new Set<string>(); return ids.filter((id) => { const t = messages[id]!.text.toLocaleLowerCase("tr").replace(/\s+/g, " ").trim(); if (said.has(t)) return false; said.add(t); return true; }); };
  for (const q of qs) {
    const p = route(q.text, participants);
    const k = p.type === "unsupported" ? `unsupported:${p.reason}` : p.type;
    routed[k] = (routed[k] ?? 0) + 1;
    {
      const name = "current";
      const vector = await embedQuery(meaningText(q.text));
      const hits = vindex.search(vector, CANDIDATES, (id) => passes(messages[id]!, q.filter));
      const ids = rank(kindex, messages, contentTerms(q.text), q.filter, { hits, similarity: (id) => vindex.score(vector, id), ...model.params }).map((r) => r.id);
      const raw = { ids, top: hits[0]?.score ?? 0 };
      // The answer shows the same words once (answer.ts); score the list the user would see.
      const out = { top: raw.top, ids: seen(raw.ids) };
      if (!q.relevant.length) { (negTop[name] ??= []).push(out.top); continue; }
      if (name === "current") { posTop.push(out.top); const qv = await embedQuery(q.text); goldSim.push(Math.max(...q.relevant.map((id) => vindex.score(qv, id) ?? -1))); }
      const first = out.ids.findIndex((id) => q.relevant.includes(id));
      const firstTrap = out.ids.findIndex((id) => q.traps.includes(id));
      let dcg = 0, ideal = 0;
      out.ids.slice(0, 10).forEach((id, i) => { if (q.relevant.includes(id)) dcg += 1 / Math.log2(i + 2); });
      for (let i = 0; i < Math.min(10, q.relevant.length); i++) ideal += 1 / Math.log2(i + 2);
      (rows[name] ??= []).push({ q, s: { r1: +(first === 0), r5: +(first >= 0 && first < 5), r10: +(first >= 0 && first < 10), rr: first >= 0 ? 1 / (first + 1) : 0, ndcg: dcg / ideal, trap: +(firstTrap >= 0 && firstTrap < 10 && (first < 0 || firstTrap < first)) } });
    }
    // End to end, now: the worker's path (handler.ts) — semantic input for a recall plan or a topic search.
    let semantic: SemanticInput | null = null;
    if (p.type === "recall" || (p.type === "fact" && !p.exact)) {
      const qv = await embedQuery(meaningText(p.type === "recall" ? p.topic : q.text));
      semantic = { search: (keep) => vindex.search(qv, CANDIDATES, keep), similarity: (id) => vindex.score(qv, id), ...model.params, coverage: 1, status: "ready" };
    }
    // A range that is not in the question's words is the composer's date filter (the hard set's year case).
    const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
    const filters = Number.isFinite(q.filter.from) && !/\b(19|20)\d\d\b/.test(q.text) ? { ...NO_FILTERS, start: iso(q.filter.from), end: iso(q.filter.to - 86_400_000) } : NO_FILTERS;
    const a = answer(q.text, session, filters, undefined, q.lang, semantic);
    const shown = a.evidence.map((e) => e.message.id);
    e2e.push({ q, shown5: +shown.slice(0, 5).some((id) => q.relevant.includes(id)), shown: +shown.some((id) => q.relevant.includes(id)), anything: +(shown.length > 0) });
  }
}

function chatSet(seed: number): { messages: Message[]; qs: Q[] } {
  const { messages, planted } = buildCorpus(Number(nArg), seed);
  const qs: Q[] = [];
  for (const pl of planted) {
    if (split(pl.index) !== splitArg) continue;
    const v = pl.family[pl.lang];
    for (const q of pl.family.queries) {
      const gold = v.gold.map((g) => pl.ids[g]!);
      const relevant = q.reply !== undefined ? [...gold, pl.ids[q.reply - 1]!] : gold;
      qs.push({ filter: ALL, seed, id: `${pl.family.id}:${q.lang}`, kind: pl.family.kind, lang: q.lang, factLang: pl.lang, text: q.text, relevant, traps: pl.traps });
    }
  }
  if (seed === 1) NEGATIVES.forEach((q, i) => { if (split(i) === splitArg) qs.push({ filter: ALL, seed, id: `neg${i}`, kind: "negative", lang: q.lang, factLang: null, text: q.text, relevant: [], traps: [] }); });
  return { messages, qs };
}
/** Held-out difficult queries padded with synthetic chatter. */
function hardSet(seed: number): { messages: Message[]; qs: Q[] } {
  let rng = seed * 2654435761 >>> 0;
  const rand = () => ((rng = (Math.imul(rng ^ (rng >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 2 ** 32);
  const start = Date.UTC(2024, 0, 1), span = Date.UTC(2025, 11, 31) - start;
  const placed: { text: string; year?: number }[] = [];
  for (const c of HARD_CASES) {
    for (const t of [...c.gold, ...c.traps]) if (!placed.some((x) => x.text === t)) placed.push({ text: t });
    if (c.year) placed.push({ text: c.gold[0]!, year: c.year + 1 });
  }
  const rows: { ts: number; text: string }[] = [];
  for (let i = 0; i < 1500; i++) rows.push({ ts: start + Math.floor(rand() * span), text: CHATTER[Math.floor(rand() * CHATTER.length)]! });
  for (const x of placed) {
    const y = x.year ?? (x.text === "yeni bir eve geçsek nasıl olur?" ? 2024 : 2024 + Math.floor(rand() * 2));
    rows.push({ ts: Date.UTC(y, Math.floor(rand() * 12), 1 + Math.floor(rand() * 27), Math.floor(rand() * 24)), text: x.text });
  }
  rows.sort((a, b) => a.ts - b.ts);
  const messages = rows.map((r, i) => ({ ts: r.ts, sender: i % 3 === 0 ? 1 : 0, kind: "text", text: r.text }) as Message);
  const idsOf = (t: string, year?: number) => messages.flatMap((m, i) => (m.text === t && (!year || new Date(m.ts).getUTCFullYear() === year) ? [i] : []));
  const en = (t: string) => /^[\x00-\x7f]*$/.test(t) && /\b(the|when|i|about)\b/i.test(t);
  const qs = HARD_CASES.map((c) => ({
    seed, id: c.id, kind: c.phenomenon, lang: en(c.query) ? "en" as const : "tr" as const, factLang: en(c.gold[0]!) ? "en" as const : "tr" as const, text: c.query,
    relevant: c.gold.flatMap((t) => idsOf(t, c.year)), traps: c.traps.flatMap((t) => idsOf(t)),
    filter: c.year ? { from: Date.UTC(c.year, 0, 1), to: Date.UTC(c.year + 1, 0, 1), sender: null } : ALL,
  }));
  return { messages, qs };
}

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const r2 = (x: number) => Math.round(x * 100) / 100;
const agg = (list: { s: Score }[]) => ({ n: list.length, r1: r2(mean(list.map((x) => x.s.r1))), r5: r2(mean(list.map((x) => x.s.r5))), r10: r2(mean(list.map((x) => x.s.r10))), mrr: r2(mean(list.map((x) => x.s.rr))), ndcg: r2(mean(list.map((x) => x.s.ndcg))), trap: r2(mean(list.map((x) => x.s.trap))) });
const table: Record<string, unknown> = {};
for (const [name, list] of Object.entries(rows)) {
  const by = (f: (q: Q) => string) => Object.fromEntries([...new Set(list.map((x) => f(x.q)))].sort().map((k) => [k, agg(list.filter((x) => f(x.q) === k))]));
  const neg = negTop[name] ?? [];
  table[name] = {
    all: agg(list), lang: by((q) => `q-${q.lang}`), pair: by((q) => `${q.lang}->${q.factLang}`), cross: by((q) => (q.lang === q.factLang ? "same" : "cross")), kind: by((q) => q.kind),
    negatives: { n: neg.length, auc: posTop.length && neg.length ? r2(mean(posTop.map((p) => mean(neg.map((n) => (p > n ? 1 : p === n ? 0.5 : 0)))))) : null },
  };
}
const e2eAgg = (list: E2E[]) => {
  const pos = list.filter((x) => x.q.relevant.length), neg = list.filter((x) => !x.q.relevant.length);
  const by = (f: (q: Q) => string) => Object.fromEntries([...new Set(pos.map((x) => f(x.q)))].sort().map((k) => { const l = pos.filter((x) => f(x.q) === k); return [k, { n: l.length, shown5: r2(mean(l.map((x) => x.shown5))) }]; }));
  return { n: pos.length, shown5: r2(mean(pos.map((x) => x.shown5))), shown: r2(mean(pos.map((x) => x.shown))), lang: by((q) => `q-${q.lang}`), pair: by((q) => `${q.lang}->${q.factLang}`), cross: by((q) => (q.lang === q.factLang ? "same" : "cross")), kind: by((q) => q.kind),
    answerableShowingNothing: `${pos.filter((x) => !x.anything).length}/${pos.length}`, negativesShowingSomething: neg.length ? `${neg.filter((x) => x.anything).length}/${neg.length}` : null };
};
if (process.env.MISSES) for (const x of rows[process.env.MISSES] ?? []) if (!x.s.r10) console.error("miss", x.q.seed, x.q.id, x.q.kind, x.q.factLang, "|", x.q.text);
const qt = (a: number[], f: number) => { const s = [...a].sort((x, y) => x - y); return +(s[Math.floor(f * (s.length - 1))] ?? NaN).toFixed(3); };
const calibration = { goldSimilarity: { p02: qt(goldSim, 0.02), p05: qt(goldSim, 0.05), p10: qt(goldSim, 0.1), p50: qt(goldSim, 0.5) }, negativeTop: { p50: qt(negTop.current ?? [], 0.5), max: qt(negTop.current ?? [], 1) } };
console.log(JSON.stringify({ mode, model: model.repo, split: splitArg, n: Number(nArg), families: frozen, params: model.params, routed, e2e: e2eAgg(e2e), calibration, embed: emb.stats(), table }));
await emb.dispose();
