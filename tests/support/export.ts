/* Synthetic WhatsApp export builders for tests. No real chats.

   Invisible characters are written as escapes so the fixtures say what they
   contain: LRM (U+200E) is what iOS puts before system lines and media
   placeholders; NNBSP (U+202F) is the space iOS writes before AM/PM. */

export const LRM = "\u200e";
export const NNBSP = "\u202f";

/** Android line: "31/12/2023, 21:05 - Alice: text" (sender omitted for system lines). */
export const android = (date: string, time: string, sender: string | null, text: string) =>
  sender === null ? `${date}, ${time} - ${text}` : `${date}, ${time} - ${sender}: ${text}`;

/** iOS line: "[31.12.23, 21:05:33] Alice: text". */
export const ios = (date: string, time: string, sender: string, text: string) =>
  `[${date}, ${time}] ${sender}: ${text}`;

export const lines = (...rows: string[]) => rows.join("\n") + "\n";
