/* Plans and dates: a conservative timeline of plan-related messages.

   A message is plan-related when it suggests meeting, accepts a suggestion,
   uses cancellation wording (behaviour rules), or names a date or a time
   (dates.ts). Plan-related messages close together in time (no gap over
   3 hours) form one conversation, grouped by time only: whether two
   conversations are about the same plan is not decided.

   What is shown is what each message says, tagged per message. The
   timeline never states that a plan was confirmed, cancelled, decided or
   happened: interleaved-plan linking is unvalidated and relative-date
   resolution is unreliable (docs/ARCHITECTURE.md). Relative dates
   ("yarın", "next Friday") are marked, never turned into calendar dates. */
import type { Message, ParseResult, ParticipantId } from "@/model";
import type { MessageId } from "@/conversation/types";
import { extractDates, type DateMention } from "./dates";
import type { Matches } from "@/behaviour/analysis";

export const THREAD_GAP_MS = 3 * 3_600_000;

export type PlanTag = "suggestion" | "accepts" | "cancellation_wording" | "date" | "time" | "relative" | "ambiguous";

export interface PlanMessage {
  readonly id: MessageId;
  readonly tags: readonly PlanTag[];
  readonly mentions: readonly DateMention[];
}

export interface PlanThread {
  readonly first: MessageId;
  readonly last: MessageId;
  readonly messages: readonly PlanMessage[];
  readonly participants: readonly ParticipantId[];
}

export interface Timeline {
  readonly threads: readonly PlanThread[];
  /** Messages mentioning each resolved day-month ("12/4"), for date questions. */
  readonly byDayMonth: ReadonlyMap<string, readonly MessageId[]>;
  readonly datedMessages: number;
  readonly buildMs: number;
}

const BIT = { proposal: 1, acceptance: 2, cancellation: 8 } as const;

export function buildTimeline(parsed: ParseResult, matches: Matches): Timeline {
  const t0 = performance.now();
  const { messages } = parsed;
  const plan: PlanMessage[] = [];
  const byDayMonth = new Map<string, MessageId[]>();
  let datedMessages = 0;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    if (m.kind !== "text") continue;
    // Cheap pre-check: no digit and no flag means no date, no time and no plan cue worth a full scan of relative words alone.
    const flags = matches.flags[i]!;
    const hasDigit = /\d/.test(m.text);
    const relevantFlags = flags & (BIT.proposal | BIT.acceptance | BIT.cancellation);
    if (!hasDigit && !relevantFlags) continue;
    const mentions = extractDates(m.text);
    const resolved = mentions.filter((d) => d.kind === "date" || d.kind === "time");
    if (resolved.length) datedMessages++;
    for (const d of mentions) if (d.kind === "date") {
      const key = `${d.day}/${d.month}`;
      let list = byDayMonth.get(key);
      if (!list) byDayMonth.set(key, (list = []));
      list.push(i);
    }
    if (!relevantFlags && !resolved.length && !mentions.some((d) => d.kind === "ambiguous")) continue;
    const tags: PlanTag[] = [];
    if (flags & BIT.proposal) tags.push("suggestion");
    if (flags & BIT.acceptance) tags.push("accepts");
    if (flags & BIT.cancellation) tags.push("cancellation_wording");
    for (const k of ["date", "time", "relative", "ambiguous"] as const) if (mentions.some((d) => d.kind === k)) tags.push(k);
    plan.push({ id: i, tags, mentions });
  }
  const threads: PlanThread[] = [];
  let current: PlanMessage[] = [];
  const flush = () => {
    if (!current.length) return;
    const participants = [...new Set(current.map((p) => messages[p.id]!.sender))];
    threads.push({ first: current[0]!.id, last: current[current.length - 1]!.id, messages: current, participants });
    current = [];
  };
  for (const p of plan) {
    const prev = current[current.length - 1];
    if (prev && messages[p.id]!.ts - messages[prev.id]!.ts > THREAD_GAP_MS) flush();
    current.push(p);
  }
  flush();
  return { threads, byDayMonth, datedMessages, buildMs: Math.round(performance.now() - t0) };
}

/** Threads overlapping the date range, optionally only those a participant wrote in. */
export function threadsIn(timeline: Timeline, messages: readonly Message[], from: number | null, to: number | null, sender: ParticipantId | null): PlanThread[] {
  const lo = from ?? -Infinity, hi = to ?? Infinity;
  return timeline.threads.filter((t) => {
    const a = messages[t.first]!.ts, b = messages[t.last]!.ts;
    if (b < lo || a >= hi) return false;
    return sender === null || t.participants.includes(sender);
  });
}
