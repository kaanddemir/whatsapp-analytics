/* Recap design tokens: Warm Editorial + Playful Geometric.

   One source of truth for the on-screen scenes (written onto the Recap root
   as CSS custom properties) and the canvas poster (read directly), so the two
   can never drift. Every ground lists the colours that may be drawn on it;
   the contrast rules are asserted in tests/recap/recap.test.ts:
   - fg and muted are text: at least 4.5:1 on the ground;
   - reveal and support mark data (peaks, night): at least 3:1 (WCAG 1.4.11),
     and reveal is only used for text at display sizes;
   - participant colours are data marks: at least 3:1.
   Orange (#E8743B) is only 2.6:1 on cream, so cream scenes reveal with a
   deeper burnt orange of the same hue. */

export const PALETTE = {
  cream: "#F4EEE1",
  ink: "#1A1A17",
  orange: "#E8743B",
  burnt: "#B0501F",
  plum: "#6E5A8A",
  lilac: "#B9A6D6",
  forest: "#12382B",
} as const;

/** The dashboard's participant colours (styles.css --participant-0..7), light
    then dark theme. Recap indexes them with the same stable hash, so a person
    keeps their colour between the dashboard and the story. */
export const PARTICIPANT_LIGHT = ["#147a62", "#356fa3", "#7559a6", "#a15c3e", "#537c2e", "#9a5577", "#8a650e", "#486d73"] as const;
export const PARTICIPANT_DARK = ["#57c9a4", "#75aee0", "#aa91dc", "#dc9272", "#91bd61", "#d68db2", "#d5ae52", "#7fb3ba"] as const;

export type Ground = "cream" | "forest" | "ink";

export interface GroundTokens {
  readonly bg: string;
  readonly fg: string;
  readonly muted: string;
  /** The reveal accent: peaks and the one number that matters. */
  readonly reveal: string;
  /** Text drawn on a reveal-coloured fill. */
  readonly onReveal: string;
  /** Restrained secondary data colour (night). */
  readonly support: string;
  readonly participants: readonly string[];
}

export const GROUNDS: Readonly<Record<Ground, GroundTokens>> = {
  cream: { bg: PALETTE.cream, fg: PALETTE.ink, muted: "#5C574C", reveal: PALETTE.burnt, onReveal: PALETTE.cream, support: PALETTE.plum, participants: PARTICIPANT_LIGHT },
  forest: { bg: PALETTE.forest, fg: PALETTE.cream, muted: "#BFCBBF", reveal: PALETTE.orange, onReveal: PALETTE.ink, support: PALETTE.lilac, participants: PARTICIPANT_DARK },
  ink: { bg: PALETTE.ink, fg: PALETTE.cream, muted: "#B9B3A6", reveal: PALETTE.orange, onReveal: PALETTE.ink, support: PALETTE.lilac, participants: PARTICIPANT_DARK },
};

/** The ground's tokens as the CSS custom properties recap.css reads. */
export function groundVars(ground: Ground): Record<string, string> {
  const g = GROUNDS[ground];
  const vars: Record<string, string> = {
    "--rc-bg": g.bg, "--rc-fg": g.fg, "--rc-muted": g.muted,
    "--rc-reveal": g.reveal, "--rc-on-reveal": g.onReveal, "--rc-support": g.support,
  };
  g.participants.forEach((c, i) => (vars[`--rc-p${i}`] = c));
  return vars;
}

export const DISPLAY_FONT = `"Recap Display", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"`;

/** Scene hold times (ms) for autoplay. A figure finishes building well inside
    its scene's hold, so the last beat is always readable before advancing. */
export const DURATION = {
  opening: 4200,
  volume: 5600,
  timeline: 5600,
  divider: 2400,
  clock: 6000,
  week: 6800,
  balance: 6200,
  behaviorOne: 5200,
  behaviorTwo: 7800,
  shared: 6000,
  words: 5600,
  highlight: 6000,
} as const;

/** WCAG relative luminance contrast of two #rrggbb colours. */
export function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
