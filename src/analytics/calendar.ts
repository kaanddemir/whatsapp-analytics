/* Calendar arithmetic on wall-clock timestamps.

   Message.ts is the export's local time stored as UTC milliseconds, so every
   bucket here reads UTC fields and is immune to the viewer's time zone. Days
   are handled as integer day numbers (days since 1970-01-01). */
import type { IsoDate } from "@/model";

const DAY_MS = 86_400_000;

export const dayOf = (ts: number) => Math.floor(ts / DAY_MS);
const HOUR_MS = 3_600_000;
/** UTC has no DST, so the hour is plain arithmetic. */
export const hourOf = (ts: number) => (((Math.floor(ts / HOUR_MS) % 24) + 24) % 24);
/** 0 = Monday … 6 = Sunday (1970-01-01 was a Thursday). */
export const weekdayOfDay = (day: number) => (((day + 3) % 7) + 7) % 7;
export const isoOfDay = (day: number): IsoDate => new Date(day * DAY_MS).toISOString().slice(0, 10);

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Day number of a valid "YYYY-MM-DD", or null. */
export function dayOfIso(iso: string): number | null {
  const m = ISO_DATE.exec(iso);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isoOfDay(ms / DAY_MS) === iso ? ms / DAY_MS : null;
}

/** Months as year * 12 + month0. */
export const monthOfDay = (day: number) => {
  const d = new Date(day * DAY_MS);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
};
export const firstDayOfMonth = (month: number) => Date.UTC(Math.floor(month / 12), month % 12, 1) / DAY_MS;
export const lastDayOfMonth = (month: number) => firstDayOfMonth(month + 1) - 1;
/** Monday on or before `day`. */
export const weekOfDay = (day: number) => day - weekdayOfDay(day);
