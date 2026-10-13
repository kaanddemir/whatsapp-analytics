/* Display rules: engine values -> text. Pure, so the wording is unit-tested
   without rendering anything. The engine never formats; this module and its
   later i18n successor are the only place numbers become strings. */
import type { ParseWarningCode } from "@/model";
import type { Locale } from "./i18n/types";

const intlLocale = (locale: Locale) => locale === "tr" ? "tr-TR" : "en-US";

export function formatCount(value: number, locale: Locale = "en"): string {
  return value.toLocaleString(intlLocale(locale));
}

const WARNING_TEXT: Record<ParseWarningCode, string> = {
  invalid_timestamp: "lines had an impossible date or time and were skipped",
  empty_sender: "messages had no sender name and were skipped",
  orphan_lines: "lines appeared before the first message and were ignored",
  unrecognized_system_lines: "timestamped lines without a sender were not recognised",
  possible_system_event: "messages look like group notices but were kept as messages",
  ambiguous_date_order: "dates could be day-first or month-first; day-first was assumed",
  conflicting_date_order: "dates disagree about day-first or month-first order",
  out_of_order: "messages were out of chronological order and were sorted",
  mixed_platforms: "Android and iPhone line formats were mixed in one file",
};

export function describeWarning(code: ParseWarningCode, count: number, locale: Locale = "en"): string {
  if (locale === "tr") {
    const text: Record<ParseWarningCode, string> = {
      invalid_timestamp: "satırın tarih veya saati geçersiz olduğu için atlandı", empty_sender: "mesajda gönderen adı olmadığı için atlandı",
      orphan_lines: "satır ilk mesajdan önce yer aldığı için yok sayıldı", unrecognized_system_lines: "gönderensiz zaman damgalı satır tanınamadı",
      possible_system_event: "mesaj grup bildirimi gibi görünüyor ancak mesaj olarak tutuldu", ambiguous_date_order: "tarihler gün veya ay önce okunabildiğinden gün önce varsayıldı",
      conflicting_date_order: "tarihlerin gün ve ay sırası birbiriyle uyuşmuyor", out_of_order: "mesaj kronolojik sırada değildi ve sıralandı",
      mixed_platforms: "Android ve iPhone satır biçimleri aynı dosyada karışık kullanılmış",
    };
    return `${formatCount(count, locale)} ${text[code]}`;
  }
  return code === "conflicting_date_order" || code === "mixed_platforms"
    ? WARNING_TEXT[code].replace(/^./, (c) => c.toUpperCase())
    : `${formatCount(count)} ${WARNING_TEXT[code]}`;
}

/**
 * A response-time median. null is "no data" and 0 is a real value (C5).
 * Minute-precision exports cannot resolve seconds, so their values under a
 * minute read as "under 1 min" rather than a false "0s".
 */
export function formatDuration(seconds: number | null, resolution: "minute" | "second", locale: Locale = "en"): string {
  if (seconds === null) return "—";
  if (seconds < 60) return resolution === "minute" ? (locale === "tr" ? "1 dk’dan kısa" : "under 1 min") : `${Math.round(seconds)}${locale === "tr" ? " sn" : "s"}`;
  const s = Math.floor(seconds);
  if (s < 3600) return `${Math.floor(s / 60)}${locale === "tr" ? " dk" : "m"}`;
  if (s < 86400) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return locale === "tr" ? (m ? `${h} sa ${m} dk` : `${h} sa`) : (m ? `${h}h ${m}m` : `${h}h`);
  }
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  return locale === "tr" ? (h ? `${d} g ${h} sa` : `${d} g`) : (h ? `${d}d ${h}h` : `${d}d`);
}

/* ---- Dates and times ----
   Engine dates are wall-clock ISO strings ("2024-01-05"). They are formatted
   in UTC so the viewer's own time zone cannot move a day. */
const utc = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);

/** "Jan 05, 2024", as legacy strftime("%b %d, %Y"). */
export const formatDate = (iso: string, locale: Locale = "en") => new Intl.DateTimeFormat(intlLocale(locale), { month: "short", day: "2-digit", year: "numeric", timeZone: "UTC" }).format(utc(iso));
/** "Jan 2024". */
export const formatMonth = (iso: string, locale: Locale = "en") => new Intl.DateTimeFormat(intlLocale(locale), { month: "short", year: "numeric", timeZone: "UTC" }).format(utc(iso));

/** A timeline bucket label: a day, the week starting that Monday, or a month. */
export function formatBucket(iso: string, grain: "daily" | "weekly" | "monthly", locale: Locale = "en"): string {
  if (grain === "monthly") return formatMonth(iso, locale);
  const date = formatDate(iso, locale);
  return grain === "weekly" ? (locale === "tr" ? `${date} haftası` : `Week of ${date}`) : date;
}

/** "Jan 05 – Jan 09, 2024" within one year, full dates otherwise (legacy streak range). */
export function formatDateRange(start: string, end: string, locale: Locale = "en"): string {
  if (start === end) return formatDate(start, locale);
  const dayMonthFmt = new Intl.DateTimeFormat(intlLocale(locale), { month: "short", day: "2-digit", timeZone: "UTC" });
  return start.slice(0, 4) === end.slice(0, 4)
    ? `${dayMonthFmt.format(utc(start))} – ${formatDate(end, locale)}`
    : `${formatDate(start, locale)} – ${formatDate(end, locale)}`;
}

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
export const WEEKDAYS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export const weekdays = (locale: Locale = "en") => locale === "tr"
  ? ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"] as const : WEEKDAYS;
export const weekdaysShort = (locale: Locale = "en") => locale === "tr"
  ? ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"] as const : WEEKDAYS_SHORT;

/** 14 -> "14:00". */
export const formatHour = (hour: number, _locale: Locale = "en") => `${String(hour).padStart(2, "0")}:00`;
/** 23 -> "23:00–00:00": a whole clock bucket, wrapping at midnight. */
export const formatHourRange = (hour: number, hours = 1, locale: Locale = "en") => `${formatHour(hour, locale)}–${formatHour((hour + hours) % 24, locale)}`;

/** 12.5 -> "12.5%", 12 -> "12%". */
export const formatPercent = (value: number, locale: Locale = "en") => new Intl.NumberFormat(intlLocale(locale), { style: "percent", maximumFractionDigits: 1 }).format(value / 100);

/** 1-decimal engine averages: 12 -> "12", 12.5 -> "12.5". */
export const formatDecimal = (value: number, locale: Locale = "en") => value.toLocaleString(intlLocale(locale), { maximumFractionDigits: 1 });

/**
 * An integer balance share. Rounding can print 0% for someone who did write,
 * or 100% beside someone else; legacy labelled those "<1%" and ">99%".
 */
export function formatShare(share: number, count: number, total: number, locale: Locale = "en"): string {
  // Turkish writes the sign first: %42, <%1.
  const pct = (n: number) => (locale === "tr" ? `%${n}` : `${n}%`);
  if (share === 0 && count > 0) return `<${pct(1)}`;
  if (share === 100 && count < total) return `>${pct(99)}`;
  return pct(share);
}

export const plural = (n: number, one: string, many: string, locale: Locale = "en") => `${formatCount(n, locale)} ${new Intl.PluralRules(intlLocale(locale)).select(n) === "one" ? one : many}`;

/** Avatar initials: two letters of a one-word name, else first letters of two words. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "–";
  const chars = (s: string) => Array.from(s);
  if (parts.length === 1) return chars(parts[0]!).slice(0, 2).join("").toUpperCase();
  return (chars(parts[0]!)[0]! + chars(parts[1]!)[0]!).toUpperCase();
}
