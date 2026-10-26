/* WhatsApp export text -> ParseResult.

   Stages:
     1. lines -> records: a header line starts a record, other lines continue it
     2. one date order for the whole file (dates.ts), then timestamps
     3. each record becomes a message, a system event, or a skipped record
     4. senders whose rows are all system wording become "the chat itself"
     5. participants, chat type, alias hints and the parse report

   Differences from the former Python parser, deliberately:
   - C1: Android "<Media omitted>" (and Turkish) is media (classify.ts).
   - C2: group-event wording from a person is a system event only with
     evidence (no sender, iOS LRM mark, sender names themselves, or a sender
     that only ever posts system lines); otherwise it stays a message and
     is reported as "possible_system_event".
   - C8: the chat is a "group" only when the file proves it; see ChatType.
   - "~ Name" aliases are reported as candidates, never merged.
   - Nothing is dropped silently: every skipped line is counted in the report.

   The parser is pure and synchronous: no I/O, no logging. Errors never
   include message text. */
import type {
  AliasCandidate,
  ChatType,
  ClockFormat,
  ExportPlatform,
  Message,
  MessageKind,
  ParseReport,
  ParseResult,
  ParseWarning,
  ParseWarningCode,
  Participant,
  SystemEvent,
  SystemEventType,
} from "@/model";
import { classifyBody, matchSystem, stripEdited, type SystemTemplate } from "./classify";
import { decideDateOrder, toTimestamp } from "./dates";
import { matchHeader, type HeaderMatch } from "./header";
import { cleanLine, cleanName, startsWithMark, stripMarks } from "./text";

/** Longest plausible sender name; past this, "x: y" is text, not a sender. */
const MAX_SENDER_LENGTH = 100;
const SAMPLE_LINES = 5;
/** A whole body in angle brackets, the shape of Android's placeholders ("<Media omitted>"). */
const PLACEHOLDER_SHAPE = /^<[^<>\n]{3,80}>$/u;

interface RawRecord {
  readonly line: number;
  readonly header: HeaderMatch;
  /** The first line, still carrying WhatsApp's marks. */
  readonly rawFirst: string;
  readonly continuation: string[];
}

class WarningLog {
  private readonly entries = new Map<ParseWarningCode, { count: number; sampleLines: number[] }>();

  add(code: ParseWarningCode, line?: number, count = 1): void {
    const entry = this.entries.get(code) ?? { count: 0, sampleLines: [] };
    entry.count += count;
    if (line !== undefined && entry.sampleLines.length < SAMPLE_LINES) entry.sampleLines.push(line);
    this.entries.set(code, entry);
  }

  has(code: ParseWarningCode): boolean {
    return this.entries.has(code);
  }

  list(): ParseWarning[] {
    return [...this.entries].map(([code, { count, sampleLines }]) => ({ code, count, sampleLines }));
  }
}

// Records.
function splitRecords(text: string, warnings: WarningLog) {
  const lines = text.split(/\r\n|\r|\n/);
  // A trailing newline is not an extra (blank) line.
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();

  const records: RawRecord[] = [];
  let blankLines = 0;
  let continuationLines = 0;
  let current: RawRecord | null = null;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const clean = cleanLine(raw);
    if (!clean.trim()) {
      blankLines++;
      // Blank lines inside a multi-line message are part of it.
      if (current) current.continuation.push("");
      continue;
    }
    const header = matchHeader(clean);
    if (header) {
      current = { line: i + 1, header, rawFirst: raw, continuation: [] };
      records.push(current);
    } else if (current) {
      current.continuation.push(raw);
      continuationLines++;
    } else {
      warnings.add("orphan_lines", i + 1);
    }
  }
  return { records, totalLines: lines.length, blankLines, continuationLines };
}

// One record.
type Row =
  | { kind: "skip" }
  | { kind: "system"; ts: number; template: SystemTemplate | null; line: number }
  | {
      kind: "sender";
      ts: number;
      line: number;
      sender: string;
      text: string;
      edited: boolean;
      body: { kind: MessageKind; mediaKind?: Message["mediaKind"] };
      /** Matched group/call wording; decided in stage 4 when contextual. */
      template: SystemTemplate | null;
      /** The template match is backed by evidence on this row alone. */
      evidenced: boolean;
      /** The body starts with the sender's own name ("Boris: Boris created group …"). */
      selfNamed: boolean;
    };

const QUOTES = /["“”«»]/;

/** Split "Sender: text". Null when the record has no sender (a system line). */
function splitSender(rest: string): { sender: string; body: string } | null {
  const at = rest.indexOf(": ");
  if (at === -1) {
    // "Alice:" with an empty message.
    const trimmed = rest.trimEnd();
    if (trimmed.endsWith(":") && trimmed.length - 1 <= MAX_SENDER_LENGTH && !QUOTES.test(trimmed)) {
      return { sender: trimmed.slice(0, -1), body: "" };
    }
    return null;
  }
  const sender = rest.slice(0, at);
  // A quote before the first ": " means a system line about a quoted group
  // subject ('Alice changed the subject to "a: b"'), not a sender.
  if (sender.length > MAX_SENDER_LENGTH || QUOTES.test(sender)) return null;
  return { sender, body: rest.slice(at + 2) };
}

function toRow(record: RawRecord, ts: number | null, warnings: WarningLog): Row {
  if (ts === null) {
    warnings.add("invalid_timestamp", record.line);
    return { kind: "skip" };
  }
  const split = splitSender(cleanLine(record.header.rest));
  const rawContinuation = record.continuation.length ? "\n" + record.continuation.join("\n") : "";

  if (!split) {
    const template = matchSystem(record.header.rest);
    if (!template) warnings.add("unrecognized_system_lines", record.line);
    return { kind: "system", ts, template, line: record.line };
  }

  const sender = cleanName(split.sender);
  if (!sender) {
    warnings.add("empty_sender", record.line);
    return { kind: "skip" };
  }

  // The body as written, marks included: they are evidence for classification.
  const delimiter = record.rawFirst.indexOf(": ");
  const rawBody = (delimiter === -1 ? split.body : record.rawFirst.slice(delimiter + 2)) + rawContinuation;
  const { text, edited } = stripEdited(stripMarks(rawBody).replace(/\s+$/u, ""));

  const template = text.includes("\n") ? null : matchSystem(text);
  const selfNamed = text.toLocaleLowerCase("tr").startsWith(sender.toLocaleLowerCase("tr") + " ");
  const evidenced = template !== null && (template.unambiguous || startsWithMark(rawBody) || selfNamed);
  return {
    kind: "sender",
    ts,
    line: record.line,
    sender,
    text,
    edited,
    body: classifyBody(rawBody, text),
    template,
    evidenced,
    selfNamed,
  };
}

// Chat-level facts.
function isMetaAI(name: string): boolean {
  const n = name.normalize("NFKC").trim().toLowerCase();
  return n === "meta ai" || n === "@meta ai";
}

function aliasCandidates(participants: readonly Participant[]): AliasCandidate[] {
  const fold = (s: string) => s.toLocaleLowerCase("tr");
  const plain = participants.filter((p) => !p.name.startsWith("~"));
  const out: AliasCandidate[] = [];
  for (const p of participants) {
    const alias = /^~\s*(.+)$/u.exec(p.name)?.[1]?.trim();
    if (!alias) continue;
    const exact = plain.filter((q) => fold(q.name) === fold(alias));
    if (exact.length) {
      out.push({ alias: p.id, candidates: exact.map((q) => q.id), match: "exact_name" });
      continue;
    }
    const first = fold(alias.split(" ")[0] ?? "");
    const byFirst = plain.filter((q) => fold(q.name.split(" ")[0] ?? "") === first);
    if (first && byFirst.length) out.push({ alias: p.id, candidates: byFirst.map((q) => q.id), match: "first_name" });
  }
  return out;
}

const zeroKinds = (): Record<MessageKind, number> => ({ text: 0, media: 0, deleted: 0, unavailable: 0 });
const zeroTypes = (): Record<SystemEventType, number> =>
  ({ encryption: 0, group: 0, call: 0, security: 0, disappearing: 0, unknown: 0 });

// Entry point.
export interface ParseOptions {
  /** The user's reading of D/M vs M/D dates; used only when the file does not prove one. */
  readonly dateOrder?: "dmy" | "mdy";
}

export function parseExport(text: string, options: ParseOptions = {}): ParseResult {
  const warnings = new WarningLog();
  const { records, totalLines, blankLines, continuationLines } = splitRecords(text, warnings);

  // Stage 2: date order and timestamps. Unless proven, the order is a guess
  // and says so; a choice by the user replaces the guess.
  const inferred = decideDateOrder(records.map((r) => r.header));
  const guessed = inferred.certainty !== "proven" && inferred.order !== "ymd";
  const decision = guessed && options.dateOrder
    ? { ...inferred, order: options.dateOrder, certainty: "user" as const }
    : inferred;
  if (guessed && decision.certainty !== "user" && records.length > 0) {
    warnings.add("ambiguous_date_order", records[0]?.line, records.length);
  }
  if (decision.conflicting) warnings.add("conflicting_date_order");

  // Stage 3: rows.
  const rows = records.map((record) => toRow(record, toTimestamp(record.header, decision.order), warnings));

  // Stage 4: a sender whose every row is system wording, at least one of it
  // unmistakable (a call record, the encryption notice), is the chat itself:
  // iOS posts group notices under the group's name. Except when one of those
  // rows names the sender as the actor: iOS attributes an action to the
  // person who did it ("Boris: Boris created group …",
  // Pustur/whatsapp-chat-parser#258), so that sender is a person and each of
  // their other rows needs its own evidence.
  const senderRows = new Map<string, { all: number; template: number; unambiguous: number; selfNamed: number }>();
  for (const row of rows) {
    if (row.kind !== "sender") continue;
    const s = senderRows.get(row.sender) ?? { all: 0, template: 0, unambiguous: 0, selfNamed: 0 };
    s.all++;
    if (row.template) s.template++;
    if (row.template?.unambiguous) s.unambiguous++;
    if (row.template && row.selfNamed) s.selfNamed++;
    senderRows.set(row.sender, s);
  }
  const chatEntity = (sender: string) => {
    const s = senderRows.get(sender);
    return !!s && s.template === s.all && s.unambiguous > 0 && s.selfNamed === 0;
  };

  const messages: Message[] = [];
  const systemEvents: SystemEvent[] = [];
  const ids = new Map<string, number>();
  const participants: Participant[] = [];
  const messagesByKind = zeroKinds();
  const systemEventsByType = zeroTypes();
  let groupEvidence = false;
  let edited = 0;
  let skipped = 0;
  let previousTs = -Infinity;
  const platforms = new Set<"android" | "ios">();
  let twelveHour = 0;

  records.forEach((record, index) => {
    const row = rows[index];
    if (!row || row.kind === "skip") {
      skipped++;
      return;
    }
    platforms.add(record.header.platform);
    if (record.header.meridiem) twelveHour++;

    const asSystem = row.kind === "system"
      || (row.template !== null && (row.evidenced || chatEntity(row.sender)));
    if (asSystem) {
      const type = row.template?.type ?? "unknown";
      systemEvents.push({ ts: row.ts, type });
      systemEventsByType[type]++;
      if (row.template?.group) groupEvidence = true;
      return;
    }
    if (row.kind !== "sender") return;

    if (row.template) warnings.add("possible_system_event", row.line);
    // An unknown variant stays text (its kind would be a guess) but is reported.
    if (row.body.kind === "text" && PLACEHOLDER_SHAPE.test(row.text)) warnings.add("unknown_placeholder", row.line);
    let id = ids.get(row.sender);
    if (id === undefined) {
      id = participants.length;
      ids.set(row.sender, id);
      participants.push({ id, name: row.sender, isMetaAI: isMetaAI(row.sender) });
    }
    if (row.ts < previousTs) warnings.add("out_of_order", row.line);
    previousTs = row.ts;

    const message: Message = {
      ts: row.ts,
      sender: id,
      text: row.text,
      kind: row.body.kind,
      ...(row.body.mediaKind ? { mediaKind: row.body.mediaKind } : {}),
      ...(row.edited ? { edited: true } : {}),
    };
    messages.push(message);
    messagesByKind[message.kind]++;
    if (row.edited) edited++;
  });

  // Exports are chronological, but a phone clock change can step backwards.
  // Array.prototype.sort is stable, so same-minute messages keep their order.
  if (warnings.has("out_of_order")) messages.sort((a, b) => a.ts - b.ts);

  let platform: ExportPlatform = "unknown";
  if (platforms.size === 2) {
    platform = "mixed";
    warnings.add("mixed_platforms");
  } else if (platforms.size === 1) {
    platform = [...platforms][0] ?? "unknown";
  }
  const parsedRecords = records.length - skipped;
  const clock: ClockFormat = twelveHour === 0 ? "24h" : twelveHour === parsedRecords ? "12h" : "mixed";

  const humanParticipants = participants.filter((p) => !p.isMetaAI).length;
  const evidence: ChatType["evidence"][number][] = [];
  if (groupEvidence) evidence.push("group_events");
  if (humanParticipants >= 3) evidence.push("three_or_more_senders");
  const chatType: ChatType = { kind: evidence.length ? "group" : "unknown", evidence, humanParticipants };

  const partial = skipped > 0
    || warnings.has("orphan_lines")
    || warnings.has("unrecognized_system_lines")
    || warnings.has("conflicting_date_order");
  const report: ParseReport = {
    completeness: messages.length === 0 ? "empty" : partial ? "partial" : "complete",
    totalLines,
    blankLines,
    recordLines: records.length,
    continuationLines,
    messages: messages.length,
    messagesByKind,
    editedMessages: edited,
    systemEvents: systemEvents.length,
    systemEventsByType,
    skippedRecords: skipped,
    format: { platform, dateOrder: decision.order, dateOrderCertainty: decision.certainty, clock },
    warnings: warnings.list(),
  };

  return {
    messages,
    participants,
    systemEvents,
    chatType,
    aliasCandidates: aliasCandidates(participants),
    report,
  };
}
