/* ParseResult + filters -> Stats. Pure and synchronous; runs in the worker.

   Parsing happens once per file; only this step re-runs when filters change
   (the former server re-parsed the export on every filter change). Module map:

     scope.ts     date/sender filters -> conversation, humans, scoped, period
     volume.ts    KPIs, timeline (partial buckets), hours, weekdays, heatmap
     content.ts   emojis, keywords, media breakdown
     text.ts      emoji regex, tokeniser, C3/C4 normalisation
     people.ts    balance, response time, starter, night owl
     insights.ts  most active window, longest streak
     highlights.ts  derived details for card explanations and Recap
     numbers.ts   exact rounding, median, largest remainder, ranking */
import type { AnalysisFilters, AnalysisOptions, Insights, ParseResult, Stats } from "@/model";
import { DEFAULT_OPTIONS } from "@/model";
import { isoOfDay } from "./calendar";
import { content } from "./content";
import { longestStreak, mostActiveWindow } from "./insights";
import { highlights } from "./highlights";
import { conversationStarter, nightOwl, participants, senderCounts } from "./people";
import { selectScope } from "./scope";
import { detectLocale, keywordExtractor, type KeywordExtractor, type KeywordLocale } from "./text";
import { busiestWeekday, kpis, timeline, timing } from "./volume";

export { AnalysisError } from "./scope";
export type { AnalysisErrorCode } from "./scope";

// Per-chat facts that do not depend on filters, computed once per ParseResult.
interface ChatFacts {
  readonly locale: KeywordLocale;
  readonly keywords: KeywordExtractor;
  readonly resolution: "minute" | "second";
}
const facts = new WeakMap<ParseResult, ChatFacts>();

function chatFacts(parsed: ParseResult): ChatFacts {
  let found = facts.get(parsed);
  if (!found) {
    const locale = detectLocale(textsOf(parsed));
    found = {
      locale,
      keywords: keywordExtractor(locale),
      resolution: parsed.messages.some((m) => m.ts % 60_000 !== 0) ? "second" : "minute",
    };
    facts.set(parsed, found);
  }
  return found;
}

function* textsOf(parsed: ParseResult) {
  for (const m of parsed.messages) if (m.kind === "text") yield m.text;
}

export function analyze(parsed: ParseResult, filters: AnalysisFilters, options: AnalysisOptions = DEFAULT_OPTIONS): Stats {
  if (parsed.messages.length === 0) throw new RangeError("analyze needs at least one message");
  const { keywords, resolution } = chatFacts(parsed);
  const scope = selectScope(parsed, filters);
  const { scoped, humans, period } = scope;

  const time = timing(scoped, period);
  const k = kpis(scoped, period, time.hours);
  const series = timeline(scoped, period);
  const contentStats = content(scoped, keywords, options.topLimit);
  const people = participants(parsed, humans, options);
  const insights: Insights = {
    mostActiveWindow: mostActiveWindow(time.hours, k.peakHour, k.totalMessages),
    busiestWeekday: busiestWeekday(scoped, period),
    longestStreak: longestStreak(scoped),
    conversationStarter: conversationStarter(humans, options.sessionGapSeconds),
    nightOwl: nightOwl(humans, options),
  };

  return {
    meta: {
      chatType: parsed.chatType,
      participants: [...senderCounts(humans).keys()],
      activeSender: filters.sender,
      fullRange: { start: isoOfDay(scope.fullStart), end: isoOfDay(scope.fullEnd) },
      range: period && { start: isoOfDay(period.start), end: isoOfDay(period.end) },
      conversationTotal: scope.conversation.length,
      timestampResolution: resolution,
      empty: scoped.length === 0,
    },
    kpis: k,
    timeline: series,
    timing: time,
    content: contentStats,
    participants: people,
    insights,
    highlights: highlights(period, k, series, time, contentStats, people, insights, options),
  };
}
