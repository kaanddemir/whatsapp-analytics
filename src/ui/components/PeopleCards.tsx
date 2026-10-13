/* Who: message balance, response times and the insight tiles. Balance,
   response time, conversation starter and night owl are interaction
   metrics: they always cover everyone in the selected dates, whatever the
   participant filter says. */
import type { ParticipantId, Stats } from "@/model";
import { formatCount, formatDateRange, formatDuration, formatHourRange, formatPercent, formatShare, plural } from "../format";
import { participantColor } from "../participantColors";
import { Card, Empty, Stat } from "./Card";
import { useI18n } from "../i18n/context";

export function nameOf(stats: Stats, id: ParticipantId | null): string | null {
  if (id === null) return null;
  return stats.participants.find((p) => p.id === id)?.name ?? null;
}

export function BalanceCard({ stats }: { stats: Stats }) {
  const { locale } = useI18n();
  const people = stats.participants;
  const total = people.reduce((a, p) => a + p.messages, 0);
  return (
    <Card cardKey="message-balance" className="wide">
      {people.length === 0 ? (
        <Empty />
      ) : (
        <>
          <div className="balance-bar" aria-hidden="true">
            {people.map((p) => (
              <i key={p.id} style={{ width: `${p.share}%`, background: participantColor(String(p.id)) }} title={`${p.name}: ${formatCount(p.messages, locale)} (${formatShare(p.share, p.messages, total, locale)})`}>
                {p.share >= 8 ? formatShare(p.share, p.messages, total, locale) : ""}
              </i>
            ))}
          </div>
          <ul className="balance-legend">
            {people.map((p) => (
              <li key={p.id}>
                <span className="dot" style={{ background: participantColor(String(p.id)) }} aria-hidden="true" />
                <span className="name">{p.name}</span>
                <span className="muted">{formatCount(p.messages, locale)} · {formatShare(p.share, p.messages, total, locale)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

export function ResponseTimeCard({ stats }: { stats: Stats }) {
  const { locale, t } = useI18n();
  const people = stats.participants;
  const res = stats.meta.timestampResolution;
  return (
    <Card cardKey="response-time" className="response-card">
      {people.length === 0 ? (
        <Empty />
      ) : (
        <div className="table-scroll">
          <table className="plain">
            <caption className="sr-only">{t("responseCaption")}</caption>
            <thead>
              <tr><th scope="col">{t("participant")}</th><th scope="col">{t("median")}</th><th scope="col">{t("repliesMeasured")}</th></tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id}>
                  <th scope="row" className="name">{p.name}</th>
                  <td>{formatDuration(p.responseTime.median, res, locale)}</td>
                  <td>{formatCount(p.responseTime.sampleSize, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function InteractionTiles({ stats }: { stats: Stats }) {
  const { locale, t } = useI18n();
  const { conversationStarter: cs, nightOwl } = stats.insights;
  const starter = nameOf(stats, cs.id);
  const owl = nameOf(stats, nightOwl.id);
  return (
    <div className="card stat-strip">
      <Stat
        cardKey="conversation-starter"
        value={starter ?? "—"}
        sub={starter ? t("starts", { percent: formatCount(cs.share, locale) }) : t("noCompare")}
      />
      <Stat
        cardKey="night-owl"
        value={owl ?? "—"}
        sub={owl ? t("night", { percent: formatPercent(nightOwl.share, locale), messages: plural(nightOwl.count, locale === "tr" ? "mesaj" : "message", locale === "tr" ? "mesaj" : "messages", locale) }) : t("noNight")}
      />
    </div>
  );
}

export function ActivityTiles({ stats }: { stats: Stats }) {
  const { locale, t } = useI18n();
  const { longestStreak: s, mostActiveWindow: w } = stats.insights;
  return (
    <div className="card stat-strip">
      <Stat
        cardKey="longest-streak"
        value={s.days ? plural(s.days, locale === "tr" ? "gün" : "day", locale === "tr" ? "gün" : "days", locale) : "—"}
        sub={s.days && s.start && s.end ? formatDateRange(s.start, s.end, locale) : t("noStreak")}
      />
      <Stat
        cardKey="active-window"
        value={w ? formatHourRange(w.startHour, 4, locale) : "—"}
        sub={w ? t("peakShare", { percent: formatPercent(w.share, locale) }) : t("nothingYet")}
      />
    </div>
  );
}
