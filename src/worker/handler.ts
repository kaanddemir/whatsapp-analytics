/* The worker's request handling, kept free of `self` so it can be unit-tested
   on the main thread or in Node. analysis.worker.ts only wires it up. */
import type { DecodedExport, ParseResult } from "@/model";
import { InputError } from "@/io/errors";
import { decodeExport, validateFileMeta } from "@/io/readExport";
import { AnalysisError, analyze } from "@/analytics";
import { parseExport } from "@/parser";
import type { LoadSummary, WorkerRequest, WorkerResponse } from "./protocol";

type Emit = (response: WorkerResponse) => void;
type Read = (file: File, emit: (stage: "reading" | "decoding") => void) => Promise<DecodedExport>;

/** Replaceable stages, so tests can inject failures and count parses. */
export interface HandlerDeps {
  readonly read?: Read;
  readonly parse?: typeof parseExport;
  readonly analyze?: typeof analyze;
}

const defaultRead: Read = async (file, stage) => {
  validateFileMeta(file);
  stage("reading");
  const bytes = new Uint8Array(await file.arrayBuffer());
  stage("decoding");
  return decodeExport(bytes, file.name);
};

const isoOf = (ts: number) => new Date(ts).toISOString().slice(0, 19);

function summarize(decoded: DecodedExport, parsed: ParseResult): LoadSummary {
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
  };
}

export function createHandler({ read = defaultRead, parse = parseExport, analyze: run = analyze }: HandlerDeps = {}) {
  // The only copy of the chat. Replaced on load, dropped on clear. The decoded
  // text is not kept: parsing produces everything later stages need.
  let current: ParseResult | null = null;

  return async function handle(request: WorkerRequest, emit: Emit): Promise<void> {
    const { id } = request;
    try {
      switch (request.type) {
        case "load": {
          current = null;
          const decoded = await read(request.file, (stage) => emit({ type: "progress", id, stage }));
          emit({ type: "progress", id, stage: "parsing" });
          const parsed = parse(decoded.text);
          if (parsed.messages.length === 0) {
            emit({
              type: "error",
              id,
              code: "no_messages",
              message: "No WhatsApp messages were found in this file.",
              report: parsed.report,
            });
            return;
          }
          current = parsed;
          emit({ type: "loaded", id, summary: summarize(decoded, parsed) });
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
        case "clear": {
          current = null;
          emit({ type: "cleared", id });
          return;
        }
      }
    } catch (error) {
      if (error instanceof InputError) {
        emit({ type: "error", id, code: error.code, message: error.message });
      } else if (error instanceof AnalysisError) {
        emit({ type: "error", id, code: error.code, message: error.message });
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
  };
}
