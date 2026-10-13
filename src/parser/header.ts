/* Recognising the line that starts a record.

   Android:  "31/12/2023, 21:05 - Alice: text"      (also "12/31/23, 9:05 PM - …")
   iOS:      "[31.12.23, 21:05:33] Alice: text"     (also "[12/31/23, 9:05:33 PM] …")
   ISO-like: "2023-12-31, 21:05 - Alice: text"      (locales that write Y-M-D)

   Stricter header patterns (as the former parser used) required a comma, ":" in
   the time and "/" or "." in the date. This also accepts "-" dates, a missing
   comma, "." in the time ("21.05"), "a. m."/"p.m." markers and the en dash some
   locales write instead of "-". Every quantifier is bounded, so a pathological
   line cannot cause catastrophic backtracking. */

export interface HeaderMatch {
  readonly platform: "android" | "ios";
  /** Date parts as written: [first, second, third] and the separator. */
  readonly dateParts: readonly [string, string, string];
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  /** "AM" | "PM" when the line used a 12-hour marker. */
  readonly meridiem: "AM" | "PM" | null;
  /** Everything after the timestamp: "Sender: text" or a system line. */
  readonly rest: string;
}

const DATE = String.raw`(\d{1,4})([./-])(\d{1,2})\2(\d{1,4})\.?`;
const TIME = String.raw`(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?`;
// AM/PM in English ("AM", "a.m.", "a. m."), Turkish ÖÖ/ÖS.
const MERIDIEM = String.raw`(?:\s?([AaPp]\.?\s?[Mm]\.?|[Öö][ÖöSs]))?`;

const IOS_RE = new RegExp(String.raw`^\[${DATE},?\s{0,3}${TIME}${MERIDIEM}\s{0,3}\]\s?(.*)$`, "s");
const ANDROID_RE = new RegExp(String.raw`^${DATE},?\s{0,3}${TIME}${MERIDIEM}\s{0,3}[-–]\s(.*)$`, "s");

function meridiemOf(token: string | undefined): "AM" | "PM" | null {
  if (!token) return null;
  const t = token.replace(/[\s.]/g, "").toLowerCase();
  if (t === "am" || t === "öö") return "AM";
  if (t === "pm" || t === "ös") return "PM";
  return null;
}

/** Match a cleaned line (see text.cleanLine). Returns null for non-header lines. */
export function matchHeader(line: string): HeaderMatch | null {
  let platform: "android" | "ios" = "ios";
  let m = IOS_RE.exec(line);
  if (!m) {
    platform = "android";
    m = ANDROID_RE.exec(line);
  }
  if (!m) return null;
  const [, a = "", , b = "", c = "", h = "", min = "", s, mer, rest = ""] = m;
  return {
    platform,
    dateParts: [a, b, c],
    hour: Number(h),
    minute: Number(min),
    second: s ? Number(s) : 0,
    meridiem: meridiemOf(mer),
    rest,
  };
}
