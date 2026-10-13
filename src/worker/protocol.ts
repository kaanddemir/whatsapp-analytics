/* Messages between the UI thread and the analysis worker.

   The worker owns the chat: decoded text and parsed messages live only in its
   memory. The UI receives summaries and statistics, never message text, so
   React state, devtools snapshots and error reports cannot hold it. Every
   request carries an id; replies echo it, and the client drops replies to
   requests it has since cancelled. */
import type { AnalysisFilters, ChatType, ParseReport, Stats, TextEncoding } from "@/model";
import type { InputErrorCode } from "@/io/errors";
import type { AnalysisErrorCode } from "@/analytics";

export type RequestId = number;

export type WorkerRequest =
  | { readonly type: "load"; readonly id: RequestId; readonly file: File }
  | { readonly type: "analyze"; readonly id: RequestId; readonly filters: AnalysisFilters }
  | { readonly type: "clear"; readonly id: RequestId };

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
}

export type WorkerErrorCode =
  | InputErrorCode
  | AnalysisErrorCode
  | "no_messages"
  | "no_chat_loaded"
  | "internal";

export type Stage = "reading" | "decoding" | "parsing" | "analyzing";

export type WorkerResponse =
  | { readonly type: "progress"; readonly id: RequestId; readonly stage: Stage }
  | { readonly type: "loaded"; readonly id: RequestId; readonly summary: LoadSummary }
  | { readonly type: "stats"; readonly id: RequestId; readonly stats: Stats }
  | { readonly type: "cleared"; readonly id: RequestId }
  | {
      readonly type: "error";
      readonly id: RequestId;
      readonly code: WorkerErrorCode;
      readonly message: string;
      /** Present for "no_messages": why nothing was found, without content. */
      readonly report?: ParseReport;
    };
