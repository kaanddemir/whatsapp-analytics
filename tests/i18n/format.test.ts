import { describe, expect, it } from "vitest";
import { formatCount, formatDate, formatDecimal, formatDuration, formatPercent, plural } from "@/i18n/format";

describe("display rules", () => {
  it("formats counts with grouping", () => {
    expect(formatCount(1234567)).toBe("1,234,567");
  });
});

describe("formatDuration", () => {
  it("keeps zero distinct from no data and respects timestamp precision", () => {
    expect(formatDuration(null, "minute")).toBe("—");
    expect(formatDuration(0, "minute")).toBe("under 1 min");
    expect(formatDuration(0, "second")).toBe("0s");
    expect(formatDuration(42, "second")).toBe("42s");
    expect(formatDuration(90, "minute")).toBe("1m");
    expect(formatDuration(3 * 3600 + 120, "minute")).toBe("3h 2m");
    expect(formatDuration(2 * 86400, "minute")).toBe("2d");
  });
});

describe("Turkish formatting", () => {
  it("formats Turkish numbers, dates, percentages, plurals and durations", () => {
    expect(formatCount(2006, "tr")).toBe("2.006");
    expect(formatDecimal(12.5, "tr")).toBe("12,5");
    expect(formatPercent(12.5, "tr")).toContain("12,5");
    expect(formatDate("2024-01-05", "tr")).toMatch(/Oca/);
    expect(plural(2, "mesaj", "mesaj", "tr")).toBe("2 mesaj");
    expect(formatDuration(90, "minute", "tr")).toBe("1 dk");
  });
});
