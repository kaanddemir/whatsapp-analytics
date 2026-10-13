/* Presentation rules: engine highlights agree with the metrics they
   summarise (the Recap story is covered in recap.test.ts), every card
   explanation survives an empty selection, and the display formatters. */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyze } from "@/analytics";
import type { Grain, Stats } from "@/model";
import { NO_FILTERS } from "@/model";
import { parseExport } from "@/parser";
import { formatBucket, formatDateRange, formatHourRange, formatPercent, formatShare, initials } from "@/ui/format";
import { heatLevels } from "@/ui/components/TimingCards";

const dir = join(__dirname, "fixtures/chats");
const chats = readdirSync(dir).map((f) => [f, parseExport(readFileSync(join(dir, f), "utf8"))] as const);
const sum = (a: readonly number[]) => a.reduce((x, y) => x + y, 0);

function selections(stats: Stats) {
  const { fullRange } = stats.meta;
  return [
    NO_FILTERS,
    { start: fullRange.end, end: fullRange.end, sender: null },
    ...stats.participants.slice(0, 2).map((p) => ({ start: null, end: null, sender: p.id })),
  ];
}

describe("highlights agree with the metrics", () => {
  for (const [name, parsed] of chats) {
    it(name, () => {
      for (const filters of selections(analyze(parsed, NO_FILTERS))) {
        const s = analyze(parsed, filters);
        const h = s.highlights;
        const total = s.kpis.totalMessages;
        expect(sum(h.weekdayTotals)).toBe(total);
        expect(h.nightMessages.count).toBe(sum(s.timing.hours.slice(0, 5)));
        expect(h.nonMediaMessages).toBe(total - s.content.media.total);
        for (const g of ["daily", "weekly", "monthly"] as Grain[]) {
          const peak = h.busiestBucket[g];
          const values = s.timeline[g].values;
          if (total === 0) expect(peak).toBeNull();
          else {
            expect(peak!.count).toBe(Math.max(...values));
            expect(s.timeline[g].buckets[values.indexOf(peak!.count)]).toBe(peak!.bucket);
          }
        }
        expect(h.busiestDay?.count ?? 0).toBe(total ? Math.max(...s.timeline.daily.values) : 0);
        if (h.busiestHour) expect(h.busiestHour.count).toBe(Math.max(...s.timing.heatmap.flat()));
        expect(h.periodDays).toBe(s.timeline.daily.values.length);
        if (s.participants.length >= 2) expect(h.leadOverRunnerUp).toBe(s.participants[0]!.share - s.participants[1]!.share);
      }
    });
  }
});

describe("display rules", () => {
  it("labels shares the way legacy did at the extremes", () => {
    expect(formatShare(0, 3, 1000)).toBe("<1%");
    expect(formatShare(100, 999, 1000)).toBe(">99%");
    expect(formatShare(100, 5, 5)).toBe("100%");
    expect(formatShare(42, 42, 100)).toBe("42%");
  });

  it("puts the percent sign first in Turkish shares", () => {
    expect(formatShare(42, 42, 100, "tr")).toBe("%42");
    expect(formatShare(0, 3, 1000, "tr")).toBe("<%1");
    expect(formatShare(100, 999, 1000, "tr")).toBe(">%99");
  });

  it("formats dates in UTC whatever the viewer's zone", () => {
    expect(formatBucket("2024-01-05", "daily")).toBe("Jan 05, 2024");
    expect(formatBucket("2024-01-01", "weekly")).toBe("Week of Jan 01, 2024");
    expect(formatBucket("2024-01-01", "monthly")).toBe("Jan 2024");
    expect(formatDateRange("2024-01-05", "2024-01-09")).toBe("Jan 05 – Jan 09, 2024");
    expect(formatDateRange("2023-12-30", "2024-01-02")).toBe("Dec 30, 2023 – Jan 02, 2024");
  });

  it("formats hours, percents and initials", () => {
    expect(formatHourRange(23)).toBe("23:00–00:00");
    expect(formatHourRange(22, 4)).toBe("22:00–02:00");
    expect(formatPercent(12)).toBe("12%");
    expect(formatPercent(12.5)).toBe("12.5%");
    expect(initials("Ayşe Yılmaz")).toBe("AY");
    expect(initials("İlker")).toBe("İL");
    expect(initials("😀 Party")).toBe("😀P");
  });

  it("ranks heatmap shades so one spike does not flatten the rest", () => {
    const level = heatLevels([[0, ...Array.from({ length: 20 }, (_, i) => i + 1), 1000]]);
    expect(level(0)).toBe(0);
    expect(level(1)).toBe(1);
    expect(level(1000)).toBe(5);
    expect(level(20)).toBe(5);
    expect(level(10)).toBeGreaterThan(level(2));
  });
});
