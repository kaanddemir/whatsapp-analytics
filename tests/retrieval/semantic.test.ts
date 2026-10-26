/* The semantic tier with a deterministic stand-in model: what is indexed,
   vectors and storage, fusion, the indexing lifecycle (resume, invalidation,
   failures, budget), verified model files, routing and recall answers.
   Real-model behaviour is tested in semanticModel.test.ts. */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseExport } from "@/parser";
import { NO_FILTERS, type Message } from "@/model";
import { ChatSession } from "@/conversation/session";
import { answer, replyTo, type SemanticInput } from "@/ask/answer";
import { route, isRecall, relativePeriod } from "@/ask/router";
import { foldAligned } from "@/text/fold";
import { fingerprint, indexableIds, isIndexable, passage, query } from "@/semantic/units";
import { E5_SMALL, indexKey, modelBytes, modelKey, type ModelSpec } from "@/semantic/model";
import { SEGMENT_SIZE, VectorIndex, decodeSegment, encodeSegment, quantize } from "@/semantic/vectors";
import { Sha256 } from "@/semantic/sha256";
import { contentTerms, coverage, lexicalCandidates, rank, type Meaning } from "@/semantic/hybrid";
import { meaningText } from "@/semantic/query";
import { SemanticIndexer, WINDOW, type SemanticState } from "@/semantic/indexer";
import { MemorySemanticStore, INDEX_SCHEMA } from "@/semantic/store";
import { ensureModelFiles } from "@/semantic/modelFiles";
import { ModelError } from "@/semantic/embedder";
import { buildKeywordIndex } from "@/search/keywordIndex";
import { fakeModel, fakeVector } from "../support/fakeEmbedder";
import { FakeFs } from "../support/fakeOpfs";
import { android, lines } from "../support/export";

const NOW = Date.UTC(2026, 9, 26);
const msg = (text: string, kind: Message["kind"] = "text") => ({ ts: 0, sender: 0, kind, text }) as Message;

describe("retrieval units", () => {
  it("indexes every meaningful message, however short, and skips fillers, media and symbols", () => {
    for (const t of ["özledim", "taşınıyoruz", "seni çok özledim ya", "ok ama yarın değil", "12:30"]) expect(isIndexable(msg(t)), t).toBe(true);
    for (const t of ["tamam", "ok", "haha", "hahahaha", "evet evet", "😂😂", "...", "Tmm"]) expect(isIndexable(msg(t)), t).toBe(false);
    expect(isIndexable(msg("<Media omitted>", "media"))).toBe(false);
    expect(isIndexable(msg("This message was deleted", "deleted"))).toBe(false);
  });
  it("adds the model's passage and query prefixes and bounds the text", () => {
    expect(passage(E5_SMALL, "  merhaba\n dünya ")).toBe("passage: merhaba dünya");
    expect(query(E5_SMALL, "ne zaman?")).toBe("query: ne zaman?");
    expect(passage(E5_SMALL, "x".repeat(5000)).length).toBe("passage: ".length + E5_SMALL.maxChars);
  });
  it("fingerprints the exact message sequence", () => {
    const a = parseExport(lines(android("13/01/24", "09:00", "Ayşe", "merhaba"), android("13/01/24", "09:01", "Can", "selam")));
    const b = parseExport(lines(android("13/01/24", "09:00", "Ayşe", "merhaba"), android("13/01/24", "09:01", "Can", "selam!")));
    expect(fingerprint(a)).toBe(fingerprint(parseExport(lines(android("13/01/24", "09:00", "Ayşe", "merhaba"), android("13/01/24", "09:01", "Can", "selam")))));
    expect(fingerprint(a)).not.toBe(fingerprint(b));
  });
  it("pins the model to a revision and verifiable files", () => {
    expect(E5_SMALL.revision).toMatch(/^[0-9a-f]{40}$/);
    expect(E5_SMALL.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256) && f.bytes > 0)).toBe(true);
    expect(Math.round(modelBytes(E5_SMALL) / 1e6)).toBe(135);
    // Model files and existing stored indexes keep their key; another text preparation gets another index key.
    expect(modelKey(E5_SMALL)).toBe("Xenova--multilingual-e5-small@761b726dd34f-int8-c1000");
    expect(indexKey(E5_SMALL)).toBe(modelKey(E5_SMALL));
    expect(indexKey({ ...E5_SMALL, passagePrefix: "query: " })).toBe("Xenova--multilingual-e5-small@761b726dd34f-int8-c1000-pquery");
  });
});

describe("question text for the model", () => {
  it.each([
    ["akşam gelemeyeceğini söylediği mesaj", "akşam gelemeyeceğini"],
    ["Onu özlediğimi söylediğim konuşmayı bul", "Onu özlediğimi"],
    ["terfi teklifini anlattığımda ne cevap vermişti?", "terfi teklifini"],
    ["ece ve mert'in düğünü ne zaman", "ece ve mert'in düğünü"],
    ["when she said she was starting a diet", "she was starting a diet"],
    ["Find the conversation where I said I missed her", "I missed her"],
    ["what time does dad's flight arrive", "dad's flight arrive"],
    ["the day her grandmother died", "her grandmother died"],
  ])("drops request framing: %s", (q, want) => expect(meaningText(q)).toBe(want));
  it.each(["kira artışı", "Zeynep'in düğünü", "who has our spare key", "yedek anahtar kimdeydi"])("keeps a question without framing: %s", (q) => expect(meaningText(q)).toBe(q));
  it("never returns nothing", () => {
    for (const q of ["mesajı bul", "find the messages", "bul", "when did", "the time when"]) expect(meaningText(q).length, q).toBeGreaterThan(0);
  });
});

describe("vectors", () => {
  const unit = (seed: number) => { const v = new Float32Array(E5_SMALL.dim); let s = seed; for (let i = 0; i < v.length; i++) { s = (s * 1103515245 + 12345) >>> 0; v[i] = (s / 2 ** 32) - 0.5; } const n = Math.hypot(...v); return v.map((x) => x / n); };
  it("scores one message's vector by id, across segments, and knows which messages have none", () => {
    const index = new VectorIndex(E5_SMALL.dim);
    const ids = Array.from({ length: SEGMENT_SIZE + 5 }, (_, i) => i * 2);
    const vectors = new Float32Array(ids.length * E5_SMALL.dim);
    ids.forEach((_, i) => vectors.set(unit(i + 1), i * E5_SMALL.dim));
    index.add(ids, vectors);
    const q = unit(3);
    expect(index.score(q, 4)).toBeCloseTo(1, 2);
    expect(index.score(q, ids.at(-1)!)).toBeCloseTo(index.search(q, ids.length).find((h) => h.id === ids.at(-1))!.score, 6);
    expect(index.score(q, 5)).toBeNull();
    expect(index.score(q, -1)).toBeNull();
  });
  it("quantizes to int8 with little loss", () => {
    const v = unit(7), codes = new Int8Array(v.length);
    const scale = quantize(v, 0, v.length, codes, 0);
    let dot = 0;
    for (let i = 0; i < v.length; i++) dot += v[i]! * codes[i]! * scale;
    expect(dot).toBeGreaterThan(0.999);
  });
  it("returns the k nearest that pass the filter, best first, across segments", () => {
    const index = new VectorIndex(E5_SMALL.dim);
    const n = SEGMENT_SIZE + 10, ids = Array.from({ length: n }, (_, i) => i), all = new Float32Array(n * E5_SMALL.dim);
    ids.forEach((i) => all.set(unit(i + 1), i * E5_SMALL.dim));
    const sealed = index.add(ids, all);
    expect(sealed).toHaveLength(1);
    expect(index.size).toBe(n);
    const hits = index.search(unit(SEGMENT_SIZE + 5 + 1), 5);
    expect(hits[0]!.id).toBe(SEGMENT_SIZE + 5);
    expect(hits.map((h) => h.score)).toEqual([...hits.map((h) => h.score)].sort((a, b) => b - a));
    expect(index.search(unit(4), 3, (id) => id % 2 === 0).every((h) => h.id % 2 === 0)).toBe(true);
  });
  it("round-trips segments and rejects damaged ones", () => {
    const index = new VectorIndex(E5_SMALL.dim);
    index.add([3, 9], new Float32Array([...unit(1), ...unit(2)]));
    const seg = index.tail()!;
    const back = decodeSegment(encodeSegment(seg, E5_SMALL.dim), E5_SMALL.dim)!;
    expect([...back.ids]).toEqual([3, 9]);
    expect([...back.codes]).toEqual([...seg.codes]);
    expect(decodeSegment(encodeSegment(seg, E5_SMALL.dim).slice(0, 40), E5_SMALL.dim)).toBeNull();
    expect(decodeSegment(encodeSegment(seg, E5_SMALL.dim), 768)).toBeNull();
  });
});

describe("streaming SHA-256", () => {
  it("matches the reference digest for any chunking", () => {
    const data = new TextEncoder().encode("abc".repeat(1000) + "ğüşiöç");
    const expected = createHash("sha256").update(data).digest("hex");
    for (const size of [1, 63, 64, 65, 1000, data.length]) {
      const h = new Sha256();
      for (let i = 0; i < data.length; i += size) h.update(data.subarray(i, i + size));
      expect(h.hex(), String(size)).toBe(expected);
    }
    expect(new Sha256().hex()).toBe(createHash("sha256").digest("hex"));
  });
});

describe("hybrid ranking", () => {
  const ALL = { from: -Infinity, to: Infinity, sender: null };
  const meaning = (scores: Record<number, number>, extra: Partial<Meaning> = {}): Meaning => ({
    hits: Object.entries(scores).map(([id, score]) => ({ id: Number(id), score })).sort((a, b) => b.score - a.score),
    similarity: (id) => scores[id] ?? null, lexicalWeight: 0.05, minSimilarity: 0.77, ...extra,
  });
  it("measures the share of the question's word weight a message contains", () => {
    const messages = [msg("zeynep'in düğünü haziranda"), msg("zeynep aradı"), msg("düğün fotoğrafçısı"), msg("bugün hava güzel"), msg("hava çok sıcak")];
    const c = coverage(buildKeywordIndex(messages), ["zeynep", "dugun"]);
    // Both words, one only as a prefix ("düğünü"): 1 + 0.7 of two equally rare words.
    expect(c.get(0)).toBeCloseTo(0.85);
    expect(c.get(1)).toBeCloseTo(0.5);
    expect(c.get(2)).toBeCloseTo(0.5);
    expect(c.has(3)).toBe(false);
  });
  it("keeps a paraphrase found by meaning above chatter that shares one common word", () => {
    // The question "when is the cat's vet appointment": the gold says "checkup at the animal clinic".
    const messages = [msg("mia's checkup at the animal clinic is thursday"), msg("dentist appointment tuesday"), msg("hello")];
    const index = buildKeywordIndex(messages);
    // Rank fusion put the chatter first (it is in both lists); here a clear lead in meaning keeps the paraphrase first.
    const ranked = rank(index, messages, ["cat", "vet", "appointment"], ALL, meaning({ 0: 0.87, 1: 0.85, 2: 0.8 }));
    expect(ranked[0]!.id).toBe(0);
    expect(ranked.find((r) => r.id === 1)).toMatchObject({ similarity: 0.85 });
  });
  it("lifts a message carrying the question's rare words above a slightly closer one without them", () => {
    const messages = [msg("ece ve mert'in düğünü 7 eylülde şilede"), msg("düğünler çok yorucu oluyor"), msg("nasılsın")];
    const index = buildKeywordIndex(messages);
    const ranked = rank(index, messages, ["ece", "mert", "dugunu"], ALL, meaning({ 0: 0.84, 1: 0.86 }));
    expect(ranked.map((r) => r.id).slice(0, 2)).toEqual([0, 1]);
  });
  it("scores word matches outside the nearest list by their own similarity, and drops unrelated nearest messages", () => {
    const messages = [msg("taşınma işleri"), msg("kahve"), msg("çay")];
    const index = buildKeywordIndex(messages);
    const ranked = rank(index, messages, ["tasinma"], ALL, meaning({ 1: 0.9, 2: 0.5 }, { similarity: (id) => ({ 0: 0.8, 1: 0.9, 2: 0.5 })[id] ?? null }));
    expect(ranked.map((r) => r.id)).toEqual([1, 0]);
    expect(ranked[1]).toMatchObject({ similarity: 0.8, coverage: 1 });
  });
  it("keeps the word ranking when there is no meaning, and applies the filter to both lists", () => {
    const messages = [msg("taşınmayı düşünüyorum"), msg("kahve içelim"), { ...msg("taşınma işleri"), sender: 1 }];
    const index = buildKeywordIndex(messages);
    expect(rank(index, messages, ["tasinma"], ALL, null).map((r) => r.id)).toEqual(lexicalCandidates(index, messages, ["tasinma"], ALL));
    const only0 = rank(index, messages, ["tasinma"], { ...ALL, sender: 0 }, meaning({ 0: 0.9, 1: 0.95, 2: 0.99 }));
    expect(only0.every((r) => messages[r.id]!.sender === 0)).toBe(true);
  });
  it("ranks messages containing any content word, within the filter", () => {
    const messages = [msg("taşınmayı düşünüyorum"), msg("kahve içelim"), { ...msg("taşınma işleri"), sender: 1 }, msg("merhaba")];
    const index = buildKeywordIndex(messages);
    expect(contentTerms("Taşınma fikrini konuştuğumuz mesajları bul")).toEqual(["tasinma", "fikrini"]);
    expect(lexicalCandidates(index, messages, ["tasinma", "fikrini"], { from: -Infinity, to: Infinity, sender: null })).toEqual([2, 0]);
    expect(lexicalCandidates(index, messages, ["tasinma"], { from: -Infinity, to: Infinity, sender: 0 })).toEqual([0]);
  });
});

const CHAT = lines(...Array.from({ length: 40 }, (_, i) => [
  android(`${String(1 + (i % 28)).padStart(2, "0")}/0${1 + (i % 9)}/25`, "09:00", "Ayşe", i === 7 ? "keşke şu an yanımda olsaydın" : `bugün hava ${i}`),
  android(`${String(1 + (i % 28)).padStart(2, "0")}/0${1 + (i % 9)}/25`, "09:05", "Can", i === 7 ? "ben de seni çok özledim" : "tamam"),
]).flat(), android("01/02/24", "10:00", "Ayşe", "bu evden taşınmayı düşünüyorum"), android("01/02/24", "10:02", "Can", "bence de yeni bir eve geçelim"));
const parsed = () => parseExport(CHAT);

async function built(store: MemorySemanticStore | null = null, chatId: string | null = null, model = fakeModel(), states: SemanticState[] = []) {
  const p = parsed();
  const ix = new SemanticIndexer(p, { factory: model.factory, store, chatId, onState: (s) => states.push(s), budgetBytes: Infinity });
  await ix.restore();
  await ix.start();
  return { ix, p, model, states };
}

describe("semantic indexing", () => {
  it("embeds every indexable message once, in order, and reports real progress", async () => {
    const { ix, p, model, states } = await built();
    expect(ix.total).toBe(indexableIds(p).length);
    expect(ix.done).toBe(ix.total);
    expect(model.calls.length).toBe(ix.total);
    expect(model.calls.every((t) => t.startsWith("passage: "))).toBe(true);
    expect(model.calls).not.toContain("passage: tamam");
    expect(states.at(-1)).toMatchObject({ status: "ready", done: ix.total, total: ix.total, device: "wasm" });
    expect(states.some((s) => s.status === "preparing")).toBe(true);
  });
  it("embeds a repeated text once, shortest texts first, and still gives every message its own entry in order", async () => {
    const texts = ["geliyorum", "akşam ne yiyoruz bu arada çok acıktım", "geliyorum", "yarın görüşürüz", "geliyorum"];
    const p = parseExport(lines(...texts.map((t, i) => android("13/01/25", `09:0${i}`, i % 2 ? "Can" : "Ayşe", t))));
    const model = fakeModel();
    const ix = new SemanticIndexer(p, { factory: model.factory, store: null, chatId: null, budgetBytes: Infinity });
    await ix.start();
    expect(model.calls).toEqual(["passage: geliyorum", "passage: yarın görüşürüz", "passage: akşam ne yiyoruz bu arada çok acıktım"]);
    expect(ix.done).toBe(texts.length);
    const ids = ix.search(fakeVector("passage: geliyorum"), 10, () => true).map((h) => h.id).sort((a, b) => a - b);
    expect(ids).toEqual([0, 1, 2, 3, 4]);
    expect(ix.index.score(fakeVector("passage: geliyorum"), 4)).toBeCloseTo(1, 5);
    expect(ix.index.sealed.length + (ix.index.tail() ? 1 : 0)).toBeGreaterThan(0);
    expect([...ix.index.tail()!.ids]).toEqual([0, 1, 2, 3, 4]);
    expect(WINDOW).toBeGreaterThan(16);
  });
  it("persists a saved chat's vectors and reopens them without embedding again", async () => {
    const store = new MemorySemanticStore();
    const first = await built(store, "chat-1");
    expect((await store.manifest("chat-1"))).toMatchObject({ schema: INDEX_SCHEMA, complete: true, vectors: first.ix.total, model: indexKey(E5_SMALL) });
    const again = fakeModel();
    const second = await built(store, "chat-1", again);
    expect(again.calls).toHaveLength(0);
    expect(second.ix.done).toBe(first.ix.total);
    expect(second.ix.state.status).toBe("ready");
    const q = fakeVector("query: özledim");
    expect(second.ix.search(q, 3, () => true).map((h) => h.id)).toEqual(first.ix.search(q, 3, () => true).map((h) => h.id));
  });
  it("stores nothing for a chat that is not kept on the device", async () => {
    const store = new MemorySemanticStore();
    await built(store, null);
    expect(store.data.size).toBe(0);
  });
  it("pauses on cancel and resumes where it stopped", async () => {
    const big = lines(...Array.from({ length: SEGMENT_SIZE + 300 }, (_, i) => android("13/01/25", "09:00", i % 2 ? "Can" : "Ayşe", `mesaj numarası ${i} hakkında bir şey`)));
    const p = parseExport(big), store = new MemorySemanticStore(), model = fakeModel();
    const ix = new SemanticIndexer(p, { factory: model.factory, store, chatId: "c", budgetBytes: Infinity });
    const run = ix.start();
    await new Promise((r) => setTimeout(r, 0));
    while (ix.done < SEGMENT_SIZE + 16) await new Promise((r) => setTimeout(r, 0));
    ix.cancel();
    await run;
    expect(ix.state.status).toBe("paused");
    const stored = (await store.manifest("c"))!;
    expect(stored).toMatchObject({ complete: false, segments: 1, vectors: SEGMENT_SIZE });
    // A new visit restores the committed segment and embeds only the rest.
    const model2 = fakeModel();
    const ix2 = new SemanticIndexer(p, { factory: model2.factory, store, chatId: "c", budgetBytes: Infinity });
    expect(await ix2.restore()).toBe(true);
    expect(ix2.state).toMatchObject({ status: "paused", done: SEGMENT_SIZE });
    await ix2.start();
    expect(ix2.done).toBe(ix2.total);
    expect(model2.calls).toHaveLength(ix2.total - SEGMENT_SIZE);
  });
  it("never reuses vectors made for other messages or another model", async () => {
    const store = new MemorySemanticStore();
    await built(store, "c");
    const m = (await store.manifest("c"))!;
    store.data.get("c")!.manifest = { ...m, fingerprint: "other" };
    const model = fakeModel();
    const { ix } = await built(store, "c", model);
    expect(model.calls).toHaveLength(ix.total);
    store.data.get("c")!.manifest = { ...(await store.manifest("c"))!, model: "another-model" };
    const model3 = fakeModel();
    await built(store, "c", model3);
    expect(model3.calls).toHaveLength(ix.total);
  });
  it("rebuilds an index whose segments are damaged", async () => {
    const store = new MemorySemanticStore();
    const { ix } = await built(store, "c");
    store.data.get("c")!.segments.set(0, new Uint8Array(10));
    const model = fakeModel();
    await built(store, "c", model);
    expect(model.calls).toHaveLength(ix.total);
  });
  it("keeps indexing in memory when the device storage is full", async () => {
    const store = new MemorySemanticStore(0);
    const { ix } = await built(store, "c");
    expect(ix.state.status).toBe("ready");
    expect(ix.persistFailed).toBe(true);
    expect(store.data.size).toBe(0);
  });
  it("reports a model that cannot load or fails, without losing finished windows", async () => {
    const missing = await built(null, null, fakeModel({ failLoad: "model_missing" }));
    expect(missing.ix.state).toMatchObject({ status: "failed", reason: "model_missing", done: 0 });
    const model = fakeModel();
    model.failAt = WINDOW + 20;
    const p = parseExport(lines(...Array.from({ length: 2 * WINDOW + 10 }, (_, i) => android("13/01/25", "09:00", i % 2 ? "Can" : "Ayşe", `mesaj ${i} hakkında`))));
    const failing = { ix: new SemanticIndexer(p, { factory: model.factory, store: null, chatId: null, budgetBytes: Infinity }) };
    await failing.ix.start();
    expect(failing.ix.state).toMatchObject({ status: "failed", reason: "failed" });
    expect(failing.ix.done).toBe(WINDOW);
    // Retrying resumes.
    model.failAt = null;
    await failing.ix.start();
    expect(failing.ix.state.status).toBe("ready");
  });
  it("does not start when the vectors would not fit this device's budget", async () => {
    const p = parsed(), model = fakeModel();
    const ix = new SemanticIndexer(p, { factory: model.factory, store: null, chatId: null, budgetBytes: 1000 });
    await ix.start();
    expect(ix.state).toMatchObject({ status: "failed", reason: "too_large" });
    expect(model.loads).toBe(0);
  });
});

describe("verified model files", () => {
  const SPEC: ModelSpec = {
    ...E5_SMALL, repo: "test/model",
    files: [{ path: "config.json", bytes: 7, sha256: createHash("sha256").update("{\"a\":1}").digest("hex") }, { path: "onnx/model.onnx", bytes: 5, sha256: createHash("sha256").update("WEIGH").digest("hex") }],
  };
  const served = (overrides: Record<string, string | number> = {}) => {
    const urls: string[] = [];
    const impl = (async (url: string) => {
      urls.push(url);
      const path = url.replace("/app/models/test/model/", "");
      const o = overrides[path];
      if (typeof o === "number") return new Response(null, { status: o });
      const body = o ?? (path === "config.json" ? "{\"a\":1}" : "WEIGH");
      return new Response(new Blob([body]).stream());
    }) as unknown as typeof fetch;
    return { impl, urls };
  };
  it("downloads from the app's own origin, verifies, stores, and then reuses without fetching", async () => {
    const fs = new FakeFs(), { impl, urls } = served(), progress: number[] = [];
    const read = await ensureModelFiles(SPEC, "/app/", await fs.handle(), (p) => progress.push(p.loaded), impl);
    expect(urls).toEqual(["/app/models/test/model/config.json", "/app/models/test/model/onnx/model.onnx"]);
    expect(await (await read("onnx/model.onnx")).text()).toBe("WEIGH");
    expect(progress.at(-1)).toBe(12);
    const second = served();
    await ensureModelFiles(SPEC, "/app/", await fs.handle(), undefined, second.impl);
    expect(second.urls).toHaveLength(0);
  });
  it("rehashes same-size cached files instead of trusting the checksum sidecar", async () => {
    const fs = new FakeFs();
    await ensureModelFiles(SPEC, "/app/", await fs.handle(), undefined, served().impl);
    const top = await fs.root.getDirectoryHandle("semantic-models");
    const cache = await top.getDirectoryHandle(modelKey(SPEC));
    const onnx = await cache.getDirectoryHandle("onnx");
    const writable = await (await onnx.getFileHandle("model.onnx")).createWritable();
    await writable.write(new TextEncoder().encode("EVIL!")); await writable.close();
    const next = served();
    const read = await ensureModelFiles(SPEC, "/app/", await fs.handle(), undefined, next.impl);
    expect(next.urls).toEqual(["/app/models/test/model/onnx/model.onnx"]);
    expect(await (await read("onnx/model.onnx")).text()).toBe("WEIGH");
  });

  it("cancels an oversized model stream before writing unbounded bytes", async () => {
    let cancelled = false, pulls = 0;
    const impl = (async () => new Response(new ReadableStream({
      pull(controller) { pulls++; controller.enqueue(new Uint8Array(1024)); },
      cancel() { cancelled = true; },
    }))) as typeof fetch;
    await expect(ensureModelFiles(SPEC, "/app/", await new FakeFs().handle(), undefined, impl)).rejects.toMatchObject({ code: "integrity" });
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThan(10);
  });

  it("deletes and refuses a file that fails its integrity check", async () => {
    const fs = new FakeFs();
    await expect(ensureModelFiles(SPEC, "/app/", await fs.handle(), undefined, served({ "onnx/model.onnx": "EVIL!" }).impl)).rejects.toMatchObject({ code: "integrity" });
    const dir = await (await (await (await fs.handle()).getDirectoryHandle("semantic-models")).getDirectoryHandle(modelKey(SPEC))).getDirectoryHandle("onnx");
    await expect(dir.getFileHandle("model.onnx")).rejects.toBeTruthy();
  });
  it("reports missing files and a full disk distinctly", async () => {
    await expect(ensureModelFiles(SPEC, "/app/", await new FakeFs().handle(), undefined, served({ "config.json": 404 }).impl)).rejects.toMatchObject({ code: "model_missing" });
    await expect(ensureModelFiles(SPEC, "/app/", await new FakeFs(3).handle(), undefined, served().impl)).rejects.toMatchObject({ code: "storage_full" });
    expect(new ModelError("integrity", "x")).toBeInstanceOf(Error);
  });
});

describe("recall routing", () => {
  const people = parsed().participants;
  it.each([
    "Geçen yıl ona özlediğimi söylediğim konuşmayı bul.",
    "Ben ona gitmek istemediğimi söylediğimde ne cevap vermişti?",
    "Geçen yaz hangi konuşmamızda taşınmaktan bahsettik?",
    "Beraber bir yerlere gidelim dediğimiz zamanlar",
    "Taşınma fikrini konuştuğumuz mesajlar",
    "Find the conversation where I said I missed her",
    "What did she reply when I said I was tired?",
    "When did we talk about moving?",
  ])("routes to recall: %s", (q) => expect(route(q, people, NOW).type).toBe("recall"));
  it.each([
    ["Toplam kaç mesaj gönderdik?", "statistic"], ["Kim daha çok mesaj gönderdi?", "statistic"], ["Kim daha çok buluşma öneriyor?", "behaviour"],
    ["En çok hangi gün konuşmuşuz?", "statistic"], ["2024 yılında kaç mesaj gönderdik?", "statistic"], ["Tatil hakkındaki mesajları bul", "fact"],
    ["Ara: taşınma", "fact"], ["Paris'ten ilk ne zaman bahsettik?", "temporal"], ["When did we first talk about Paris?", "temporal"],
    ["Planlarımızı göster", "timeline"], ["12 Nisan geçen mesajlar", "temporal"], ["Neden tartışıyoruz?", "recall"], ["Beni seviyor mu?", "unsupported"],
  ])("keeps the exact path: %s", (q, type) => expect(route(q, people, NOW).type).toBe(type));
  it("resolves relative periods against today and marks reply questions", () => {
    expect(relativePeriod(foldAligned("geçen yıl"), NOW)).toMatchObject({ start: "2025-01-01", end: "2025-12-31" });
    expect(relativePeriod(foldAligned("geçen yaz"), NOW)).toMatchObject({ start: "2026-06-01", end: "2026-08-31" });
    expect(relativePeriod(foldAligned("geçen yaz"), Date.UTC(2026, 3, 1))).toMatchObject({ start: "2025-06-01", end: "2025-08-31" });
    expect(relativePeriod(foldAligned("geçen ay"), Date.UTC(2026, 0, 10))).toMatchObject({ start: "2025-12-01", end: "2025-12-31" });
    expect(route("Ben ona gitmek istemediğimi söylediğimde ne cevap vermişti?", people, NOW)).toMatchObject({ reply: true, speakerWords: true });
    expect(isRecall(foldAligned("kahve hakkındaki mesajlar"))).toBe(false);
  });
});

describe("recall answers", () => {
  const session = new ChatSession(parsed());
  const withMeaning = async (scope = NO_FILTERS) => {
    const { ix } = await built();
    return (text: string): SemanticInput => {
      const q = fakeVector(query(E5_SMALL, text));
      return { search: (keep) => ix.search(q, 200, keep), coverage: ix.coverage, status: "ready" };
    };
    void scope;
  };
  it("finds a paraphrase by meaning that the words alone miss, and says what it is", async () => {
    const q = "Onu özlediğimi söylediğim konuşmayı bul";
    const words = answer(q, session, NO_FILTERS, undefined, "tr", null, NOW);
    expect(words).toMatchObject({ basis: "match", action: "enable_semantic" });
    expect(words.note).toContain("Yalnızca sorunuzdaki kelimelerle arandı");
    const sem = await withMeaning();
    const a = answer(q, session, NO_FILTERS, undefined, "tr", sem(q), NOW);
    expect(a.basis).toBe("meaning");
    expect(a.action).toBeNull();
    expect(a.text).toMatch(/ilgili olabilecek mesajlar buldum/);
    expect(a.evidence.slice(0, 2).map((e) => e.message.text)).toEqual(expect.arrayContaining(["keşke şu an yanımda olsaydın", "ben de seni çok özledim"]));
    // Every item is a real message, shown as written.
    for (const e of a.evidence) expect(session.parsed.messages[e.message.id]!.text).toBe(e.message.text);
    expect(a.note).toContain("“ben” ve “o”");
  });
  it("pairs a matched message with the reply that followed it, and only a plausible one", async () => {
    const q = "Ben ona taşınmayı düşündüğümü söylediğimde ne cevap vermişti?";
    const sem = await withMeaning();
    const a = answer(q, session, NO_FILTERS, undefined, "tr", sem(q), NOW);
    expect(a.result?.kind).toBe("recall");
    if (a.result?.kind !== "recall") return;
    const pair = a.result.pairs.find((p) => session.parsed.messages[p.match]!.text === "bu evden taşınmayı düşünüyorum")!;
    expect(session.parsed.messages[pair.reply!]!.text).toBe("bence de yeni bir eve geçelim");
    expect(a.note).toContain("Yanıt olarak");
    // A message whose next reply is hours later in another exchange gets none.
    const p = parseExport(lines(android("01/02/24", "10:00", "Ayşe", "geliyor musun"), android("01/02/24", "18:00", "Can", "başka konu")));
    expect(replyTo(p.messages, 0)).toBeNull();
  });
  it("applies the date and participant filters to both lexical and semantic candidates", async () => {
    const q = "taşınma fikrini konuştuğumuz mesajlar";
    const sem = await withMeaning();
    const inPeriod = answer(q, session, { start: "2025-01-01", end: "2025-12-31", sender: null }, undefined, "tr", sem(q), NOW);
    expect(inPeriod.evidence.every((e) => e.message.at.startsWith("2025"))).toBe(true);
    const ayse = session.parsed.participants.find((x) => x.name === "Ayşe")!.id;
    const kept: number[] = [];
    const spy: SemanticInput = { search: (keep) => { const hits = sem(q).search!(keep); kept.push(...hits.map((h) => h.id)); return hits; }, coverage: 1, status: "ready" };
    const byAyse = answer(q, session, { ...NO_FILTERS, sender: ayse }, undefined, "tr", spy, NOW);
    expect(byAyse.evidence.length).toBeGreaterThan(0);
    expect(byAyse.evidence.every((e) => e.message.sender === ayse)).toBe(true);
    expect(kept.every((id) => session.parsed.messages[id]!.sender === ayse)).toBe(true);
    expect(byAyse.note).toContain("Yalnızca Ayşe tarafından");
  });
  it("says it found nothing rather than offering unrelated messages", async () => {
    const q = "uzay gemisi tamircisi konuştuğumuz mesajlar";
    const weak: SemanticInput = { search: () => [{ id: 0, score: E5_SMALL.minSimilarity - 0.1 }], coverage: 1, status: "ready" };
    const a = answer(q, session, NO_FILTERS, undefined, "tr", weak, NOW);
    expect(a.evidence).toHaveLength(0);
    expect(a.text).toBe("Sohbetin tamamı kapsamında bununla ilgili bir konuşma bulamadım.");
  });
  it("shows repeated texts once, and warns when only meaning matched", () => {
    const p = parseExport(lines(...Array.from({ length: 6 }, (_, i) => android(`0${1 + i}/01/25`, "09:00", "Ayşe", "iptal edelim bence")), android("09/01/25", "09:00", "Can", "başka bir şey")));
    const s = new ChatSession(p);
    const all: SemanticInput = { search: () => p.messages.map((_, id) => ({ id, score: 0.9 })), coverage: 1, status: "ready" };
    const a = answer("Uzay gemisini konuştuğumuz mesajlar", s, NO_FILTERS, undefined, "tr", all, NOW);
    const texts = a.evidence.map((e) => e.message.text);
    expect(texts.filter((t) => t === "iptal edelim bence")).toHaveLength(1);
    expect(a.note).toContain("yalnızca anlam benzerliğine göre sıralandılar");
  });
  it("widens a topic search with no exact match to related meaning, and says so; an explicit search stays exact", async () => {
    const sem = await withMeaning();
    // English topic, Turkish chat: no exact match.
    const q = "Find messages about moving";
    const exactOnly = answer(q, session, NO_FILTERS, undefined, "en", null, NOW);
    expect(exactOnly).toMatchObject({ basis: "match", evidenceTotal: 0, result: { kind: "search" } });
    const widened = answer(q, session, NO_FILTERS, undefined, "en", sem(q), NOW);
    expect(widened).toMatchObject({ basis: "meaning", result: { kind: "recall" } });
    expect(widened.text).toBe("No message in the whole chat contains “moving” exactly; these look related by meaning. The most relevant come first.");
    expect(widened.evidence.map((e) => e.message.text)).toEqual(expect.arrayContaining(["bu evden taşınmayı düşünüyorum"]));
    const literal = answer("Search: moving", session, NO_FILTERS, undefined, "en", sem("moving"), NOW);
    expect(literal).toMatchObject({ basis: "match", evidenceTotal: 0, result: { kind: "search" } });
    // With exact matches the count stays the keyword search's.
    expect(answer("taşınma hakkındaki mesajları bul", session, NO_FILTERS, undefined, "tr", sem("taşınma"), NOW).result?.kind).toBe("search");
  });
  it("names a relative period by its real dates", () => {
    const a = answer("Geçen yaz hangi konuşmamızda taşınmaktan bahsettik?", session, NO_FILTERS, undefined, "tr", null, NOW);
    expect(a.scope).toBe("1 Haz 2026 – 31 Ağu 2026");
    expect(answer("Geçen yıl taşınmaktan bahsettiğimiz konuşmayı bul", session, NO_FILTERS, undefined, "tr", null, NOW).scope).toBe("2025");
  });
  it("states partial coverage while indexing is under way", () => {
    const q = "taşınma fikrini konuştuğumuz mesajlar";
    const a = answer(q, session, NO_FILTERS, undefined, "tr", { search: () => [], coverage: 0.42, status: "indexing" }, NOW);
    expect(a.note).toContain("%42");
  });
  it("tells a chat too large for this device apart from one that can be enabled", () => {
    const q = "taşınma fikrini konuştuğumuz mesajlar";
    const a = answer(q, session, NO_FILTERS, undefined, "tr", { search: null, coverage: 0, status: "failed", failure: "too_large" }, NOW);
    expect(a.action).toBeNull();
    expect(a.note).toContain("bu cihazda anlamsal arama kullanılamıyor");
  });
});
