/* Contracts shared by keyword/semantic search, behaviour, timeline and Ask.

   A message is cited by its number: the index into ParseResult.messages. The
   parser sorts messages stably by time, so the number is stable for a given
   export text, parser version and date order; a chat kept on the device is
   re-parsed from the same text, so its numbers do not change on reload. */
import type { MessageKind, ParticipantId } from "@/model";

export type MessageId = number;

/** One message as the UI may show it: exactly the stored text, never rewritten. */
export interface MessageView {
  readonly id: MessageId;
  /** Wall-clock time as written in the export, "YYYY-MM-DDTHH:MM:SS". */
  readonly at: string;
  readonly sender: ParticipantId;
  readonly senderName: string;
  readonly kind: MessageKind;
  /** The message text; for media/deleted/unavailable rows, the export's placeholder. */
  readonly text: string;
  readonly edited: boolean;
}

/** A cited message, with the spans of `message.text` that matched, if any. */
export interface Evidence {
  readonly message: MessageView;
  readonly highlights: readonly (readonly [number, number])[];
}
