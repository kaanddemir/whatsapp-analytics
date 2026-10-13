/* A handful of line icons drawn inline (no icon library): 20x20 grid,
   one 1.5px stroke weight, round caps and joins, in currentColor, so they follow the text colour in both
   themes. Always decorative; the control next to them carries the name. */
const PATHS = {
  logo: "M5.5 3h9A2.5 2.5 0 0 1 17 5.5v7a2.5 2.5 0 0 1-2.5 2.5H14v2.5L11 15H5.5A2.5 2.5 0 0 1 3 12.5v-7A2.5 2.5 0 0 1 5.5 3Z M7 12V10 M10 12V7.5 M13 12V6",
  calendar: "M5.5 5h9a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 15V6.5A1.5 1.5 0 0 1 5.5 5Z M4 8.75h12 M7.5 3.5v3 M12.5 3.5v3",
  users: "M7.5 9a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5Z M2.5 16c.5-2.8 2.5-4.5 5-4.5s4.5 1.7 5 4.5 M13 4a2.5 2.5 0 0 1 0 5 M14.5 11.8c1.6.5 2.7 1.9 3 4.2",
  chevron: "M6 8l4 4 4-4",
  chevronLeft: "M12 5.5 7.5 10l4.5 4.5",
  chevronRight: "M8 5.5l4.5 4.5L8 14.5",
  chart: "M3.5 16.5h13 M6 13.5V10 M10 13.5V5.5 M14 13.5v-5",
  table: "M4.5 4h11A1.5 1.5 0 0 1 17 5.5v9a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5v-9A1.5 1.5 0 0 1 4.5 4Z M3 8h14 M3 12h14 M8 8v8",
  more: "M5 10h.01 M10 10h.01 M15 10h.01",
  upload: "M10 13V4 M6.5 7.5 10 4l3.5 3.5 M4 13v3h12v-3",
  close: "M5.5 5.5l9 9 M14.5 5.5l-9 9",
  warning: "M10 3.5 2.5 16.5h15z M10 8.5v3.5 M10 14.3h.01",
  play: "M7 5l8 5-8 5z",
  shield: "M10 2.75 4 5v4.75c0 3.6 2.55 6.4 6 7.5 3.45-1.1 6-3.9 6-7.5V5z M7.5 10l1.75 1.75L12.75 8",
  file: "M5.5 2.5h6l3 3v12h-9z M11.5 2.5v3h3",
  check: "M4.5 10.5l3.5 3.5 7.5-8",
  logout: "M8 4H4.5v12H8 M12 6.5 15.5 10 12 13.5 M15.5 10H8",
  info: "M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z M10 9.25V13.5 M10 6.6h.01",
  monitor: "M4.5 4h11A1.5 1.5 0 0 1 17 5.5v6.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 12V5.5A1.5 1.5 0 0 1 4.5 4Z M7.5 16.5h5 M10 13.5v3",
  sun: "M10 13.25a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5Z M10 2.5v1.5 M10 16v1.5 M4.7 4.7l1.06 1.06 M14.24 14.24l1.06 1.06 M2.5 10H4 M16 10h1.5 M4.7 15.3l1.06-1.06 M14.24 5.76l1.06-1.06",
  moon: "M16.5 12.2A6.75 6.75 0 0 1 7.8 3.5a6.75 6.75 0 1 0 8.7 8.7Z",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={name === "more" ? 2.4 : 1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}
