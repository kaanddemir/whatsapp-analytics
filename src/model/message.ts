/* Parsed-message model: the output of the parser and the only input the
   analytics layer accepts. Counterpart of the {dt, sender, text} dicts of
   the former Python parser, plus the classification that code did
   ad hoc inside each metric (media / deleted / system checks), decided once
   here instead. */

/** What a message row is. */
export type MessageKind =
  | "text"
  | "media"        // export placeholder: "image omitted", "<Media omitted>", "<attached: …>"
  | "deleted"      // "This message was deleted" and localized variants
  | "unavailable"; // "Waiting for this message…": content never arrived

/** Media categories, as shown in the dashboard. */
export type MediaKind =
  | "Stickers"
  | "GIFs"
  | "Video notes"
  | "Videos"
  | "Photos"
  | "Voice notes"
  | "Documents"
  | "Contacts"
  | "Other";

/** Index into ParseResult.participants; keeps per-message memory small. */
export type ParticipantId = number;

export interface Message {
  /**
   * Local wall-clock time as written in the export, encoded as milliseconds
   * of a UTC Date. Exports carry no time zone; treating the stamp as UTC keeps
   * hour/weekday bucketing identical to Python's naive datetimes and immune to
   * the viewer's own time zone. Read with getUTC* only.
   */
  readonly ts: number;
  readonly sender: ParticipantId;
  /**
   * Message text with WhatsApp's directional marks removed and the "edited"
   * suffix stripped. For media/deleted/unavailable rows this is the original
   * placeholder text, so it is never mistaken for typed content.
   */
  readonly text: string;
  readonly kind: MessageKind;
  /** Set only when kind === "media". */
  readonly mediaKind?: MediaKind;
  /** The export marked the message "<This message was edited>". */
  readonly edited?: boolean;
}

export interface Participant {
  readonly id: ParticipantId;
  /** Name exactly as exported (marks removed, NFC). Aliases are never merged. */
  readonly name: string;
  /** WhatsApp's built-in assistant: counted in volume, not in interaction metrics. */
  readonly isMetaAI: boolean;
}

/** What a system line was about. Text is not kept. */
export type SystemEventType =
  | "encryption"   // end-to-end encryption and similar chat notices
  | "group"        // membership, subject, icon, description, admin changes
  | "call"         // call records
  | "security"     // security code / phone number changes
  | "disappearing" // disappearing-message settings
  | "unknown";     // a timestamped line with no sender that matched no template

export interface SystemEvent {
  readonly ts: number;
  readonly type: SystemEventType;
}
