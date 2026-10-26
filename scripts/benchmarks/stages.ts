/* derived pipeline stages for import.ts (BENCH_STAGES=1), using the production modules. */
import type { ParseResult } from "@/model";
import { buildKeywordIndex, indexBytes, search } from "@/search/keywordIndex";
import { behaviourReport, matchAll } from "@/behaviour/analysis";
import { buildTimeline } from "@/events/timeline";
import { ChatSession } from "@/conversation/session";
import { answer } from "@/ask/answer";
import { NO_FILTERS } from "@/model";

type Stage = <T>(name: string, fn: () => T | Promise<T>) => Promise<T>;
export const extraResults: Record<string, unknown> = {};

const QUERIES = ["toplantı", "trafik", "kira unutma", "the", "\"sınav sonuçları\"", "netflix series", "çocukları okuldan", "gym", "xyzzy", "a"];
const pct = (a: number[], p: number) => +[...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))]!.toFixed(2);

export async function run(parsed: ParseResult, stage: Stage): Promise<void> {
  const index = await stage("searchIndex", () => buildKeywordIndex(parsed.messages));
  extraResults.searchIndexMB = +(indexBytes(index) / 1024 / 1024).toFixed(1);
  extraResults.vocabulary = index.words.length;
  const lat: number[] = [];
  const totals: Record<string, number> = {};
  await stage("searchQueries", () => {
    for (let rep = 0; rep < 3; rep++) for (const q of QUERIES) {
      const t = performance.now();
      const hits = search(index, parsed.messages, q, {}, "relevance");
      lat.push(performance.now() - t);
      totals[q] = hits.total;
    }
  });
  extraResults.searchMsP50 = pct(lat, 0.5);
  extraResults.searchMsP95 = pct(lat, 0.95);
  extraResults.searchMsMax = pct(lat, 1);
  extraResults.searchTotals = totals;

  const matches = await stage("behaviourMatch", () => matchAll(parsed));
  const report = await stage("behaviourReport", () => behaviourReport(parsed, matches, { from: null, to: null }, { from: null, to: null }));
  extraResults.behaviourTotals = Object.fromEntries(report.results.map((r) => [r.behaviour, r.total]));
  extraResults.languageMix = report.languageMix;
  const timeline = await stage("timeline", () => buildTimeline(parsed, matches));
  extraResults.planThreads = timeline.threads.length;
  extraResults.datedMessages = timeline.datedMessages;
  // Ask latency with every derived structure already built (the session reuses them).
  const session = new ChatSession(parsed);
  session.keywordIndex(); session.behaviourMatches(); session.timeline();
  const askLat: number[] = [];
  await stage("ask", () => {
    for (const q of ["Who sent more messages?", "How many messages in 2018?", "Kim daha çok buluşma öneriyor?", "When did we first talk about netflix?", "kira hakkındaki mesajlar", "Who apologizes more?"]) {
      const t = performance.now();
      answer(q, session, NO_FILTERS);
      askLat.push(performance.now() - t);
    }
  });
  extraResults.askMsMax = +Math.max(...askLat).toFixed(1);
  extraResults.askMsP50 = pct(askLat, 0.5);
}
