/* Messages over time, with the granularity menu.
   Daily, weekly and monthly series are all in Stats; the card only picks one.
   Buckets only partly inside the selected dates are drawn dashed. Dense
   series drop markers and smoothing, and the y axis always
   starts at zero so the line cannot exaggerate a change. */
import { useMemo } from "react";
import type { ChartConfiguration } from "chart.js";
import type { Grain, Stats } from "@/model";
import { formatBucket, formatCount, plural } from "../format";
import { ChartCanvas, type Paint } from "../charts/ChartCanvas";
import { DataTable } from "../charts/DataTable";
import { Card, ChartView, Empty, ViewToggle, useView } from "./Card";
import { useI18n } from "../i18n/context";

const DENSE_POINTS = 60;
const GRAINS: readonly Grain[] = ["daily", "weekly", "monthly"];

interface Props {
  stats: Stats;
  grain: Grain;
  onGrain: (grain: Grain) => void;
}

export function TimelineCard({ stats, grain, onGrain }: Props) {
  const { locale, t } = useI18n();
  const series = stats.timeline[grain];
  const labels = useMemo(() => series.buckets.map((b) => formatBucket(b, grain, locale)), [series, grain, locale]);

  const config = useMemo((): ChartConfiguration<"line"> => {
    const dense = series.values.length > DENSE_POINTS;
    const partial = series.partial;
    return {
      type: "line",
      data: {
        labels,
        datasets: [{
          label: t("messages"),
          data: [...series.values],
          fill: true,
          borderWidth: dense ? 1.25 : 2.5,
          tension: dense ? 0 : 0.35,
          pointRadius: dense ? 0 : 3,
          pointHoverRadius: dense ? 3 : 5,
          pointBorderWidth: 2,
          segment: { borderDash: (c) => (partial[c.p0DataIndex] || partial[c.p1DataIndex] ? [5, 4] : undefined) },
        }],
      },
      options: {
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            displayColors: false,
            callbacks: {
              label: (item) => plural(Number(item.raw), locale === "tr" ? "mesaj" : "message", locale === "tr" ? "mesaj" : "messages", locale),
              afterBody: (items) => (items[0] && partial[items[0].dataIndex] ? t("partialTip", { unit: t(grain === "weekly" ? "week" : "month").toLocaleLowerCase(locale === "tr" ? "tr-TR" : "en-US") }) : []),
            },
          },
        },
        scales: {
          x: { grid: { display: false }, border: { display: true }, ticks: { maxTicksLimit: dense ? 8 : 12, autoSkip: true, autoSkipPadding: 12, maxRotation: 0 } },
          y: { beginAtZero: true, border: { display: false }, ticks: { maxTicksLimit: 5, precision: 0, padding: 8, callback: (v) => formatCount(Number(v), locale) }, title: { display: true, text: t("messages") } },
        },
      },
    };
  }, [series, labels, grain, locale, t]);

  const [view, setView] = useView();
  const empty = stats.kpis.totalMessages === 0;
  const paint: Paint = (t) => [{
    borderColor: t.series, backgroundColor: t.fill,
    pointBackgroundColor: t.surface, pointBorderColor: t.series,
    pointHoverBackgroundColor: t.series, pointHoverBorderColor: t.surface,
  }];
  const controls = !empty && (
    <>
      <div className="grain-selector" role="group" aria-label={t("granularity")}>
        {GRAINS.map((g) => (
          <button
            key={g}
            type="button"
            aria-pressed={grain === g}
            onClick={() => onGrain(g)}
          >
            {t(g)}
          </button>
        ))}
      </div>
      <ViewToggle view={view} onView={setView} />
    </>
  );
  const unit = t(grain === "daily" ? "day" : grain === "weekly" ? "week" : "month");

  return (
    <Card cardKey="messages-over-time" controls={controls} className="wide">
      {empty ? (
        <Empty />
      ) : (
        <>
          <ChartView
            view={view}
            height={240}
            chart={() => (
              <ChartCanvas
                config={config}
                paint={paint}
                summary={t("timelineSummary", { unit: unit.toLocaleLowerCase(locale === "tr" ? "tr-TR" : "en-US"), start: labels[0]!, end: labels[labels.length - 1]! })}
              />
            )}
            table={() => (
              <DataTable
                caption={t("messagesPer", { unit: unit.toLocaleLowerCase(locale === "tr" ? "tr-TR" : "en-US") })}
                headers={[unit, t("messages")]}
                rows={series.values.map((v, i) => [labels[i]! + (series.partial[i] ? ` (${t("partial")})` : ""), formatCount(v, locale)])}
              />
            )}
          />
        </>
      )}
    </Card>
  );
}
