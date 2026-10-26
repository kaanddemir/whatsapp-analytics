/* How an answer is laid out (src/ui/ask/present.ts): bars only for rows on
   one scale, widths from the engine's magnitudes, reply pairs kept together
   in the engine's order, and highlighting that never repeats or loses text. */
import { describe, expect, it } from "vitest";
import { parseExport } from "@/parser";
import { answer } from "@/ask/answer";
import { ChatSession } from "@/conversation/session";
import { NO_FILTERS } from "@/model";
import type { Answer, AnswerRow } from "@/ask/types";
import { barWidths, highlightParts, isTranscript, messageGroups, pageable, rowsView, scopeKey } from "@/ui/ask/present";
import { ASK_CHAT } from "../fixtures/askChat";

const session = new ChatSession(parseExport(ASK_CHAT));
const ask = (q: string) => answer(q, session, NO_FILTERS);
const row = (magnitude: number | null): AnswerRow => ({ label: "x", value: "v", detail: null, lead: false, share: null, magnitude });

describe("rows", () => {
  it("are bars only when every row is one measure and there is something to compare", () => {
    expect(rowsView([])).toBeNull();
    expect(rowsView([row(3)])).toBe("list");
    expect(rowsView([row(3), row(0)])).toBe("bars");
    expect(rowsView([row(3), row(null)])).toBe("list");
    expect(rowsView([row(3), row(Number.NaN)])).toBe("list");
  });

  it("are drawn in proportion to the largest, and all-zero rows draw nothing", () => {
    expect(barWidths([row(10), row(5), row(0)])).toEqual([100, 50, 0]);
    expect(barWidths([row(0), row(0)])).toEqual([0, 0]);
  });

  it("follow the engine's choice per answer type", () => {
    expect(rowsView(ask("Who sends more messages?").rows)).toBe("bars");
    expect(rowsView(ask("Who replies fastest?").rows)).toBe("bars");
    // Behaviour rule matches are a list: their counts and rates are not one scale.
    const apology = ask("Who apologises more?");
    expect(apology.rows.every((r) => r.magnitude === null)).toBe(true);
    expect(rowsView(apology.rows)).toBe("list");
  });
});

describe("messages", () => {
  it("keep each reply with the message it answered, in the engine's order", () => {
    const evidence = ask("Find messages about concert").evidence;
    const [a, b, c] = evidence;
    const fake = { evidence: [a, b, c], result: { kind: "recall", filters: NO_FILTERS, pairs: [{ match: a!.message.id, reply: b!.message.id }, { match: c!.message.id, reply: null }] } } as unknown as Answer;
    expect(messageGroups(fake).map((g) => [g.match.message.id, g.reply?.message.id ?? null])).toEqual([[a!.message.id, b!.message.id], [c!.message.id, null]]);
  });

  it("are a transcript for a day's messages, ranked otherwise; only searches that found more can page", () => {
    expect(isTranscript(ask("What did we talk about on 1 March 2024?"))).toBe(true);
    expect(isTranscript(ask("Find messages about concert"))).toBe(false);
    expect(pageable(ask("Find messages about concert"))).toBe(true);
    expect(pageable(ask("What did we talk about on 1 March 2024?"))).toBe(false);
  });
});

describe("highlighting", () => {
  it("marks the matched spans and keeps every character once", () => {
    const parts = highlightParts("the concert was amazing", [[4, 11]]);
    expect(parts).toEqual([{ text: "the ", mark: false }, { text: "concert", mark: true }, { text: " was amazing", mark: false }]);
  });

  it("tolerates unsorted, overlapping and out-of-range spans", () => {
    const text = "abcdefgh";
    const parts = highlightParts(text, [[6, 99], [1, 3], [2, 4]]);
    expect(parts.map((p) => p.text).join("")).toBe(text);
    expect(parts.filter((p) => p.mark).map((p) => p.text)).toEqual(["bc", "d", "gh"]);
    expect(highlightParts("", [])).toEqual([{ text: "", mark: false }]);
  });
});

it("tells scopes apart by participant and dates", () => {
  expect(scopeKey(NO_FILTERS)).toBe(scopeKey({ start: null, end: null, sender: null }));
  expect(scopeKey({ start: "2024-01-01", end: null, sender: null })).not.toBe(scopeKey(NO_FILTERS));
  expect(scopeKey({ start: null, end: null, sender: 0 })).not.toBe(scopeKey(NO_FILTERS));
});
