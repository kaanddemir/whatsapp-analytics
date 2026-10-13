import { describe, expect, it } from "vitest";
import { formatCount, formatDuration } from "@/ui/format";

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
