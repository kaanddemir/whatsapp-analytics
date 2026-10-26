/* Cancelling one question (worker/handler.ts): a queued request never runs, a
   question waiting on the model stops waiting so later requests are not held
   up, a late result is never delivered, and the chat, its indexes and search
   by meaning all survive. The model is the tests' fake, held at will. */
import { describe, expect, it } from "vitest";
import { createHandler } from "@/worker/handler";
import type { WorkerRequest, WorkerResponse } from "@/worker/protocol";
import { MemoryChatStore } from "@/store/chatStore";
import { NO_FILTERS } from "@/model";
import { fakeModel } from "../support/fakeEmbedder";
import { ASK_CHAT } from "../fixtures/askChat";

async function setup() {
  const model = fakeModel();
  const handle = createHandler({
    read: async () => ({ fileName: "chat.txt", byteLength: ASK_CHAT.length, encoding: "utf-8", hadBom: false, hadReplacementChars: false, text: ASK_CHAT }),
    store: new MemoryChatStore(), embedder: model.factory, semanticStore: null,
  });
  const out: WorkerResponse[] = [];
  let id = 0;
  const send = (body: Record<string, unknown>) => {
    const request = { ...body, id: ++id } as WorkerRequest;
    return { id: request.id, done: handle(request, (r) => { if (r.type !== "progress") out.push(r); }) };
  };
  await send({ type: "load", file: new File(["x"], "chat.txt") }).done;
  await send({ type: "semantic", action: "enable" }).done;
  // Index the chat with the model free, then hold every further embedding (a question's query).
  for (let i = 0; i < 200; i++) {
    const r = send({ type: "semantic", action: "status" });
    await r.done;
    const last = out.at(-1)!;
    if (last.type === "semanticStatus" && last.state.status === "ready") break;
    await new Promise((res) => setTimeout(res, 5));
  }
  let release!: () => void;
  model.gate = new Promise<void>((r) => (release = r));
  const reply = (target: number) => out.filter((r) => r.id === target);
  const ask = (question: string) => send({ type: "ask", question, filters: NO_FILTERS, locale: "en" });
  const cancel = (target: number) => send({ type: "cancel", target });
  return { model, out, send, ask, cancel, reply, release: () => release() };
}

describe("cancelling a question", () => {
  it("stops waiting on the model, so the next question is answered at once and the late result is dropped", async () => {
    const w = await setup();
    const slow = w.ask("Where did we talk about moving?"); // a recall: waits for its query embedding
    await new Promise((r) => setTimeout(r, 10));
    expect(w.reply(slow.id)).toHaveLength(0);
    w.cancel(slow.id);
    await slow.done;
    expect(w.reply(slow.id)).toEqual([{ type: "error", id: slow.id, code: "cancelled", message: "Cancelled." }]);
    // The model is still held, yet a counting question is answered: the queue moved on.
    const quick = w.ask("How many messages?");
    await quick.done;
    expect(w.reply(quick.id)[0]!.type).toBe("answer");
    // Releasing the model finishes the abandoned embedding; nothing more arrives for it.
    w.release();
    await new Promise((r) => setTimeout(r, 20));
    expect(w.reply(slow.id)).toHaveLength(1);
    // Search by meaning still works on the same, still indexed chat.
    const again = w.ask("Where did we talk about moving?");
    await again.done;
    const answer = w.reply(again.id)[0]!;
    if (answer.type !== "answer") throw new Error("expected an answer");
    expect(answer.answer.basis).toBe("meaning");
    expect(answer.answer.evidence.map((e) => e.message.text)).toContain("yeni eve geçsek mi diye düşünüyorum");
  });

  it("never runs a queued question that was cancelled, and leaves the others alone", async () => {
    const w = await setup();
    const first = w.ask("Where did we talk about moving?");
    const queued = w.ask("How many messages?");
    const after = w.ask("Who sends more messages?");
    w.cancel(queued.id);
    w.release();
    await Promise.all([first.done, queued.done, after.done]);
    expect(w.reply(first.id)[0]!.type).toBe("answer");
    expect(w.reply(queued.id)).toEqual([{ type: "error", id: queued.id, code: "cancelled", message: "Cancelled." }]);
    expect(w.reply(after.id)[0]!.type).toBe("answer");
  });

  it("ignores repeated, late and unknown cancels", async () => {
    const w = await setup();
    w.release();
    const done = w.ask("How many messages?");
    await done.done;
    w.cancel(done.id);
    w.cancel(done.id);
    w.cancel(9999);
    // The id of a finished request is not remembered as cancelled: nothing is replied to the cancels,
    // and the chat still answers.
    const next = w.ask("How many messages?");
    await next.done;
    expect(w.reply(done.id).map((r) => r.type)).toEqual(["answer"]);
    expect(w.reply(next.id)[0]!.type).toBe("answer");
    expect(w.out.filter((r) => r.type === "error")).toHaveLength(0);
  });

  it("rejects a malformed cancel", async () => {
    const w = await setup();
    w.release();
    await w.send({ type: "cancel", target: -1 }).done;
    expect(w.out.at(-1)).toMatchObject({ type: "error", code: "internal" });
  });
});
