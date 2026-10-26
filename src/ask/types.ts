import type { AnalysisFilters, IsoDate, MediaKind, ParticipantId } from "@/model";
import type { Behaviour } from "@/behaviour/rules";
import type { BehaviourResult } from "@/behaviour/analysis";
import type { TimelinePage } from "@/conversation/results";
import type { SearchSort } from "@/search/keywordIndex";
import type { Evidence } from "@/conversation/types";

export type Plan =
  /** The dashboard's own figures (session.stats, the engine behind Genel Bakış), so both always agree.
      `kind`: count only messages of this kind (message_count). */
  | { readonly type: "statistic"; readonly metric: StatisticMetric; readonly person: ParticipantId | null; readonly period: Period | null; readonly kind?: CountKind | null;
      /** response_time: the question asks who is slowest ("takes the longest to reply"). */
      readonly slowest?: boolean;
      /** compare_periods: the two (or more) periods the question names, in the order asked. */
      readonly periods?: readonly Period[];
      /** trend: which change the question asks about (recent weeks vs the weeks before). */
      readonly aspect?: TrendAspect }
  /** `person`: the question asks about one named participant ("how many times did Can apologise"), not who does it more. */
  | { readonly type: "behaviour"; readonly behaviour: Behaviour; readonly period: Period | null; readonly person: ParticipantId | null }
  /** `exact`: an explicit "Search:" / "Ara:" request, never widened to related meaning. */
  /** `byPerson`: "who says 'haha' more": the matching messages counted per participant. */
  | { readonly type: "fact"; readonly search: string; readonly person: ParticipantId | null; readonly period: Period | null; readonly exact: boolean; readonly byPerson?: boolean }
  | { readonly type: "temporal"; readonly which: "first" | "last"; readonly search: string; readonly person: ParticipantId | null; readonly period: Period | null }
  | { readonly type: "temporal"; readonly which: "mentions_date"; readonly day: number; readonly month: number; readonly year: number | null; readonly period: Period | null }
  /** What was said on a calendar day ("14 Şubat'ta ne konuştuk"): messages sent that day, never messages similar in meaning.
      Without a year, the chat's own years with messages on that day decide it, or the answer asks which. */
  | { readonly type: "temporal"; readonly which: "on_date"; readonly day: number; readonly month: number; readonly year: number | null; readonly period: Period | null }
  /** "What did we talk about yesterday / last week": every message sent in the period, oldest first. */
  | { readonly type: "temporal"; readonly which: "in_period"; readonly period: Period; readonly person: ParticipantId | null }
  | { readonly type: "timeline"; readonly period: Period | null; readonly needsRange: boolean }
  /** Find past messages or conversations by meaning and words; `reply`: also the answer that followed.
      `limitation`: the question asks for a reason or decision the engine cannot state; it gets related messages.
      `fallback`: no other pattern recognised the question. */
  | { readonly type: "recall"; readonly topic: string; readonly period: Period | null; readonly reply: boolean; readonly speakerWords: boolean; readonly limitation: RecallLimitation; readonly fallback: boolean }
  | { readonly type: "unsupported"; readonly reason: UnsupportedReason; readonly suggestion: string | null };

export type TrendAspect = "activity" | "response_time" | "share" | "starter";

export type RecallLimitation = "reason" | "decision" | "summary" | null;

export type StatisticMetric =
  | "messages_by_person" | "message_count" | "busiest_month" | "busiest_day" | "conversation_starter"
  | "response_time" | "message_length" | "kind_by_person" | "night_owl" | "emoji_count" | "compare_periods" | "peak_hour" | "busiest_weekday" | "top_emoji" | "top_words" | "longest_streak" | "active_days" | "chat_span" | "trend";

/** Message kinds a count can be limited to: the export's placeholders, or one media category. */
export type CountKind = "media" | "deleted" | MediaKind;

export type UnsupportedReason =
  | "behaviour_not_validated"  // e.g. postponing, asking questions
  | "not_measured"             // a count or comparison the statistics do not compute (e.g. message length per person)
  | "needs_understanding"      // summaries, disagreements, feelings and the relationship need understanding this engine lacks
  | "topics"                   // conversation topics: word counts are not topics, and no reliable grouping exists
  | "not_understood";

/** A date range stated in the question; inclusive ISO dates. */
export interface Period {
  readonly start: IsoDate;
  readonly end: IsoDate;
  /** As the user wrote it, for the answer text ("March 2024", "2023"). */
  readonly label: string;
}

/** Small, scoped result projections; no former page or navigation state. */
export type ChatResult =
  | { readonly kind: "search"; readonly query: string; readonly filters: AnalysisFilters; readonly sort: SearchSort }
  | { readonly kind: "behaviour"; readonly value: BehaviourResult; readonly filters: AnalysisFilters }
  | { readonly kind: "timeline"; readonly filters: AnalysisFilters; readonly needsRange: boolean; readonly page: TimelinePage | null }
  | { readonly kind: "date"; readonly day: number; readonly month: number; readonly year: number | null; readonly filters: AnalysisFilters }
  /** Retrieved messages travel with the answer; `replies[i]` is the message answering evidence match i, if one was found. */
  | { readonly kind: "recall"; readonly filters: AnalysisFilters; readonly pairs: readonly { readonly match: number; readonly reply: number | null }[] };

/** One line of a comparison: who, the figure, and how it reads in context. */
export interface AnswerRow {
  readonly label: string;
  readonly value: string;
  /** A secondary figure, such as a share or a rate per 100 messages. */
  readonly detail: string | null;
  /** Set only when the analysis supports naming this person as ahead. */
  readonly lead: boolean;
  /** Percent of the total, when the rows are parts of one whole. */
  readonly share: number | null;
  /** The figure behind `value` as a number, on one scale shared by every row of the answer, so the rows can be drawn
      to scale. Null when the rows are not one comparable measure (changes between periods, behaviour rule matches). */
  readonly magnitude: number | null;
}

/** How far a figure can be trusted:
    count  exact, from every message in scope;
    match  messages containing words or phrases, not verified meaning;
    rule   validated behaviour rules with a statistical comparison;
    meaning  ranked by similarity of meaning (and words): related, not verified;
    none   nothing was computed (unsupported). */
export type Basis = "count" | "match" | "rule" | "meaning" | "none";

/** Something the user can do to improve this answer. */
export type AnswerAction = "enable_semantic";

/** The primary answer value and its caption. */
export interface AnswerFigure { readonly value: string; readonly caption: string }

export interface Answer {
  readonly plan: Plan;
  /** True when the app answered the question; false for a stated limitation. */
  readonly supported: boolean;
  readonly basis: Basis;
  /** One or two plain sentences; every number in them was computed, never estimated. */
  readonly text: string;
  readonly figure: AnswerFigure | null;
  /** Per-person figures, when the answer is a comparison. */
  readonly rows: readonly AnswerRow[];
  /** What the figures do and do not establish, or what to ask instead; shown apart from the answer. */
  readonly note: string | null;
  /** The scope the numbers cover, in words ("12 Mar 2023 – 4 Oct 2024", "the whole chat"). */
  readonly scope: string;
  readonly evidence: readonly Evidence[];
  /** Total messages behind the answer when `evidence` shows only some. */
  readonly evidenceTotal: number;
  readonly result: ChatResult | null;
  readonly action: AnswerAction | null;
}
