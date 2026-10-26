/* When people write: the 7x24 heatmap, the
   hourly distribution and the weekday averages. The heatmap is a real table,
   so it reads cell by cell without a separate data view. */
import { useMemo } from "react";
import type { ChartConfiguration } from "chart.js";
import type { Stats } from "@/model";
import { formatCount, formatDecimal, formatHour, formatHourRange, plural, weekdays, weekdaysShort } from "@/i18n/format";
import { ChartCanvas, type Paint } from "../charts/ChartCanvas";
import { DataTable } from "../charts/DataTable";
import { Card, ChartView, Empty, ViewToggle, useView } from "./Card";
import { useI18n } from "@/ui/i18n";

const HEAT = ["var(--heat-0)", "var(--heat-1)", "var(--heat-2)", "var(--heat-3)", "var(--heat-4)", "var(--heat-5)"];

/**
 * Shade levels by rank (quintiles of the non-zero cells), so one very busy
 * hour does not flatten the rest of the week to the lightest shade.
 */
export function heatLevels(matrix: readonly (readonly number[])[]): (value: number) => number {
  const sorted = matrix.flat().filter((v) => v > 0).sort((a, b) => a - b);
  const cut = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
  const stops = sorted.length ? [cut(0.2), cut(0.4), cut(0.6), cut(0.8)] : [];
  return (v) => (v === 0 ? 0 : 1 + stops.filter((s) => v > s).length);
}

export function HeatmapCard({ stats }: { stats: Stats }) {
  const { locale, t } = useI18n();
  const days = weekdays(locale); const shortDays = weekdaysShort(locale);
  const matrix = stats.timing.heatmap;
  const level = useMemo(() => heatLevels(matrix), [matrix]);
  return (
    <Card cardKey="heatmap" className="heat-card">
      {stats.kpis.totalMessages === 0 ? (
        <Empty />
      ) : (
        <>
          {/* Scrolls sideways on narrow screens rather than shrinking the cells;
              focusable so the scroll is reachable from the keyboard. */}
          <div className="table-scroll" role="region" aria-label={t("heatRegion")} tabIndex={0}>
            <table className="heatmap">
              <caption className="sr-only">{t("heatCaption")}</caption>
              <thead>
                <tr>
                  <td />
                  {Array.from({ length: 24 }, (_, h) => (
                    <th key={h} scope="col" aria-label={formatHour(h, locale)}>
                      <span aria-hidden="true">{h % 6 === 0 ? String(h).padStart(2, "0") : ""}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.map((row, d) => (
                  <tr key={d}>
                    <th scope="row" aria-label={days[d]}>{shortDays[d]}</th>
                    {row.map((v, h) => (
                      <td key={h} style={{ background: HEAT[level(v)] }} title={`${shortDays[d]} ${formatHour(h, locale)} · ${plural(v, locale === "tr" ? "mesaj" : "message", locale === "tr" ? "mesaj" : "messages", locale)}`}>
                        <span className="sr-only">{formatCount(v, locale)}</span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="heat-legend" aria-hidden="true">
            <span className="heat-zero"><i style={{ background: HEAT[0] }} />{t("none")}</span>
            <span>{t("less")}</span>
            {HEAT.slice(1).map((c) => <i key={c} style={{ background: c }} />)}
            <span>{t("more")}</span>
          </div>
        </>
      )}
    </Card>
  );
}

/** Every bar in the series colour, the peak (named in the summary) in the accent. */
const barPaint = (count: number, highlight: number | null): Paint => (t) => [{
  backgroundColor: Array.from({ length: count }, (_, i) => (i === highlight ? t.barPeak : t.bar)),
  hoverBackgroundColor: Array.from({ length: count }, (_, i) => (i === highlight ? t.barPeak : t.series)),
}];

function barConfig(labels: string[], values: number[], yTitle: string, unit: (v: number) => string): ChartConfiguration<"bar"> {
  return {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: yTitle,
        data: values,
        borderRadius: 4,
        borderSkipped: "start",
        maxBarThickness: 28,
      }],
    },
    options: {
      plugins: { legend: { display: false }, tooltip: { displayColors: false, callbacks: { label: (item) => unit(Number(item.raw)) } } },
      scales: {
        x: { grid: { display: false }, border: { display: true }, ticks: { autoSkip: true, autoSkipPadding: 6, maxRotation: 0 } },
        y: { beginAtZero: true, border: { display: false }, ticks: { maxTicksLimit: 5, padding: 8 }, title: { display: true, text: yTitle } },
      },
    },
  };
}

export function HourlyCard({ stats }: { stats: Stats }) {
  const { locale, t } = useI18n();
  const hours = stats.timing.hours;
  const peak = stats.kpis.peakHour;
  const config = useMemo(
    () => barConfig(hours.map((_, h) => String(h).padStart(2, "0")), [...hours], t("messages"), (v) => plural(v, locale === "tr" ? "mesaj" : "message", locale === "tr" ? "mesaj" : "messages", locale)),
    // The peak is painted, not configured, but a new peak needs a fresh chart.
    [hours, peak, locale, t],
  );
  const [view, setView] = useView();
  const empty = stats.kpis.totalMessages === 0;
  return (
    <Card cardKey="hourly" controls={!empty && <ViewToggle view={view} onView={setView} />}>
      {empty ? (
        <Empty />
      ) : (
        <ChartView
          view={view}
          height={200}
          chart={() => <ChartCanvas config={config} paint={barPaint(hours.length, peak)} height={200} summary={t("hourSummary", { peak: peak === null ? "" : t("peak", { range: formatHourRange(peak, 1, locale) }) })} />}
          table={() => <DataTable caption={t("hourCaption")} headers={[t("hour"), t("messages")]} rows={hours.map((v, h) => [formatHourRange(h, 1, locale), formatCount(v, locale)])} />}
        />
      )}
    </Card>
  );
}

export function WeekdayCard({ stats }: { stats: Stats }) {
  const { locale, t } = useI18n();
  const days = weekdays(locale); const shortDays = weekdaysShort(locale);
  const avgs = stats.timing.weekdayAverages;
  const best = stats.insights.busiestWeekday;
  const config = useMemo(
    () => barConfig([...shortDays], [...avgs], t("averageAxis"), (v) => t("averageValue", { value: formatDecimal(v, locale) })),
    [avgs, best, shortDays, locale, t],
  );
  const [view, setView] = useView();
  const empty = stats.kpis.totalMessages === 0;
  return (
    <Card cardKey="weekdays" controls={!empty && <ViewToggle view={view} onView={setView} />}>
      {empty ? (
        <Empty />
      ) : (
        <ChartView
          view={view}
          height={200}
          chart={() => <ChartCanvas config={config} paint={barPaint(avgs.length, best)} height={200} summary={t("weekdaySummary", { busiest: best === null ? "" : t("busiest", { day: days[best]! }) })} />}
          table={() => <DataTable caption={t("weekdayCaption")} headers={[t("weekday"), t("averageMessages")]} rows={avgs.map((v, d) => [days[d]!, formatDecimal(v, locale)])} />}
        />
      )}
    </Card>
  );
}
