/* Date presets, counted back from the LAST day of data, not from today:
   exports are often historical, and "last 7 days" of today would be empty.
   The window includes the
   last day ("7" = the last day and the six before it) and never starts
   before the chat's first day. UTC arithmetic, so the viewer's time zone
   cannot shift the window. */
import type { DatePreset, IsoDate } from "@/model";

const DAY_MS = 86_400_000;

export function presetRange(
  preset: DatePreset,
  fullRange: { readonly start: IsoDate; readonly end: IsoDate },
): { start: IsoDate | null; end: IsoDate | null } {
  if (preset === "all") return { start: null, end: null };
  const end = Date.parse(`${fullRange.end}T00:00:00Z`);
  const start = new Date(end - (Number(preset) - 1) * DAY_MS).toISOString().slice(0, 10);
  return { start: start < fullRange.start ? fullRange.start : start, end: fullRange.end };
}
