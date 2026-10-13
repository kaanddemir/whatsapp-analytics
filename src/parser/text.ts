/* Character-level cleanup shared by the parser stages.

   WhatsApp writes invisible marks into exports: U+200E (LRM) before system
   lines and placeholders on iOS, U+202A/U+202C around phone numbers, and
   U+202F / U+00A0 inside 12-hour times ("9:41 PM"). They must be removed for
   matching, but the LRM is also *evidence*, so callers check for it before
   stripping. */

export const LRM = "‎";

// LRM, the embedding/override controls WhatsApp wraps numbers in, isolates,
// and a stray BOM. U+200F (RLM) is kept: it can be legitimate RTL content.
const DIRECTIONAL = /[‎‪-‮⁦-⁩﻿]/g;
// No-break spaces WhatsApp uses inside times and before AM/PM.
const SPACES = /[   ]/g;

export function stripMarks(value: string): string {
  return value.replace(DIRECTIONAL, "");
}

/** Normalise a raw line for header matching: marks removed, odd spaces as spaces. */
export function cleanLine(line: string): string {
  return stripMarks(line).replace(SPACES, " ");
}

/** Normalise a sender name: marks removed, spaces collapsed, NFC. */
export function cleanName(name: string): string {
  return stripMarks(name).replace(SPACES, " ").replace(/\s+/g, " ").trim().normalize("NFC");
}

/** Whether `raw` begins (after whitespace) with WhatsApp's LRM marker. */
export function startsWithMark(raw: string): boolean {
  return raw.replace(SPACES, " ").trimStart().startsWith(LRM);
}
