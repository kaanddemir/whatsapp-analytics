/* The four KPI cards with their sparklines. Total, active-days and per-day sparks follow the
   monthly series; the peak-hour spark is the 24-hour profile. Sparks need at
   least two points to mean anything. */
import type { Stats } from "@/model";
import { CARD_TITLE_KEYS, type CardKey } from "../cardInfo";
import { formatCount, formatDecimal, formatHour, formatPercent } from "../format";
import { Sparkline } from "../charts/Sparkline";
import { useI18n } from "../i18n/context";

// Sparklines take theme tokens.
const GREEN = "var(--color-accent)";
const AMBER = "var(--participant-6)";
const VIOLET = "var(--participant-2)";

/* Every KPI has the same four rows (title, value, one short line, spark),
   so the cards line up across the row whatever their content. The short
   line is only used where it adds something the title does not say. */
function Kpi({ cardKey, stats, value, sub, spark, color }: {
  cardKey: CardKey; stats: Stats; value: string; sub: string; spark: readonly number[]; color: string;
}) {
  const { t } = useI18n();
  return (
    <section className="card kpi" aria-label={t(CARD_TITLE_KEYS[cardKey])}>
      <h3>{t(CARD_TITLE_KEYS[cardKey])}</h3>
      <p className="kpi-value">{value}</p>
      {/* The row is always there, empty or not, so values and sparks line up. */}
      <p className="kpi-sub">{sub}</p>
      <Sparkline values={stats.kpis.totalMessages >= 2 ? spark : []} color={color} />
    </section>
  );
}

export function KpiGrid({ stats }: { stats: Stats }) {
  const { locale, t } = useI18n();
  const { kpis: k, timeline } = stats;
  const none = k.totalMessages === 0;
  return (
    <div className="kpi-grid">
      <Kpi
        cardKey="total-messages"
        stats={stats}
        value={formatCount(k.totalMessages, locale)}
        sub={t("wordsSub", { words: formatCount(k.totalWords, locale), average: formatDecimal(k.wordsPerMessage, locale) })}
        spark={timeline.monthly.values} color={GREEN} />
      <Kpi cardKey="active-days" stats={stats} value={formatCount(k.activeDays, locale)} sub="" spark={k.activeDaysSeries} color={GREEN} />
      <Kpi cardKey="messages-per-day" stats={stats} value={formatDecimal(k.messagesPerActiveDay, locale)} sub="" spark={k.messagesPerActiveDaySeries} color={AMBER} />
      <Kpi
        cardKey="peak-hour"
        stats={stats}
        value={k.peakHour === null ? "—" : formatHour(k.peakHour, locale)}
        sub={none || k.peakHour === null ? "—" : t("peakShare", { percent: formatPercent(k.peakHourShare, locale) })}
        spark={stats.timing.hours}
        color={VIOLET}
      />
    </div>
  );
}
