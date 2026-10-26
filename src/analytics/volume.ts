/* KPIs, timeline and timing over the scoped messages.
   Every chart is built from the same message set as the totals, so
   timeline, hour and heatmap sums all equal kpis.totalMessages. */
import type { Grain, Kpis, Message, MessageKind, Timeline, TimeSeries, Timing } from "@/model";
import {
  dayOf,
  firstDayOfMonth,
  hourOf,
  isoOfDay,
  lastDayOfMonth,
  monthOfDay,
  weekOfDay,
  weekdayOfDay,
} from "./calendar";
import { percent, ratio } from "./numbers";

type Period = { readonly start: number; readonly end: number } | null;

/** Legacy grain_for: daily up to 90 days, weekly up to 180, then monthly. */
export function grainFor(days: number): Grain {
  return days <= 90 ? "daily" : days <= 180 ? "weekly" : "monthly";
}

function months(period: Period): number[] {
  if (!period) return [];
  const out: number[] = [];
  for (let m = monthOfDay(period.start); m <= monthOfDay(period.end); m++) out.push(m);
  return out;
}

export function kpis(messages: readonly Message[], period: Period, hours: readonly number[]): Kpis {
  const byKind: Record<MessageKind, number> = { text: 0, media: 0, deleted: 0, unavailable: 0 };
  const activeDays = new Set<number>();
  const perMonth = new Map<number, { messages: number; days: Set<number> }>();
  let words = 0;
  let typed = 0;
  let lastDay = NaN;
  let entry: { messages: number; days: Set<number> } | undefined;
  for (const m of messages) {
    byKind[m.kind]++;
    const day = dayOf(m.ts);
    if (day !== lastDay) {
      // Messages are sorted, so the month only needs working out per new day.
      lastDay = day;
      activeDays.add(day);
      const month = monthOfDay(day);
      entry = perMonth.get(month);
      if (!entry) perMonth.set(month, (entry = { messages: 0, days: new Set() }));
    }
    entry!.messages++;
    entry!.days.add(day);
    // Only typed text has words: placeholders are export wording, not content.
    if (m.kind === "text") {
      const count = countWords(m.text);
      if (count > 0) {
        words += count;
        typed++;
      }
    }
  }
  const keys = months(period);
  const activeDaysSeries = keys.map((k) => perMonth.get(k)?.days.size ?? 0);
  const total = messages.length;
  let peakHour: number | null = null;
  for (let h = 0; h < 24; h++) if (hours[h]! > 0 && (peakHour === null || hours[h]! > hours[peakHour]!)) peakHour = h;
  return {
    totalMessages: total,
    messagesByKind: byKind,
    activeDays: activeDays.size,
    messagesPerActiveDay: ratio(total, activeDays.size, 1),
    peakHour,
    peakHourShare: peakHour === null ? 0 : percent(hours[peakHour]!, total, 1),
    totalWords: words,
    wordsPerMessage: ratio(words, typed, 1),
    activeDaysSeries,
    messagesPerActiveDaySeries: keys.map((k, i) => ratio(perMonth.get(k)?.messages ?? 0, activeDaysSeries[i]!, 1)),
  };
}

const WHITESPACE = /\S+/g;
export const countWords = (text: string) => text.match(WHITESPACE)?.length ?? 0;

function series(keys: readonly number[], counts: Map<number, number>, bounds: (k: number) => [number, number], period: NonNullable<Period>): TimeSeries {
  return {
    buckets: keys.map((k) => isoOfDay(bounds(k)[0])),
    values: keys.map((k) => counts.get(k) ?? 0),
    partial: keys.map((k) => {
      const [lo, hi] = bounds(k);
      return period.start > lo || period.end < hi;
    }),
  };
}

const EMPTY_SERIES: TimeSeries = { buckets: [], values: [], partial: [] };

export function timeline(messages: readonly Message[], period: Period): Timeline {
  if (!period) return { suggestedGrain: "daily", daily: EMPTY_SERIES, weekly: EMPTY_SERIES, monthly: EMPTY_SERIES };
  const daily = new Map<number, number>();
  const weekly = new Map<number, number>();
  const monthly = new Map<number, number>();
  const bump = (map: Map<number, number>, key: number) => map.set(key, (map.get(key) ?? 0) + 1);
  for (const m of messages) {
    const day = dayOf(m.ts);
    bump(daily, day);
    bump(weekly, weekOfDay(day));
    bump(monthly, monthOfDay(day));
  }
  const days: number[] = [];
  for (let d = period.start; d <= period.end; d++) days.push(d);
  const weeks: number[] = [];
  for (let w = weekOfDay(period.start); w <= period.end; w += 7) weeks.push(w);
  return {
    suggestedGrain: grainFor(period.end - period.start + 1),
    // A day is never partial: the period is made of whole days.
    daily: series(days, daily, (d) => [d, d], period),
    weekly: series(weeks, weekly, (w) => [w, w + 6], period),
    monthly: series(months(period), monthly, (m) => [firstDayOfMonth(m), lastDayOfMonth(m)], period),
  };
}

export function timing(messages: readonly Message[], period: Period): Timing {
  const hours = new Array<number>(24).fill(0);
  const heatmap = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  const perWeekday = new Array<number>(7).fill(0);
  for (const m of messages) {
    const hour = hourOf(m.ts);
    const weekday = weekdayOfDay(dayOf(m.ts));
    hours[hour]!++;
    heatmap[weekday]![hour]!++;
    perWeekday[weekday]!++;
  }
  // Denominator: how many of each weekday the period contains, active or not.
  const occurrences = new Array<number>(7).fill(0);
  if (period) for (let d = period.start; d <= period.end; d++) occurrences[weekdayOfDay(d)]!++;
  return { hours, heatmap, weekdayAverages: perWeekday.map((n, i) => ratio(n, occurrences[i]!, 1)) };
}

/** Exact weekday averages as fractions, for ranking without rounding ties. */
export function busiestWeekday(messages: readonly Message[], period: Period): number | null {
  if (!period || messages.length === 0) return null;
  const perWeekday = new Array<number>(7).fill(0);
  for (const m of messages) perWeekday[weekdayOfDay(dayOf(m.ts))]!++;
  const occurrences = new Array<number>(7).fill(0);
  for (let d = period.start; d <= period.end; d++) occurrences[weekdayOfDay(d)]!++;
  let best = -1;
  for (let i = 0; i < 7; i++) {
    if (occurrences[i] === 0) continue;
    // a/b > c/d  <=>  a*d > c*b
    if (best < 0 || perWeekday[i]! * occurrences[best]! > perWeekday[best]! * occurrences[i]!) best = i;
  }
  return best < 0 ? null : best;
}
