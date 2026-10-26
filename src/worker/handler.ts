/* The worker's request handling, kept free of `self` so it can be unit-tested
   on the main thread or in Node. analysis.worker.ts only wires it up. */
import type { DecodedExport, ParseResult } from "@/model";
import { InputError } from "@/io/errors";
import { readExport, type ReadStage } from "@/io/readExport";
import { AnalysisError, analyze } from "@/analytics";
import { parseExport } from "@/parser";
import { OpfsChatStore, StoreError, type ChatStore, type SavedChat, type StoreErrorCode } from "@/store/chatStore";
import { validRequest, type LoadSummary, type WorkerRequest, type WorkerResponse } from "./protocol";
import { ChatSession } from "@/conversation/session";
import { answer, type SemanticInput } from "@/ask/answer";
import { route } from "@/ask/router";
import { SemanticIndexer, type SemanticState } from "@/semantic/indexer";
import { OpfsSemanticStore, type SemanticStore } from "@/semantic/store";
import type { EmbedderFactory } from "@/semantic/embedder";
import { workerEmbedderFactory } from "@/semantic/workerEmbedder";
import { CANDIDATES } from "@/semantic/hybrid";
import { meaningText } from "@/semantic/query";

type Emit = (response: WorkerResponse) => void;
type Read = (file: File, emit: (stage: ReadStage, fraction?: number) => void) => Promise<DecodedExport>;

/** Replaceable stages, so tests can inject failures and count parses. */
export interface HandlerDeps {
  readonly read?: Read;
  readonly parse?: typeof parseExport;
  readonly analyze?: typeof analyze;
  readonly store?: ChatStore;
  /** Creates the embedding model on first use (the model worker in the browser). */
  readonly embedder?: EmbedderFactory;
  /** Where a saved chat's vectors are kept; null keeps nothing. */
  readonly semanticStore?: SemanticStore | null;
  /** Unsolicited updates (semantic indexing state), outside any request. */
  readonly notify?: (response: WorkerResponse) => void;
}

const defaultRead: Read = (file, stage) => readExport(file, stage);

/** Allocation failures surface as RangeError ("Array buffer allocation failed", "Invalid string length"). */
const isOutOfMemory = (error: unknown) => error instanceof RangeError;

const isoOf = (ts: number) => new Date(ts).toISOString().slice(0, 19);

/** Thrown inside a request that was cancelled; reported as the error "cancelled". */
class Cancelled extends Error {}

function summarize(decoded: DecodedExport, parsed: ParseResult, saved: SavedChat | null = null, saveError: StoreErrorCode | null = null): LoadSummary {
  const first = parsed.messages[0];
  const last = parsed.messages[parsed.messages.length - 1];
  return {
    file: {
      fileName: decoded.fileName,
      byteLength: decoded.byteLength,
      encoding: decoded.encoding,
      hadBom: decoded.hadBom,
      hadReplacementChars: decoded.hadReplacementChars,
      archiveEntry: decoded.archiveEntry ?? null,
    },
    report: parsed.report,
    participantCount: parsed.participants.length,
    chatType: parsed.chatType,
    aliasCandidates: parsed.aliasCandidates.length,
    firstMessageAt: first ? isoOf(first.ts) : "",
    lastMessageAt: last ? isoOf(last.ts) : "",
    saved,
    saveError,
  };
}

const defaultSemanticStore = () => (typeof navigator !== "undefined" && typeof navigator.storage?.getDirectory === "function" ? new OpfsSemanticStore() : null);

export function createHandler({
  read = defaultRead, parse = parseExport, analyze: run = analyze, store = new OpfsChatStore(),
  embedder = workerEmbedderFactory(import.meta.env.BASE_URL), semanticStore = defaultSemanticStore(), notify = () => {},
}: HandlerDeps = {}) {
  // The only copy of the chat. Replaced on load, dropped on clear. The decoded
  // text is not kept: parsing produces everything later stages need. (A chat
  // saved on the device is re-read from there.)
  let current: ParseResult | null = null;
  let session: ChatSession | null = null;
  let cleaned = false;
  // Search by meaning for the open chat; replaced with the chat, disposed on clear.
  let indexer: SemanticIndexer | null = null;
  let savedId: string | null = null;
  const open = () => {
    if (!current) return null;
    if (session?.parsed !== current) session = new ChatSession(current);
    return session;
  };
  const status = (): SemanticState => indexer?.state ?? { status: "off" };

  // Cancellation is cooperative. A request still in the queue never runs; one waiting on the model
  // (a question's query embedding) stops waiting, so the queue moves on. Synchronous work cannot be
  // interrupted: an answer computed after its cancel is dropped. The model and indexes are untouched.
  const active = new Set<number>();
  const cancelled = new Set<number>();
  const stoppers = new Map<number, () => void>();
  /** `work`, unless request `id` is cancelled first; then the work finishes unobserved. */
  function unlessCancelled<T>(id: number, work: Promise<T>): Promise<T> {
    if (cancelled.has(id)) return Promise.reject(new Cancelled());
    return new Promise<T>((resolve, reject) => {
      stoppers.set(id, () => reject(new Cancelled()));
      work.then(resolve, reject).finally(() => stoppers.delete(id));
    });
  }

  /** Hybrid retrieval input for a question, when search by meaning is on. */
  async function semanticFor(plan: ReturnType<typeof route>, question: string): Promise<SemanticInput | null> {
    // A topic search can widen to meaning when nothing matches exactly (answer.ts), so it gets the input too.
    if (!((plan.type === "recall" || (plan.type === "fact" && !plan.exact)) && indexer)) return null;
    const ix = indexer;
    const state = ix.state;
    let search: SemanticInput["search"] = null;
    let similarity: SemanticInput["similarity"];
    // A query searches the indexed portion without waiting for completion.
    if (ix.done > 0) {
      try {
        // The model reads what the question is about, without its request framing (semantic/query.ts).
        const q = await ix.queryVector(meaningText(plan.type === "recall" ? plan.topic : question));
        search = (keep) => ix.search(q, CANDIDATES, keep);
        similarity = (mid) => ix.index.score(q, mid);
      } catch { /* the model is unavailable: words only, and the answer says so */ }
    }
    return { search, similarity, lexicalWeight: ix.spec.lexicalWeight, minSimilarity: ix.spec.minSimilarity, coverage: ix.coverage, status: state.status, failure: state.status === "failed" ? state.reason : undefined };
  }
  /** A new chat: a fresh indexer, and a saved chat's stored index read back (resuming if it was unfinished). */
  async function adoptSemantic(parsed: ParseResult, chatId: string | null) {
    const old = indexer;
    indexer = null;
    await old?.dispose();
    savedId = chatId;
    const next = new SemanticIndexer(parsed, {
      factory: embedder, store: chatId ? semanticStore : null, chatId,
      onState: (state) => { if (indexer === next) notify({ type: "semanticStatus", id: 0, state }); },
    });
    indexer = next;
    if (await next.restore().catch(() => false)) {
      if (indexer === next && (next.state.status === "off" || next.state.status === "paused")) void next.start();
    }
  }

  /** Parse decoded text into the current chat; false (after reporting) when it holds no messages. */
  function adopt(id: number, decoded: DecodedExport, dateOrder: "dmy" | "mdy" | undefined, emit: Emit): ParseResult | null {
    emit({ type: "progress", id, stage: "parsing" });
    const parsed = parse(decoded.text, dateOrder ? { dateOrder } : {});
    if (parsed.messages.length === 0) {
      emit({ type: "error", id, code: "no_messages", message: "No WhatsApp messages were found in this file.", report: parsed.report });
      return null;
    }
    current = parsed;
    return parsed;
  }

  async function reset() {
    current = null;
    session = null;
    savedId = null;
    const old = indexer;
    indexer = null;
    await old?.dispose();
  }

  async function handle(request: unknown, emit: Emit): Promise<void> {
    if (!validRequest(request)) {
      const candidate = request as { id?: unknown; filters?: unknown } | null;
      emit({ type: "error", id: typeof candidate?.id === "number" && Number.isSafeInteger(candidate.id) ? candidate.id : 0,
        code: candidate?.filters !== undefined ? "invalid_filter" : "internal", message: "Invalid analysis request." });
      return;
    }
    const { id } = request;
    try {
      if (cancelled.has(id)) throw new Cancelled();
      switch (request.type) {
        case "load": {
          await reset();
          const decoded = await read(request.file, (stage, fraction) => emit({ type: "progress", id, stage, ...(fraction === undefined ? {} : { fraction }) }));
          const parsed = adopt(id, decoded, request.dateOrder, emit);
          if (!parsed) return;
          let saved: SavedChat | null = null;
          let saveError: StoreErrorCode | null = null;
          if (request.persist) {
            emit({ type: "progress", id, stage: "saving" });
            try {
              const s = summarize(decoded, parsed);
              saved = await store.save(decoded.text, {
                fileName: decoded.fileName, archiveEntry: decoded.archiveEntry ?? null, messageCount: parsed.messages.length,
                firstMessageAt: s.firstMessageAt, lastMessageAt: s.lastMessageAt, dateOrder: request.dateOrder ?? null,
              });
            } catch (error) {
              // The chat is loaded either way; the UI says why it was not kept.
              saveError = error instanceof StoreError ? error.code : "storage_failed";
            }
          }
          await adoptSemantic(parsed, saved?.id ?? null);
          emit({ type: "loaded", id, summary: summarize(decoded, parsed, saved, saveError) });
          return;
        }
        case "openSaved": {
          await reset();
          emit({ type: "progress", id, stage: "reading" });
          const { chat, text } = await store.read(request.chatId);
          const decoded: DecodedExport = {
            fileName: chat.fileName, byteLength: chat.textBytes, encoding: "utf-8", hadBom: false,
            hadReplacementChars: text.includes("\uFFFD"), ...(chat.archiveEntry ? { archiveEntry: chat.archiveEntry } : {}), text,
          };
          const order = request.dateOrder ?? chat.dateOrder ?? undefined;
          const parsed = adopt(id, decoded, order, emit);
          if (!parsed) return;
          await adoptSemantic(parsed, chat.id);
          emit({ type: "loaded", id, summary: summarize(decoded, parsed, chat) });
          return;
        }
        case "listSaved": {
          if (!cleaned) {
            cleaned = true;
            await store.cleanup().catch(() => {});
          }
          emit({ type: "savedList", id, chats: await store.list() });
          return;
        }
        case "deleteSaved": {
          if (savedId === request.chatId) await indexer?.forget();
          await semanticStore?.remove(request.chatId);
          await store.remove(request.chatId);
          // Its vectors go with it; an open copy keeps searching from memory only.
          if (savedId === request.chatId) savedId = null;
          emit({ type: "deleted", id });
          return;
        }
        case "analyze": {
          if (!current) {
            emit({ type: "error", id, code: "no_chat_loaded", message: "No chat is loaded." });
            return;
          }
          // Parse once, analyse many: only the analytics re-run on a filter change.
          emit({ type: "progress", id, stage: "analyzing" });
          emit({ type: "stats", id, stats: run(current, request.filters) });
          return;
        }
        case "search": {
          const chat = open();
          if (!chat) {
            emit({ type: "error", id, code: "no_chat_loaded", message: "No chat is loaded." });
            return;
          }
          const limit = Math.max(1, Math.min(100, request.limit));
          const page = chat.search(request.query, request.filters, request.sort, Math.max(0, request.offset), limit, () => emit({ type: "progress", id, stage: "indexing" }));
          emit({ type: "searchResults", id, page });
          return;
        }
        case "behaviourEvidence": {
          const chat = open();
          if (!chat) {
            emit({ type: "error", id, code: "no_chat_loaded", message: "No chat is loaded." });
            return;
          }
          const onBuild = () => emit({ type: "progress", id, stage: "indexing" });
          const page = chat.behaviourEvidence(request.behaviour, request.sender, request.filters, Math.max(0, request.offset), Math.max(1, Math.min(100, request.limit)), onBuild);
          emit({ type: "evidencePage", id, total: page.total, items: page.items });
          return;
        }
        case "timeline": {
          const chat = open();
          if (!chat) {
            emit({ type: "error", id, code: "no_chat_loaded", message: "No chat is loaded." });
            return;
          }
          const page = chat.timelinePage(request.filters, request.order, Math.max(0, request.offset), Math.max(1, Math.min(50, request.limit)), () => emit({ type: "progress", id, stage: "indexing" }));
          emit({ type: "timelinePage", id, page });
          return;
        }
        case "dateEvidence": {
          const chat = open();
          if (!chat) { emit({ type: "error", id, code: "no_chat_loaded", message: "No chat is loaded." }); return; }
          const ids = chat.mentioning(request.day, request.month, request.year, request.filters, () => emit({ type: "progress", id, stage: "indexing" }));
          const offset = Number.isFinite(request.offset) ? Math.max(0, Math.floor(request.offset)) : 0;
          const limit = Number.isFinite(request.limit) ? Math.max(1, Math.min(100, Math.floor(request.limit))) : 10;
          emit({ type: "evidencePage", id, total: ids.length, items: ids.slice(offset, offset + limit).map((messageId) => chat.evidence(messageId)) });
          return;
        }
        case "ask": {
          const chat = open();
          if (!chat) {
            emit({ type: "error", id, code: "no_chat_loaded", message: "No chat is loaded." });
            return;
          }
          const question = request.question.slice(0, 500);
          const onBuild = () => emit({ type: "progress", id, stage: "indexing" });
          const semantic = await unlessCancelled(id, semanticFor(route(question, chat.parsed.participants), question));
          const result = answer(question, chat, request.filters, onBuild, request.locale ?? "en", semantic);
          if (cancelled.has(id)) throw new Cancelled();
          emit({ type: "answer", id, answer: result });
          return;
        }
        case "semantic": {
          if (request.action === "forget" && !current) {
            await semanticStore?.removeAll();
            emit({ type: "semanticStatus", id, state: { status: "off" } });
            return;
          }
          if (!current || !indexer) {
            emit({ type: "error", id, code: "no_chat_loaded", message: "No chat is loaded." });
            return;
          }
          if (request.action === "enable") {
            void indexer.start();
          }
          else if (request.action === "pause") indexer.cancel();
          else if (request.action === "forget") {
            // Stop, unload the model, delete it and every stored index; the open chat starts over at "off".
            const parsed = current;
            await indexer.dispose();
            await semanticStore?.removeAll();
            indexer = null;
            await adoptSemantic(parsed, null);
          }
          emit({ type: "semanticStatus", id, state: status() });
          return;
        }
        case "context": {
          const chat = open();
          if (!chat) {
            emit({ type: "error", id, code: "no_chat_loaded", message: "No chat is loaded." });
            return;
          }
          if (!Number.isInteger(request.messageId) || request.messageId < 0 || request.messageId >= chat.size) {
            emit({ type: "error", id, code: "internal", message: "No such message." });
            return;
          }
          emit({ type: "messages", id, messages: chat.context(request.messageId, Math.min(50, request.before), Math.min(50, request.after)) });
          return;
        }
        case "cancel": return; // handled outside the queue, below
        case "clear": {
          await reset();
          emit({ type: "cleared", id });
          return;
        }
      }
    } catch (error) {
      if (error instanceof Cancelled) {
        emit({ type: "error", id, code: "cancelled", message: "Cancelled." });
      } else if (error instanceof InputError) {
        emit({ type: "error", id, code: error.code, message: error.message });
      } else if (error instanceof AnalysisError || error instanceof StoreError) {
        emit({ type: "error", id, code: error.code, message: error.message });
      } else if (isOutOfMemory(error)) {
        await reset();
        emit({ type: "error", id, code: "out_of_memory", message: "The browser ran out of memory for this chat." });
      } else {
        // Never forward an arbitrary error message: it could quote file content.
        emit({
          type: "error",
          id,
          code: "internal",
          message: request.type === "analyze" ? "Something went wrong while analysing the chat." : "Something went wrong while reading the file.",
        });
      }
    }
  }
  // Preserve request order across asynchronous imports, storage and queries.
  let pending = Promise.resolve();
  return (request: WorkerRequest, emit: Emit): Promise<void> => {
    if (validRequest(request) && request.type === "cancel") {
      // Only requests still queued or running: a late cancel leaves nothing behind.
      if (active.has(request.target)) {
        cancelled.add(request.target);
        stoppers.get(request.target)?.();
      }
      return Promise.resolve();
    }
    const id = validRequest(request) ? request.id : null;
    if (id !== null) active.add(id);
    const next = pending.then(() => handle(request, emit)).finally(() => {
      if (id === null) return;
      active.delete(id);
      cancelled.delete(id);
    });
    pending = next.catch(() => {});
    return next;
  };
}
