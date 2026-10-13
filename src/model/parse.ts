/* Results of reading a file and parsing it into messages. */
import type { Message, MessageKind, Participant, ParticipantId, SystemEvent, SystemEventType } from "./message";

export type ExportPlatform = "android" | "ios" | "mixed" | "unknown";
export type DateOrder = "dmy" | "mdy" | "ymd";
/**
 * How the date order was decided:
 * - proven:   the other order would produce impossible dates (e.g. day 13 as a month)
 * - inferred: only this order keeps the export in chronological order
 * - assumed:  nothing distinguishes the orders; D/M/Y was assumed
 */
export type DateOrderCertainty = "proven" | "inferred" | "assumed";
export type ClockFormat = "24h" | "12h" | "mixed";
export type TextEncoding = "utf-8" | "utf-16le" | "utf-16be";

/** What came out of the file-reading stage, before any WhatsApp parsing. */
export interface DecodedExport {
  readonly fileName: string;
  readonly byteLength: number;
  readonly encoding: TextEncoding;
  /** A UTF-8/16 byte-order mark was present and stripped. */
  readonly hadBom: boolean;
  /** The decoder met invalid bytes and substituted U+FFFD. */
  readonly hadReplacementChars: boolean;
  /** Set when the text came out of a .zip archive: the entry's path. */
  readonly archiveEntry?: string;
  readonly text: string;
}

export type ParseWarningCode =
  | "invalid_timestamp"         // header-shaped line whose date or time is impossible; record skipped
  | "empty_sender"              // sender made only of directional marks; record skipped
  | "orphan_lines"              // text before the first recognisable message
  | "unrecognized_system_lines" // sender-less timestamped lines matching no known template
  | "possible_system_event"     // looks like a group event but lacks evidence; kept as a message
  | "ambiguous_date_order"      // nothing proved D/M/Y vs M/D/Y; D/M/Y assumed
  | "conflicting_date_order"    // some dates only fit one order, others only the other
  | "out_of_order"              // timestamps went backwards; records were sorted
  | "mixed_platforms";          // both Android and iOS line formats in one file

export interface ParseWarning {
  readonly code: ParseWarningCode;
  /** How many rows/lines this applies to. */
  readonly count: number;
  /** First 1-based line numbers affected, for diagnostics; never message text. */
  readonly sampleLines: readonly number[];
}

export type ParseCompleteness =
  | "complete" // every line was accounted for as a message, continuation or known system line
  | "partial"  // something was skipped or not recognised; see warnings
  | "empty";   // no messages at all

/** Line- and record-level accounting, so the UI can say what was and was not counted. */
export interface ParseReport {
  readonly completeness: ParseCompleteness;
  readonly totalLines: number;
  readonly blankLines: number;
  /** Lines that started a record (message or system line). */
  readonly recordLines: number;
  /** Lines appended to the previous message (multi-line messages). */
  readonly continuationLines: number;
  readonly messages: number;
  readonly messagesByKind: Readonly<Record<MessageKind, number>>;
  readonly editedMessages: number;
  readonly systemEvents: number;
  readonly systemEventsByType: Readonly<Record<SystemEventType, number>>;
  /** Records dropped because their timestamp or sender was unusable. */
  readonly skippedRecords: number;
  readonly format: {
    readonly platform: ExportPlatform;
    readonly dateOrder: DateOrder;
    readonly dateOrderCertainty: DateOrderCertainty;
    readonly clock: ClockFormat;
  };
  readonly warnings: readonly ParseWarning[];
}

/**
 * Group vs direct chat. An export never states which it is, so this is only
 * "group" when the file proves it; otherwise "unknown". Two human senders
 * and no group events usually means a one-to-one chat, but a quiet group looks
 * the same, so that is left for the UI to phrase, not asserted.
 */
export interface ChatType {
  readonly kind: "group" | "unknown";
  readonly evidence: readonly ("group_events" | "three_or_more_senders")[];
  /** Participants excluding Meta AI. */
  readonly humanParticipants: number;
}

/**
 * A "~ Name" sender that may be the same person as a saved contact. WhatsApp
 * shows unsaved members by their profile name with a tilde, so a match by name
 * is a hint, never proof: they are reported, not merged.
 */
export interface AliasCandidate {
  readonly alias: ParticipantId;
  readonly candidates: readonly ParticipantId[];
  readonly match: "exact_name" | "first_name";
}

export interface ParseResult {
  /** Chronologically sorted (stable); system events and skipped records excluded. */
  readonly messages: readonly Message[];
  /** Senders with at least one message, in first-appearance order. */
  readonly participants: readonly Participant[];
  readonly systemEvents: readonly SystemEvent[];
  readonly chatType: ChatType;
  readonly aliasCandidates: readonly AliasCandidate[];
  readonly report: ParseReport;
}
