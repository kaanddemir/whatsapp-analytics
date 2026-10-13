/* How media placeholders are classified with and without WhatsApp's LRM mark
   (U+200E), and what that means for analytics. The parser stays
   conservative: a placeholder with text in front of it counts as media only
   when the LRM sits right before the term. The "gap" cases pin down where
   that rule falls short, so a change in behaviour is a deliberate decision. */
import { describe, expect, it } from "vitest";
import { analyze } from "@/analytics";
import { NO_FILTERS } from "@/model";
import { parseExport } from "@/parser";
import { LRM } from "./fixtures";

const kindOf = (body: string) => {
  const m = parseExport(`[01.01.24, 10:00:00] A: ${body}\n[01.01.24, 10:01:00] B: ok\n`).messages[0]!;
  return m.kind === "media" ? `media:${m.mediaKind}` : m.kind;
};

describe("media placeholders", () => {
  it.each([
    [`${LRM}image omitted`, "media:Photos"],
    ["image omitted", "media:Photos"], // whole body: no LRM needed
    [`Look at this ${LRM}image omitted`, "media:Photos"], // caption + LRM
    [`report.pdf • 3 pages ${LRM}document omitted`, "media:Documents"],
    [`${LRM}<attached: 00000012-PHOTO-2024-01-01-10-00-00.jpg>`, "media:Photos"],
    ["<attached: 00000012-PHOTO-2024-01-01-10-00-00.jpg>", "media:Photos"],
    ["IMG-20240101-WA0001.jpg (file attached)", "media:Photos"],
    ["görüntü dahil edilmedi", "media:Photos"],
    // Android caption on the next line (Pustur/whatsapp-chat-parser#260).
    [`${LRM}IMG-20240101-WA0001.jpg (file attached)\nnice pic`, "media:Photos"],
    // iOS document row ending in "<attached: …>" (timelinize fixture).
    [`A PDF.pdf • ${LRM}1 page ${LRM}<attached: some-doc.pdf>`, "media:Documents"],
    ["<image omitted>", "media:Photos"],
    ["<GIF omitted>", "media:GIFs"],
    ["<Medya atlanmış>", "media:Other"],
    ["<Media omitted>", "media:Other"],
    ["the best part of the video omitted", "text"], // ordinary sentence stays text
  ])("%j -> %s", (body, expected) => expect(kindOf(body)).toBe(expected));

  describe("known gaps (no LRM evidence, so the row stays text)", () => {
    it("caption or document name before a placeholder, marks stripped", () => {
      // An export re-saved by a tool that drops invisible marks.
      expect(kindOf("Look at this image omitted")).toBe("text");
      expect(kindOf("report.pdf • 3 pages document omitted")).toBe("text");
      expect(kindOf("A PDF.pdf • 1 page <attached: some-doc.pdf>")).toBe("text");
    });


    it("the cost: the placeholder wording reaches word counts and keywords", () => {
      const stats = analyze(parseExport("[01.01.24, 10:00:00] A: Look at this image omitted\n"), NO_FILTERS);
      expect(stats.kpis.messagesByKind.media).toBe(0);
      expect(stats.content.topKeywords.map((k) => k.key)).toEqual(expect.arrayContaining(["image", "omitted"]));
    });
  });
});
