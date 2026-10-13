/* Window and streak insights over the scoped messages (the parts
   that are not per-person). */
import type { Insights, Message } from "@/model";
import { dayOf, isoOfDay } from "./calendar";
import { percent } from "./numbers";

/**
 * The four consecutive hours (wrapping past midnight) with the most messages.
 * Ties prefer a window containing the peak hour, then the earliest start.
 */
export function mostActiveWindow(hours: readonly number[], peakHour: number | null, total: number): Insights["mostActiveWindow"] {
  if (peakHour === null || total === 0) return null;
  const sum = (start: number) => hours[start % 24]! + hours[(start + 1) % 24]! + hours[(start + 2) % 24]! + hours[(start + 3) % 24]!;
  const hasPeak = (start: number) => (peakHour - start + 24) % 24 < 4;
  let best = 0;
  for (let start = 1; start < 24; start++) {
    const diff = sum(start) - sum(best);
    if (diff > 0 || (diff === 0 && hasPeak(start) && !hasPeak(best))) best = start;
  }
  return { startHour: best, share: percent(sum(best), total) };
}

/** Longest run of consecutive active days; a single day is not a streak. Earliest run wins ties. */
export function longestStreak(messages: readonly Message[]): Insights["longestStreak"] {
  let longest = 0;
  let longestEnd = 0;
  let run = 0;
  let previous: number | null = null;
  for (const m of messages) {
    const day = dayOf(m.ts);
    if (day === previous) continue;
    run = previous !== null && day === previous + 1 ? run + 1 : 1;
    if (run > longest) {
      longest = run;
      longestEnd = day;
    }
    previous = day;
  }
  if (longest < 2) return { days: 0, start: null, end: null };
  return { days: longest, start: isoOfDay(longestEnd - longest + 1), end: isoOfDay(longestEnd) };
}
