/* How an Ask answer is laid out. Pure decisions over the engine's structured
   Answer, so the components only render and nothing here computes a figure:
   bars are drawn from AnswerRow.magnitude, messages are grouped from the
   evidence the engine cited, in the order it cited them. */
import type { AnalysisFilters } from "@/model";
import type { Answer, AnswerRow } from "@/ask/types";
import type { Evidence } from "@/conversation/types";

/** Rows shown before "Show all". */
export const ROW_LIMIT = 8;
/** Message groups shown at first, and how many more each "Show more" adds. */
export const FIRST_MESSAGES = 4;
export const MORE_MESSAGES = 10;

/** Bars when every row is one measure on one scale (counts, shares, medians, words); a plain list otherwise
    (changes between two periods, behaviour rule matches) or for a single row, where a bar says nothing. */
export function rowsView(rows: readonly AnswerRow[]): "bars" | "list" | null {
  if (!rows.length) return null;
  return rows.length > 1 && rows.every((r) => r.magnitude !== null && Number.isFinite(r.magnitude) && r.magnitude >= 0) ? "bars" : "list";
}

/** Each row's bar as a percentage of the largest. */
export function barWidths(rows: readonly AnswerRow[]): number[] {
  const max = Math.max(0, ...rows.map((r) => r.magnitude ?? 0));
  return rows.map((r) => (max > 0 ? ((r.magnitude ?? 0) / max) * 100 : 0));
}

/** A cited message, with the reply the engine paired it with (recall questions that ask for the answer). */
export interface MessageGroup {
  readonly match: Evidence;
  readonly reply: Evidence | null;
}

export function messageGroups(answer: Answer): MessageGroup[] {
  const result = answer.result;
  if (result?.kind === "recall" && result.pairs.some((p) => p.reply !== null)) {
    const byId = new Map(answer.evidence.map((e) => [e.message.id, e]));
    return result.pairs.flatMap((p) => {
      const match = byId.get(p.match);
      return match ? [{ match, reply: p.reply === null ? null : byId.get(p.reply) ?? null }] : [];
    });
  }
  return answer.evidence.map((match) => ({ match, reply: null }));
}

/** A day's or a period's messages read as a transcript under day headings; anything ranked keeps its order and dates. */
export function isTranscript(answer: Answer): boolean {
  const plan = answer.plan;
  return plan.type === "temporal" && (plan.which === "on_date" || plan.which === "in_period");
}

/** Whether the engine's result can page beyond the cited messages (searches, behaviour examples, date mentions). */
export function pageable(answer: Answer): boolean {
  const kind = answer.result?.kind;
  return (kind === "search" || kind === "behaviour" || kind === "date") && answer.evidenceTotal > answer.evidence.length;
}

/** Same participant and dates: one scope. */
export const scopeKey = (filters: AnalysisFilters) => `${filters.sender ?? "*"}|${filters.start ?? ""}|${filters.end ?? ""}`;

/** Message text split at the highlighted ranges; ranges are sorted and clipped so bad input never repeats text. */
export function highlightParts(text: string, ranges: readonly (readonly [number, number])[]): { text: string; mark: boolean }[] {
  const parts: { text: string; mark: boolean }[] = [];
  let at = 0;
  for (const [s, e] of [...ranges].sort((a, b) => a[0] - b[0])) {
    const start = Math.max(at, Math.min(s, text.length)), end = Math.min(e, text.length);
    if (end <= start) continue;
    if (start > at) parts.push({ text: text.slice(at, start), mark: false });
    parts.push({ text: text.slice(start, end), mark: true });
    at = end;
  }
  if (at < text.length || !parts.length) parts.push({ text: text.slice(at), mark: false });
  return parts;
}
