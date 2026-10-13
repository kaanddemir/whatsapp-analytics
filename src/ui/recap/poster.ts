/* The Recap poster: a fixed 1080x1920 PNG, drawn on a canvas by hand so no
   library is needed and the image is identical whatever the viewport or
   orientation. The same canvas is the finale's on-screen preview, so what
   people see is exactly what they save.

   Privacy: everything stays on the device. Drawing is local; saving is an
   explicit user action that hands a blob: URL to the browser's download
   (allowed by the CSP). With hideNames, people appear only as neutral rank
   aliases and a one-to-one chat is titled generically.

   Composition (top to bottom): a forest band with the kicker, the chat title
   and the 24-hour dial; the total as the one dominant number; the balance
   strip; up to four facts; the product line. Every position comes from LAYOUT. */
import type { Poster } from "./story";
import { DISPLAY_FONT, GROUNDS, PALETTE } from "./tokens";

export const POSTER_W = 1080;
export const POSTER_H = 1920;

export const LAYOUT = {
  margin: 88,
  band: { height: 960 },
  kicker: { y: 150, size: 30, tracking: 6 },
  title: { top: 196, maxSize: 112, minSize: 60, lineHeight: 1.02, maxLines: 2 },
  span: { gap: 22, size: 34 },
  dial: { cx: POSTER_W / 2, cy: 722, inner: 64, outer: 196, ring: 210 },
  total: { baseline: 1190, maxSize: 240, minSize: 120 },
  unit: { baseline: 1252, size: 42 },
  detail: { baseline: 1306, size: 32 },
  strip: { top: 1362, height: 56, gap: 6 },
  legend: { baseline: 1470, size: 30, swatch: 22, max: 3 },
  cells: { top: 1530, rowHeight: 116, gap: 22, labelSize: 24, valueMax: 54, valueMin: 34, tracking: 3, rule: 6 },
  footer: { baseline: 1852, size: 26, tracking: 2 },
} as const;

type Ctx = CanvasRenderingContext2D & { letterSpacing?: string };

const cream = GROUNDS.cream;
const forest = GROUNDS.forest;
const font = (weight: number, size: number) => `${weight} ${size}px ${DISPLAY_FONT}`;
const upper = (text: string, locale: string) => text.toLocaleUpperCase(locale === "tr" ? "tr-TR" : "en-US");

function tracked(ctx: Ctx, px: number) {
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${px}px`;
}

/** Greedy word wrap; a word wider than the line is broken by characters. */
export function wrap(measure: (s: string) => number, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (measure(next) <= width) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = "";
    let piece = "";
    for (const ch of Array.from(word)) {
      if (measure(piece + ch) > width && piece) {
        lines.push(piece);
        piece = "";
      }
      piece += ch;
    }
    line = piece;
  }
  if (line) lines.push(line);
  return lines;
}

/** Wraps into at most maxLines, shrinking the type first and only then ending with an ellipsis. */
export function fitLines(measureAt: (s: string, size: number) => number, text: string, width: number, maxSize: number, minSize: number, maxLines: number): { size: number; lines: string[] } {
  for (let size = maxSize; size >= minSize; size -= 4) {
    const lines = wrap((s) => measureAt(s, size), text, width);
    if (lines.length <= maxLines) return { size, lines };
  }
  const lines = wrap((s) => measureAt(s, minSize), text, width).slice(0, maxLines);
  let last = Array.from(lines[maxLines - 1] ?? "");
  while (last.length > 1 && measureAt(`${last.join("")}…`, minSize) > width) last = last.slice(0, -1);
  lines[maxLines - 1] = `${last.join("")}…`;
  return { size: minSize, lines };
}

function fitOne(ctx: Ctx, text: string, width: number, weight: number, maxSize: number, minSize: number) {
  const r = fitLines((s, size) => ((ctx.font = font(weight, size)), ctx.measureText(s).width), text, width, maxSize, minSize, 1);
  ctx.font = font(weight, r.size);
  return r.lines[0]!;
}

function drawDial(ctx: Ctx, hours: readonly number[], peak: number | null) {
  const { cx, cy, inner, outer, ring } = LAYOUT.dial;
  const max = Math.max(1, ...hours);
  ctx.strokeStyle = forest.muted;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, ring, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
  const half = (Math.PI / 24) * 0.82;
  hours.forEach((v, h) => {
    const a = ((h + 0.5) / 24) * Math.PI * 2 - Math.PI / 2;
    const r = v ? inner + Math.max(6, (v / max) * (outer - inner)) : inner + 2;
    ctx.fillStyle = h === peak ? forest.reveal : forest.fg;
    ctx.globalAlpha = h === peak ? 1 : 0.82;
    ctx.beginPath();
    ctx.arc(cx, cy, r, a - half, a + half);
    ctx.arc(cx, cy, inner, a + half, a - half, true);
    ctx.closePath();
    ctx.fill();
  });
  ctx.globalAlpha = 1;
  ctx.fillStyle = forest.muted;
  ctx.font = font(600, 24);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  [0, 6, 12, 18].forEach((h) => {
    const a = (h / 24) * Math.PI * 2 - Math.PI / 2;
    ctx.fillText(String(h).padStart(2, "0"), cx + Math.cos(a) * (inner - 26), cy + Math.sin(a) * (inner - 26));
  });
  // Everything after the dial is left-aligned on the baseline.
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

/** Draws the poster; null when the browser has no 2D canvas. */
export function drawPoster(poster: Poster, hideNames: boolean): HTMLCanvasElement | null {
  const canvas = document.createElement("canvas");
  canvas.width = POSTER_W;
  canvas.height = POSTER_H;
  const ctx = canvas.getContext("2d") as Ctx | null;
  if (!ctx) return null;
  const L = LAYOUT;
  const M = L.margin;
  const inner = POSTER_W - M * 2;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  // Ground and band.
  ctx.fillStyle = cream.bg;
  ctx.fillRect(0, 0, POSTER_W, POSTER_H);
  ctx.fillStyle = forest.bg;
  ctx.fillRect(0, 0, POSTER_W, L.band.height);

  // Kicker, title, span.
  ctx.fillStyle = forest.reveal;
  ctx.font = font(700, L.kicker.size);
  tracked(ctx, L.kicker.tracking);
  ctx.fillText(upper(poster.kicker, poster.locale), M, L.kicker.y);
  tracked(ctx, 0);
  const title = hideNames ? poster.titleHidden : poster.title;
  const fit = fitLines((s, size) => ((ctx.font = font(800, size)), ctx.measureText(s).width), title, inner, L.title.maxSize, L.title.minSize, L.title.maxLines);
  ctx.fillStyle = forest.fg;
  ctx.font = font(800, fit.size);
  const lh = fit.size * L.title.lineHeight;
  fit.lines.forEach((line, i) => ctx.fillText(line, M, L.title.top + fit.size * 0.85 + i * lh));
  ctx.fillStyle = forest.muted;
  ctx.font = font(500, L.span.size);
  ctx.fillText(poster.span, M, L.title.top + fit.size * 0.85 + (fit.lines.length - 1) * lh + L.span.gap + L.span.size);

  drawDial(ctx, poster.hours, poster.peakHour);

  // The one dominant number.
  ctx.fillStyle = cream.fg;
  ctx.fillText(fitOne(ctx, poster.total, inner, 800, L.total.maxSize, L.total.minSize), M, L.total.baseline);
  ctx.font = font(700, L.unit.size);
  ctx.fillText(poster.totalUnit, M, L.unit.baseline);
  ctx.fillStyle = cream.muted;
  ctx.font = font(500, L.detail.size);
  ctx.fillText(fitOne(ctx, poster.detail, inner, 500, L.detail.size, 22), M, L.detail.baseline);

  // Balance strip: exact shares, ground-coloured gaps so equal colours never merge.
  let cellsTop: number = L.cells.top;
  if (poster.people.length >= 2) {
    const total = poster.people.reduce((a, p) => a + p.messages, 0) / Math.max(1e-9, 1 - poster.othersShare);
    const parts = [...poster.people.map((p) => ({ v: p.messages, color: cream.participants[p.color]! })), ...(poster.othersShare > 0 ? [{ v: total * poster.othersShare, color: cream.muted }] : [])];
    const usable = inner - L.strip.gap * (parts.length - 1);
    let x = M;
    parts.forEach((p) => {
      const w = (p.v / total) * usable;
      ctx.fillStyle = p.color;
      ctx.fillRect(x, L.strip.top, Math.max(w, 2), L.strip.height);
      x += w + L.strip.gap;
    });
    // Legend: the top three, name and share, each in its own column.
    const shown = poster.people.slice(0, L.legend.max);
    const col = inner / shown.length;
    shown.forEach((p, i) => {
      const lx = M + i * col;
      ctx.fillStyle = cream.participants[p.color]!;
      ctx.fillRect(lx, L.legend.baseline - L.legend.swatch, L.legend.swatch, L.legend.swatch);
      ctx.fillStyle = cream.fg;
      ctx.fillText(fitOne(ctx, `${hideNames ? p.alias : p.name} ${p.share}`, col - L.legend.swatch - 24, 700, L.legend.size, 18), lx + L.legend.swatch + 12, L.legend.baseline);
    });
  } else {
    cellsTop = L.strip.top + 20;
  }

  // Facts: two columns, an accent rule over each.
  const colW = (inner - L.cells.gap) / 2;
  poster.cells.forEach((c, i) => {
    const x = M + (i % 2) * (colW + L.cells.gap);
    const y = cellsTop + Math.floor(i / 2) * (L.cells.rowHeight + L.cells.gap);
    ctx.fillStyle = cream.reveal;
    ctx.fillRect(x, y, 56, L.cells.rule);
    ctx.fillStyle = cream.muted;
    ctx.font = font(700, L.cells.labelSize);
    tracked(ctx, L.cells.tracking);
    ctx.fillText(fitOne(ctx, upper(c.label, poster.locale), colW, 700, L.cells.labelSize, 16), x, y + 46);
    tracked(ctx, 0);
    ctx.fillStyle = cream.fg;
    ctx.fillText(fitOne(ctx, c.value, colW, 800, L.cells.valueMax, L.cells.valueMin), x, y + 46 + L.cells.valueMax + 8);
  });

  ctx.fillStyle = cream.muted;
  ctx.font = font(600, L.footer.size);
  tracked(ctx, L.footer.tracking);
  ctx.fillText(fitOne(ctx, poster.footer, inner, 600, L.footer.size, 18), M, L.footer.baseline);
  tracked(ctx, 0);
  ctx.fillStyle = PALETTE.orange;
  ctx.beginPath();
  ctx.arc(POSTER_W - M - 12, L.footer.baseline - 9, 12, 0, Math.PI * 2);
  ctx.fill();
  return canvas;
}

/** Waits for the bundled display face so the first draw is not in a fallback font. */
async function fontsReady() {
  try {
    await Promise.all([800, 700, 500].map((w) => document.fonts?.load(font(w, 64))));
  } catch {
    /* system fallback is fine */
  }
}

const toBlob = (canvas: HTMLCanvasElement) => new Promise<Blob | null>((resolve) => {
  try {
    canvas.toBlob(resolve, "image/png");
  } catch {
    resolve(null);
  }
});

/** The poster as a PNG blob, or null when the browser cannot draw it. */
export async function posterBlob(poster: Poster, hideNames: boolean): Promise<Blob | null> {
  await fontsReady();
  try {
    const canvas = drawPoster(poster, hideNames);
    return canvas ? await toBlob(canvas) : null;
  } catch {
    return null;
  }
}

/** Hands an already-drawn poster to the browser as a local download. */
export function downloadBlob(blob: Blob, name = "whatsapp-recap.png"): boolean {
  try {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    // Firefox ignores click() on a detached anchor.
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return true;
  } catch {
    return false;
  }
}
