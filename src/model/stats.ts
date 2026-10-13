/* The statistics payload the dashboard and Recap render.

   Counterpart of the dict the former Python analyzer returned,
   renamed to camelCase. Formatting that Python did on the server
   (e.g. "Jan 05, 2024", "14:00", "2h 5m", "<1%") moves to the presentation
   layer: the engine returns raw numbers and ISO dates, and the UI localizes
   them. */
import type { MediaKind, MessageKind, ParticipantId } from "./message";
import type { ChatType } from "./parse";
import type { IsoDate } from "./filters";

export type Grain = "daily" | "weekly" | "monthly";

/** One timeline series. buckets/values/partial are positionally aligned. */
export interface TimeSeries {
  /** Bucket start dates (day, Monday of week, first of month). */
  readonly buckets: readonly IsoDate[];
  readonly values: readonly number[];
  /** Bucket only partly inside the analysed period (drawn dashed). */
  readonly partial: readonly boolean[];
}

export interface Timeline {
  /** Suggested grain for the period length . */
  readonly suggestedGrain: Grain;
  readonly daily: TimeSeries;
  readonly weekly: TimeSeries;
  readonly monthly: TimeSeries;
}

export interface Kpis {
  /** Messages in scope, every kind. Equals the sum of messagesByKind. */
  readonly totalMessages: number;
  readonly messagesByKind: Readonly<Record<MessageKind, number>>;
  /** Calendar days with at least one message in scope. */
  readonly activeDays: number;
  /** totalMessages / activeDays, 1 decimal; 0 when there are none. */
  readonly messagesPerActiveDay: number;
  /** 0–23; null when there are no messages. Ties go to the earliest hour. */
  readonly peakHour: number | null;
  /** Percent of messages in the peak hour, 1 decimal. */
  readonly peakHourShare: number;
  /** Whitespace-separated words in text messages. */
  readonly totalWords: number;
  /** totalWords / text messages with at least one word, 1 decimal. */
  readonly wordsPerMessage: number;
  /** Monthly sparkline series aligned with timeline.monthly. */
  readonly activeDaysSeries: readonly number[];
  readonly messagesPerActiveDaySeries: readonly number[];
}

export interface Timing {
  /** 24 message counts, index = hour. Sums to kpis.totalMessages. */
  readonly hours: readonly number[];
  /** Messages per calendar weekday of the period, 1 decimal, index 0 = Monday. */
  readonly weekdayAverages: readonly number[];
  /** 7 x 24 counts, [weekday][hour], Monday first. Sums to kpis.totalMessages. */
  readonly heatmap: readonly (readonly number[])[];
}

export interface RankedItem<K extends string = string> {
  readonly key: K;
  readonly count: number;
}

export interface Content {
  readonly topEmojis: readonly RankedItem[];
  readonly topKeywords: readonly RankedItem[];
  /** uses = all emoji occurrences; messageCount = messages with at least one. */
  readonly emojiSummary: { readonly uses: number; readonly messageCount: number };
  /** uses = counted keyword occurrences; unique = distinct keywords. */
  readonly keywordSummary: { readonly uses: number; readonly unique: number };
  readonly media: {
    /** Equals kpis.messagesByKind.media. */
    readonly total: number;
    /** Percent of messages in scope, 1 decimal. */
    readonly share: number;
    readonly items: readonly RankedItem<MediaKind>[];
  };
}

/**
 * Time from another person's message to this person's next message, in
 * seconds. With minute-precision exports, values are multiples of 60 and
 * 0 means "within the same minute". In groups the export does not say who
 * is being answered: this is the gap after the previous speaker, not a
 * proven reply.
 */
export interface ResponseTime {
  /** null = no qualifying gaps; 0 is a real value (C5). */
  readonly median: number | null;
  readonly sampleSize: number;
}

export interface ParticipantStats {
  readonly id: ParticipantId;
  readonly name: string;
  readonly messages: number;
  /** Integer percent; all participants sum to exactly 100 (largest remainder). */
  readonly share: number;
  readonly responseTime: ResponseTime;
}

export interface Insights {
  /** Four-hour window with the most messages; null when there are none. */
  readonly mostActiveWindow: { readonly startHour: number; readonly share: number } | null;
  /** 0 = Monday; highest weekday average; null when there are no messages. */
  readonly busiestWeekday: number | null;
  readonly longestStreak: {
    /** 0 when there is no run of 2+ consecutive active days. */
    readonly days: number;
    readonly start: IsoDate | null;
    readonly end: IsoDate | null;
  };
  readonly conversationStarter: {
    readonly id: ParticipantId | null;
    /** Integer percent of conversations. */
    readonly share: number;
    readonly count: number;
    readonly conversations: number;
  };
  readonly nightOwl: {
    /** null when nobody wrote in the night window. */
    readonly id: ParticipantId | null;
    readonly count: number;
    /** Percent of that person's own messages, 1 decimal. */
    readonly share: number;
  };
}

/** The largest bucket of one timeline grain. */
export interface PeakBucket {
  readonly bucket: IsoDate;
  readonly count: number;
  /** Percent of kpis.totalMessages, 1 decimal. */
  readonly share: number;
  readonly partial: boolean;
}

/**
 * Supporting details for the card explanations and the Recap, derived from
 * the other fields, so the UI only formats them.
 * Ties go to the earliest bucket / weekday / hour. Shares are 1 decimal.
 */
export interface Highlights {
  /** Calendar days in meta.range, active or not; 0 when range is null. */
  readonly periodDays: number;
  /** activeDays as a percent of periodDays. */
  readonly activeDayShare: number;
  /** timesAverage = count / messagesPerActiveDay, 1 decimal. */
  readonly busiestDay: { readonly date: IsoDate; readonly count: number; readonly timesAverage: number } | null;
  readonly busiestBucket: Readonly<Record<Grain, PeakBucket | null>>;
  /** Busiest heatmap cell; weekday 0 = Monday. */
  readonly busiestHour: { readonly weekday: number; readonly hour: number; readonly count: number } | null;
  /** Message totals per weekday (heatmap rows), Monday first. */
  readonly weekdayTotals: readonly number[];
  readonly weekdayShares: readonly number[];
  /** Weekday with the most messages in total (not per occurrence, unlike insights.busiestWeekday). */
  readonly busiestWeekdayByTotal: number | null;
  readonly nonMediaMessages: number;
  /** Scoped messages in the night window (options.nightHours). */
  readonly nightMessages: { readonly count: number; readonly share: number };
  /** Share points between the first and second participant; null with fewer than two. */
  readonly leadOverRunnerUp: number | null;
  /** longestStreak.days as a percent of periodDays. */
  readonly streakShare: number;
}

export interface StatsMeta {
  /** Decided by the parser over the whole file, independent of filters (C8). */
  readonly chatType: ChatType;
  /** Human participants (Meta AI excluded) with messages in the date range, first-seen order. */
  readonly participants: readonly ParticipantId[];
  readonly activeSender: ParticipantId | null;
  /** Bounds of the whole chat, for the date picker. */
  readonly fullRange: { readonly start: IsoDate; readonly end: IsoDate };
  /**
   * The analysed period: the date filter clamped to the chat's bounds.
   * null when the filter lies entirely outside the chat.
   */
  readonly range: { readonly start: IsoDate; readonly end: IsoDate } | null;
  /** All messages in the date range, every sender. */
  readonly conversationTotal: number;
  /** "minute" when the export has no seconds; response times are then ±1 min. */
  readonly timestampResolution: "minute" | "second";
  /** True when no message is in scope; every metric is then zero or null. */
  readonly empty: boolean;
}

export interface Stats {
  readonly meta: StatsMeta;
  readonly kpis: Kpis;
  readonly timeline: Timeline;
  readonly timing: Timing;
  readonly content: Content;
  /** Interaction metrics over the date range (never the sender filter), ranked by count. */
  readonly participants: readonly ParticipantStats[];
  readonly insights: Insights;
  readonly highlights: Highlights;
}
