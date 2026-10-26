/* The one place Chart.js is touched. Registers only the pieces the dashboard
   uses (line + bar on category/linear axes, tooltip, area fill), so the
   bundle carries nothing else.

   A chart is created when its data/config changes and destroyed on the next
   change and on unmount: Chart.js throws if a canvas is reused, and stale
   instances would leak. A theme change is not a config change: the existing
   instance is repainted from the tokens (paint + shared axis and tooltip
   styling) and updated without animation, so no data is rebuilt.

   The canvas is an image to assistive technology (role="img" + a one-line
   summary); every chart card also offers its numbers as a table. */
import { useI18n } from "@/ui/i18n";
import { useEffect, useRef } from "react";
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Filler,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
  type ChartConfiguration,
  type ChartDataset,
} from "chart.js";
import { useChartTheme, type ChartTheme } from "./chartTheme";

Chart.register(LineController, LineElement, PointElement, BarController, BarElement, CategoryScale, LinearScale, Tooltip, Filler);

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

type Kind = "line" | "bar";
type AnyChart = Chart<Kind>;
/** Theme-dependent dataset properties (colours), one entry per dataset. */
export type Paint = (theme: ChartTheme) => readonly Partial<ChartDataset<Kind>>[];

/** Colours, fonts and tooltip look shared by every chart, from the tokens. */
export function applyChartTheme(chart: AnyChart, theme: ChartTheme, paint: Paint) {
  const styles = paint(theme);
  chart.data.datasets.forEach((ds, i) => Object.assign(ds, styles[i]));
  const o = chart.options;
  o.color = theme.muted;
  o.font = { ...o.font, family: theme.font, size: 11 };
  for (const scale of Object.values(o.scales ?? {})) {
    if (!scale) continue;
    Object.assign(scale.ticks ?? {}, { color: theme.muted });
    if ("title" in scale && scale.title) Object.assign(scale.title, { color: theme.muted });
    if (scale.grid) Object.assign(scale.grid, { color: theme.grid, tickColor: theme.grid });
    if (scale.border) Object.assign(scale.border, { color: theme.grid });
  }
  const tip = o.plugins?.tooltip;
  if (tip) {
    Object.assign(tip, {
      backgroundColor: theme.tooltip,
      titleColor: theme.tooltipText,
      bodyColor: theme.tooltipText,
      footerColor: theme.tooltipText,
      borderWidth: 0,
      cornerRadius: 8,
      padding: { x: 10, y: 8 },
      caretSize: 5,
      titleFont: { family: theme.font, size: 12, weight: 600 },
      bodyFont: { family: theme.font, size: 12 },
      footerFont: { family: theme.font, size: 11 },
    });
  }
}

interface Props {
  /** Built by the caller from Stats; a new object re-creates the chart. */
  config: ChartConfiguration<Kind>;
  /** Colours for each dataset. Read at paint time, so it need not be memoised. */
  paint: Paint;
  /** What the chart shows, for screen readers. */
  summary: string;
  height?: number;
}

export function ChartCanvas({ config, paint, summary, height = 240 }: Props) {
  const { locale } = useI18n();
  const canvas = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<AnyChart | null>(null);
  const paintRef = useRef(paint);
  paintRef.current = paint;
  const theme = useChartTheme();
  const themeRef = useRef(theme);
  themeRef.current = theme;

  useEffect(() => {
    const el = canvas.current;
    // No 2D context (very old browser, test DOM): leave the summary and the
    // data table to carry the content rather than throwing.
    if (!el || !el.getContext("2d")) return;
    const chart = new Chart(el, {
      ...config,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        ...(reducedMotion() ? { animation: false as const } : {}),
        ...config.options,
        locale: locale === "tr" ? "tr-TR" : "en-US",
      },
    } as ChartConfiguration<Kind>) as AnyChart;
    applyChartTheme(chart, themeRef.current, paintRef.current);
    chart.update("none");
    chartRef.current = chart;
    return () => {
      chart.destroy();
      if (chartRef.current === chart) chartRef.current = null;
    };
  }, [config, locale]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    applyChartTheme(chart, theme, paintRef.current);
    chart.update("none");
  }, [theme]);

  return (
    <div className="chart-wrap" style={{ height }}>
      <canvas ref={canvas} role="img" aria-label={summary} />
    </div>
  );
}
