/* Date and time expressions in a message, Turkish and English, extracted
   conservatively. Relative-date resolution is not reliable enough for
   calendar claims; only what the text states unambiguously is resolved:

   - absolute dates with a month name ("12 Nisan", "April 12", "12th of
     April", optionally with a year): day and month; the year only when it
     is written. A year is never guessed.
   - numeric dates ("12.04", "25/12/2024"): only when one reading is
     possible (a part above 12 fixes which is the day). "03.04" could be
     3 April or 4 March, so it is marked ambiguous.
   - times "HH:MM": 24-hour times (13:00–23:59, 00:00–00:59 and any leading
     zero) are resolved; with am/pm too. "7:30" alone could be morning or
     evening and is marked so. "15.04" with a dot stays ambiguous between a
     date and a time unless "saat"/"at" precedes it.
   - relative expressions ("yarın", "haftaya salı", "next Friday",
     "tonight", "cmt") are recognised and returned unresolved.

   Spans are offsets into the original message text, for highlighting. */
import { foldAligned } from "@/text/fold";

export type DateKind = "date" | "time" | "relative" | "ambiguous";

export interface DateMention {
  readonly kind: DateKind;
  readonly start: number;
  readonly end: number;
  /** The text as written. */
  readonly text: string;
  /** date: day and month (1-based), year when written. */
  readonly day?: number;
  readonly month?: number;
  readonly year?: number;
  /** time: 24-hour "HH:MM". */
  readonly time?: string;
  /** ambiguous: why. */
  readonly reason?: "day_month_order" | "am_pm" | "date_or_time";
}

const MONTHS: Record<string, number> = {
  ocak: 1, subat: 2, mart: 3, nisan: 4, mayis: 5, haziran: 6, temmuz: 7, agustos: 8, eylul: 9, ekim: 10, kasim: 11, aralik: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
// "mart" is also a word in Turkish only as the month; "may" in English is a verb too, so it needs a day next to it (the pattern always does).
const MONTH_RE = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");
const DAY_IN_MONTH = [0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const validDay = (d: number, m: number) => m >= 1 && m <= 12 && d >= 1 && d <= DAY_IN_MONTH[m]!;
const validYear = (y: number) => y >= 1990 && y <= 2100;

// Day then month name: "12 nisan", "12 nisan'da", "12th april", "12 of april", optional year.
// Turkish case endings may follow the month with or without an apostrophe ("14 şubatta", "12 Nisan'da").
const TR_CASE = "(?:'?(?:ta|te|da|de|tan|ten|dan|den|a|e|ya|ye|in|un|nin|nun))?";
const DAY_MONTH = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?\\s+(${MONTH_RE})${TR_CASE}\\b\\.?(?:[\\s,]+(\\d{4}))?`, "g");
// Month name then day: "april 12", "april 12th, 2025".
const MONTH_DAY = new RegExp(`\\b(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`, "g");
// Numeric: d.m, d/m, d.m.yyyy (also with -).
const NUMERIC = /(?<![\d.:/-])(\d{1,2})([./-])(\d{1,2})(?:\2(\d{2}|\d{4}))?(?![\d.:/]|-\d)/g;
// Times with a colon, optional am/pm.
const TIME = /(?<![\d:])([01]?\d|2[0-3]):([0-5]\d)(?!\d|:\d)(\s?(am|pm|a\.m\.|p\.m\.))?/g;
// "saat 19.30" / "at 19.30": a dotted time introduced as a time.
const DOTTED_TIME = /\b(saat|at)\s+([01]?\d|2[0-3])\.([0-5]\d)\b/g;
// Hour with am/pm: "7pm", "8 am".
const HOUR_AMPM = /(?<![\d:.])(1[0-2]|0?[1-9])\s?(am|pm)\b/g;

const RELATIVE_TR = "bugun|yarin|obur gun|ertesi gun|dun|bu aksam|yarin aksam|bu gece|haftaya|gelecek hafta|onumuzdeki hafta|hafta ?sonu|bu hafta|ay sonu|seneye|gecen hafta|pazartesi|sali|carsamba|persembe|cuma|cumartesi|pazar|pzt|sal|crs|car|prs|per|cum|cmt|cts|paz";
const RELATIVE_EN = "today|tonight|tomorrow|tmrw|tmr|yesterday|day after tomorrow|next week|this week|next weekend|this weekend|weekend|next month|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun";
// "pazar" (Sunday) is also "market"; "sal"/"per"/"sun"/"sat"/"wed"/"mar" are words too: abbreviations only count with a time or "günü".
const AMBIGUOUS_WORDS = new Set(["pazar", "sal", "per", "cum", "sun", "sat", "wed", "mon", "car", "paz"]);
const RELATIVE_WORDS = `${RELATIVE_TR}|${RELATIVE_EN}`.split("|").sort((a, b) => b.length - a.length).join("|");
const RELATIVE = new RegExp(`\\b(?:(?:next|this|gelecek|bu|haftaya)\\s+)?(${RELATIVE_WORDS})\\b(?:'?(?:da|de|ta|te|ya|ye|ki|dan|den))?`, "g");

function overlaps(spans: DateMention[], a: number, b: number) {
  return spans.some((s) => a < s.end && s.start < b);
}

export function extractDates(text: string): DateMention[] {
  const f = foldAligned(text);
  const out: DateMention[] = [];
  const push = (m: DateMention) => { if (!overlaps(out, m.start, m.end)) out.push(m); };
  const slice = (a: number, b: number) => text.slice(a, b);

  for (const m of f.matchAll(DAY_MONTH)) {
    const day = Number(m[1]), month = MONTHS[m[2]!]!, year = m[3] ? Number(m[3]) : undefined;
    if (m[2] === "may" && !/\d/.test(m[1]!)) continue;
    if (!validDay(day, month) || (year !== undefined && !validYear(year))) continue;
    const a = m.index!, b = a + m[0].length;
    push({ kind: "date", start: a, end: b, text: slice(a, b), day, month, ...(year ? { year } : {}) });
  }
  for (const m of f.matchAll(MONTH_DAY)) {
    const month = MONTHS[m[1]!]!, day = Number(m[2]), year = m[3] ? Number(m[3]) : undefined;
    // "may" before a number is usually the verb ("you may 2 …"); only a capitalised "May" is the month here.
    if (m[1] === "may" && text[m.index!] !== "M") continue;
    if (!validDay(day, month) || (year !== undefined && !validYear(year))) continue;
    const a = m.index!, b = a + m[0].length;
    push({ kind: "date", start: a, end: b, text: slice(a, b), day, month, ...(year ? { year } : {}) });
  }
  for (const m of f.matchAll(DOTTED_TIME)) {
    const a = m.index! + m[1]!.length + 1, b = m.index! + m[0].length;
    push({ kind: "time", start: a, end: b, text: slice(a, b), time: `${m[2]!.padStart(2, "0")}:${m[3]}` });
  }
  for (const m of f.matchAll(TIME)) {
    const a = m.index!, b = a + m[0].length;
    let h = Number(m[1]);
    const mm = m[2]!, suffix = m[4];
    if (suffix) {
      if (h > 12 || h === 0) continue; // "15:00 pm" is not a time anyone means
      if (suffix.startsWith("p") && h < 12) h += 12;
      if (suffix.startsWith("a") && h === 12) h = 0;
      push({ kind: "time", start: a, end: b, text: slice(a, b), time: `${String(h).padStart(2, "0")}:${mm}` });
    } else if (h >= 13 || m[1]!.startsWith("0") || h === 0) {
      push({ kind: "time", start: a, end: b, text: slice(a, b), time: `${String(h).padStart(2, "0")}:${mm}` });
    } else {
      push({ kind: "ambiguous", start: a, end: b, text: slice(a, b), reason: "am_pm" });
    }
  }
  for (const m of f.matchAll(HOUR_AMPM)) {
    const a = m.index!, b = a + m[0].length;
    let h = Number(m[1]);
    if (m[2] === "pm" && h < 12) h += 12;
    if (m[2] === "am" && h === 12) h = 0;
    push({ kind: "time", start: a, end: b, text: slice(a, b), time: `${String(h).padStart(2, "0")}:00` });
  }
  for (const m of f.matchAll(NUMERIC)) {
    const a = m.index!, b = a + m[0].length;
    if (overlaps(out, a, b)) continue;
    const x = Number(m[1]), y = Number(m[3]), sep = m[2]!;
    const yearText = m[4];
    const year = yearText ? (yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText)) : undefined;
    if (year !== undefined && !validYear(year)) continue;
    // A decimal with a unit is a quantity: "2.5 milyon", "1,5 kg", "3.2 km".
    if (/^\s*(milyon|milyar|bin|tl|lira|euro|dolar|kg|km|gb|mb|%|percent|million|billion|k\b)/.test(f.slice(b, b + 10))) continue;
    const dm = validDay(x, y), md = validDay(y, x);
    if (!dm && !md) continue;
    // "15.04" with no year: a date or a time (15:04)? Unless the context says which, leave it.
    if (sep === "." && !yearText && x <= 23 && y <= 59 && !/\b(ayin|tarih|tarihinde|on the)\b/.test(f.slice(Math.max(0, a - 12), a))) {
      push({ kind: "ambiguous", start: a, end: b, text: slice(a, b), reason: "date_or_time" });
      continue;
    }
    if (dm && md && x !== y) {
      push({ kind: "ambiguous", start: a, end: b, text: slice(a, b), reason: "day_month_order" });
      continue;
    }
    const [day, month] = dm ? [x, y] : [y, x];
    push({ kind: "date", start: a, end: b, text: slice(a, b), day, month, ...(year ? { year } : {}) });
  }
  for (const m of f.matchAll(RELATIVE)) {
    const word = m[1]!;
    const a = m.index!, b = a + m[0].length;
    if (AMBIGUOUS_WORDS.has(word) && !/\b(gunu|günü|aksam|sabah|ogle|gece)\b/.test(f.slice(b, b + 10)) && !out.some((o) => o.kind === "time" || o.kind === "ambiguous")) continue;
    push({ kind: "relative", start: a, end: b, text: slice(a, b) });
  }
  return out.sort((p, q) => p.start - q.start);
}
