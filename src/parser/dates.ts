/* Turning header date/time parts into timestamps, with the date order decided
   once per file.

   Legacy (parsing.detect_day_first) voted only on dates whose first or second
   part exceeded 12 and otherwise silently assumed D/M/Y, then still let each
   line fall back to the other order when the chosen one failed. Here:

   1. Year-first dates ("2024-01-31") are recognised on their own.
   2. Each candidate order (D/M/Y, M/D/Y) is scored over the whole file: dates
      it makes impossible count heavily, and steps backwards in time count
      lightly, because exports are written in chronological order.
   3. The winning order is applied to every line; there is no per-line
      fallback, which is what mixed calendars in the legacy parser.
   4. The report says whether the order was proven, inferred from chronology,
      or merely assumed. */
import type { DateOrder, DateOrderCertainty } from "@/model";
import type { HeaderMatch } from "./header";

export interface DateDecision {
  readonly order: DateOrder;
  readonly certainty: DateOrderCertainty;
  /** Lines whose dates fit neither order consistently with the rest. */
  readonly conflicting: boolean;
}

interface Ymd { y: number; m: number; d: number }

function fullYear(part: string): number {
  const n = Number(part);
  // WhatsApp exports start in 2009; two-digit years are always 20xx.
  return part.length <= 2 ? 2000 + n : n;
}

function isValidDate({ y, m, d }: Ymd): boolean {
  if (y < 1970 || y > 2100 || m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function isYearFirst(parts: readonly [string, string, string]): boolean {
  return parts[0].length === 4;
}

export function toYmd(parts: readonly [string, string, string], order: DateOrder): Ymd | null {
  const [a, b, c] = parts;
  let ymd: Ymd;
  if (isYearFirst(parts)) {
    if (c.length > 2) return null;
    ymd = { y: Number(a), m: Number(b), d: Number(c) };
  } else {
    if (c.length !== 2 && c.length !== 4) return null;
    const first = Number(a);
    const second = Number(b);
    ymd = order === "mdy"
      ? { y: fullYear(c), m: first, d: second }
      : { y: fullYear(c), m: second, d: first };
  }
  return isValidDate(ymd) ? ymd : null;
}

const dayNumber = ({ y, m, d }: Ymd) => Date.UTC(y, m - 1, d) / 86_400_000;

function score(headers: readonly HeaderMatch[], order: "dmy" | "mdy") {
  let invalid = 0;
  let backwards = 0;
  let previous: number | null = null;
  for (const header of headers) {
    if (isYearFirst(header.dateParts)) continue;
    const ymd = toYmd(header.dateParts, order);
    if (!ymd) {
      invalid++;
      continue;
    }
    const day = dayNumber(ymd);
    if (previous !== null && day < previous) backwards++;
    previous = day;
  }
  return { invalid, backwards };
}

export function decideDateOrder(headers: readonly HeaderMatch[]): DateDecision {
  const ambiguousShape = headers.filter((h) => !isYearFirst(h.dateParts));
  if (ambiguousShape.length === 0) {
    return { order: headers.length ? "ymd" : "dmy", certainty: headers.length ? "proven" : "assumed", conflicting: false };
  }
  const dmy = score(ambiguousShape, "dmy");
  const mdy = score(ambiguousShape, "mdy");

  if (dmy.invalid !== mdy.invalid) {
    const order = dmy.invalid < mdy.invalid ? "dmy" : "mdy";
    // Both orders leave impossible dates: some lines contradict the rest.
    const conflicting = Math.min(dmy.invalid, mdy.invalid) > 0;
    return { order, certainty: "proven", conflicting };
  }
  if (dmy.backwards !== mdy.backwards) {
    return { order: dmy.backwards < mdy.backwards ? "dmy" : "mdy", certainty: "inferred", conflicting: dmy.invalid > 0 };
  }
  return { order: "dmy", certainty: "assumed", conflicting: dmy.invalid > 0 };
}

/** The record's timestamp (wall clock as UTC ms), or null if the time is impossible. */
export function toTimestamp(header: HeaderMatch, order: DateOrder): number | null {
  const ymd = toYmd(header.dateParts, order);
  if (!ymd) return null;
  let { hour } = header;
  const { minute, second, meridiem } = header;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem === "PM" ? 12 : 0);
  } else if (hour > 23) {
    return null;
  }
  if (minute > 59 || second > 59) return null;
  return Date.UTC(ymd.y, ymd.m - 1, ymd.d, hour, minute, second);
}
