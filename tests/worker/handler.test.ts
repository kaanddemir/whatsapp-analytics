import { describe, expect, it } from "vitest";
import { analyze as analyzeStats } from "@/analytics";
import { createHandler } from "@/worker/handler";
import type { WorkerRequest, WorkerResponse } from "@/worker/protocol";
import { NO_FILTERS } from "@/model";
import { parseExport } from "@/parser";

const SAMPLE = "01/02/24, 09:00 - Alice: hi\n01/02/24, 09:01 - Bob: hello there\n";

async function run(handle: ReturnType<typeof createHandler>, request: WorkerRequest) {
  const out: WorkerResponse[] = [];
  await handle(request, (r) => out.push(r));
  return out;
}

describe("worker handler", () => {
  it("reads, decodes and parses a file, reporting progress and a summary without message text", async () => {
    const handle = createHandler();
    const out = await run(handle, { type: "load", id: 1, file: new File([SAMPLE], "chat.txt") });
    // Reading may report several fractions; the stages themselves come in order, once each.
    const stages = out.filter((r) => r.type === "progress").map((r) => r.type === "progress" && r.stage);
    expect(stages.filter((s, i) => s !== stages[i - 1])).toEqual(["reading", "decoding", "parsing"]);
    expect(out.at(-1)).toMatchObject({
      type: "loaded",
      id: 1,
      summary: {
        file: { fileName: "chat.txt", encoding: "utf-8", archiveEntry: null },
        participantCount: 2,
        chatType: { kind: "unknown" },
        firstMessageAt: "2024-02-01T09:00:00",
        report: { messages: 2, completeness: "complete" },
      },
    });
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain("hello there");
    expect(serialized).not.toContain("Alice");
  });

  it("re-reads a file with the date order the user chose", async () => {
    const handle = createHandler();
    const out = await run(handle, { type: "load", id: 3, file: new File([SAMPLE], "chat.txt"), dateOrder: "mdy" });
    expect(out.at(-1)).toMatchObject({
      type: "loaded",
      summary: { firstMessageAt: "2024-01-02T09:00:00", report: { format: { dateOrder: "mdy", dateOrderCertainty: "user" } } },
    });
  });

  it("reports no_messages with the parse report, still without content", async () => {
    const handle = createHandler();
    const out = await run(handle, { type: "load", id: 2, file: new File(["secret notes\nmore\n"], "notes.txt") });
    expect(out.at(-1)).toMatchObject({
      type: "error",
      code: "no_messages",
      report: { completeness: "empty", warnings: [{ code: "orphan_lines", count: 2 }] },
    });
    expect(JSON.stringify(out)).not.toContain("secret");
  });

  it("maps input errors to codes", async () => {
    const handle = createHandler();
    const out = await run(handle, { type: "load", id: 3, file: new File(["x"], "a.pdf") });
    expect(out.at(-1)).toMatchObject({ type: "error", id: 3, code: "unsupported_type" });
  });

  it("does not leak unexpected error messages", async () => {
    const handle = createHandler({ read: () => Promise.reject(new Error("secret message text")) });
    const out = await run(handle, { type: "load", id: 4, file: new File(["x"], "a.txt") });
    expect(out.at(-1)).toMatchObject({ type: "error", code: "internal" });
    expect(JSON.stringify(out)).not.toContain("secret");
  });

  it("refuses to analyze before a load, then returns stats", async () => {
    const handle = createHandler();
    expect((await run(handle, { type: "analyze", id: 5, filters: NO_FILTERS })).at(-1)).toMatchObject({ code: "no_chat_loaded" });
    await run(handle, { type: "load", id: 6, file: new File([SAMPLE], "chat.txt") });
    const out = await run(handle, { type: "analyze", id: 7, filters: NO_FILTERS });
    expect(out.map((r) => r.type)).toEqual(["progress", "stats"]);
    expect(out.at(-1)).toMatchObject({ type: "stats", id: 7, stats: { kpis: { totalMessages: 2 } } });
    expect(JSON.stringify(out)).not.toContain("hello there");
  });

  it("parses once; filter changes only re-run the analytics", async () => {
    let parses = 0;
    let analyses = 0;
    const handle = createHandler({
      parse: (text) => (parses++, parseExport(text)),
      analyze: (...args) => (analyses++, analyzeStats(...args)),
    });
    await run(handle, { type: "load", id: 1, file: new File([SAMPLE], "chat.txt") });
    for (const [id, sender] of [[2, 0], [3, 1], [4, null], [5, 0]] as const) {
      const out = await run(handle, { type: "analyze", id, filters: { ...NO_FILTERS, sender } });
      expect(out.at(-1)?.type).toBe("stats");
    }
    expect(parses).toBe(1);
    expect(analyses).toBe(4);
  });

  it("maps a bad filter to invalid_filter", async () => {
    const handle = createHandler();
    await run(handle, { type: "load", id: 1, file: new File([SAMPLE], "chat.txt") });
    const out = await run(handle, { type: "analyze", id: 2, filters: { ...NO_FILTERS, start: "not a date" } });
    expect(out.at(-1)).toMatchObject({ type: "error", code: "invalid_filter" });
  });

  it("forgets the chat on clear and on a failed reload", async () => {
    const handle = createHandler();
    await run(handle, { type: "load", id: 8, file: new File([SAMPLE], "chat.txt") });
    expect(await run(handle, { type: "clear", id: 9 })).toEqual([{ type: "cleared", id: 9 }]);
    expect((await run(handle, { type: "analyze", id: 10, filters: NO_FILTERS })).at(-1)).toMatchObject({ code: "no_chat_loaded" });

    await run(handle, { type: "load", id: 11, file: new File([SAMPLE], "chat.txt") });
    await run(handle, { type: "load", id: 12, file: new File(["nothing here"], "b.txt") });
    expect((await run(handle, { type: "analyze", id: 13, filters: NO_FILTERS })).at(-1)).toMatchObject({ code: "no_chat_loaded" });
  });
});
