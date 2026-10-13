/* Filters -> the message sets each metric reads.

   Two scopes, never mixed:
   - conversation: every message in the date range, all senders. Interaction
     metrics use its human part (Meta AI removed), because a reply, a
     conversation start or a share of the balance needs everyone.
   - scoped: the conversation narrowed to the sender filter. Volume metrics
     (KPIs, timeline, timing, content, window, weekday, streak) use it.
   The period is the date filter clamped to the chat's own bounds, and it does
   not depend on the sender filter, so every person's chart shares one axis.
   Legacy used the first and last message of the narrowed set instead. */
import type { AnalysisFilters, Message, ParseResult } from "@/model";
import { dayOf, dayOfIso } from "./calendar";

export type AnalysisErrorCode = "invalid_filter";

export class AnalysisError extends Error {
  readonly code: AnalysisErrorCode;
  constructor(code: AnalysisErrorCode, message: string) {
    super(message);
    this.name = "AnalysisError";
    this.code = code;
  }
}

export interface Scope {
  readonly conversation: readonly Message[];
  readonly humans: readonly Message[];
  readonly scoped: readonly Message[];
  /** Inclusive day numbers; null when the filter misses the chat entirely. */
  readonly period: { readonly start: number; readonly end: number } | null;
  readonly fullStart: number;
  readonly fullEnd: number;
}

function bound(value: string | null, name: string): number | null {
  if (value === null) return null;
  const day = dayOfIso(value);
  if (day === null) throw new AnalysisError("invalid_filter", `The ${name} date is not a valid YYYY-MM-DD date.`);
  return day;
}

/** First index whose day is >= `day` (messages are sorted). */
function lowerBound(messages: readonly Message[], day: number): number {
  let lo = 0;
  let hi = messages.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (dayOf(messages[mid]!.ts) < day) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function selectScope(parsed: ParseResult, filters: AnalysisFilters): Scope {
  const all = parsed.messages;
  const start = bound(filters.start, "start");
  const end = bound(filters.end, "end");
  if (start !== null && end !== null && start > end) {
    throw new AnalysisError("invalid_filter", "The start date is after the end date.");
  }
  const { sender } = filters;
  if (sender !== null && !(Number.isInteger(sender) && sender >= 0 && sender < parsed.participants.length)) {
    throw new AnalysisError("invalid_filter", "That participant is not in this chat.");
  }

  const fullStart = dayOf(all[0]!.ts);
  const fullEnd = dayOf(all[all.length - 1]!.ts);
  const from = Math.max(start ?? fullStart, fullStart);
  const to = Math.min(end ?? fullEnd, fullEnd);
  const period = from <= to ? { start: from, end: to } : null;

  const conversation = period ? all.slice(lowerBound(all, period.start), lowerBound(all, period.end + 1)) : [];
  const human = parsed.participants.map((p) => !p.isMetaAI);
  const humans = conversation.filter((m) => human[m.sender]);
  const scoped = sender === null ? conversation : conversation.filter((m) => m.sender === sender);
  return { conversation, humans, scoped, period, fullStart, fullEnd };
}
