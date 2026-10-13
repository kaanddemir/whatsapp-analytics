/* Deciding what a message body is: typed text, a media/deleted/unavailable
   placeholder, or a system event.

   Placeholders are matched on the whole body, never on a substring, so a
   sentence that merely mentions "video omitted" stays text. A placeholder
   with a prefix (iOS documents: "report.pdf • 6 pages ‎document omitted",
   captioned media) is accepted only when WhatsApp's LRM mark sits directly
   before the placeholder term, which is how iOS writes it.

   System templates come in two strengths (see SYSTEM_TEMPLATES):
   - unambiguous: wording nobody types as a message (call records, the
     encryption notice); always a system event;
   - contextual: group-event wording that ordinary sentences can share
     ("I added sugar", "annem çorbaya tuz ekledi"). These are system events
     only when the parser has supporting evidence (parser/index.ts). */
import type { MediaKind, SystemEventType } from "@/model";
import { LRM, stripMarks } from "./text";

// ---- media placeholders ---------------------------------------------------

/** [label, English terms, Turkish terms]. */
const MEDIA_TERMS: readonly (readonly [MediaKind, readonly string[], readonly string[]])[] = [
  ["Stickers", ["sticker"], ["çıkartma", "sticker"]],
  ["GIFs", ["gif"], ["gif"]],
  ["Video notes", ["video note"], ["video notu"]],
  ["Videos", ["video"], ["video"]],
  ["Photos", ["image", "photo"], ["fotoğraf", "resim", "görüntü"]],
  ["Voice notes", ["audio"], ["ses", "ses kaydı", "sesli mesaj"]],
  ["Documents", ["document"], ["belge", "doküman"]],
  ["Contacts", ["contact card"], ["kişi kartı", "kartvizit"]],
  ["Other", ["media"], ["medya"]],
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const alternation = (terms: readonly string[]) =>
  [...new Set(terms)].sort((a, b) => b.length - a.length).map(escape).join("|");

const EN_TERMS = alternation(MEDIA_TERMS.flatMap(([, en]) => en));
const TR_TERMS = alternation(MEDIA_TERMS.flatMap(([, , tr]) => tr));
// The term and its "omitted" suffix, at the very end of the body.
const PLACEHOLDER_TAIL = new RegExp(String.raw`(?:(${EN_TERMS}) omitted|(${TR_TERMS}) dahil edilmedi)\s*$`, "iu");
// Android "without media": the whole body is "<Media omitted>" (legacy bug C1:
// the leading "<" made the legacy regex miss it). "<Medya atlanmış>" is listed
// by mlomb/chat-analytics; "medya atlandı" comes from the legacy tests.
const ANDROID_OMITTED = /^<\s*(media omitted|medya dahil edilmedi|medya atlandı|medya atlanmış)\s*>$/iu;
// Bracketed per-type variants ("<image omitted>", "<GIF omitted>"), as listed
// by mlomb/chat-analytics for English exports.
const BRACKETED_TERM = new RegExp(String.raw`^<\s*(${EN_TERMS}) omitted\s*>$`, "iu");
// iOS "with media": "<attached: 00000012-PHOTO-2024-01-31-21-05-33.jpg>".
const IOS_ATTACHED = /^<attached: ([^<>]{1,255})>$/iu;
// The same at the end of a document row, which iOS writes as
// "A PDF.pdf • ‎1 page ‎<attached: some-doc.pdf>" (timelinize test fixture).
// Accepted only with the LRM directly before "<attached", like other prefixes.
const IOS_ATTACHED_TAIL = /<attached: ([^<>]{1,255})>$/iu;
// Android "with media": "IMG-20240131-WA0001.jpg (file attached)". A caption
// goes on the following lines (Pustur/whatsapp-chat-parser#260), so only the
// first line has to be the placeholder.
const ANDROID_ATTACHED = /^(.{1,255}?) \((?:file attached|dosya ekli)\)$/iu;

function kindOfTerm(term: string): MediaKind {
  // Both lowercasings: Turkish rules turn "GIF" into "gıf", English ones
  // turn "İ" into "i̇".
  const forms = [term.toLowerCase(), term.toLocaleLowerCase("tr")];
  for (const [label, en, tr] of MEDIA_TERMS) {
    if (forms.some((form) => en.includes(form) || tr.includes(form))) return label;
  }
  return "Other";
}

function kindOfFileName(name: string): MediaKind {
  const n = name.toUpperCase();
  if (/(^|-)(PHOTO|IMG)-|\.(JPE?G|PNG|HEIC|WEBP)$/.test(n) && !/STICKER|STK-/.test(n)) return "Photos";
  if (/(^|-)STICKER-|^STK-|\.WEBP$/.test(n)) return "Stickers";
  if (/(^|-)(VIDEO|VID)-|\.(MP4|MOV|3GP)$/.test(n)) return "Videos";
  if (/(^|-)GIF-|\.GIF$/.test(n)) return "GIFs";
  if (/(^|-)(AUDIO|PTT|AUD)-|\.(OPUS|M4A|MP3|AAC|OGG)$/.test(n)) return "Voice notes";
  if (/\.VCF$/.test(n)) return "Contacts";
  return "Documents";
}

export interface BodyClass {
  readonly kind: "text" | "media" | "deleted" | "unavailable";
  readonly mediaKind?: MediaKind;
}

const DELETED = /^(?:this message was deleted|you deleted this message|this message was deleted by (?:an )?admin.*|bu mesaj silindi|bu mesajı sildiniz)\.?$/iu;
const UNAVAILABLE = /^waiting for this message\b/iu;
const EDITED_SUFFIX = /\s*<(?:this message was edited|bu mesaj düzenlendi)>\s*$/iu;

/** Remove the "<This message was edited>" suffix; report whether it was there. */
export function stripEdited(text: string): { text: string; edited: boolean } {
  const match = EDITED_SUFFIX.exec(text);
  return match ? { text: text.slice(0, match.index), edited: true } : { text, edited: false };
}

/**
 * Classify a single-record body. `raw` still holds WhatsApp's LRM marks;
 * `clean` is the same text with marks removed and the edited suffix stripped.
 */
export function classifyBody(raw: string, clean: string): BodyClass {
  const t = clean.trim();
  if (DELETED.test(t)) return { kind: "deleted" };
  if (UNAVAILABLE.test(t)) return { kind: "unavailable" };
  if (ANDROID_OMITTED.test(t)) return { kind: "media", mediaKind: "Other" };
  const bracketed = BRACKETED_TERM.exec(t);
  if (bracketed?.[1]) return { kind: "media", mediaKind: kindOfTerm(bracketed[1]) };

  const firstLine = t.split("\n", 1)[0] ?? "";
  const attached = IOS_ATTACHED.exec(t) ?? ANDROID_ATTACHED.exec(firstLine.trim());
  if (attached?.[1]) return { kind: "media", mediaKind: kindOfFileName(attached[1]) };
  const attachedTail = IOS_ATTACHED_TAIL.exec(t);
  if (attachedTail?.[1] && raw.toLowerCase().includes(LRM + "<attached:")) {
    return { kind: "media", mediaKind: kindOfFileName(attachedTail[1]) };
  }

  const tail = PLACEHOLDER_TAIL.exec(t);
  if (tail) {
    const term = tail[1] ?? tail[2] ?? "";
    const prefix = t.slice(0, tail.index).trim();
    // A bare placeholder, or one whose term WhatsApp marked with an LRM.
    if (!prefix || markedBeforeTerm(raw, term)) {
      return { kind: "media", mediaKind: kindOfTerm(term) };
    }
  }
  return { kind: "text" };
}

function markedBeforeTerm(raw: string, term: string): boolean {
  return raw.toLowerCase().includes(LRM + term.toLowerCase());
}

// ---- system events --------------------------------------------------------

export interface SystemTemplate {
  readonly type: SystemEventType;
  /** True for wording that cannot plausibly be a typed message. */
  readonly unambiguous: boolean;
  /** Evidence that the chat is a group. */
  readonly group: boolean;
  readonly re: RegExp;
}

const T = (type: SystemEventType, unambiguous: boolean, group: boolean, re: RegExp): SystemTemplate =>
  ({ type, unambiguous, group, re });

export const SYSTEM_TEMPLATES: readonly SystemTemplate[] = [
  // Notices
  T("encryption", true, false, /^messages and calls are end-to-end encrypted\b/iu),
  T("encryption", true, false, /^mesajlar ve aramalar uçtan uca şifrelidir\b/iu),
  T("encryption", true, false, /^only messages that mention or people share with @meta ai can be read by meta\b/iu),
  T("group", true, true, /^you can't send messages to this group because you're no longer a participant\b/iu),
  T("group", true, true, /^artık (?:bu grubun katılımcısı|üye) olmadığınız için\b/iu),
  // Calls
  T("call", true, false, /^missed (?:voice|video|group voice|group video) call\W*$/iu),
  // "Voice call. 5 min" (legacy tests) and "Video call, 5 min" (iOS, timelinize fixture).
  T("call", true, false, /^(?:voice|video) call[.,]?\s*\d+\s*(?:sec|secs|second|seconds|min|mins|minute|minutes|hr|hrs|hour|hours)\b.*$/iu),
  T("call", true, false, /^(?:cevapsız )?(?:sesli|görüntülü) arama\W*$/iu),
  // Security
  T("security", true, false, /^your security code with .{1,100} changed\b/iu),
  T("security", false, false, /^.{1,100} changed (?:their|his|her) phone number\b/iu),
  T("security", false, false, /^.{1,100} changed to .{1,40}$/iu),
  // Group membership and settings (contextual: ordinary sentences can match)
  T("group", false, true, /^you were added$/iu),
  T("group", false, true, /^.{1,100} added .{1,200}$/iu),
  T("group", false, true, /^.{1,100} removed .{1,200}$/iu),
  T("group", false, true, /^.{1,100} left$/iu),
  T("group", false, true, /^.{1,100} joined using this group's invite link$/iu),
  T("group", false, true, /^.{1,100} created (?:the )?group(?: .{1,200})?$/iu),
  T("group", false, true, /^.{1,100} changed (?:the )?(?:group )?(?:subject|description|icon)\b.*$/iu),
  T("group", false, true, /^.{1,100} changed this group's (?:icon|settings)\b.*$/iu),
  T("group", false, true, /^.{1,100} deleted this group's icon$/iu),
  T("group", false, true, /^you're now an admin$/iu),
  T("group", false, true, /^.{1,100} (?:gruba )?ekledi$/iu),
  T("group", false, true, /^.{1,100} gruptan (?:çıkardı|kaldırdı)$/iu),
  T("group", false, true, /^.{1,100} gruptan ayrıldı$/iu),
  T("group", false, true, /^.{1,100} grubu oluşturdu\b.*$/iu),
  T("group", false, true, /^.{1,100} grup (?:başlığını|açıklamasını|simgesini) .{1,200}$/iu),
  // Calls started by a member: a group-call record, but "X started a call" is
  // also something people type.
  T("call", false, false, /^.{1,100} started a (?:voice|video) call$/iu),
  T("call", false, false, /^.{1,100} (?:sesli|görüntülü) arama başlattı$/iu),
  // Disappearing messages
  T("disappearing", false, false, /^.{1,100} turned (?:on|off) disappearing messages\b.*$/iu),
];

export function matchSystem(text: string): SystemTemplate | null {
  const t = stripMarks(text).trim();
  if (!t || t.includes("\n")) return null;
  for (const template of SYSTEM_TEMPLATES) {
    if (template.re.test(t)) return template;
  }
  return null;
}
