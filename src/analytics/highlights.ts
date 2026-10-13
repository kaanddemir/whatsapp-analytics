/* Secondary details derived from the computed metrics: the "busiest day",
   "coverage" and "share of" figures the card explanations and the Recap
   show. Computed here so the UI only
   formats; every value is a function of numbers already in Stats, so they
   agree with the cards by construction. */
import type { AnalysisOptions, Content, Grain, Highlights, Insights, Kpis, ParticipantStats, PeakBucket, Timeline, Timing } from "@/model";
import { percent, ratio } from "./numbers";

type Period = { readonly start: number; readonly end: number } | null;

/** First index of the largest value; null when every value is 0. */
function argmax(values: readonly number[]): number | null {
  let best: number | null = null;
  for (let i = 0; i < values.length; i++) if (values[i]! > 0 && (best === null || values[i]! > values[best]!)) best = i;
  return best;
}

function peak(timeline: Timeline, grain: Grain, total: number): PeakBucket | null {
  const s = timeline[grain];
  const i = argmax(s.values);
  return i === null ? null : { bucket: s.buckets[i]!, count: s.values[i]!, share: percent(s.values[i]!, total, 1), partial: s.partial[i]! };
}

export function highlights(
  period: Period,
  k: Kpis,
  timeline: Timeline,
  timing: Timing,
  content: Content,
  participants: readonly ParticipantStats[],
  insights: Insights,
  options: AnalysisOptions,
): Highlights {
  const total = k.totalMessages;
  const periodDays = period ? period.end - period.start + 1 : 0;
  const day = peak(timeline, "daily", total);

  let cell: Highlights["busiestHour"] = null;
  timing.heatmap.forEach((row, weekday) =>
    row.forEach((count, hour) => {
      if (count > 0 && (!cell || count > cell.count)) cell = { weekday, hour, count };
    }),
  );

  const weekdayTotals = timing.heatmap.map((row) => row.reduce((a, b) => a + b, 0));
  const topWeekday = argmax(weekdayTotals);
  const [from, to] = options.nightHours;
  const night = timing.hours.slice(from, to).reduce((a, b) => a + b, 0);
  const [leader, runnerUp] = participants;

  return {
    periodDays,
    activeDayShare: percent(k.activeDays, periodDays, 1),
    busiestDay: day && { date: day.bucket, count: day.count, timesAverage: ratio(day.count * 10, Math.round(k.messagesPerActiveDay * 10), 1) },
    busiestBucket: {
      daily: day,
      weekly: peak(timeline, "weekly", total),
      monthly: peak(timeline, "monthly", total),
    },
    busiestHour: cell,
    weekdayTotals,
    weekdayShares: weekdayTotals.map((n) => percent(n, total, 1)),
    busiestWeekdayByTotal: topWeekday,
    nonMediaMessages: total - content.media.total,
    nightMessages: { count: night, share: percent(night, total, 1) },
    leadOverRunnerUp: leader && runnerUp ? leader.share - runnerUp.share : null,
    streakShare: percent(insights.longestStreak.days, periodDays, 1),
  };
}
