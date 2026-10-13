/* One line icon per media type, drawn inside the Recap's media tiles. */
import type { MediaKind } from "@/model";

const PATHS: Record<MediaKind, string> = {
  Photos: "M4 7h3l2-2h6l2 2h3v12H4zM12 10a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7",
  Videos: "M3 6h13v12H3zM16 10l5-3v10l-5-3",
  "Video notes": "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M10 8.5v7l6-3.5z",
  "Voice notes": "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3M5 11a7 7 0 0 0 14 0M12 18v3",
  Stickers: "M4 4h11l5 5v11H4zM15 4v5h5M8.5 14a4 4 0 0 0 7 0",
  GIFs: "M3 6h18v12H3zM10 10H7.5v4H10v-2M13 10v4M16 14v-4h2.5M16 12h2",
  Documents: "M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6",
  Contacts: "M12 4a4 4 0 1 0 0 8a4 4 0 1 0 0-8M4 21a8 8 0 0 1 16 0",
  Other: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
};

export function MediaIcon({ kind }: { kind: MediaKind }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={PATHS[kind] ?? PATHS.Other} /></svg>;
}
