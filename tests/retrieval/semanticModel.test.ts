/* Real-model integration: the pinned multilingual-e5-small, through the
   production embedder contract, indexer and answer code, on Node CPU.

   Opt-in, because it loads a 118 MB model:
     SEMANTIC_MODEL_TEST=1 npx vitest run tests/retrieval/semanticModel.test.ts
   It needs the verified model files locally (SEMANTIC_MODELS_DIR, default
   ~/.cache/wa-phase2/models); it is skipped otherwise, never downloads. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseExport } from "@/parser";
import { NO_FILTERS } from "@/model";
import { ChatSession } from "@/conversation/session";
import { answer, type SemanticInput } from "@/ask/answer";
import { meaningText } from "@/semantic/query";
import { E5_SMALL } from "@/semantic/model";
import { pipelineEmbedder, type Embedder, type FeatureExtractor } from "@/semantic/embedder";
import { SemanticIndexer } from "@/semantic/indexer";
import { query } from "@/semantic/units";
import { android, lines } from "../support/export";

const ROOT = process.env.SEMANTIC_MODELS_DIR ?? join(homedir(), ".cache", "wa-phase2", "models");
const present = E5_SMALL.files.every((f) => existsSync(join(ROOT, E5_SMALL.repo, f.path)));
const NOW = Date.UTC(2026, 9, 26);

const filler = ["günaydın", "eve geldim", "markete uğradım", "toplantı uzadı", "yarın erken kalkacağım", "hava çok soğuk", "film izleyelim mi bu akşam", "trafik çok kötü", "telefonun şarjı bitti", "kargo geldi mi"];
const CHAT = lines(
  ...Array.from({ length: 120 }, (_, i) => android(`${String(1 + (i % 28)).padStart(2, "0")}/${String(1 + (i % 12)).padStart(2, "0")}/25`, `${String(8 + (i % 12)).padStart(2, "0")}:00`, i % 2 ? "Can" : "Ayşe", filler[i % filler.length]!)),
  android("10/04/25", "21:00", "Ayşe", "keşke şu an yanımda olsaydın"),
  android("10/04/25", "21:03", "Can", "ben de seni çok özledim"),
  android("15/05/25", "18:00", "Ayşe", "ben o partiye gitmek istemiyorum açıkçası"),
  android("15/05/25", "18:02", "Can", "tamam zorlamayacağım, evde kalırız"),
  android("20/05/25", "12:00", "Can", "partiye gitmek istiyorum çok heyecanlıyım"),
  android("03/06/24", "09:00", "Ayşe", "yeni bir eve geçsek nasıl olur?"),
  android("03/06/24", "09:10", "Can", "bence iyi fikir, kira da çok arttı"),
);

describe.skipIf(!process.env.SEMANTIC_MODEL_TEST || !present)("real model: multilingual-e5-small", () => {
  let embedder: Embedder;
  let session: ChatSession;
  let indexer: SemanticIndexer;
  // As the worker does (handler.ts): the question without its framing, similarity for word matches, the model's parameters.
  const input = (_q: string, vector: Float32Array): SemanticInput => ({
    search: (keep) => indexer.search(vector, 200, keep), similarity: (id) => indexer.index.score(vector, id),
    lexicalWeight: E5_SMALL.lexicalWeight, minSimilarity: E5_SMALL.minSimilarity, coverage: indexer.coverage, status: "ready",
  });
  const vector = (q: string) => indexer.queryVector(meaningText(q));

  beforeAll(async () => {
    // The files used are the pinned ones.
    for (const f of E5_SMALL.files) expect(createHash("sha256").update(readFileSync(join(ROOT, E5_SMALL.repo, f.path))).digest("hex"), f.path).toBe(f.sha256);
    const { pipeline, env } = await import("@huggingface/transformers");
    env.allowRemoteModels = false;
    env.useFSCache = false; // read the model in place; never copy it into a cache folder
    env.localModelPath = ROOT + "/";
    const fe = await pipeline("feature-extraction", E5_SMALL.repo, { dtype: E5_SMALL.dtype, device: "cpu", session_options: { intraOpNumThreads: 1 } as never });
    embedder = pipelineEmbedder(fe as unknown as FeatureExtractor, E5_SMALL, "cpu");
    const parsed = parseExport(CHAT);
    session = new ChatSession(parsed);
    indexer = new SemanticIndexer(parsed, { factory: async () => embedder, store: null, chatId: null, budgetBytes: Infinity });
    await indexer.start();
  }, 120_000);
  afterAll(async () => { await indexer?.dispose(); });

  it("produces normalised, deterministic vectors of the pinned dimension", async () => {
    const a = await embedder.embed(["query: merhaba", "passage: merhaba"]);
    expect(a.length).toBe(2 * E5_SMALL.dim);
    let n = 0;
    for (let i = 0; i < E5_SMALL.dim; i++) n += a[i]! * a[i]!;
    expect(Math.abs(n - 1)).toBeLessThan(1e-3);
    // Identical input gives identical output; another batch shifts it slightly (int8 activations are
    // quantized per batch), never enough to change what is similar.
    const alone = await embedder.embed(["query: merhaba"]);
    expect([...(await embedder.embed(["query: merhaba"]))]).toEqual([...alone]);
    let cos = 0;
    for (let i = 0; i < E5_SMALL.dim; i++) cos += alone[i]! * a[i]!;
    expect(cos).toBeGreaterThan(0.99);
    expect(indexer.state.status).toBe("ready");
  });

  it("finds a Turkish paraphrase that shares no words with the question", async () => {
    const q = "Onu özlediğimi söylediğim konuşmayı bul";
    const a = answer(q, session, NO_FILTERS, undefined, "tr", input(q, await vector(q)), NOW);
    expect(a.basis).toBe("meaning");
    // The exchange is found: at least one of its two messages ranks in the top three.
    const top = a.evidence.slice(0, 3).map((e) => e.message.text);
    expect(top.some((t) => t === "keşke şu an yanımda olsaydın" || t === "ben de seni çok özledim"), top.join(" | ")).toBe(true);
  });

  it("pairs the statement with the reply that followed it", async () => {
    const q = "Partiye gitmek istemediğimi söylediğimde ne cevap vermişti?";
    const a = answer(q, session, NO_FILTERS, undefined, "tr", input(q, await vector(q)), NOW);
    expect(a.result?.kind).toBe("recall");
    if (a.result?.kind !== "recall") return;
    const top = a.result.pairs.slice(0, 3).map((p) => [session.parsed.messages[p.match]!.text, p.reply === null ? null : session.parsed.messages[p.reply]!.text]);
    expect(top).toContainEqual(["ben o partiye gitmek istemiyorum açıkçası", "tamam zorlamayacağım, evde kalırız"]);
  });

  it("respects a stated year: the same topic in another year is excluded", async () => {
    const q = "Geçen yıl taşınmaktan bahsettiğimiz konuşmayı bul";
    const a = answer(q, session, NO_FILTERS, undefined, "tr", input(q, await vector(q)), NOW);
    expect(a.scope).toBe("2025");
    expect(a.evidence.every((e) => e.message.at.startsWith("2025"))).toBe(true);
    expect(a.evidence.map((e) => e.message.text)).not.toContain("yeni bir eve geçsek nasıl olur?");
  });

  it("keeps related messages above the model's floor (which cannot tell an unrelated question apart)", async () => {
    const q = await vector("Onu özlediğimi söylediğim konuşmayı bul");
    const gold = session.parsed.messages.findIndex((m) => m.text === "ben de seni çok özledim");
    expect(indexer.index.score(q, gold)!).toBeGreaterThan(E5_SMALL.minSimilarity);
    // Measured on the conversational retrieval evaluation: unrelated questions score as high as related ones, so no answer
    // claims "not discussed" from a threshold; meaning-only results carry a note instead.
    const unrelated = indexer.search(await vector("kuantum fiziği ve kara delikler hakkında konuştuğumuz an"), 1, () => true)[0]!;
    expect(Number.isFinite(unrelated.score)).toBe(true);
    expect(query(E5_SMALL, "x")).toBe("query: x");
  });
});
