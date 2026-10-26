/* Messages between the UI thread and the analysis worker.

   The worker owns the chat: decoded text and parsed messages live only in its
   memory. The UI receives summaries and statistics, and message text only
   for the messages it shows on request (search results, cited evidence,
   context), never the chat as a whole. Every
   request carries an id; replies echo it, and the client drops replies to
   requests it has since cancelled. */
import type { AnalysisFilters, ChatType, ParseReport, Stats, TextEncoding } from "@/model";
import type { InputErrorCode } from "@/io/errors";
import type { AnalysisErrorCode } from "@/analytics";
import type { SavedChat, StoreErrorCode } from "@/store/chatStore";
import type { MessageView } from "@/conversation/types";
import type { SearchSort } from "@/search/keywordIndex";
import type { SearchPage, TimelinePage } from "@/conversation/results";
import type { Behaviour } from "@/behaviour/rules";
import type { Evidence } from "@/conversation/types";
import type { Answer } from "@/ask/types";
import type { SemanticState } from "@/semantic/indexer";

export type RequestId = number;

export type WorkerRequest =
  /** dateOrder: the user's reading of ambiguous D/M vs M/D dates, on a re-read. */
  /** persist: keep the chat text on this device (opt-in). */
  | { readonly type: "load"; readonly id: RequestId; readonly file: File; readonly dateOrder?: "dmy" | "mdy"; readonly persist?: boolean }
  | { readonly type: "openSaved"; readonly id: RequestId; readonly chatId: string; readonly dateOrder?: "dmy" | "mdy" }
  | { readonly type: "listSaved"; readonly id: RequestId }
  | { readonly type: "deleteSaved"; readonly id: RequestId; readonly chatId: string }
  | { readonly type: "analyze"; readonly id: RequestId; readonly filters: AnalysisFilters }
  | { readonly type: "clear"; readonly id: RequestId }
  /** Keyword search within the filters; a page of results with highlights. */
  | { readonly type: "search"; readonly id: RequestId; readonly query: string; readonly filters: AnalysisFilters; readonly sort: SearchSort; readonly offset: number; readonly limit: number }
  /** A message with its neighbours, to read a result in context. */
  | { readonly type: "context"; readonly id: RequestId; readonly messageId: number; readonly before: number; readonly after: number }
  /** The messages behind a behaviour count; sender null = everyone. */
  | { readonly type: "behaviourEvidence"; readonly id: RequestId; readonly behaviour: Behaviour; readonly sender: number | null; readonly filters: AnalysisFilters; readonly offset: number; readonly limit: number }
  /** Plan conversations in the filters. */
  | { readonly type: "timeline"; readonly id: RequestId; readonly filters: AnalysisFilters; readonly order: "newest" | "oldest"; readonly offset: number; readonly limit: number }
  /** A bounded page of messages mentioning a specific explicit calendar date. */
  | { readonly type: "dateEvidence"; readonly id: RequestId; readonly day: number; readonly month: number; readonly year: number | null; readonly filters: AnalysisFilters; readonly offset: number; readonly limit: number }
  /** A question, answered deterministically within the filters. */
  | { readonly type: "ask"; readonly id: RequestId; readonly question: string; readonly locale?: "en" | "tr"; readonly filters: AnalysisFilters }
  /** Search by meaning for the open chat: start or resume indexing (downloading the model first, once), pause it, report its state,
      or forget: remove the model files and every stored index from this device. */
  | { readonly type: "semantic"; readonly id: RequestId; readonly action: "enable" | "pause" | "status" | "forget" }
  /** Stop request `target` if it is still queued or waiting; handled at once, outside the queue, and never answered.
      The cancelled request itself replies with the error "cancelled". */
  | { readonly type: "cancel"; readonly id: RequestId; readonly target: RequestId };

export interface FileInfo {
  readonly fileName: string;
  /** Size of the decoded chat text in bytes (inside the zip, for a zip). */
  readonly byteLength: number;
  readonly encoding: TextEncoding;
  readonly hadBom: boolean;
  readonly hadReplacementChars: boolean;
  /** Path of the chat file inside a .zip, when the input was one. */
  readonly archiveEntry: string | null;
}

/** What the UI may know about a loaded chat: counts and dates, no message text. */
export interface LoadSummary {
  readonly file: FileInfo;
  readonly report: ParseReport;
  readonly participantCount: number;
  readonly chatType: ChatType;
  readonly aliasCandidates: number;
  /** ISO date-times (wall clock) of the first and last message. */
  readonly firstMessageAt: string;
  readonly lastMessageAt: string;
  /** The device copy, when the chat was saved or opened from the device. */
  readonly saved: SavedChat | null;
  /** Why a requested save did not happen; the chat itself loaded. */
  readonly saveError: StoreErrorCode | null;
}

export type WorkerErrorCode =
  | InputErrorCode
  | AnalysisErrorCode
  | "no_messages"
  | "no_chat_loaded"
  | StoreErrorCode
  /** The browser ran out of memory while reading or parsing. */
  | "out_of_memory"
  /** The request was cancelled before it produced a result. */
  | "cancelled"
  | "internal";

/** "indexing": building the search index (or other derived data) on first use. */
export type Stage = "reading" | "decoding" | "parsing" | "saving" | "analyzing" | "indexing";

export type WorkerResponse =
  /** fraction: share of the stage done (0–1), when the stage can measure it. */
  | { readonly type: "progress"; readonly id: RequestId; readonly stage: Stage; readonly fraction?: number }
  | { readonly type: "savedList"; readonly id: RequestId; readonly chats: readonly SavedChat[] }
  | { readonly type: "deleted"; readonly id: RequestId }
  | { readonly type: "searchResults"; readonly id: RequestId; readonly page: SearchPage }
  | { readonly type: "messages"; readonly id: RequestId; readonly messages: readonly MessageView[] }
  | { readonly type: "evidencePage"; readonly id: RequestId; readonly total: number; readonly items: readonly Evidence[] }
  | { readonly type: "timelinePage"; readonly id: RequestId; readonly page: TimelinePage }
  | { readonly type: "answer"; readonly id: RequestId; readonly answer: Answer }
  | { readonly type: "loaded"; readonly id: RequestId; readonly summary: LoadSummary }
  | { readonly type: "stats"; readonly id: RequestId; readonly stats: Stats }
  | { readonly type: "cleared"; readonly id: RequestId }
  /** The reply to "semantic", and, with id 0, an unsolicited update while indexing runs. */
  | { readonly type: "semanticStatus"; readonly id: RequestId; readonly state: SemanticState }
  | {
      readonly type: "error";
      readonly id: RequestId;
      readonly code: WorkerErrorCode;
      readonly message: string;
      /** Present for "no_messages": why nothing was found, without content. */
      readonly report?: ParseReport;
    };

/** Worker messages cross a runtime boundary; TypeScript alone does not validate them. */
export function validRequest(value: unknown): value is WorkerRequest {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  const integer = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
  const sender = (n: unknown) => n === null || integer(n);
  const date = (v: unknown) => v === null || (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)
    && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v);
  const f = r.filters as Record<string, unknown> | null;
  const filters = () => !!f && date(f.start) && date(f.end) && sender(f.sender);
  const page = () => integer(r.offset) && integer(r.limit) && r.limit > 0;
  const order = () => r.dateOrder === undefined || r.dateOrder === "dmy" || r.dateOrder === "mdy";
  if (!integer(r.id) || typeof r.type !== "string") return false;
  switch (r.type) {
    case "load": return r.file instanceof File && order() && (r.persist === undefined || typeof r.persist === "boolean");
    case "openSaved": return typeof r.chatId === "string" && /^[a-z0-9]+-[a-z0-9]+$/.test(r.chatId) && order();
    case "deleteSaved": return typeof r.chatId === "string" && /^[a-z0-9]+-[a-z0-9]+$/.test(r.chatId);
    case "listSaved": case "clear": return true;
    case "analyze": return filters();
    case "ask": return filters() && typeof r.question === "string" && (r.locale === undefined || r.locale === "tr" || r.locale === "en");
    case "search": return filters() && page() && typeof r.query === "string" && ["relevance", "newest", "oldest"].includes(String(r.sort));
    case "context": return integer(r.messageId) && integer(r.before) && integer(r.after);
    case "behaviourEvidence": return filters() && page() && sender(r.sender) && ["proposal", "acceptance", "apology", "cancellation"].includes(String(r.behaviour));
    case "timeline": return filters() && page() && ["newest", "oldest"].includes(String(r.order));
    case "dateEvidence": return filters() && page() && integer(r.day) && r.day >= 1 && r.day <= 31 && integer(r.month) && r.month >= 1 && r.month <= 12 && (r.year === null || integer(r.year) && r.year >= 1 && r.year <= 9999);
    case "semantic": return ["enable", "pause", "status", "forget"].includes(String(r.action));
    case "cancel": return integer(r.target);
    default: return false;
  }
}
