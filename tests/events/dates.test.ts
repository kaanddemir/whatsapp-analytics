/* Plan and date analysis: the conservative date/time extractor on labelled cases. */
import { describe, expect, it } from "vitest";
import { extractDates, type DateMention } from "@/events/dates";
import { foldAligned } from "@/text/fold";
import { DATE_CASES } from "../fixtures/dateCases";

function describeMention(m: DateMention): string {
  if (m.kind === "date") return `date:${m.day}/${m.month}${m.year ? `/${m.year}` : ""}`;
  if (m.kind === "time") return `time:${m.time}`;
  if (m.kind === "ambiguous") return `ambiguous:${m.reason}:${foldAligned(m.text)}`;
  return `relative:${foldAligned(m.text).replace(/'.*$/, "")}`;
}

describe("date and time extraction", () => {
  for (const [text, expected] of DATE_CASES) {
    it(text, () => {
      expect(extractDates(text).map(describeMention)).toEqual(expected);
    });
  }

  it("spans point at the original text", () => {
    const text = "Düğün 7 Eylül 2025, saat 19:30";
    for (const m of extractDates(text)) expect(text.slice(m.start, m.end)).toBe(m.text);
  });
});
