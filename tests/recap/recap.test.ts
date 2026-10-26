/* Recap story model: eligibility and length, determinism, the
   highlight selection rule, preservation of every previous slide's metric,
   TR/EN copy, design-token contrast and the poster layout. Pure: no DOM. */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyze } from "@/analytics";
import type { Stats } from "@/model";
import { NO_FILTERS } from "@/model";
import { parseExport } from "@/parser";
import { en, type TranslationKey } from "@/i18n/en";
import { tr } from "@/i18n/tr";
import type { Locale, TranslationParams } from "@/i18n/types";
import { participantColorIndex } from "@/ui/participantColors";
import { LAYOUT, POSTER_H, POSTER_W, fitLines, wrap } from "@/ui/recap/poster";
import { MAX_DOTS, MAX_STREAK_DOTS, bucketed, buildStory, dotUnit, pickHighlight, type Scene, type Story } from "@/ui/recap/story";
import { GROUNDS, PARTICIPANT_DARK, PARTICIPANT_LIGHT, contrast } from "@/ui/recap/tokens";

const dir = join(__dirname, "../fixtures/chats");
const chats = readdirSync(dir).map((f) => [f, analyze(parseExport(readFileSync(join(dir, f), "utf8")), NO_FILTERS)] as const);
const statsOf = (name: string) => chats.find(([f]) => f === name)![1];
const translate = (locale: Locale) => (key: TranslationKey, params?: TranslationParams) =>
  (locale === "tr" ? tr : en)[key].replace(/\{(\w+)\}/g, (_, k: string) => String(params?.[k] ?? `{${k}}`));
const storyOf = (stats: Stats, locale: Locale = "en"): Story => buildStory(stats, locale, translate(locale));
const kinds = (story: Story) => story.scenes.map((s) => s.kind);
const find = <K extends Scene["kind"]>(story: Story, kind: K) => story.scenes.find((s) => s.kind === kind) as Extract<Scene, { kind: K }> | undefined;

/** A copy of real stats with some fields replaced, for rule tests. */
function tweak(stats: Stats, patch: { streak?: number; busiestDay?: Stats["highlights"]["busiestDay"]; activeDays?: number }): Stats {
  return {
    ...stats,
    kpis: { ...stats.kpis, activeDays: patch.activeDays ?? stats.kpis.activeDays },
    insights: { ...stats.insights, longestStreak: patch.streak === undefined ? stats.insights.longestStreak : { days: patch.streak, start: "2024-01-01", end: "2024-02-01" } },
    highlights: { ...stats.highlights, busiestDay: patch.busiestDay === undefined ? stats.highlights.busiestDay : patch.busiestDay },
  };
}

describe("recap story: shape and length", () => {
  it("always opens on the opening scene and ends on the finale, which holds", () => {
    for (const [, stats] of chats) {
      const story = storyOf(stats);
      expect(story.scenes[0]!.kind).toBe("opening");
      expect(story.scenes.at(-1)).toMatchObject({ kind: "finale", duration: 0 });
      expect(story.scenes.slice(0, -1).every((s) => s.duration > 0)).toBe(true);
      expect(story.scenes.every((s) => s.summary.trim().length > 0)).toBe(true);
    }
  });

  it("gives a rich conversation the full four-chapter story in 10-12 scenes", () => {
    for (const name of ["long_android_12h.chat", "dm_en_android.chat", "group_tr_ios.chat"]) {
      const story = storyOf(statsOf(name));
      expect(story.scenes.length).toBeGreaterThanOrEqual(10);
      expect(story.scenes.length).toBeLessThanOrEqual(12);
      expect(new Set(story.scenes.map((s) => s.chapter))).toEqual(new Set(["scale", "rhythm", "people", "signature", "finale"]));
    }
    expect(kinds(storyOf(statsOf("long_android_12h.chat")))).toEqual(["opening", "volume", "timeline", "divider", "clock", "week", "balance", "behavior", "shared", "words", "highlight", "finale"]);
  });

  it("keeps a single message to opening, volume and finale", () => {
    expect(kinds(storyOf(statsOf("edge_single_message.chat")))).toEqual(["opening", "volume", "finale"]);
  });

  it("drops the people chapter for one participant and empty sections elsewhere", () => {
    for (const name of ["edge_one_participant.chat", "edge_only_media.chat", "edge_single_message.chat", "edge_five_years.chat"]) {
      const story = storyOf(statsOf(name));
      expect(story.scenes.some((s) => s.chapter === "people")).toBe(false);
      expect(find(story, "opening")!.mode).toBe("solo");
    }
    const media = storyOf(statsOf("edge_only_media.chat"));
    expect(find(media, "shared")!.emoji).toBeNull();
    expect(find(media, "shared")!.media).not.toBeNull();
    expect(find(media, "words")).toBeUndefined();
  });

  it("never shows a chapter divider in front of fewer than two scenes", () => {
    for (const [, stats] of chats) {
      const story = storyOf(stats);
      const at = story.scenes.findIndex((s) => s.kind === "divider");
      if (at < 0) continue;
      expect(story.scenes.filter((s) => s.chapter === "rhythm" && s.kind !== "divider").length).toBeGreaterThanOrEqual(2);
    }
  });

  it("is deterministic for the same input", () => {
    for (const [, stats] of chats) expect(JSON.stringify(storyOf(stats))).toBe(JSON.stringify(storyOf(stats)));
  });

  it("keeps chapters contiguous and in narrative order", () => {
    const order = ["scale", "rhythm", "people", "signature", "finale"];
    for (const [, stats] of chats) {
      const seen = storyOf(stats).scenes.map((s) => order.indexOf(s.chapter));
      expect([...seen].sort((a, b) => a - b)).toEqual(seen);
    }
  });
});

describe("recap story: figures stay bounded and accurate", () => {
  it("caps the dot field and keeps its total area exact", () => {
    for (const total of [1, 7, 199, 200, 201, 7844, 1_234_567]) {
      const unit = dotUnit(total);
      expect(Math.ceil(total / unit)).toBeLessThanOrEqual(MAX_DOTS);
      expect([1, 2, 5].includes(unit / 10 ** Math.floor(Math.log10(unit)))).toBe(true);
    }
    const v = find(storyOf(statsOf("long_android_12h.chat")), "volume")!;
    const unit = dotUnit(v.total);
    expect((v.dots - 1 + v.partial) * unit).toBeCloseTo(v.total, 6);
    expect(v.legend).toMatch(/Each dot is/);
  });

  it("folds long timelines without losing messages and lights the bar holding the peak month", () => {
    const values = Array.from({ length: 100 }, (_, i) => i);
    expect(bucketed(values, 36).reduce((a, b) => a + b, 0)).toBe(values.reduce((a, b) => a + b, 0));
    expect(bucketed(values, 36).length).toBeLessThanOrEqual(36);
    const stats = statsOf("edge_five_years.chat");
    const t = find(storyOf(stats), "timeline")!;
    const months = stats.timeline.monthly.values;
    const per = Math.ceil(months.length / t.bars.length);
    const peakMonth = months.indexOf(Math.max(...months));
    expect(t.peak).toBe(Math.floor(peakMonth / per));
  });

  it("uses the dashboard's stable participant colours and exact shares", () => {
    const stats = statsOf("group_tr_ios.chat");
    const b = find(storyOf(stats), "balance")!;
    for (const p of b.segments) expect(p.color).toBe(participantColorIndex(String(p.id)));
    expect(b.segments.reduce((a, p) => a + p.messages, 0) + (b.others?.messages ?? 0)).toBe(stats.participants.reduce((a, p) => a + p.messages, 0));
  });

  it("folds a large group into seven regions plus others", () => {
    const b = find(storyOf(statsOf("edge_large_group.chat")), "balance")!;
    expect(b.mode).toBe("group");
    expect(b.segments.length).toBe(7);
    expect(b.others?.label).toMatch(/others/);
    // The legend names exactly the regions drawn.
    expect(b.legend.map((p) => p.id)).toEqual(b.segments.map((p) => p.id));
    expect(b.summary).toMatch(/43 others/);
  });

  it("draws the starter's conversations as bubbles in proportion", () => {
    const stats = statsOf("long_android_12h.chat");
    const s = find(storyOf(stats), "behavior")!.starter!;
    const { count, conversations } = stats.insights.conversationStarter;
    expect(s.bubbles).toBeLessThanOrEqual(48);
    expect(s.filled).toBe(Math.round((s.bubbles * count) / conversations));
    expect(s.legend).not.toBeNull();
  });

  it("keeps the streak path bounded", () => {
    const h = find(storyOf(statsOf("long_android_12h.chat")), "highlight");
    expect(h?.kind === "highlight" && h.pick === "streak" && h.dots).toBeLessThanOrEqual(MAX_STREAK_DOTS);
  });
});

describe("recap story: the highlight rule", () => {
  const base = statsOf("dm_en_android.chat");
  const day = (count: number, timesAverage: number) => ({ date: "2024-03-01", count, timesAverage });

  it("prefers a sustained streak, then a stand-out day, then any real streak, then a busy day", () => {
    expect(pickHighlight(tweak(base, { streak: 20, busiestDay: day(80, 9), activeDays: 30 }))).toBe("streak");
    expect(pickHighlight(tweak(base, { streak: 5, busiestDay: day(80, 9), activeDays: 30 }))).toBe("peakDay");
    expect(pickHighlight(tweak(base, { streak: 5, busiestDay: day(12, 3), activeDays: 30 }))).toBe("streak");
    expect(pickHighlight(tweak(base, { streak: 2, busiestDay: day(12, 3), activeDays: 30 }))).toBe("peakDay");
    expect(pickHighlight(tweak(base, { streak: 2, busiestDay: day(5, 3), activeDays: 30 }))).toBeNull();
  });

  it("ignores a peak day when too few active days make the average meaningless", () => {
    expect(pickHighlight(tweak(base, { streak: 1, busiestDay: day(80, 9), activeDays: 2 }))).toBeNull();
  });

  it("keeps the streak when a peak day is featured, on the scene and the poster", () => {
    const story = storyOf(tweak(base, { streak: 5, busiestDay: day(80, 9), activeDays: 30 }));
    const h = find(story, "highlight")!;
    expect(h.kind === "highlight" && h.pick).toBe("peakDay");
    expect(h.kind === "highlight" && h.pick === "peakDay" && h.streak).toMatch(/5 days/);
    expect(story.poster.cells.some((c) => c.value === "5 days")).toBe(true);
  });
});

describe("recap story: every previous slide's metric survives", () => {
  it("maps cover, total, days, hour, timeline, heatmap, media, emojis, words, balance, day, starter, streak, owl, final", () => {
    const stats = statsOf("long_android_12h.chat");
    const story = storyOf(stats);
    const v = find(story, "volume")!;
    expect(v.total).toBe(stats.kpis.totalMessages); // total
    expect(v.days).toContain(String(stats.kpis.activeDays)); // days
    expect(v.perDay).toContain("18.6"); // days: per active day
    expect(v.words).not.toBeNull(); // the old image's words written
    expect(find(story, "clock")!.peak).toBe(stats.kpis.peakHour); // hour
    expect(find(story, "timeline")).toBeDefined(); // timeline
    expect(find(story, "week")!.slot!.hours).toEqual(stats.timing.heatmap[stats.highlights.busiestHour!.weekday]); // heatmap
    expect(find(story, "week")!.peak).toBe(stats.insights.busiestWeekday); // day
    expect(find(story, "shared")!.media).not.toBeNull(); // media
    expect(find(story, "shared")!.emoji!.items[0]!.glyph).toBe(stats.content.topEmojis[0]!.key); // emojis
    expect(find(story, "words")!.words[0]!.word).toBe(stats.content.topKeywords[0]!.key); // words
    expect(find(story, "balance")).toBeDefined(); // balance
    expect(find(story, "behavior")!.starter!.person.id).toBe(stats.insights.conversationStarter.id); // starter
    expect(find(story, "behavior")!.owl!.person.id).toBe(stats.insights.nightOwl.id); // owl
    expect(find(story, "highlight")).toBeDefined(); // streak
    expect(find(story, "opening")!.span).toBeTruthy(); // cover
    expect(story.poster.cells.length).toBeGreaterThan(0); // final
  });
});

describe("recap story: localisation", () => {
  it("has every Recap key in both languages", () => {
    const rc = Object.keys(en).filter((k) => k.startsWith("rc"));
    expect(rc.length).toBeGreaterThan(80);
    for (const k of rc) expect((tr as Record<string, string>)[k]?.trim()).toBeTruthy();
  });

  it("formats Turkish numbers, percentages and weekdays, and never suffixes a name", () => {
    const stats = statsOf("long_android_12h.chat");
    const story = storyOf(stats, "tr");
    expect(find(story, "volume")!.days).toBe("421 aktif gün boyunca");
    expect(find(story, "clock")!.share).toMatch(/^Tüm mesajlardan %/);
    expect(find(story, "week")!.day).toBe("Cuma");
    const names = stats.participants.map((p) => p.name);
    const text = JSON.stringify(story);
    for (const name of names) expect(text).not.toMatch(new RegExp(`${name}['’][a-zıüöçşğ]`));
  });

  it("uses singular forms and drops per-day copy for a single message", () => {
    const v = find(storyOf(statsOf("edge_single_message.chat")), "volume")!;
    expect(v.unitLabel).toBe("message");
    expect(v.days).toBe("over 1 active day");
    expect(v.perDay).toBeNull();
    expect(v.legend).toBeNull();
  });

  it("makes no relationship or personality claims", () => {
    const copy = [...Object.entries(en), ...Object.entries(tr)].filter(([k]) => k.startsWith("rc")).map(([, v]) => v).join(" ");
    expect(copy).not.toMatch(/\b(love|best friend|bff|soulmate|obsess|close friend)/i);
    expect(copy).not.toMatch(/(sevgili|aşk|en yakın arkadaş|sevilen)/i);
  });

  it("titles a hidden-name poster without any participant name", () => {
    for (const [, stats] of chats) {
      const p = storyOf(stats).poster;
      for (const person of stats.participants) expect(p.titleHidden).not.toContain(person.name);
      p.people.forEach((person, i) => expect(person.alias).toBe(`Person ${i + 1}`));
    }
  });
});

describe("recap tokens", () => {
  it("meets the contrast rules on every ground", () => {
    for (const g of Object.values(GROUNDS)) {
      expect(contrast(g.bg, g.fg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(g.bg, g.muted)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(g.bg, g.reveal)).toBeGreaterThanOrEqual(3);
      expect(contrast(g.bg, g.support)).toBeGreaterThanOrEqual(3);
      expect(contrast(g.reveal, g.onReveal)).toBeGreaterThanOrEqual(4.5);
      for (const p of g.participants) {
        expect(contrast(g.bg, p)).toBeGreaterThanOrEqual(3);
        // Region labels are display-size ground-coloured text on the participant colour.
        expect(contrast(p, g.bg)).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("mirrors the dashboard's participant colours exactly", () => {
    const css = readFileSync(join(__dirname, "../../src/ui/styles.css"), "utf8");
    const values = [...css.matchAll(/--participant-(\d): (#[0-9a-f]{6})/g)].map((m) => m[2]);
    expect(values).toEqual([...PARTICIPANT_LIGHT, ...PARTICIPANT_DARK]);
  });
});

describe("recap poster", () => {
  const measure = (s: string, size = 10) => Array.from(s).length * size * 0.6;

  it("wraps long names, breaking a word wider than the line", () => {
    expect(wrap((s) => measure(s), "Ayşe Gülşen Karaosmanoğlu", 48)).toEqual(["Ayşe", "Gülşen", "Karaosma", "noğlu"]);
  });

  it("shrinks before truncating, and only truncates with an ellipsis", () => {
    const short = fitLines(measure, "Deniz", 900, 112, 60, 2);
    expect(short).toEqual({ size: 112, lines: ["Deniz"] });
    const long = fitLines(measure, "x".repeat(200), 900, 112, 60, 2);
    expect(long.size).toBe(60);
    expect(long.lines).toHaveLength(2);
    expect(long.lines[1]!.endsWith("…")).toBe(true);
  });

  it("keeps every block inside the 1080x1920 frame without overlaps", () => {
    const L = LAYOUT;
    expect([POSTER_W, POSTER_H]).toEqual([1080, 1920]);
    const titleBottom = L.title.top + L.title.maxSize * L.title.lineHeight * L.title.maxLines;
    const spanBaseline = titleBottom + L.span.gap + L.span.size;
    expect(spanBaseline).toBeLessThan(L.dial.cy - L.dial.ring);
    expect(L.dial.cy + L.dial.ring).toBeLessThan(L.band.height);
    expect(L.total.baseline - L.total.maxSize * 0.75).toBeGreaterThan(L.band.height);
    expect(L.detail.baseline).toBeLessThan(L.strip.top);
    expect(L.strip.top + L.strip.height).toBeLessThan(L.legend.baseline - L.legend.swatch);
    const cellsBottom = L.cells.top + 2 * L.cells.rowHeight + L.cells.gap;
    expect(L.legend.baseline).toBeLessThan(L.cells.top);
    expect(cellsBottom).toBeLessThan(L.footer.baseline - L.footer.size);
    expect(L.footer.baseline).toBeLessThan(POSTER_H - 40);
  });

  it("carries at most four facts", () => {
    for (const [, stats] of chats) expect(storyOf(stats).poster.cells.length).toBeLessThanOrEqual(4);
  });
});

describe("recap story: agrees with the dashboard", () => {
  const msgs = (date: string, n: number) =>
    Array.from({ length: n }, (_, i) => `${date}, 10:${String(i).padStart(2, "0")} - ${i % 2 ? "Ana" : "Bo"}: hi`);

  it("the week scene draws the same weekday averages it ranks by", () => {
    // Mon 1 Jan to Mon 8 Jan 2024: two Mondays (10 messages), one Tuesday (6).
    // Tuesday wins on average (6 vs 5), as on the dashboard, so its bar must be the tallest.
    const stats = analyze(parseExport([...msgs("01/01/2024", 5), ...msgs("02/01/2024", 6), ...msgs("08/01/2024", 5)].join("\n")), NO_FILTERS);
    const week = find(storyOf(stats), "week")!;
    expect(week.peak).toBe(stats.insights.busiestWeekday);
    expect(week.averages).toEqual(stats.timing.weekdayAverages);
    expect(week.averages[week.peak]).toBe(Math.max(...week.averages));
  });

  it("the balance scene's segments and others add up to the dashboard's 100%", () => {
    // Seven segments hold 94%; "others" rounded on its own was 5% (99% in all),
    // its largest-remainder share is 6%.
    const counts = [10, 10, 9, 7, 7, 5, 4, 3];
    const rows = counts.flatMap((n, p) => Array.from({ length: n }, (_, i) => `01/01/2024, ${String(p + 10).padStart(2, "0")}:${String(i).padStart(2, "0")} - P${p}: hi`));
    const stats = analyze(parseExport(rows.join("\n")), NO_FILTERS);
    const balance = find(storyOf(stats), "balance")!;
    const shown = [...balance.segments.map((p) => p.share), balance.others!.share].map((s) => Number(s.replace(/\D/g, "")));
    expect(shown.reduce((a, b) => a + b, 0)).toBe(100);
    expect(balance.others!.share).toBe(`${stats.participants.slice(7).reduce((a, p) => a + p.share, 0)}%`);
  });
});
