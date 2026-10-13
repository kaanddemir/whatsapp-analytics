/* Dashboard filters (start, end, sender), the date presets and the
   analysis options. */
import type { ParticipantId } from "./message";

/** Inclusive calendar date, "YYYY-MM-DD". */
export type IsoDate = string;

/** Legacy presets: windows counted back from the LAST day of data, not today. */
export type DatePreset = "all" | "7" | "30" | "90" | "180" | "365";

export interface AnalysisFilters {
  /** Inclusive; null means unbounded. */
  readonly start: IsoDate | null;
  readonly end: IsoDate | null;
  /**
   * Narrows volume metrics (KPIs, timeline, timing, content, window,
   * weekday, streak) to one person. Interaction metrics (balance, response
   * time, starter, night owl) stay computed on the whole conversation in the
   * date range.
   */
  readonly sender: ParticipantId | null;
}

export const NO_FILTERS: AnalysisFilters = { start: null, end: null, sender: null };

/** Tunables that the Python code hard-codes; named here so they are visible. */
export interface AnalysisOptions {
  /** Gap that starts a new conversation (people.conversation_starter_details). */
  readonly sessionGapSeconds: number;
  /** Replies slower than this are ignored (people.reply_speed). */
  readonly replyWindowSeconds: number;
  /** Night-owl window, [startHour, endHour). */
  readonly nightHours: readonly [number, number];
  /** Minimum messages to be eligible for night owl. */
  readonly nightOwlMinMessages: number;
  /** Ranked-list length (metrics.TOP_CONTENT_LIMIT). */
  readonly topLimit: number;
}

export const DEFAULT_OPTIONS: AnalysisOptions = {
  sessionGapSeconds: 6 * 60 * 60,
  replyWindowSeconds: 48 * 60 * 60,
  nightHours: [0, 5],
  nightOwlMinMessages: 20,
  topLimit: 10,
};
