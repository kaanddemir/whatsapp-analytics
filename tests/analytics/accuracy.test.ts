/* Hand-computed expectations for a small chat, and format equivalence.

   The golden files check parity with the former Python engine; these check
   the numbers against values worked out by hand from the fixture below, so a
   defect shared by both engines would still fail here. */
import { describe, expect, it } from "vitest";
import { analyze } from "@/analytics";
import type { Stats } from "@/model";
import { NO_FILTERS } from "@/model";
import { parseExport } from "@/parser";
import { LRM, NNBSP, android, ios, lines } from "../support/export";

// Wed 3 Jan 2024 to Fri 5 Jan 2024. Ana, Bo, Cem (a group: three senders).
//   #  time               sender  body
//   1  Wed 09:00          Ana     "Günaydın 😀"            text, 2 words, 1 emoji
//   2  Wed 09:02          Bo      "hi"                     text; reply after 2 min
//   3  Wed 09:02          Bo      photo                    media (same sender: no reply)
//   4  Wed 09:10          Cem     "two\nlines 😀😀"        text, 2 words, 2 emojis; reply after 8 min
//   5  Wed 23:30          Ana     "late"                   text; reply after 14 h 20 min
//   -  Thu 00:10          (system) Cem left               not a message
//   6  Thu 01:00          Bo      deleted                  reply after 1 h 30 min; night
//   7  Fri 10:00          Cem     "ok"                     reply after 33 h; new conversation (> 6 h)
const DMY = lines(
  android("03/01/2024", "09:00", "Ana", "Günaydın 😀"),
  android("03/01/2024", "09:02", "Bo", "hi"),
  android("03/01/2024", "09:02", "Bo", "IMG-20240103-WA0001.jpg (file attached)"),
  android("03/01/2024", "09:10", "Cem", "two"),
  "lines 😀😀",
  android("03/01/2024", "23:30", "Ana", "late"),
  android("04/01/2024", "00:10", null, "Cem left"),
  android("04/01/2024", "01:00", "Bo", "This message was deleted"),
  android("05/01/2024", "10:00", "Cem", "ok"),
);

// The same chat as an iOS export with a 12-hour clock and M/D/Y dates.
const pm = (t: string) => `${t}${NNBSP}PM`;
const am = (t: string) => `${t}${NNBSP}AM`;
const IOS = lines(
  ios("1/3/24", am("9:00:00"), "Ana", "Günaydın 😀"),
  ios("1/3/24", am("9:02:00"), "Bo", "hi"),
  ios("1/3/24", am("9:02:00"), "Bo", `${LRM}image omitted`),
  ios("1/3/24", am("9:10:00"), "Cem", "two"),
  "lines 😀😀",
  ios("1/3/24", pm("11:30:00"), "Ana", "late"),
  `[1/4/24, ${am("12:10:00")}] ${LRM}Cem left`,
  ios("1/4/24", am("1:00:00"), "Bo", `${LRM}This message was deleted.`),
  ios("1/5/24", am("10:00:00"), "Cem", "ok"),
);

// And as a Turkish Android export: dotted dates.
const TR = DMY.replace(/(\d\d)\/(\d\d)\/(\d{4})/g, "$1.$2.$3");

const statsOf = (text: string): Stats => analyze(parseExport(text), NO_FILTERS);
const byName = (s: Stats) => Object.fromEntries(s.participants.map((p) => [p.name, p]));

describe("hand-computed chat", () => {
  const s = statsOf(DMY);

  it("counts every message once, by kind, and not the system line", () => {
    expect(s.kpis.totalMessages).toBe(7);
    expect(s.kpis.messagesByKind).toEqual({ text: 5, media: 1, deleted: 1, unavailable: 0 });
    expect(s.meta.chatType.kind).toBe("group");
    expect(s.kpis.activeDays).toBe(3);
    expect(s.kpis.messagesPerActiveDay).toBe(2.3); // 7 / 3
    expect(s.meta.fullRange).toEqual({ start: "2024-01-03", end: "2024-01-05" });
  });

  it("attributes messages and shares to the right people", () => {
    const p = byName(s);
    expect([p.Ana!.messages, p.Bo!.messages, p.Cem!.messages]).toEqual([2, 3, 2]);
    // 28.57 / 42.86 / 28.57 -> largest remainder 29 / 43 / 28 (equal remainders: first seen wins).
    expect(s.participants.map((x) => [x.name, x.share])).toEqual([["Bo", 43], ["Ana", 29], ["Cem", 28]]);
  });

  it("buckets by wall-clock hour, weekday and day", () => {
    const hours = new Array(24).fill(0);
    hours[9] = 4; hours[23] = 1; hours[1] = 1; hours[10] = 1;
    expect(s.timing.hours).toEqual(hours);
    expect(s.highlights.weekdayTotals).toEqual([0, 0, 5, 1, 1, 0, 0]); // Wed, Thu, Fri
    expect(s.timeline.daily.values).toEqual([5, 1, 1]);
    expect(s.kpis.peakHour).toBe(9);
    expect(s.kpis.peakHourShare).toBe(57.1); // 4 / 7
  });

  it("counts words in typed text only, and emojis in every message", () => {
    // "Günaydın 😀" 2, "hi" 1, "two\nlines 😀😀" 3, "late" 1, "ok" 1 = 8 over 5 messages.
    expect(s.kpis.totalWords).toBe(8);
    expect(s.kpis.wordsPerMessage).toBe(1.6);
    expect(s.content.emojiSummary).toEqual({ uses: 3, messageCount: 2 });
    expect(s.content.topEmojis).toEqual([{ key: "😀", count: 3 }]);
    expect(s.content.media.items).toEqual([{ key: "Photos", count: 1 }]);
  });

  it("measures response time after a different sender, under 48 h, as a median", () => {
    const p = byName(s);
    // Bo: 2 min and 1 h 30 min -> median 46 min. Cem: 8 min and 33 h -> 20 h 34 min. Ana: 14 h 20 min.
    expect(p.Bo!.responseTime).toEqual({ median: (120 + 5400) / 2, sampleSize: 2 });
    expect(p.Cem!.responseTime).toEqual({ median: (480 + 118_800) / 2, sampleSize: 2 });
    expect(p.Ana!.responseTime).toEqual({ median: 51_600, sampleSize: 1 });
  });

  it("starts a conversation at the first message and after more than 6 h of silence", () => {
    // Starts: Ana 09:00, Ana 23:30 (14 h gap), Cem Fri 10:00 (33 h gap).
    expect(s.insights.conversationStarter).toMatchObject({ count: 2, conversations: 3, share: 67 });
    expect(s.participants.find((x) => x.id === s.insights.conversationStarter.id)!.name).toBe("Ana");
  });

  it("night owl and streak", () => {
    // Bo's 01:00 message: 1 of 3 own messages (nobody reaches the 20-message minimum).
    expect(s.insights.nightOwl).toMatchObject({ count: 1, share: 33.3 });
    expect(s.participants.find((x) => x.id === s.insights.nightOwl.id)!.name).toBe("Bo");
    expect(s.insights.longestStreak).toEqual({ days: 3, start: "2024-01-03", end: "2024-01-05" });
  });
});

describe("equivalent exports give equivalent analytics", () => {
  // Media placeholders differ by platform (file name vs "image omitted") but
  // classify the same; everything else must match exactly.
  const comparable = (s: Stats) => ({ ...s, meta: { ...s.meta, timestampResolution: null } });

  it("Android D/M/Y 24 h, iOS M/D/Y 12 h and Turkish dotted dates agree", () => {
    const base = comparable(statsOf(DMY));
    expect(comparable(statsOf(IOS))).toEqual(base);
    expect(comparable(statsOf(TR))).toEqual(base);
  });

  it("filtering never adds messages, and day filters partition the total", () => {
    const parsed = parseExport(DMY);
    const full = analyze(parsed, NO_FILTERS);
    const days = ["2024-01-03", "2024-01-04", "2024-01-05"].map((d) => analyze(parsed, { start: d, end: d, sender: null }).kpis.totalMessages);
    expect(days.reduce((a, b) => a + b, 0)).toBe(full.kpis.totalMessages);
    for (const d of days) expect(d).toBeLessThanOrEqual(full.kpis.totalMessages);
  });
});
