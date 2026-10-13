/* Chart colours come from the design tokens in styles.css, never from
   literals here. A canvas cannot resolve var(), so the tokens are read once
   per theme from the root element's computed style.

   The theme is always applied as data-theme on <html> (ThemeSelector also
   does this when Auto follows a system change), so watching that attribute
   is enough to know when charts need repainting. */
import { useSyncExternalStore } from "react";

export interface ChartTheme {
  text: string;
  muted: string;
  grid: string;
  surface: string;
  series: string;
  fill: string;
  bar: string;
  barPeak: string;
  tooltip: string;
  tooltipText: string;
  font: string;
}

const TOKENS: Record<Exclude<keyof ChartTheme, "font">, string> = {
  text: "--color-text-secondary",
  muted: "--color-chart-axis",
  grid: "--color-chart-grid",
  surface: "--color-surface",
  series: "--color-chart-series",
  fill: "--color-chart-fill",
  bar: "--color-chart-bar",
  barPeak: "--color-chart-bar-peak",
  tooltip: "--color-tooltip",
  tooltipText: "--color-tooltip-text",
};

/** Used when no stylesheet is loaded (tests): the light theme's values. */
const FALLBACK: ChartTheme = {
  text: "#4f5751", muted: "#6d756e", grid: "#edf0ed", surface: "#ffffff", series: "#168568", fill: "rgba(22, 133, 104, .1)",
  bar: "#8cc4b0", barPeak: "#168568", tooltip: "#242824", tooltipText: "#ffffff",
  font: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
};

let cached: { key: string; theme: ChartTheme } | null = null;

function themeKey(): string {
  return typeof document === "undefined" ? "" : document.documentElement.dataset.theme ?? "";
}

export function readChartTheme(): ChartTheme {
  const key = themeKey();
  if (cached?.key === key) return cached.theme;
  const theme = { ...FALLBACK };
  if (typeof document !== "undefined") {
    const style = getComputedStyle(document.documentElement);
    for (const [field, token] of Object.entries(TOKENS) as [keyof typeof TOKENS, string][]) {
      const value = style.getPropertyValue(token).trim();
      if (value) theme[field] = value;
    }
  }
  cached = { key, theme };
  return theme;
}

function subscribe(onChange: () => void): () => void {
  if (typeof MutationObserver === "undefined") return () => {};
  const observer = new MutationObserver(() => {
    cached = null;
    onChange();
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

/** The current chart colours; re-renders the caller when the theme changes. */
export function useChartTheme(): ChartTheme {
  return useSyncExternalStore(subscribe, readChartTheme, readChartTheme);
}
