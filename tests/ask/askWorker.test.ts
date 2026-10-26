import { describe, expect, it, vi } from "vitest";
import { createHandler } from "@/worker/handler";
import type { WorkerRequest, WorkerResponse } from "@/worker/protocol";
import { MemoryChatStore } from "@/store/chatStore";
import { MemorySemanticStore } from "@/semantic/store";
import { NO_FILTERS } from "@/model";
import { fakeModel } from "../support/fakeEmbedder";
import { android, lines } from "../support/export";

const CHAT = lines(
  android("13/01/24", "09:00", "Ayşe", "yarın kahveye gidelim mi?"),
  android("13/01/24", "09:02", "Can", "olur saat 19:30 uygun"),
  android("14/01/24", "18:00", "Ayşe", "keşke şu an yanımda olsaydın"),
  android("14/01/24", "18:03", "Can", "ben de seni çok özledim"),
  android("20/03/24", "09:00", "Ayşe", "coffee tomorrow"),
);

async function open() {
  const states: string[] = [];
  const model = fakeModel();
  const handle = createHandler({
    store: new MemoryChatStore(), semanticStore: new MemorySemanticStore(), embedder: model.factory,
    notify: (r) => { if (r.type === "semanticStatus") states.push(r.state.status); },
  });
  let id = 0;
  const request = async (body: Omit<WorkerRequest, "id"> | Record<string, unknown>) => {
    const out: WorkerResponse[] = [];
    await handle({ ...body, id: ++id } as WorkerRequest, (r) => out.push(r));
    return out.at(-1)!;
  };
  expect((await request({ type: "load", file: new File([CHAT], "synthetic.txt"), persist: true })).type).toBe("loaded");
  return { request, states, model };
}

describe("Ask worker API without a presentation layer", () => {
  it.each(["en", "tr"] as const)("answers both question languages and preserves dashboard/date/participant parity: %s", async (locale) => {
    const { request } = await open();
    const filters = { start: "2024-01-13", end: "2024-01-13", sender: 0 };
    const stats = await request({ type: "analyze", filters });
    expect(stats.type).toBe("stats");
    for (const question of ["How many messages?", "Toplam kaç mesaj gönderdik?"]) {
      const result = await request({ type: "ask", question, locale, filters });
      expect(result.type).toBe("answer");
      if (result.type === "answer" && stats.type === "stats") {
        expect(result.answer.plan.type).toBe("statistic");
        expect(result.answer.figure?.value).toBe(String(stats.stats.kpis.totalMessages));
        expect(result.answer.text).toContain("Ayşe");
      }
    }
    await request({ type: "clear" });
  });

  it("returns keyword evidence and surrounding source messages through the worker contracts", async () => {
    const { request } = await open();
    const result = await request({ type: "ask", question: "Search: kahve", locale: "en", filters: NO_FILTERS });
    expect(result.type).toBe("answer");
    if (result.type === "answer") {
      const evidence = result.answer.evidence[0]!;
      expect(evidence.message.text).toBe("yarın kahveye gidelim mi?");
      const context = await request({ type: "context", messageId: evidence.message.id, before: 0, after: 1 });
      expect(context).toMatchObject({ type: "messages", messages: [{ text: "yarın kahveye gidelim mi?" }, { text: "olur saat 19:30 uygun" }] });
    }
    await request({ type: "clear" });
  });

  it("indexes, retrieves by meaning, and clears the session without any UI controls", async () => {
    const { request, states, model } = await open();
    await request({ type: "semantic", action: "enable" });
    await vi.waitFor(() => expect(states).toContain("ready"));
    const result = await request({ type: "ask", question: "Onu özlediğimi söylediğim konuşmayı bul", locale: "tr", filters: NO_FILTERS });
    expect(model.loads).toBe(1);
    expect(result.type).toBe("answer");
    if (result.type === "answer") {
      expect(result.answer.basis).toBe("meaning");
      expect(result.answer.evidence.some((e) => /özledim|yanımda/.test(e.message.text))).toBe(true);
    }
    await request({ type: "clear" });
    expect(await request({ type: "ask", question: "How many messages?", filters: NO_FILTERS })).toMatchObject({ type: "error", code: "no_chat_loaded" });
  });
});
