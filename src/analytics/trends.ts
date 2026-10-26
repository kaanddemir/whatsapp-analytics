/* Changes over time: the last weeks of the period against the same number of
   weeks just before them, and the longest silence.

   The two windows end at the period's last day (the last day with data when
   no end date is set), never at today: an export ends when it was made.
     period >= 180 days  -> last 90 days vs the 90 before
     period >=  60 days  -> last 30 days vs the 30 before
     shorter             -> no comparison (windows null)

   A change is reported only when it is both large and unlikely to be noise;
   otherwise it is "steady" (enough data, no clear change) or "insufficient"
   (too little data to say either). Messages come in bursts, so the tests are
   deliberately strict:
     activity       daily counts (zero days included), Mann-Whitney z >= 2.58
                    and the totals differ by >= 25% of the larger
     response time  each person's gaps (as on the Response Time card),
                    >= 20 per window, Mann-Whitney z >= 2.58, medians differ
                    by >= 25% of the larger and by >= 1 minute
     share          >= 100 human messages per window, two-proportion
                    z >= 3.29 and >= 5 share points
     starter        >= 20 conversations per window, two-proportion z >= 2.58
                    and >= 15 share points
   Activity and silence follow both filters; share, response time and starter
   compare people, so they use the human conversation in the date range. */
import type { AnalysisOptions, Message, ParticipantId, TrendDirection, Trends } from "@/model";
import { dayOf, isoOfDay } from "./calendar";
import { median, ratio } from "./numbers";

type Period = { readonly start: number; readonly end: number } | null;

export const TREND_LIMITS = {
  activityMinMessages: 60, activityChange: 0.25,
  replyMinGaps: 20, replyChange: 0.25, replyMinSeconds: 60,
  shareMinMessages: 100, shareMinPoints: 5,
  starterMinConversations: 20, starterMinPoints: 15,
  z: 2.58, shareZ: 3.29,
} as const;

/** Mann-Whitney U as a normal z (tie-corrected), positive when `b` tends to be larger than `a`. */
export function mannWhitneyZ(a: readonly number[], b: readonly number[]): number {
  const n1 = a.length, n2 = b.length, n = n1 + n2;
  if (n1 === 0 || n2 === 0) return 0;
  const all = [...a.map((v) => [v, 0] as const), ...b.map((v) => [v, 1] as const)].sort((x, y) => x[0] - y[0]);
  let rankB = 0, ties = 0;
  for (let i = 0; i < n;) {
    let j = i;
    while (j < n && all[j]![0] === all[i]![0]) j++;
    const avg = (i + j + 1) / 2, size = j - i;
    ties += size ** 3 - size;
    for (let k = i; k < j; k++) if (all[k]![1] === 1) rankB += avg;
    i = j;
  }
  const u = rankB - (n2 * (n2 + 1)) / 2;
  const variance = ((n1 * n2) / 12) * (n + 1 - ties / (n * (n - 1)));
  return variance > 0 ? (u - (n1 * n2) / 2) / Math.sqrt(variance) : 0;
}

/** Two-proportion z, positive when the second proportion is larger. */
export function proportionZ(x1: number, n1: number, x2: number, n2: number): number {
  if (n1 === 0 || n2 === 0) return 0;
  const p = (x1 + x2) / (n1 + n2), se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  return se > 0 ? (x2 / n2 - x1 / n1) / se : 0;
}

const direction = (z: number, big: boolean, limit: number = TREND_LIMITS.z): TrendDirection =>
  big && Math.abs(z) >= limit ? (z > 0 ? "up" : "down") : "steady";

export function windowDays(periodDays: number): number | null {
  return periodDays >= 180 ? 90 : periodDays >= 60 ? 30 : null;
}

/** First index whose day is >= `day` (messages are sorted). */
function lowerBound(messages: readonly Message[], day: number): number {
  let lo = 0, hi = messages.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (dayOf(messages[mid]!.ts) < day) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The longest run of days without a message strictly between two active days; null under 7 days. */
export function longestSilence(messages: readonly Message[]): Trends["longestSilence"] {
  let best: Trends["longestSilence"] = null;
  for (let i = 1; i < messages.length; i++) {
    const a = dayOf(messages[i - 1]!.ts), b = dayOf(messages[i]!.ts), days = b - a - 1;
    if (days >= 7 && (!best || days > best.days)) best = { days, lastBefore: isoOfDay(a), firstAfter: isoOfDay(b) };
  }
  return best;
}

export function trends(scoped: readonly Message[], humans: readonly Message[], period: Period, options: AnalysisOptions, precedingHuman: Message | null = null): Trends {
  const silence = longestSilence(scoped);
  const W = period ? windowDays(period.end - period.start + 1) : null;
  if (!period || W === null) return { windows: null, activity: null, responseTime: [], share: [], starter: [], longestSilence: silence };
  const afterStart = period.end - W + 1, beforeStart = afterStart - W;
  const windows = {
    days: W,
    before: { start: isoOfDay(beforeStart), end: isoOfDay(afterStart - 1) },
    after: { start: isoOfDay(afterStart), end: isoOfDay(period.end) },
  };
  // 0 = before, 1 = after, -1 = outside both.
  const side = (ts: number): 0 | 1 | -1 => { const d = dayOf(ts); return d < beforeStart || d > period.end ? -1 : d < afterStart ? 0 : 1; };

  // Activity: messages per calendar day in each window, the scoped set.
  const daily = [new Array<number>(W).fill(0), new Array<number>(W).fill(0)] as const;
  for (let i = lowerBound(scoped, beforeStart); i < scoped.length; i++) {
    const d = dayOf(scoped[i]!.ts);
    if (d > period.end) break;
    if (d < afterStart) daily[0][d - beforeStart]!++;
    else daily[1][d - afterStart]!++;
  }
  const total = daily.map((xs) => xs.reduce((a, b) => a + b, 0)) as [number, number];
  const active = daily.map((xs) => xs.filter((x) => x > 0).length) as [number, number];
  const L = TREND_LIMITS;
  const activity: Trends["activity"] = {
    before: total[0], after: total[1],
    perDayBefore: ratio(total[0], W, 1), perDayAfter: ratio(total[1], W, 1),
    activeDaysBefore: active[0], activeDaysAfter: active[1],
    direction: total[0] + total[1] < L.activityMinMessages ? "insufficient"
      : direction(mannWhitneyZ(daily[0], daily[1]), relativeChange(total[0], total[1]) >= L.activityChange),
  };

  // People: the human conversation of the two windows.
  const counts = new Map<ParticipantId, [number, number]>();
  const gaps = new Map<ParticipantId, [number[], number[]]>();
  const starts = new Map<ParticipantId, [number, number]>();
  const conversations: [number, number] = [0, 0];
  for (let i = lowerBound(humans, beforeStart); i < humans.length; i++) {
    const m = humans[i]!, s = side(m.ts);
    if (s === -1) break;
    (counts.get(m.sender) ?? counts.set(m.sender, [0, 0]).get(m.sender)!)[s]++;
    const prev = i > 0 ? humans[i - 1]! : null;
    const seconds = prev ? (m.ts - prev.ts) / 1000 : Infinity;
    // A start as the Conversation Starter card counts it: after a silence longer than the session gap
    // (the chat's first message too). A window's first message only counts if that silence really came before it.
    const startPrev = prev ?? precedingHuman;
    if (!startPrev || (m.ts - startPrev.ts) / 1000 > options.sessionGapSeconds) {
      conversations[s]++;
      (starts.get(m.sender) ?? starts.set(m.sender, [0, 0]).get(m.sender)!)[s]++;
    }
    if (prev && prev.sender !== m.sender && seconds >= 0 && seconds < options.replyWindowSeconds)
      (gaps.get(m.sender) ?? gaps.set(m.sender, [[], []]).get(m.sender)!)[s].push(seconds);
  }
  const people = [...counts.keys()];
  const humanTotal = [0, 1].map((s) => people.reduce((a, id) => a + counts.get(id)![s]!, 0)) as [number, number];
  const twoPlus = people.length >= 2;

  const responseTime: Trends["responseTime"] = !twoPlus ? [] : people.map((id) => {
    const [a, b] = gaps.get(id) ?? [[], []];
    const before = median(a), after = median(b);
    const enough = a.length >= L.replyMinGaps && b.length >= L.replyMinGaps;
    const big = before !== null && after !== null && Math.abs(after - before) >= L.replyMinSeconds && relativeChange(before, after) >= L.replyChange;
    return { id, before: { median: before, sampleSize: a.length }, after: { median: after, sampleSize: b.length },
      direction: enough ? direction(mannWhitneyZ(a, b), big) : "insufficient" };
  });

  const share: Trends["share"] = !twoPlus ? [] : people.map((id) => {
    const [x1, x2] = counts.get(id)!;
    const before = ratio(x1 * 100, humanTotal[0], 1), after = ratio(x2 * 100, humanTotal[1], 1);
    const enough = humanTotal[0] >= L.shareMinMessages && humanTotal[1] >= L.shareMinMessages;
    return { id, before, after, direction: enough ? direction(proportionZ(x1, humanTotal[0], x2, humanTotal[1]), Math.abs(x2 * humanTotal[0] - x1 * humanTotal[1]) * 100 >= L.shareMinPoints * humanTotal[0] * humanTotal[1], L.shareZ) : "insufficient" };
  });

  const starter: Trends["starter"] = !twoPlus ? [] : people.map((id) => {
    const [x1, x2] = starts.get(id) ?? [0, 0];
    const before = ratio(x1 * 100, conversations[0], 1), after = ratio(x2 * 100, conversations[1], 1);
    const enough = conversations[0] >= L.starterMinConversations && conversations[1] >= L.starterMinConversations;
    return { id, before, after, startedBefore: x1, startedAfter: x2, conversationsBefore: conversations[0], conversationsAfter: conversations[1],
      direction: enough ? direction(proportionZ(x1, conversations[0], x2, conversations[1]), Math.abs(x2 * conversations[0] - x1 * conversations[1]) * 100 >= L.starterMinPoints * conversations[0] * conversations[1]) : "insufficient" };
  });

  return { windows, activity, responseTime, share, starter, longestSilence: silence };
}

/** |b - a| relative to the larger of the two; 0 when both are 0. */
function relativeChange(a: number, b: number): number {
  const top = Math.max(Math.abs(a), Math.abs(b));
  return top === 0 ? 0 : Math.abs(b - a) / top;
}
