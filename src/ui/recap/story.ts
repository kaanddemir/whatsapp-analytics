/* The Recap story as data: which scenes a chat gets, in which
   chapter, with what figures and copy. Pure and deterministic, so the story is
   unit-tested without a DOM; Recap.tsx only plays it. Always built from the
   whole-chat Stats (NO_FILTERS), never from the dashboard's filtered view, and
   rebuilt cheaply when the language changes (no worker round trip).

   Previous 15-slide deck -> scenes (nothing analytical was dropped):
     cover            -> opening
     total, days      -> volume (plus words written, from the old image)
     timeline         -> timeline
     hour             -> clock
     heatmap          -> clock (hour shape) + week (busiest weekday-hour slot)
     day              -> week
     media, emojis    -> shared
     words            -> words
     balance          -> balance
     starter, owl     -> behavior (two beats)
     streak           -> highlight (when it stands out) and always the poster
     final            -> finale poster

   Eligibility reflects substance, so a sparse chat gets a short story: see
   the per-scene rules below and MIN_PATTERN_MESSAGES. */
import type { MediaKind, ParticipantId, ParticipantStats, Stats } from "@/model";
import type { TranslationKey } from "@/i18n/en";
import type { Locale, TranslationParams } from "@/i18n/types";
import { chatTitle } from "../components/Filters";
import { formatCount, formatDate, formatDateRange, formatDecimal, formatHourRange, formatMonth, formatPercent, formatShare, plural, weekdays, weekdaysShort } from "@/i18n/format";
import { participantColorIndex } from "../participantColors";
import { DURATION, type Ground } from "./tokens";

export type Translate = (key: TranslationKey, params?: TranslationParams) => string;

export type Chapter = "scale" | "rhythm" | "people" | "signature" | "finale";
export type Family = "hero" | "spotlight" | "comparison" | "pattern" | "finale";

/** Patterns (hour, weekday, month) need this many messages before their
    shape says something about the chat rather than about chance. */
export const MIN_PATTERN_MESSAGES = 10;
/** Shape-count caps: a figure never draws one element per message. */
export const MAX_DOTS = 200;
export const MAX_MONTH_BARS = 36;
export const MAX_SEGMENTS = 7;
export const MAX_OPENING_PEOPLE = 8;
export const MAX_BUBBLES = 48;
export const MAX_STREAK_DOTS = 60;

export interface Person {
  readonly id: ParticipantId;
  readonly name: string;
  /** Rank-based neutral alias ("Person 1"), for the poster's hidden-names mode. */
  readonly alias: string;
  /** Index into the stable participant palette (dashboard hash). */
  readonly color: number;
  readonly messages: number;
  readonly share: string;
}

interface Base<K extends string> {
  readonly kind: K;
  readonly chapter: Chapter;
  readonly family: Family;
  readonly ground: Ground;
  /** Autoplay hold in ms; 0 holds until the viewer acts (the finale). */
  readonly duration: number;
  /** The scene's insight in one or two sentences: announced and used as the
      scene's accessible description, so nothing depends on seeing a figure. */
  readonly summary: string;
}

export interface OpeningScene extends Base<"opening"> {
  readonly mode: "direct" | "group" | "solo";
  readonly kicker: string;
  readonly title: string;
  readonly subtitle: string;
  readonly span: string;
  readonly people: readonly Person[];
  readonly more: number;
}

export interface VolumeScene extends Base<"volume"> {
  readonly kicker: string;
  readonly total: number;
  readonly unitLabel: string;
  readonly days: string;
  readonly perDay: string | null;
  readonly words: string | null;
  /** Dot field: `dots` dots of `unit` messages; the last is `partial` full (0..1]. */
  readonly dots: number;
  readonly partial: number;
  readonly legend: string | null;
}

export interface TimelineScene extends Base<"timeline"> {
  readonly kicker: string;
  readonly month: string;
  readonly count: string;
  readonly of: string;
  readonly bars: readonly number[];
  readonly peak: number;
  readonly axis: readonly [string, string];
}

export interface DividerScene extends Base<"divider"> {
  readonly title: string;
  readonly subtitle: string;
}

export interface ClockScene extends Base<"clock"> {
  readonly kicker: string;
  readonly hours: readonly number[];
  readonly peak: number;
  readonly range: string;
  readonly share: string;
}

export interface WeekScene extends Base<"week"> {
  readonly kicker: string;
  readonly averages: readonly number[];
  readonly labels: readonly string[];
  readonly peak: number;
  readonly day: string;
  readonly detail: string;
  /** Second beat: the 24 hours of the busiest weekday-hour slot's weekday. */
  readonly slot: { readonly kicker: string; readonly hours: readonly number[]; readonly peak: number; readonly text: string } | null;
}

export interface BalanceScene extends Base<"balance"> {
  readonly kicker: string;
  readonly mode: "duo" | "group";
  readonly segments: readonly Person[];
  readonly others: { readonly label: string; readonly messages: number; readonly share: string } | null;
  readonly legend: readonly Person[];
}

export interface BehaviorScene extends Base<"behavior"> {
  readonly starter: {
    readonly kicker: string; readonly person: Person; readonly text: string;
    readonly bubbles: number; readonly filled: number; readonly legend: string | null;
  } | null;
  readonly owl: { readonly kicker: string; readonly person: Person; readonly text: string; readonly share: number } | null;
}

export interface SharedScene extends Base<"shared"> {
  readonly kicker: string;
  readonly emoji: { readonly kicker: string; readonly items: readonly { readonly glyph: string; readonly count: number; readonly label: string }[] } | null;
  readonly media: { readonly kicker: string; readonly total: string; readonly items: readonly { readonly kind: MediaKind; readonly label: string; readonly count: number; readonly text: string }[] } | null;
}

export interface WordsScene extends Base<"words"> {
  readonly kicker: string;
  readonly words: readonly { readonly word: string; readonly count: number; readonly label: string; readonly weight: number }[];
}

export interface StreakHighlight extends Base<"highlight"> {
  readonly pick: "streak";
  readonly kicker: string;
  readonly days: number;
  readonly unit: string;
  readonly range: string;
  readonly dots: number;
  readonly legend: string | null;
}

export interface PeakDayHighlight extends Base<"highlight"> {
  readonly pick: "peakDay";
  readonly kicker: string;
  readonly date: string;
  readonly count: number;
  readonly countText: string;
  readonly average: number;
  readonly averageLabel: string;
  readonly times: string;
  readonly streak: string | null;
}

export type HighlightScene = StreakHighlight | PeakDayHighlight;

export interface Poster {
  readonly locale: Locale;
  readonly kicker: string;
  readonly title: string;
  /** The title when names are hidden: a group title never names anyone. */
  readonly titleHidden: string;
  readonly span: string;
  readonly total: string;
  readonly totalUnit: string;
  readonly detail: string;
  readonly hours: readonly number[];
  readonly peakHour: number | null;
  readonly people: readonly Person[];
  readonly othersShare: number;
  readonly cells: readonly { readonly label: string; readonly value: string }[];
  readonly footer: string;
}

export interface FinaleScene extends Base<"finale"> {
  readonly kicker: string;
  readonly poster: Poster;
}

export type Scene = OpeningScene | VolumeScene | TimelineScene | DividerScene | ClockScene | WeekScene | BalanceScene | BehaviorScene | SharedScene | WordsScene | HighlightScene | FinaleScene;

export interface Story {
  readonly scenes: readonly Scene[];
  readonly poster: Poster;
}

/** Folds a long run of months into at most `limit` equal buckets without losing messages. */
export function bucketed(values: readonly number[], limit: number): number[] {
  if (values.length <= limit) return [...values];
  const per = Math.ceil(values.length / limit);
  const out: number[] = [];
  for (let i = 0; i < values.length; i += per) out.push(values.slice(i, i + per).reduce((a, b) => a + b, 0));
  return out;
}

const firstMax = (values: readonly number[]) => values.indexOf(Math.max(...values));

/** The smallest 1-2-5 unit that keeps the dot field at or under `cap` dots. */
export function dotUnit(total: number, cap = MAX_DOTS): number {
  for (let scale = 1; ; scale *= 10) {
    for (const step of [1, 2, 5]) {
      const unit = step * scale;
      if (Math.ceil(total / unit) <= cap) return unit;
    }
  }
}

export type HighlightPick = "streak" | "peakDay" | null;

/**
 * The pre-finale highlight, picked by explicit rules over existing stats
 * rather than by comparing unrelated magnitudes:
 *   1. a sustained streak (14+ consecutive active days);
 *   2. a stand-out day: 20+ messages and at least 4x an average active day,
 *      in a chat with 3+ active days so the average means something;
 *   3. any real streak (3+ days);
 *   4. a clearly busy day: 10+ messages and at least 2.5x the average.
 * Otherwise there is no highlight scene. The streak is never lost: it stays
 * on the poster, and a peak-day highlight mentions it.
 */
export function pickHighlight(stats: Stats): HighlightPick {
  const streak = stats.insights.longestStreak.days;
  const day = stats.highlights.busiestDay;
  const enoughDays = stats.kpis.activeDays >= 3;
  if (streak >= 14) return "streak";
  if (day && enoughDays && day.count >= 20 && day.timesAverage >= 4) return "peakDay";
  if (streak >= 3) return "streak";
  if (day && enoughDays && day.count >= 10 && day.timesAverage >= 2.5) return "peakDay";
  return null;
}

export function buildStory(stats: Stats, locale: Locale, t: Translate): Story {
  const { kpis: k, insights: ins, highlights: h, content, timeline, timing, meta } = stats;
  const ranked = stats.participants;
  const total = ranked.reduce((a, p) => a + p.messages, 0);
  const count = (n: number) => formatCount(n, locale);
  const messages = (n: number) => plural(n, t("rcMessageOne"), t("rcMessageMany"), locale);
  const activeDays = (n: number) => plural(n, t("rcDayOne"), t("rcDayMany"), locale);
  const persons = new Map<ParticipantId, Person>();
  ranked.forEach((p: ParticipantStats, i) => persons.set(p.id, {
    id: p.id, name: p.name, alias: t("rcPerson", { n: i + 1 }), color: participantColorIndex(String(p.id)),
    messages: p.messages, share: formatShare(p.share, p.messages, total, locale),
  }));
  const people = [...persons.values()];
  const personOf = (id: ParticipantId | null) => (id === null ? null : persons.get(id) ?? null);
  const span = formatDateRange(meta.fullRange.start, meta.fullRange.end, locale);
  const title = chatTitle(stats, ranked, locale);
  const isGroup = meta.chatType.kind === "group";
  const enoughForPatterns = k.totalMessages >= MIN_PATTERN_MESSAGES;
  const scenes: Scene[] = [];

  // Chapter 1 - Scale.
  const mode = isGroup ? "group" : people.length >= 2 ? "direct" : "solo";
  const participantsLabel = people.length === 1 ? t("rcParticipantOne") : t("rcParticipantMany", { count: count(people.length) });
  scenes.push({
    kind: "opening", chapter: "scale", family: "hero", ground: "forest", duration: DURATION.opening,
    mode, kicker: t("rcOpenKicker"),
    title: isGroup ? t("rcGroupChat") : title,
    subtitle: isGroup ? participantsLabel : mode === "direct" ? t("rcDirectChat") : t("rcChat"),
    span, people: people.slice(0, MAX_OPENING_PEOPLE), more: Math.max(0, people.length - MAX_OPENING_PEOPLE),
    summary: t("rcOpenSummary", { title: isGroup ? `${t("rcGroupChat")}, ${participantsLabel}` : title, span }),
  });

  const unit = dotUnit(k.totalMessages);
  const dots = Math.max(1, Math.ceil(k.totalMessages / unit));
  const remainder = k.totalMessages % unit;
  const perDay = k.activeDays >= 2 ? t("rcPerDay", { value: formatDecimal(k.messagesPerActiveDay, locale) }) : null;
  scenes.push({
    kind: "volume", chapter: "scale", family: "spotlight", ground: "cream", duration: DURATION.volume,
    kicker: t("rcVolumeKicker"), total: k.totalMessages,
    unitLabel: k.totalMessages === 1 ? t("rcMessageOne") : t("rcMessageMany"),
    days: t("rcVolumeDays", { days: activeDays(k.activeDays) }), perDay,
    words: k.totalWords > 0 ? t("rcWordsWritten", { words: plural(k.totalWords, t("rcWordOne"), t("rcWordMany"), locale) }) : null,
    dots, partial: remainder === 0 ? 1 : remainder / unit,
    legend: unit === 1 ? null : t(remainder === 0 ? "rcDotUnit" : "rcDotUnitApprox", { value: messages(unit) }),
    summary: [t("rcVolumeSummary", { total: messages(k.totalMessages), days: activeDays(k.activeDays) }), perDay && `${perDay}.`].filter(Boolean).join(" "),
  });

  const months = timeline.monthly;
  if (months.values.length >= 2 && enoughForPatterns) {
    const peak = firstMax(months.values);
    const bars = bucketed(months.values, MAX_MONTH_BARS);
    const per = Math.ceil(months.values.length / bars.length);
    const monthsText = plural(months.values.length, t("rcMonthOne"), t("rcMonthMany"), locale);
    const month = formatMonth(months.buckets[peak]!, locale);
    scenes.push({
      kind: "timeline", chapter: "scale", family: "pattern", ground: "ink", duration: DURATION.timeline,
      kicker: t("rcTimelineKicker"), month, count: t("rcTimelineCount", { count: messages(months.values[peak]!) }),
      of: t("rcTimelineOf", { months: monthsText }),
      // A folded bar holds the peak month, so that is the one that lights up.
      bars, peak: Math.floor(peak / per),
      axis: [formatMonth(months.buckets[0]!, locale), formatMonth(months.buckets[months.buckets.length - 1]!, locale)],
      summary: t("rcTimelineSummary", { months: monthsText, month, count: messages(months.values[peak]!) }),
    });
  }

  // Chapter 2 - Rhythm.
  const rhythm: Scene[] = [];
  if (k.peakHour !== null && enoughForPatterns) {
    const range = formatHourRange(k.peakHour, 1, locale);
    const share = formatPercent(k.peakHourShare, locale);
    rhythm.push({
      kind: "clock", chapter: "rhythm", family: "pattern", ground: "forest", duration: DURATION.clock,
      kicker: t("rcClockKicker"), hours: timing.hours, peak: k.peakHour, range, share: t("rcClockShare", { share }),
      summary: t("rcClockSummary", { range, share }),
    });
  }
  // With one active day the busiest weekday is that day at 100%.
  if (ins.busiestWeekday !== null && k.activeDays >= 2 && enoughForPatterns) {
    const d = ins.busiestWeekday;
    const day = weekdays(locale)[d]!;
    const share = formatPercent(h.weekdayShares[d]!, locale);
    const slot = h.busiestHour;
    rhythm.push({
      kind: "week", chapter: "rhythm", family: "pattern", ground: "cream", duration: DURATION.week,
      // Bars are the weekday averages the peak is ranked by, as on the
      // dashboard: totals would favour a weekday the period holds twice.
      kicker: t("rcWeekKicker"), averages: timing.weekdayAverages, labels: weekdaysShort(locale), peak: d, day,
      detail: t("rcWeekShare", { count: messages(h.weekdayTotals[d]!), share }),
      slot: slot && {
        kicker: t("rcSlotKicker"), hours: timing.heatmap[slot.weekday]!, peak: slot.hour,
        text: t("rcSlotText", { day: weekdays(locale)[slot.weekday]!, range: formatHourRange(slot.hour, 1, locale), count: messages(slot.count) }),
      },
      summary: t("rcWeekSummary", { day, share }) + (slot ? ` ${t("rcSlotKicker")}: ${t("rcSlotText", { day: weekdays(locale)[slot.weekday]!, range: formatHourRange(slot.hour, 1, locale), count: messages(slot.count) })}.` : ""),
    });
  }
  // A divider earns its place only in front of a chapter with two scenes.
  if (rhythm.length >= 2) {
    scenes.push({
      kind: "divider", chapter: "rhythm", family: "hero", ground: "ink", duration: DURATION.divider,
      title: t("rcRhythmTitle"), subtitle: t("rcRhythmSub"), summary: `${t("rcRhythmTitle")}. ${t("rcRhythmSub")}.`,
    });
  }
  scenes.push(...rhythm);

  // Chapter 3 - People: only with someone to compare.
  if (people.length >= 2) {
    const segments = people.slice(0, MAX_SEGMENTS);
    const rest = people.slice(MAX_SEGMENTS);
    const restMessages = rest.reduce((a, p) => a + p.messages, 0);
    // The sum of their own shares, so segments and others make exactly 100%.
    const restShare = formatShare(ranked.slice(MAX_SEGMENTS).reduce((a, p) => a + p.share, 0), restMessages, total, locale);
    scenes.push({
      kind: "balance", chapter: "people", family: "comparison", ground: "cream", duration: DURATION.balance,
      kicker: t("rcBalanceKicker"), mode: people.length === 2 ? "duo" : "group", segments,
      others: rest.length ? { label: t("rcOthers", { count: count(rest.length) }), messages: restMessages, share: restShare } : null,
      // The legend names exactly the regions drawn, so the two always agree.
      legend: segments,
      summary: t("rcBalanceSummary", { list: segments.map((p) => `${p.name} ${p.share}`).join(", ") + (rest.length ? `, ${t("rcOthers", { count: count(rest.length) })} ${restShare}` : "") }),
    });

    const starterPerson = personOf(ins.conversationStarter.id);
    const starter = starterPerson && ins.conversationStarter.conversations >= 2 ? (() => {
      const { count: started, conversations } = ins.conversationStarter;
      const bubbles = Math.min(conversations, MAX_BUBBLES);
      const scaled = bubbles < conversations;
      const conv = plural(conversations, t("rcConversationOne"), t("rcConversationMany"), locale);
      return {
        kicker: t("rcStarterKicker"), person: starterPerson,
        text: t("rcStarterText", { count: count(started), total: conv }),
        bubbles, filled: Math.round((bubbles * started) / conversations),
        legend: scaled ? t("rcBubbleUnit", { value: plural(Math.round(conversations / bubbles), t("rcConversationOne"), t("rcConversationMany"), locale) }) : null,
        summary: t("rcBehaviorSummaryStarter", { name: starterPerson.name, count: count(started), total: conv }),
      };
    })() : null;
    const owlPerson = personOf(ins.nightOwl.id);
    const owl = owlPerson && ins.nightOwl.count > 0 ? {
      kicker: t("rcOwlKicker"), person: owlPerson, share: ins.nightOwl.share,
      text: t("rcOwlText", { share: formatPercent(ins.nightOwl.share, locale) }),
      summary: t("rcBehaviorSummaryOwl", { name: owlPerson.name, share: formatPercent(ins.nightOwl.share, locale) }),
    } : null;
    if (starter || owl) {
      scenes.push({
        kind: "behavior", chapter: "people", family: "comparison", ground: "ink",
        duration: starter && owl ? DURATION.behaviorTwo : DURATION.behaviorOne,
        starter: starter && { kicker: starter.kicker, person: starter.person, text: starter.text, bubbles: starter.bubbles, filled: starter.filled, legend: starter.legend },
        owl: owl && { kicker: owl.kicker, person: owl.person, text: owl.text, share: owl.share },
        summary: [starter?.summary, owl?.summary].filter(Boolean).join(" "),
      });
    }
  }

  // Chapter 4 - Signature.
  const emojis = content.topEmojis.slice(0, 5);
  const media = content.media.items.filter((m) => m.count > 0).slice(0, 4);
  if (emojis.length || content.media.total > 0) {
    const mediaTotal = plural(content.media.total, t("rcMediaOne"), t("rcMediaMany"), locale);
    const mediaItems = media.map((m) => ({ kind: m.key, label: t(`rcMedia.${m.key}` as TranslationKey), count: m.count, text: count(m.count) }));
    scenes.push({
      kind: "shared", chapter: "signature", family: "spotlight", ground: "forest", duration: DURATION.shared,
      kicker: t("rcSharedKicker"),
      emoji: emojis.length ? { kicker: t("rcEmojiKicker"), items: emojis.map((e) => ({ glyph: e.key, count: e.count, label: `${count(e.count)}×` })) } : null,
      media: content.media.total > 0 ? { kicker: t("rcMediaKicker"), total: mediaTotal, items: mediaItems } : null,
      summary: [
        emojis.length ? t("rcSharedSummaryEmoji", { list: emojis.map((e) => `${e.key} ${count(e.count)}`).join(", ") }) : "",
        content.media.total > 0 ? t("rcSharedSummaryMedia", { total: mediaTotal, list: mediaItems.map((m) => `${m.label} ${m.text}`).join(", ") }) : "",
      ].filter(Boolean).join(" "),
    });
  }

  // A word used once did not "keep coming back".
  const words = content.topKeywords.filter((w) => w.count >= 2).slice(0, 5);
  if (words.length) {
    const max = words[0]!.count;
    scenes.push({
      kind: "words", chapter: "signature", family: "pattern", ground: "cream", duration: DURATION.words,
      kicker: t("rcWordsKicker"),
      words: words.map((w) => ({ word: w.key, count: w.count, label: count(w.count), weight: w.count / max })),
      summary: t("rcWordsSummary", { list: words.map((w) => `${w.key} ${count(w.count)}`).join(", ") }),
    });
  }

  const streak = ins.longestStreak;
  const streakDays = (n: number) => plural(n, t("rcStreakDayOne"), t("rcStreakDayMany"), locale);
  const pick = pickHighlight(stats);
  if (pick === "streak" && streak.start && streak.end) {
    const per = Math.ceil(streak.days / MAX_STREAK_DOTS);
    const range = formatDateRange(streak.start, streak.end, locale);
    scenes.push({
      kind: "highlight", pick: "streak", chapter: "signature", family: "spotlight", ground: "ink", duration: DURATION.highlight,
      kicker: t("rcStreakKicker"), days: streak.days, unit: t("rcStreakUnit"), range,
      dots: Math.ceil(streak.days / per), legend: per > 1 ? t("rcStreakDots", { value: streakDays(per) }) : null,
      summary: t("rcStreakSummary", { days: streakDays(streak.days), range }),
    });
  } else if (pick === "peakDay" && h.busiestDay) {
    const d = h.busiestDay;
    const date = formatDate(d.date, locale);
    const times = formatDecimal(d.timesAverage, locale);
    scenes.push({
      kind: "highlight", pick: "peakDay", chapter: "signature", family: "spotlight", ground: "ink", duration: DURATION.highlight,
      kicker: t("rcPeakDayKicker"), date, count: d.count, countText: messages(d.count),
      average: k.messagesPerActiveDay, averageLabel: t("rcAverageDay"), times: t("rcPeakDayTimes", { times }),
      streak: streak.days >= 2 ? t("rcStreakAlso", { days: streakDays(streak.days) }) : null,
      summary: t("rcPeakDaySummary", { date, count: messages(d.count), times }),
    });
  }

  // Finale: the poster.
  const cells: { label: string; value: string }[] = [];
  if (k.peakHour !== null) cells.push({ label: t("rcCellHour"), value: formatHourRange(k.peakHour, 1, locale) });
  if (ins.busiestWeekday !== null && k.activeDays >= 2) cells.push({ label: t("rcCellDay"), value: weekdays(locale)[ins.busiestWeekday]! });
  if (streak.days >= 2) cells.push({ label: t("rcCellStreak"), value: streakDays(streak.days) });
  if (emojis[0]) cells.push({ label: t("rcCellEmoji"), value: `${emojis[0].key} ${count(emojis[0].count)}×` });
  if (words[0]) cells.push({ label: t("rcCellWord"), value: words[0].key });
  if (months.values.length >= 2) cells.push({ label: t("rcCellMonth"), value: formatMonth(months.buckets[firstMax(months.values)]!, locale) });
  const posterPeople = people.length >= 2 ? people.slice(0, MAX_SEGMENTS) : [];
  const poster: Poster = {
    locale,
    kicker: `${t("rcOpenKicker")} · ${meta.fullRange.end.slice(0, 4)}`,
    title: isGroup ? `${t("rcGroupChat")} · ${participantsLabel}` : title,
    titleHidden: isGroup ? `${t("rcGroupChat")} · ${participantsLabel}` : mode === "direct" ? t("rcDirectChat") : t("rcChat"),
    span,
    total: count(k.totalMessages),
    totalUnit: k.totalMessages === 1 ? t("rcMessageOne") : t("rcMessageMany"),
    detail: [activeDays(k.activeDays), perDay].filter(Boolean).join(" · "),
    hours: timing.hours,
    peakHour: k.peakHour,
    people: posterPeople,
    othersShare: posterPeople.length ? Math.max(0, total - posterPeople.reduce((a, p) => a + p.messages, 0)) / Math.max(1, total) : 0,
    cells: cells.slice(0, 4),
    footer: t("rcPosterFooter"),
  };
  scenes.push({
    kind: "finale", chapter: "finale", family: "finale", ground: "cream", duration: 0,
    kicker: t("rcFinaleKicker"), poster,
    summary: [poster.title, poster.span, `${poster.total} ${poster.totalUnit}`, poster.detail, ...poster.cells.map((c) => `${c.label}: ${c.value}`)].join(". ") + ".",
  });

  return { scenes, poster };
}
