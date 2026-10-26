import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AnalysisError, analyze } from "@/analytics";
import { emojisIn, foldStretch, keywordsIn } from "@/analytics/text";
import { largestRemainder, median, percent, ratio } from "@/analytics/numbers";
import { presetRange } from "@/analytics/presets";
import type { AnalysisFilters, ParseResult, Stats } from "@/model";
import { NO_FILTERS } from "@/model";
import { parseExport } from "@/parser";
import { android, ios, lines } from "../support/export";

const run = (text: string, filters: Partial<AnalysisFilters> = {}) => {
  const parsed = parseExport(text);
  return { parsed, stats: analyze(parsed, { ...NO_FILTERS, ...filters }) };
};
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
const idOf = (parsed: ParseResult, name: string) => parsed.participants.findIndex((p) => p.name === name);

function checkInvariants(s: Stats) {
  const total = s.kpis.totalMessages;
  expect(sum(Object.values(s.kpis.messagesByKind))).toBe(total);
  expect(sum(s.timing.hours)).toBe(total);
  expect(sum(s.timing.heatmap.flat())).toBe(total);
  expect(s.timing.heatmap.map((row) => row.length)).toEqual([24, 24, 24, 24, 24, 24, 24]);
  for (const grain of ["daily", "weekly", "monthly"] as const) {
    const series = s.timeline[grain];
    expect(sum(series.values)).toBe(total);
    expect(series.buckets.length).toBe(series.values.length);
    expect(series.partial.length).toBe(series.values.length);
  }
  expect(s.timeline.daily.values.filter((v) => v > 0).length).toBe(s.kpis.activeDays);
  expect(sum(s.kpis.activeDaysSeries)).toBe(s.kpis.activeDays);
  expect(s.kpis.activeDaysSeries.length).toBe(s.timeline.monthly.values.length);
  expect(s.content.media.total).toBe(s.kpis.messagesByKind.media);
  expect(sum(s.content.media.items.map((i) => i.count))).toBe(s.content.media.total);
  expect(s.content.emojiSummary.messageCount).toBeLessThanOrEqual(total);
  expect(s.meta.conversationTotal).toBeGreaterThanOrEqual(total);
  expect(sum(s.participants.map((p) => p.messages))).toBeLessThanOrEqual(s.meta.conversationTotal);
  if (s.participants.length > 0) expect(sum(s.participants.map((p) => p.share))).toBe(100);
  if (s.kpis.peakHour !== null) {
    expect(s.timing.hours[s.kpis.peakHour]).toBe(Math.max(...s.timing.hours));
    expect(s.kpis.peakHourShare).toBe(percent(s.timing.hours[s.kpis.peakHour]!, total, 1));
  }
  expect(s.meta.empty).toBe(total === 0);
  for (const p of s.participants) {
    expect(p.responseTime.median === null).toBe(p.responseTime.sampleSize === 0);
  }
}

describe("numerical invariants on every fixture and filter", () => {
  const dir = new URL("../fixtures/chats/", import.meta.url);
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".chat"))) {
    it(file, () => {
      const parsed = parseExport(readFileSync(new URL(file, dir), "utf8"));
      const full = analyze(parsed, NO_FILTERS);
      checkInvariants(full);
      const { start, end } = full.meta.fullRange;
      const filters: AnalysisFilters[] = [
        { ...NO_FILTERS, ...presetRange("7", full.meta.fullRange) },
        { ...NO_FILTERS, ...presetRange("365", full.meta.fullRange) },
        { start: end, end, sender: null },
        ...parsed.participants.map((p) => ({ start, end, sender: p.id })),
      ];
      for (const f of filters) checkInvariants(analyze(parsed, f));
      // Sender filters partition the conversation's volume.
      const perSender = parsed.participants.map((p) => analyze(parsed, { ...NO_FILTERS, sender: p.id }).kpis.totalMessages);
      expect(sum(perSender)).toBe(full.kpis.totalMessages);
    });
  }
});

describe("known legacy defects", () => {
  it("C3: English words keep their I; Turkish words use Turkish rules", () => {
    expect(keywordsIn("Is Istanbul nice? Indeed", "en")).toEqual(["istanbul", "nice", "indeed"]);
    expect(keywordsIn("İzmir IŞIK Iğdır", "en")).toEqual(["izmir", "ışık", "ığdır"]);
    // A dotless-I-only word follows the chat's language.
    expect(keywordsIn("IRMAK", "tr")).toEqual(["ırmak"]);
    expect(keywordsIn("IRMAK", "en")).toEqual(["irmak"]);
  });

  it("C3: the chat language is detected from the whole chat", () => {
    const en = run(lines(android("01/01/2024", "10:00", "A", "Is it there? I think it is"), android("01/01/2024", "10:01", "B", "Indeed")));
    expect(en.stats.content.topKeywords.map((k) => k.key)).toEqual(["indeed"]);
    const tr = run(lines(android("01/01/2024", "10:00", "A", "bu ne ve neden"), android("01/01/2024", "10:01", "B", "IRMAK")));
    expect(tr.stats.content.topKeywords.map((k) => k.key)).toEqual(["ırmak"]);
  });

  it("C4: legitimate final double letters survive; stretched words fold", () => {
    expect(["all", "will", "call", "kiss", "coffee", "football"].map(foldStretch)).toEqual(["all", "will", "call", "kiss", "coffee", "football"]);
    expect(foldStretch("çoookk")).toBe("çok");
    expect(foldStretch("sooo")).toBe("so");
    expect(keywordsIn("kiss kisss call", "en")).toEqual(["kiss", "kis", "call"]);
  });

  it("C5: a same-minute reply is a median of 0, distinct from no data", () => {
    const { parsed, stats } = run(lines(android("01/01/2024", "10:00", "A", "hi"), android("01/01/2024", "10:00", "B", "hey")));
    const b = stats.participants.find((p) => p.id === idOf(parsed, "B"))!;
    const a = stats.participants.find((p) => p.id === idOf(parsed, "A"))!;
    expect(b.responseTime).toEqual({ median: 0, sampleSize: 1 });
    expect(a.responseTime).toEqual({ median: null, sampleSize: 0 });
    expect(stats.meta.timestampResolution).toBe("minute");
  });

  it("C6: the statistic is an exact median, not an average", () => {
    expect(median([60, 120])).toBe(90);
    expect(median([1, 2])).toBe(1.5); // legacy truncated to 1
    expect(median([60, 60, 3000])).toBe(60); // an average would be 1040
    expect(median([])).toBeNull();
  });
});

describe("response time", () => {
  it("skips same-sender runs and gaps of 48 h or more", () => {
    const { parsed, stats } = run(lines(
      android("01/01/2024", "10:00", "A", "1"),
      android("01/01/2024", "10:05", "A", "2"),
      android("01/01/2024", "10:07", "B", "3"), // 2 min after A's last
      android("03/01/2024", "10:07", "A", "4"), // exactly 48 h: excluded
      android("03/01/2024", "11:07", "B", "5"), // 1 h
    ));
    expect(stats.participants.find((p) => p.id === idOf(parsed, "B"))!.responseTime).toEqual({ median: 1860, sampleSize: 2 });
    expect(stats.participants.find((p) => p.id === idOf(parsed, "A"))!.responseTime).toEqual({ median: null, sampleSize: 0 });
  });

  it("uses seconds when the export has them", () => {
    const { stats } = run(lines(ios("01.01.24", "10:00:00", "A", "hi"), ios("01.01.24", "10:00:42", "B", "yo")));
    expect(stats.meta.timestampResolution).toBe("second");
    expect(stats.participants.find((p) => p.name === "B")!.responseTime.median).toBe(42);
  });

  it("ignores Meta AI: it is neither replier nor the one replied to", () => {
    const { stats } = run(lines(
      android("01/01/2024", "10:00", "A", "question"),
      android("01/01/2024", "10:01", "Meta AI", "answer"),
      android("01/01/2024", "10:03", "B", "thanks"),
    ));
    expect(stats.participants.map((p) => p.name)).toEqual(["A", "B"]);
    expect(stats.participants.find((p) => p.name === "B")!.responseTime.median).toBe(180);
    expect(stats.kpis.totalMessages).toBe(3); // still counted in volume
  });
});

describe("filters", () => {
  const chat = lines(
    android("30/12/2023", "23:59", "A", "late"),
    android("31/12/2023", "00:00", "B", "midnight"),
    android("31/12/2023", "09:00", "A", "morning"),
    android("01/01/2024", "10:00", "B", "new year"),
    android("15/01/2024", "10:00", "A", "mid month"),
  );

  it("sender filter narrows volume but never interaction metrics", () => {
    const { parsed, stats: all } = run(chat);
    const a = analyze(parsed, { ...NO_FILTERS, sender: idOf(parsed, "A") });
    expect(a.kpis.totalMessages).toBe(3);
    expect(a.meta.activeSender).toBe(idOf(parsed, "A"));
    expect(a.participants).toEqual(all.participants);
    expect(a.insights.conversationStarter).toEqual(all.insights.conversationStarter);
    expect(a.insights.nightOwl).toEqual(all.insights.nightOwl);
    expect(a.meta.conversationTotal).toBe(5);
    // Same axis for everyone.
    expect(a.timeline.daily.buckets).toEqual(all.timeline.daily.buckets);
  });

  it("date filter is inclusive and splits days at midnight", () => {
    const { stats } = run(chat, { start: "2023-12-31", end: "2023-12-31" });
    expect(stats.kpis.totalMessages).toBe(2);
    expect(stats.timing.hours[0]).toBe(1);
    expect(stats.meta.range).toEqual({ start: "2023-12-31", end: "2023-12-31" });
    expect(stats.meta.fullRange).toEqual({ start: "2023-12-30", end: "2024-01-15" });
  });

  it("a range inside the chat with no messages is empty, not an error", () => {
    const { stats } = run(chat, { start: "2024-01-05", end: "2024-01-10" });
    expect(stats.meta.empty).toBe(true);
    expect(stats.kpis).toMatchObject({ totalMessages: 0, activeDays: 0, messagesPerActiveDay: 0, peakHour: null, wordsPerMessage: 0 });
    expect(stats.timeline.daily.values).toEqual([0, 0, 0, 0, 0, 0]);
    expect(stats.insights).toMatchObject({ mostActiveWindow: null, busiestWeekday: null, longestStreak: { days: 0 } });
    expect(stats.insights.conversationStarter.id).toBeNull();
    expect(stats.participants).toEqual([]);
    checkInvariants(stats);
  });

  it("a range outside the chat has no period", () => {
    const { stats } = run(chat, { start: "2025-01-01", end: null });
    expect(stats.meta.range).toBeNull();
    expect(stats.timeline.daily.buckets).toEqual([]);
    checkInvariants(stats);
  });

  it("clamps the period to the chat and marks cut buckets partial", () => {
    const { stats } = run(chat, { start: "2023-01-01", end: "2024-01-03" });
    expect(stats.meta.range).toEqual({ start: "2023-12-30", end: "2024-01-03" });
    expect(stats.timeline.monthly.buckets).toEqual(["2023-12-01", "2024-01-01"]);
    expect(stats.timeline.monthly.partial).toEqual([true, true]);
    // 2023-12-30 is a Saturday: its week starts Monday 2023-12-25.
    expect(stats.timeline.weekly.buckets).toEqual(["2023-12-25", "2024-01-01"]);
    expect(stats.timeline.weekly.partial).toEqual([true, true]);
  });

  it("rejects malformed filters with a typed error", () => {
    const { parsed } = run(chat);
    expect(() => analyze(parsed, { ...NO_FILTERS, start: "2024-02-30" })).toThrow(AnalysisError);
    expect(() => analyze(parsed, { ...NO_FILTERS, start: "2024-02-01", end: "2024-01-01" })).toThrow(AnalysisError);
    expect(() => analyze(parsed, { ...NO_FILTERS, sender: 99 })).toThrow(AnalysisError);
  });

  it("presets count back from the last day of data and clamp to the first", () => {
    const full = { start: "2023-12-30", end: "2024-01-15" };
    expect(presetRange("all", full)).toEqual({ start: null, end: null });
    expect(presetRange("7", full)).toEqual({ start: "2024-01-09", end: "2024-01-15" });
    expect(presetRange("30", full)).toEqual({ start: "2023-12-30", end: "2024-01-15" });
  });

  it("Recap (no filters) equals an explicit full-range filter", () => {
    const { parsed, stats } = run(chat);
    expect(analyze(parsed, { start: "2023-12-30", end: "2024-01-15", sender: null })).toEqual(stats);
  });
});

describe("edge cases", () => {
  it("single message", () => {
    const { stats } = run(lines(android("01/01/2024", "09:00", "Alice", "merhaba")));
    checkInvariants(stats);
    expect(stats.kpis).toMatchObject({ totalMessages: 1, activeDays: 1, peakHour: 9, peakHourShare: 100 });
    expect(stats.insights.longestStreak).toEqual({ days: 0, start: null, end: null });
    expect(stats.insights.mostActiveWindow).toEqual({ startHour: 6, share: 100 }); // ties prefer the window holding the peak, then earliest
    expect(stats.insights.conversationStarter).toMatchObject({ share: 100, count: 1, conversations: 1 });
    expect(stats.insights.nightOwl.id).toBeNull();
    expect(stats.participants[0]).toMatchObject({ messages: 1, share: 100, responseTime: { median: null } });
  });

  it("media-only chat: no words, no keywords, every message is media", () => {
    const { stats } = run(lines(
      ios("01.01.24", "09:00:00", "A", "‎image omitted"),
      ios("01.01.24", "09:01:00", "B", "‎sticker omitted"),
      ios("01.01.24", "09:02:00", "A", "‎audio omitted"),
    ));
    expect(stats.kpis).toMatchObject({ totalWords: 0, wordsPerMessage: 0, messagesByKind: { media: 3, text: 0 } });
    expect(stats.content.topKeywords).toEqual([]);
    expect(stats.content.media).toEqual({
      total: 3, share: 100,
      items: [{ key: "Photos", count: 1 }, { key: "Stickers", count: 1 }, { key: "Voice notes", count: 1 }],
    });
  });

  it("deleted and unavailable messages count as messages, not media or words", () => {
    const { stats } = run(lines(
      android("01/01/2024", "09:00", "A", "This message was deleted"),
      android("01/01/2024", "09:01", "B", "Waiting for this message"),
      android("01/01/2024", "09:02", "A", "real words here"),
    ));
    expect(stats.kpis.messagesByKind).toEqual({ text: 1, media: 0, deleted: 1, unavailable: 1 });
    expect(stats.kpis).toMatchObject({ totalMessages: 3, totalWords: 3, wordsPerMessage: 3 });
    expect(stats.content.media.total).toBe(0);
    expect(stats.content.topKeywords.map((k) => k.key)).toEqual(["real", "words"]);
  });

  it("streak: consecutive days, earliest of equal runs, across a month end", () => {
    const { stats } = run(lines(
      android("30/01/2024", "10:00", "A", "1"),
      android("31/01/2024", "10:00", "A", "2"),
      android("01/02/2024", "10:00", "A", "3"),
      android("05/02/2024", "10:00", "A", "4"),
      android("06/02/2024", "10:00", "A", "5"),
      android("07/02/2024", "10:00", "A", "6"),
    ));
    expect(stats.insights.longestStreak).toEqual({ days: 3, start: "2024-01-30", end: "2024-02-01" });
  });

  it("weekday averages divide by the weekdays in the period", () => {
    // Monday 2024-01-01 … Sunday 2024-01-14: two of every weekday.
    const { stats } = run(lines(
      android("01/01/2024", "10:00", "A", "x"),
      android("01/01/2024", "11:00", "A", "x"),
      android("08/01/2024", "10:00", "A", "x"),
      android("14/01/2024", "10:00", "A", "x"),
    ));
    expect(stats.timing.weekdayAverages).toEqual([1.5, 0, 0, 0, 0, 0, 0.5]);
    expect(stats.insights.busiestWeekday).toBe(0);
  });

  it("night owl: share of own messages, minimum count, nobody when nobody is up", () => {
    const rows = [];
    for (let i = 0; i < 20; i++) rows.push(android("01/01/2024", `1${i % 10}:${String(i).padStart(2, "0")}`, "A", "day"));
    rows.push(android("02/01/2024", "01:00", "A", "night"));
    rows.push(android("02/01/2024", "02:00", "B", "night"), android("02/01/2024", "03:00", "B", "night"));
    // B: 100% at night but only 2 messages; A is the only one with >= 20.
    const { parsed, stats } = run(lines(...rows));
    expect(stats.insights.nightOwl).toEqual({ id: idOf(parsed, "A"), count: 1, share: 4.8 });
  });

  it("emojis: sequences, flags, keycaps; skin tones folded", () => {
    expect(emojisIn("👍🏽 👍 🇹🇷 👨‍👩‍👧 1️⃣ ❤️ text")).toEqual(["👍", "👍", "🇹🇷", "👨‍👩‍👧", "1️⃣", "❤️"]);
  });

  it("keywords: Unicode letters, URLs removed, apostrophe suffixes cut, mash dropped", () => {
    expect(keywordsIn("Café https://x.io/abc İzmir'den hahaha asdasdasd naïve", "en")).toEqual(["café", "izmir", "naïve"]);
  });

  it("chat type comes from the parser, not from the filtered senders (C8)", () => {
    const { parsed, stats } = run(lines(
      android("01/01/2024", "10:00", "A", "1"),
      android("01/01/2024", "10:01", "B", "2"),
      android("02/01/2024", "10:00", "C", "3"),
    ));
    expect(stats.meta.chatType.kind).toBe("group");
    expect(analyze(parsed, { ...NO_FILTERS, end: "2024-01-01" }).meta.chatType.kind).toBe("group");
  });
});

describe("numbers", () => {
  it("rounds exact fractions half to even, like Python's round()", () => {
    expect(percent(1, 8)).toBe(12); // 12.5
    expect(percent(3, 8)).toBe(38); // 37.5
    expect(ratio(1, 4, 1)).toBe(0.2); // 0.25
    expect(ratio(3, 4, 1)).toBe(0.8); // 0.75
    expect(ratio(5, 0, 1)).toBe(0);
  });

  it("largest remainder sums to 100 and keeps equal counts equal", () => {
    expect(largestRemainder([1, 1, 1])).toEqual([34, 33, 33]);
    expect(largestRemainder([1, 1, 4])).toEqual([17, 17, 66]);
    expect(largestRemainder([0, 0])).toEqual([0, 0]);
  });
});
