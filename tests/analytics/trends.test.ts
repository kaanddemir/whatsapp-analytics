/* Recent changes (analytics/trends.ts) and the Ask answers about them.

   Every chat here is built day by day, so the expected figures are known by
   construction (counted while building), never read back from the code under
   test. Negative cases matter as much as positive ones: bursty chats with no
   real change must not be reported as a trend, and too little data must say
   so instead of "no change". */
import { describe, expect, it } from "vitest";
import { analyze } from "@/analytics";
import { longestSilence, mannWhitneyZ, proportionZ, windowDays } from "@/analytics/trends";
import { answer } from "@/ask/answer";
import { route } from "@/ask/router";
import type { AnalysisFilters, ParseResult } from "@/model";
import { NO_FILTERS } from "@/model";
import { parseExport } from "@/parser";
import { ChatSession } from "@/conversation/session";
import { android, lines } from "../support/export";

const DAY0 = Date.UTC(2024, 0, 1);
const dateOf = (day: number) => {
  const d = new Date(DAY0 + day * 86_400_000);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
};
const isoOf = (day: number) => new Date(DAY0 + day * 86_400_000).toISOString().slice(0, 10);
const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

/** Builds a chat from (day, minute, sender, text) rows, kept in time order. */
class Chat {
  readonly rows: [number, number, string, string][] = [];
  add(day: number, minute: number, sender: string, text = "selam nasılsın") { this.rows.push([day, minute, sender, text]); return this; }
  parse(): ParseResult {
    const sorted = [...this.rows].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return parseExport(lines(...sorted.map(([d, m, s, t]) => android(dateOf(d), clock(m), s, t))));
  }
}
const stats = (parsed: ParseResult, filters: Partial<AnalysisFilters> = {}) => analyze(parsed, { ...NO_FILTERS, ...filters });
const id = (parsed: ParseResult, name: string) => parsed.participants.findIndex((p) => p.name === name);

/** Deterministic pseudo-random numbers (LCG), so "noise" is the same on every run. */
function rng(seed: number) {
  let x = seed >>> 0;
  return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

/** An exchange: `first` writes, `second` answers `gap` minutes later. */
function exchange(c: Chat, day: number, minute: number, first: string, second: string, gap = 2) {
  c.add(day, minute, first, "naber").add(day, minute + gap, second, "iyi senden");
}

describe("windows and tests", () => {
  it("compares 90-day windows from 180 days, 30-day windows from 60 days, nothing below", () => {
    expect([windowDays(59), windowDays(60), windowDays(179), windowDays(180), windowDays(1000)]).toEqual([null, 30, 30, 90, 90]);
  });

  it("Mann-Whitney z is zero for identical samples and signed by direction", () => {
    expect(mannWhitneyZ([1, 2, 3], [1, 2, 3])).toBeCloseTo(0);
    expect(mannWhitneyZ([1, 1, 1, 1, 1], [9, 9, 9, 9, 9])).toBeGreaterThan(2.5);
    expect(mannWhitneyZ([9, 9, 9, 9, 9], [1, 1, 1, 1, 1])).toBeLessThan(-2.5);
    expect(mannWhitneyZ([], [1])).toBe(0);
    expect(proportionZ(50, 100, 80, 100)).toBeGreaterThan(4);
    expect(proportionZ(5, 10, 5, 10)).toBe(0);
  });
});

describe("activity", () => {
  // 200 days: 6 messages a day for the first 110 days, 2 a day after.
  const c = new Chat();
  for (let d = 0; d < 200; d++) for (let i = 0; i < (d < 110 ? 6 : 2); i++) c.add(d, 600 + i * 7, i % 2 ? "Ayşe" : "Can");
  const parsed = c.parse(), s = stats(parsed);

  it("finds the drop and reports the exact window totals", () => {
    const w = s.trends.windows!;
    expect(w).toEqual({ days: 90, before: { start: isoOf(20), end: isoOf(109) }, after: { start: isoOf(110), end: isoOf(199) } });
    expect(s.trends.activity).toMatchObject({ before: 540, after: 180, perDayBefore: 6, perDayAfter: 2, activeDaysBefore: 90, activeDaysAfter: 90, direction: "down" });
  });

  it("agrees with the timeline the Overview draws", () => {
    const daily = s.timeline.daily.values;
    expect(daily.slice(110, 200).reduce((a, b) => a + b, 0)).toBe(s.trends.activity!.after);
    expect(daily.slice(20, 110).reduce((a, b) => a + b, 0)).toBe(s.trends.activity!.before);
  });

  it("follows the participant filter for activity, never for the people comparisons", () => {
    const ayse = stats(parsed, { sender: id(parsed, "Ayşe") });
    expect(ayse.trends.activity).toMatchObject({ before: 270, after: 90, direction: "down" });
    expect(ayse.trends.share).toEqual(s.trends.share);
  });

  it("follows the date filter: the windows end at the filter's end", () => {
    const early = stats(parsed, { end: isoOf(99) });
    // 100 days -> 30-day windows, all before the drop: no change.
    expect(early.trends.windows).toMatchObject({ days: 30, after: { start: isoOf(70), end: isoOf(99) } });
    expect(early.trends.activity).toMatchObject({ before: 180, after: 180, direction: "steady" });
  });

  it("answers in English and Turkish with the same figures", () => {
    const session = new ChatSession(parsed);
    const en = answer("Have we been texting less lately?", session, NO_FILTERS, undefined, "en");
    expect(en.plan).toMatchObject({ metric: "trend", aspect: "activity" });
    expect(en.text).toBe("Messages became less frequent: 2 a day in the last 90 days, against 6 a day in the 90 days before.");
    expect(en.rows.map((r) => r.value)).toEqual(["540 messages", "180 messages"]);
    expect(en.note).toMatch(/unlikely to be chance/);
    const tr = answer("Son aylarda konuşma sıklığımız değişti mi?", session, NO_FILTERS, undefined, "tr");
    expect(tr.text).toBe("Mesajlaşma seyrekleşti: son 90 günde günde 2 mesaj, önceki 90 günde ise günde 6 mesaj.");
  });
});

describe("no false trends", () => {
  it("bursty chats with the same pattern throughout are 'steady' (at most 1 of 30 seeds flagged)", () => {
    let flagged = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const r = rng(seed), c = new Chat();
      for (let d = 0; d < 200; d++) {
        // Quiet days, ordinary days and occasional bursts, drawn from one distribution for all 200 days.
        const u = r(), n = u < 0.35 ? 0 : u < 0.9 ? 1 + Math.floor(r() * 8) : 20 + Math.floor(r() * 60);
        for (let i = 0; i < n; i++) c.add(d, 480 + i * 2, r() < 0.5 ? "Ayşe" : "Can");
      }
      const t = stats(c.parse()).trends;
      if (t.activity!.direction === "up" || t.activity!.direction === "down") flagged++;
      if (t.share.some((x) => x.direction === "up" || x.direction === "down")) flagged++;
    }
    expect(flagged).toBeLessThanOrEqual(1);
  });

  it("too little data says so instead of 'no change'", () => {
    const c = new Chat();
    for (let d = 0; d < 200; d += 10) exchange(c, d, 600, "Can", "Ayşe");
    const t = stats(c.parse()).trends;
    expect(t.activity!.direction).toBe("insufficient");
    expect(t.share.every((x) => x.direction === "insufficient")).toBe(true);
    expect(t.responseTime.every((x) => x.direction === "insufficient")).toBe(true);
    expect(t.starter.every((x) => x.direction === "insufficient")).toBe(true);
  });

  it("a short chat compares nothing, and Ask says the period is too short", () => {
    const c = new Chat();
    for (let d = 0; d < 40; d++) exchange(c, d, 600, "Can", "Ayşe");
    const parsed = c.parse();
    expect(stats(parsed).trends).toMatchObject({ windows: null, activity: null, share: [], responseTime: [], starter: [] });
    const a = answer("Did we talk less lately?", new ChatSession(parsed), NO_FILTERS, undefined, "en");
    expect(a.text).toMatch(/fewer than 60 days/);
  });

  it("a one-sided chat has nobody to compare", () => {
    const c = new Chat();
    for (let d = 0; d < 200; d++) c.add(d, 600, "Can", "not");
    const parsed = c.parse(), t = stats(parsed).trends;
    expect(t.share).toEqual([]);
    expect(t.activity!.direction).toBe("steady");
    expect(answer("Has the message balance changed recently?", new ChatSession(parsed), NO_FILTERS, undefined, "en").text).toMatch(/Only one person/);
  });
});

describe("people", () => {
  // 200 days, one conversation a day (09:00), plus messages through the day.
  // Before day 110: Can starts, Ayşe answers within 2 minutes, both write equally.
  // From day 110: Ayşe starts, Can answers after 40 minutes, Ayşe writes 4 of every 5 messages.
  const c = new Chat();
  let canBefore = 0, ayseBefore = 0, canAfter = 0, ayseAfter = 0;
  for (let d = 0; d < 200; d++) {
    const late = d >= 110;
    const [first, second] = late ? ["Ayşe", "Can"] : ["Can", "Ayşe"];
    exchange(c, d, 540, first, second, late ? 40 : 2);
    for (let i = 0; i < 5; i++) c.add(d, 700 + i * 30, late ? (i === 4 ? "Can" : "Ayşe") : i % 2 ? "Ayşe" : "Can", "tamam");
    if (d >= 20 && d < 110) { canBefore += 4; ayseBefore += 3; }
    if (d >= 110) { canAfter += 2; ayseAfter += 5; }
  }
  // Day-by-day: before, 1 + 3 (i=0,2,4) Can and 1 + 2 Ayşe; after, Can 1 + 1, Ayşe 1 + 4.
  const parsed = c.parse(), s = stats(parsed), can = id(parsed, "Can"), ayse = id(parsed, "Ayşe");

  it("finds the share shift with exact window shares", () => {
    const byId = new Map(s.trends.share.map((x) => [x.id, x]));
    const pct = (a: number, b: number) => Math.round((a * 1000) / (a + b)) / 10;
    expect(byId.get(ayse)).toMatchObject({ before: pct(ayseBefore, canBefore), after: pct(ayseAfter, canAfter), direction: "up" });
    expect(byId.get(can)).toMatchObject({ direction: "down" });
  });

  it("finds who now starts the conversations, counted like the Conversation Starter card", () => {
    const st = new Map(s.trends.starter.map((x) => [x.id, x]));
    expect(st.get(ayse)).toMatchObject({ startedBefore: 0, startedAfter: 90, conversationsBefore: 90, conversationsAfter: 90, before: 0, after: 100, direction: "up" });
    expect(st.get(can)).toMatchObject({ startedBefore: 90, startedAfter: 0, direction: "down" });
    expect(s.insights.conversationStarter.conversations).toBe(200);
  });

  it("reports reply times per window, and a 14% change as no clear change", () => {
    const rt = new Map(s.trends.responseTime.map((x) => [x.id, x]));
    // Can before: 11:40 after 09:02 (158 min), 12:40 and 13:40 after Ayşe's half-hour turns (30 min) -> median 30 min.
    // Can after: 09:40 after 09:00 (40 min) and 13:40 after 13:10 (30 min) each day -> median 35 min.
    expect(rt.get(can)).toMatchObject({ before: { median: 1800, sampleSize: 270 }, after: { median: 2100, sampleSize: 180 }, direction: "steady" });
    expect(rt.get(ayse)!.direction).not.toBe("insufficient");
    const a = answer("Did our response times change this year?", new ChatSession(parsed), NO_FILTERS, undefined, "en");
    expect(a.plan).toMatchObject({ metric: "trend", aspect: "response_time", period: { start: `${new Date().getUTCFullYear()}-01-01` } });
  });

  it("answers who starts now, in both languages, ignoring the participant filter", () => {
    const session = new ChatSession(parsed);
    const en = answer("Has who starts our conversations changed?", session, { ...NO_FILTERS, sender: can }, undefined, "en");
    expect(en.text).toBe("Ayşe has been starting more of the conversations: 100% in the last 90 days, against 0% in the 90 days before.");
    expect(en.note).toMatch(/doesn’t apply to this comparison/);
    const tr = answer("Sohbeti kimin başlattığı değişti mi?", session, NO_FILTERS, undefined, "tr");
    expect(tr.text).toBe("Ayşe konuşmaların daha büyük kısmını başlatıyor: son 90 günde %100, önceki 90 günde %0.");
  });
});

describe("longest silence", () => {
  it("counts the empty days between two active days, from a week up", () => {
    const c = new Chat();
    c.add(0, 600, "Can").add(3, 600, "Ayşe").add(24, 600, "Can").add(30, 600, "Ayşe");
    const parsed = c.parse();
    expect(longestSilence(parsed.messages)).toEqual({ days: 20, lastBefore: isoOf(3), firstAfter: isoOf(24) });
    const c2 = new Chat();
    for (let d = 0; d < 30; d += 7) c2.add(d, 600, "Can");
    expect(longestSilence(c2.parse().messages)).toBeNull();
  });

  it("follows the participant filter (only that person's messages)", () => {
    const c = new Chat();
    for (let d = 0; d < 30; d++) c.add(d, 600, "Can");
    c.add(0, 610, "Ayşe").add(29, 610, "Ayşe");
    const parsed = c.parse();
    expect(stats(parsed).trends.longestSilence).toBeNull();
    expect(stats(parsed, { sender: id(parsed, "Ayşe") }).trends.longestSilence).toEqual({ days: 28, lastBefore: isoOf(0), firstAfter: isoOf(29) });
  });
});

describe("routing", () => {
  const people = [{ id: 0, name: "Can", isMetaAI: false }, { id: 1, name: "Ayşe", isMetaAI: false }];
  const NOW = Date.UTC(2025, 5, 15);
  const plan = (q: string) => route(q, people, NOW);

  it("keeps questions about something said as recall, not trends", () => {
    expect(plan("When did we talk about changing jobs?").type).toBe("recall");
    expect(plan("İş değiştirmek hakkında ne zaman konuştuk?")).not.toMatchObject({ metric: "trend" });
    expect(plan("Why do we talk less lately?")).toMatchObject({ type: "recall", limitation: "reason" });
    expect(plan("Has our relationship changed?")).toMatchObject({ type: "unsupported", reason: "needs_understanding" });
  });

  it("reads this month and last month as two periods", () => {
    expect(plan("Geçen ay ile bu ayı karşılaştır.")).toMatchObject({ metric: "compare_periods", periods: [{ start: "2025-05-01", end: "2025-05-31" }, { start: "2025-06-01", end: "2025-06-30" }] });
    expect(plan("Compare this month with last month")).toMatchObject({ metric: "compare_periods", periods: [{ start: "2025-06-01" }, { start: "2025-05-01" }] });
  });

  it("refuses topic lists rather than passing words off as topics", () => {
    for (const q of ["What topics do we talk about most?", "En çok konuştuğumuz konular neler?"]) expect(plan(q)).toMatchObject({ type: "unsupported", reason: "topics" });
  });
});

describe("period comparison per day", () => {
  it("shows messages per day and says when the periods cover different numbers of days", () => {
    const c = new Chat();
    // January 2024: 31 days x 2; February 1-10: 10 days x 3.
    for (let d = 0; d < 31; d++) exchange(c, d, 600, "Can", "Ayşe");
    for (let d = 31; d < 41; d++) { exchange(c, d, 600, "Can", "Ayşe"); c.add(d, 700, "Can"); }
    const a = answer("Did we talk more in January 2024 than in February 2024?", new ChatSession(c.parse()), NO_FILTERS, undefined, "en");
    expect(a.text).toBe("January 2024 had more messages than February 2024: 62 against 30.");
    expect(a.rows.map((r) => r.detail)).toEqual(["2 a day", "3 a day"]);
    expect(a.note).toMatch(/covers only part of February 2024/);
    expect(a.note).toMatch(/different numbers of days/);
  });
});

describe("exact change gates and filtered conversation boundaries", () => {
  it("does not promote a 4.96-point share change to five points by rounding for display", () => {
    const make = (afterCount: number) => {
      const c = new Chat();
      for (let side = 0; side < 2; side++) for (let i = 0; i < 10000; i++)
        c.add(side * 30 + i % 30, Math.floor(i / 30), i < (side ? afterCount : 1000) ? "Ayşe" : "Can");
      return stats(c.parse()).trends.share;
    };
    expect(make(1496).every((row) => row.direction === "steady")).toBe(true);
    expect(make(1500).some((row) => row.direction === "up")).toBe(true);
  });

  it("does not invent a conversation start when a date filter hides the immediately preceding message", () => {
    const c = new Chat().add(0, 23 * 60 + 59, "Can");
    for (let day = 1; day <= 60; day++) c.add(day, 0, "Ayşe").add(day, 1, "Can");
    const parsed = c.parse();
    const result = stats(parsed, { start: isoOf(1), end: isoOf(60) }).trends;
    const ayse = result.starter.find((row) => row.id === id(parsed, "Ayşe"))!;
    expect(ayse.conversationsBefore).toBe(29);
    expect(ayse.conversationsAfter).toBe(30);
  });
});
