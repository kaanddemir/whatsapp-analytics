/* Interaction metrics over the human conversation in the date range (never
   the sender filter).

   Response time (C5, C6): for each message whose sender differs from the
   previous message's sender, the gap since that previous message, if it is
   under the reply window. It is reported as a median, never as an average,
   and "no gaps" (null) is distinct from a median of 0. The export does not
   record who answers whom; in groups this is "time after the previous
   speaker", not a proven reply. Timestamps without seconds make every gap a
   multiple of 60 s. */
import type { AnalysisOptions, Insights, Message, ParticipantId, ParticipantStats, ParseResult } from "@/model";
import { hourOf } from "./calendar";
import { largestRemainder, median, percent } from "./numbers";

/** Senders of `messages` with counts, in first-seen order. */
export function senderCounts(messages: readonly Message[]): Map<ParticipantId, number> {
  const counts = new Map<ParticipantId, number>();
  for (const m of messages) counts.set(m.sender, (counts.get(m.sender) ?? 0) + 1);
  return counts;
}

export function responseGaps(humans: readonly Message[], windowSeconds: number): Map<ParticipantId, number[]> {
  const gaps = new Map<ParticipantId, number[]>();
  for (let i = 1; i < humans.length; i++) {
    const prev = humans[i - 1]!;
    const cur = humans[i]!;
    if (cur.sender === prev.sender) continue;
    const seconds = (cur.ts - prev.ts) / 1000;
    if (seconds < 0 || seconds >= windowSeconds) continue;
    let list = gaps.get(cur.sender);
    if (!list) gaps.set(cur.sender, (list = []));
    list.push(seconds);
  }
  return gaps;
}

export function participants(parsed: ParseResult, humans: readonly Message[], options: AnalysisOptions): ParticipantStats[] {
  const counts = senderCounts(humans);
  // Ranked by count, ties in first-seen order (Counter.most_common).
  const ranked = [...counts].sort((a, b) => b[1] - a[1]);
  const shares = largestRemainder(ranked.map(([, n]) => n));
  const gaps = responseGaps(humans, options.replyWindowSeconds);
  return ranked.map(([id, messages], i) => {
    const list = gaps.get(id) ?? [];
    return {
      id,
      name: parsed.participants[id]!.name,
      messages,
      share: shares[i]!,
      responseTime: { median: median(list), sampleSize: list.length },
    };
  });
}

/**
 * A conversation starts with the first message and with every message that
 * follows a silence longer than the session gap. Ties go to whoever started
 * a conversation first.
 */
export function conversationStarter(humans: readonly Message[], gapSeconds: number): Insights["conversationStarter"] {
  const starts = new Map<ParticipantId, number>();
  for (let i = 0; i < humans.length; i++) {
    const m = humans[i]!;
    if (i === 0 || (m.ts - humans[i - 1]!.ts) / 1000 > gapSeconds) starts.set(m.sender, (starts.get(m.sender) ?? 0) + 1);
  }
  let best: [ParticipantId, number] | null = null;
  let total = 0;
  for (const entry of starts) {
    total += entry[1];
    if (!best || entry[1] > best[1]) best = entry;
  }
  if (!best) return { id: null, share: 0, count: 0, conversations: 0 };
  return { id: best[0], share: percent(best[1], total), count: best[1], conversations: total };
}

/**
 * Highest share of one's own messages sent in the night window, among people
 * with at least the minimum message count (everyone if nobody qualifies).
 * Ties: higher night count, then first seen. Nobody when no one wrote at night.
 */
export function nightOwl(humans: readonly Message[], options: AnalysisOptions): Insights["nightOwl"] {
  const [from, to] = options.nightHours;
  const totals = senderCounts(humans);
  const night = new Map<ParticipantId, number>();
  for (const m of humans) {
    const h = hourOf(m.ts);
    if (h >= from && h < to) night.set(m.sender, (night.get(m.sender) ?? 0) + 1);
  }
  let eligible = [...totals.keys()].filter((id) => totals.get(id)! >= options.nightOwlMinMessages);
  if (eligible.length === 0) eligible = [...totals.keys()];
  let best: ParticipantId | null = null;
  for (const id of eligible) {
    if (best === null) {
      best = id;
      continue;
    }
    const [a, an] = [night.get(id) ?? 0, totals.get(id)!];
    const [b, bn] = [night.get(best) ?? 0, totals.get(best)!];
    const cmp = a * bn - b * an; // a/an vs b/bn without floats
    if (cmp > 0 || (cmp === 0 && a > b)) best = id;
  }
  const count = best === null ? 0 : night.get(best) ?? 0;
  if (best === null || count === 0) return { id: null, count: 0, share: 0 };
  return { id: best, count, share: percent(count, totals.get(best)!, 1) };
}
