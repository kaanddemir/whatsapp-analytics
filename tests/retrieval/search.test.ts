/* Keyword search: keyword search. Results must equal a brute-force scan of every
   message under the documented matching rules (exact totals, no sampling),
   handle Turkish folding and suffixes, respect filters, cite the right
   messages, and highlight what matched. */
import { describe, expect, it } from "vitest";
import { parseExport } from "@/parser";
import { buildKeywordIndex, highlights, parseQuery, search } from "@/search/keywordIndex";
import { foldAligned, tokens } from "@/text/fold";
import { ChatSession } from "@/conversation/session";
import { createHandler } from "@/worker/handler";
import { MemoryChatStore } from "@/store/chatStore";
import type { Message } from "@/model";
import type { WorkerResponse } from "@/worker/protocol";
import { synthExport } from "../fixtures/syntheticExport";
import { android, lines } from "../support/export";

const SMALL = lines(
  android("01/02/24", "09:00", "Ayşe", "Yarın kahveye gidelim mi? Kadıköy'deki kahveci çok iyi"),
  android("01/02/24", "09:05", "Can", "GÖRÜŞÜRÜZ, saat 19:30 uygun"),
  android("02/02/24", "10:00", "Ayşe", "gorusuruz o zaman"),
  android("03/02/24", "11:00", "Can", "Let's grab coffee at the new place"),
  android("04/02/24", "12:00", "Ayşe", "<Media omitted>"),
  android("05/02/24", "13:00", "Can", "İstanbul'a dönünce ararım"),
  android("06/02/24", "14:00", "Ayşe", "istanbul trafiği yine berbat"),
);

/** The documented rules, applied message by message without the index. */
function bruteForce(messages: readonly Message[], query: string, from = -Infinity, to = Infinity, sender: number | null = null): number[] {
  const q = parseQuery(query);
  const out: number[] = [];
  messages.forEach((m, i) => {
    if (m.kind !== "text" || m.ts < from || m.ts >= to || (sender !== null && m.sender !== sender)) return;
    const ws = tokens(foldAligned(m.text));
    const ok = q.terms.every((t) => ws.some((w) => (t.length <= 2 ? w === t : w.startsWith(t))))
      && q.phrases.every((p) => foldAligned(m.text).replace(/\s+/g, " ").includes(p));
    if (ok) out.push(i);
  });
  return out;
}

describe("keyword search rules", () => {
  const parsed = parseExport(SMALL);
  const index = buildKeywordIndex(parsed.messages);
  const find = (q: string) => [...search(index, parsed.messages, q, {}, "oldest").ids];

  it("matches Turkish suffixes by word beginnings", () => {
    expect(find("kahve")).toEqual([0]); // kahveye, kahveci
    expect(find("istanbul")).toEqual([5, 6]); // İstanbul'a, istanbul
  });

  it("folds diacritics and case both ways", () => {
    expect(find("görüşürüz")).toEqual([1, 2]);
    expect(find("gorusuruz")).toEqual([1, 2]);
    expect(find("GÖRÜŞ")).toEqual([1, 2]);
  });

  it("requires every word, and quoted phrases exactly", () => {
    expect(find("gorusuruz zaman")).toEqual([2]);
    expect(find("\"grab coffee\"")).toEqual([3]);
    expect(find("\"coffee grab\"")).toEqual([]);
  });

  it("short words match whole words only; media placeholders are not searchable", () => {
    expect(find("o")).toEqual([2]);
    expect(find("media")).toEqual([]);
    expect(find("omitted")).toEqual([]);
  });

  it("highlights the matched spans of the original text", () => {
    const text = parsed.messages[0]!.text;
    const spans = highlights(text, parseQuery("kahve").terms);
    expect(spans.map(([a, b]) => text.slice(a, b))).toEqual(["kahveye", "kahveci"]);
    const t5 = parsed.messages[5]!.text;
    expect(highlights(t5, parseQuery("istanbul").terms).map(([a, b]) => t5.slice(a, b))).toEqual(["İstanbul"]);
  });
});

describe("keyword search equals a full scan (20k synthetic messages, TR/EN)", () => {
  const text = [...synthExport({ n: 20000, format: "android24", lang: "mix", seed: 11, noise: false })].join("");
  const parsed = parseExport(text);
  const index = buildKeywordIndex(parsed.messages);
  const queries = ["toplantı", "toplanti", "the", "sınav sonuçları", "netflix", "\"trafik yine\"", "gym tomorrow", "kira", "ok", "unutma", "çocukları okuldan", "dentist tuesday", "xyzzy"];

  for (const q of queries) {
    it(`"${q}"`, () => {
      expect([...search(index, parsed.messages, q, {}, "oldest").ids]).toEqual(bruteForce(parsed.messages, q));
    });
  }

  it("filters by participant and date range exactly", () => {
    const from = Date.UTC(2018, 0, 1), to = Date.UTC(2019, 0, 1);
    for (const sender of [0, 2]) {
      expect([...search(index, parsed.messages, "kira", { from, to, sender }, "oldest").ids]).toEqual(bruteForce(parsed.messages, "kira", from, to, sender));
    }
  });

  it("relevance and date sorts return the same set", () => {
    const a = [...search(index, parsed.messages, "trafik", {}, "relevance").ids].sort((x, y) => x - y);
    const b = [...search(index, parsed.messages, "trafik", {}, "newest").ids];
    expect(a).toEqual([...b].reverse());
  });
});

describe("search through the worker", () => {
  it("pages results with exact totals and cites the stored messages", async () => {
    const handle = createHandler({ store: new MemoryChatStore() });
    const out: WorkerResponse[] = [];
    await handle({ type: "load", id: 1, file: new File([SMALL], "chat.txt") }, (r) => out.push(r));
    await handle({ type: "search", id: 2, query: "gorusuruz", filters: { start: null, end: null, sender: null }, sort: "oldest", offset: 0, limit: 1 }, (r) => out.push(r));
    expect(out.some((r) => r.type === "progress" && r.stage === "indexing")).toBe(true);
    const res = out.at(-1)!;
    expect(res.type).toBe("searchResults");
    if (res.type !== "searchResults") return;
    expect(res.page.total).toBe(2);
    expect(res.page.items).toHaveLength(1);
    expect(res.page.items[0]!.message).toMatchObject({ id: 1, at: "2024-02-01T09:05:00", senderName: "Can", text: "GÖRÜŞÜRÜZ, saat 19:30 uygun" });

    const ctx: WorkerResponse[] = [];
    await handle({ type: "context", id: 3, messageId: 1, before: 1, after: 1 }, (r) => ctx.push(r));
    expect(ctx.at(-1)).toMatchObject({ type: "messages", messages: [{ id: 0 }, { id: 1 }, { id: 2 }] });
  });

  it("session context is clamped to the chat", () => {
    const s = new ChatSession(parseExport(SMALL));
    expect(s.context(0, 3, 0).map((m) => m.id)).toEqual([0]);
    expect(s.context(6, 0, 5).map((m) => m.id)).toEqual([6]);
  });
});
