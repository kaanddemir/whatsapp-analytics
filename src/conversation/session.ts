/* One open conversation: the parse result plus everything derived
   from it on demand (keyword index, behaviour matches, plan timeline). Each
   derived structure is built the first time a request needs it and kept
   until the chat is closed; they are pure functions of the messages, so
   these caches are not persisted. */
import type { AnalysisFilters, ParseResult, Stats } from "@/model";
import { analyze } from "@/analytics";
import type { Evidence, MessageId, MessageView } from "@/conversation/types";
import type { SearchPage, TimelineThread, TimelinePage } from "@/conversation/results";
import { buildKeywordIndex, highlights, search, type KeywordIndex, type SearchSort } from "@/search/keywordIndex";
import { behaviourReport, counted, matchAll, type BehaviourReport, type Matches } from "@/behaviour/analysis";
import type { Behaviour } from "@/behaviour/rules";
import { buildTimeline, threadsIn, type Timeline } from "@/events/timeline";
import { extractDates } from "@/events/dates";

/** A mention of day/month that also states `year`, or states no year at all. */
function extractDatesYearMatches(text: string, day: number, month: number, year: number): boolean {
  return extractDates(text).some((d) => d.kind === "date" && d.day === day && d.month === month && (d.year === undefined || d.year === year));
}

const MAX_THREAD_MESSAGES = 40;

const DAY_MS = 86_400_000;
const isoOf = (ts: number) => new Date(ts).toISOString().slice(0, 19);

/** Inclusive ISO dates -> [from, to) in message time. */
export function timeRange(filters: Pick<AnalysisFilters, "start" | "end">): { from: number | null; to: number | null } {
  return {
    from: filters.start ? Date.parse(`${filters.start}T00:00:00Z`) : null,
    to: filters.end ? Date.parse(`${filters.end}T00:00:00Z`) + DAY_MS : null,
  };
}

export class ChatSession {
  private index: KeywordIndex | null = null;
  private matches: Matches | null = null;
  private timelineData: Timeline | null = null;
  private readonly statsCache = new Map<string, Stats>();
  private last: { key: string; ids: Int32Array; terms: readonly string[]; phrases: readonly string[] } | null = null;

  constructor(readonly parsed: ParseResult) {}

  get size(): number {
    return this.parsed.messages.length;
  }

  view(id: MessageId): MessageView {
    const m = this.parsed.messages[id]!;
    return {
      id, at: isoOf(m.ts), sender: m.sender, senderName: this.parsed.participants[m.sender]?.name ?? "", kind: m.kind, text: m.text, edited: m.edited === true,
    };
  }

  evidence(id: MessageId, terms: readonly string[] = [], phrases: readonly string[] = []): Evidence {
    const message = this.view(id);
    return { message, highlights: message.kind === "text" && (terms.length || phrases.length) ? highlights(message.text, terms, phrases) : [] };
  }

  /** The keyword index, built on first use. `onBuild` fires only when it has to be built. */
  keywordIndex(onBuild?: () => void): KeywordIndex {
    if (!this.index) {
      onBuild?.();
      this.index = buildKeywordIndex(this.parsed.messages);
    }
    return this.index;
  }

  search(query: string, filters: AnalysisFilters, sort: SearchSort, offset: number, limit: number, onBuild?: () => void): SearchPage {
    const key = JSON.stringify([query, filters, sort]);
    if (this.last?.key !== key) {
      const index = this.keywordIndex(onBuild);
      const hits = search(index, this.parsed.messages, query, { ...timeRange(filters), sender: filters.sender }, sort);
      this.last = { key, ids: hits.ids, terms: hits.terms, phrases: hits.phrases };
    }
    const { ids, terms, phrases } = this.last;
    const items: Evidence[] = [];
    for (let i = offset; i < Math.min(ids.length, offset + limit); i++) items.push(this.evidence(ids[i]!, terms, phrases));
    return { total: ids.length, offset, items, terms };
  }

  /** Dashboard statistics for these filters, from the same engine, kept for the last few filter sets. */
  stats(filters: AnalysisFilters): Stats {
    const key = `${filters.start}|${filters.end}|${filters.sender}`;
    let s = this.statsCache.get(key);
    if (!s) {
      s = analyze(this.parsed, filters);
      if (this.statsCache.size >= 8) this.statsCache.delete(this.statsCache.keys().next().value!);
      this.statsCache.set(key, s);
    }
    return s;
  }

  behaviourMatches(onBuild?: () => void): Matches {
    if (!this.matches) {
      onBuild?.();
      this.matches = matchAll(this.parsed);
    }
    return this.matches;
  }

  /** Behaviour counts for the date filter. The participant filter does not apply: these compare people. */
  behaviour(filters: AnalysisFilters, onBuild?: () => void): BehaviourReport {
    return behaviourReport(this.parsed, this.behaviourMatches(onBuild), timeRange(filters), { from: filters.start, to: filters.end });
  }

  /** The messages behind one count (a person's, or everyone's), oldest first, a page at a time. */
  behaviourEvidence(behaviour: Behaviour, sender: number | null, filters: AnalysisFilters, offset: number, limit: number, onBuild?: () => void): { total: number; items: Evidence[] } {
    const { from, to } = timeRange(filters);
    const ids = [...counted(this.parsed, this.behaviourMatches(onBuild), behaviour, from ?? -Infinity, to ?? Infinity, sender)];
    return { total: ids.length, items: ids.slice(offset, offset + limit).map((id) => this.evidence(id)) };
  }

  timeline(onBuild?: () => void): Timeline {
    if (!this.timelineData) {
      const matches = this.behaviourMatches(onBuild);
      onBuild?.();
      this.timelineData = buildTimeline(this.parsed, matches);
    }
    return this.timelineData;
  }

  /** Plan conversations in the filters, newest first (or oldest), a page at a time. */
  timelinePage(filters: AnalysisFilters, order: "newest" | "oldest", offset: number, limit: number, onBuild?: () => void): TimelinePage {
    const t = this.timeline(onBuild);
    const { from, to } = timeRange(filters);
    const threads = threadsIn(t, this.parsed.messages, from, to, filters.sender);
    if (order === "newest") threads.reverse();
    const page = threads.slice(offset, offset + limit).map((th): TimelineThread => ({
      from: this.view(th.first).at,
      to: this.view(th.last).at,
      participants: th.participants.map((p) => this.parsed.participants[p]?.name ?? ""),
      size: th.messages.length,
      messages: th.messages.slice(0, MAX_THREAD_MESSAGES).map((pm) => ({
        evidence: { message: this.view(pm.id), highlights: pm.mentions.map((d) => [d.start, d.end] as const) },
        tags: pm.tags,
        mentions: pm.mentions,
      })),
    }));
    return { total: threads.length, offset, threads: page, datedMessages: t.datedMessages };
  }

  /** Messages naming a calendar day ("12/4"), optionally a year, within the filters. */
  mentioning(day: number, month: number, year: number | null, filters: AnalysisFilters, onBuild?: () => void): MessageId[] {
    const t = this.timeline(onBuild);
    const { from, to } = timeRange(filters);
    return (t.byDayMonth.get(`${day}/${month}`) ?? []).filter((id) => {
      const m = this.parsed.messages[id]!;
      if ((from !== null && m.ts < from) || (to !== null && m.ts >= to) || (filters.sender !== null && m.sender !== filters.sender)) return false;
      return year === null || extractDatesYearMatches(m.text, day, month, year);
    });
  }

  /** `before` and `after` neighbours of a message, in chat order. */
  context(id: MessageId, before: number, after: number): MessageView[] {
    const out: MessageView[] = [];
    for (let i = Math.max(0, id - before); i <= Math.min(this.size - 1, id + after); i++) out.push(this.view(i));
    return out;
  }
}
