/* The dashboard: every card, grouped by the question it answers.

     Overview          headline KPIs, the timeline and the weekly heatmap
     Time patterns     hour of day, weekday averages, streak and busiest window
     Content           message types, media, emojis, keywords
     People            balance, response time, conversation starter, night owl

   The first three follow both filters (dates and participant): that is the
   default and needs no label. People compares participants, so it follows
   the dates only (a balance of one person would always read 100%); its
   header says so, and says why when a participant filter is on. Import
   details live in the chat menu, not here. Every number is read from Stats;
   nothing is recomputed here. */
import type { ReactNode } from "react";
import type { Grain, ParticipantStats, Stats } from "@/model";
import { formatDate } from "@/i18n/format";
import { EmojiCard, KeywordCard, MessageKindsCard } from "./ContentCards";
import { KpiGrid } from "./KpiGrid";
import { ActivityTiles, BalanceCard, InteractionTiles, ResponseTimeCard } from "./PeopleCards";
import { TimelineCard } from "./TimelineCard";
import { HeatmapCard, HourlyCard, WeekdayCard } from "./TimingCards";
import { useI18n } from "@/ui/i18n";

interface Props {
  stats: Stats;
  people: readonly ParticipantStats[];
  grain: Grain;
  onGrain: (grain: Grain) => void;
  onResetFilters: () => void;
}

function Section({ id, title, scopeNote, children }: { id: string; title: string; scopeNote?: string; children: ReactNode }) {
  return (
    <section className="section" aria-labelledby={id}>
      <div className="section-head">
        <h2 id={id}>{title}</h2>
        {scopeNote && <p className="section-note">{scopeNote}</p>}
      </div>
      {children}
    </section>
  );
}

export function Dashboard({ stats, people, grain, onGrain, onResetFilters }: Props) {
  const { locale, t } = useI18n();
  const { meta } = stats;
  const sender = people.find((p) => p.id === meta.activeSender)?.name ?? null;
  const period = meta.range ? `${formatDate(meta.range.start, locale)} – ${formatDate(meta.range.end, locale)}` : null;

  if (!period) {
    return (
      <div className="card notice" role="status">
        <p>{t("noPeriod", { start: formatDate(meta.fullRange.start, locale), end: formatDate(meta.fullRange.end, locale) })}</p>
        <button type="button" className="btn" onClick={onResetFilters}>{t("showWhole")}</button>
      </div>
    );
  }

  return (
    <>
      {meta.empty && (
        <div className="card notice" role="status">
          <p>{sender ? t("personEmpty", { name: sender }) : t("emptyDates")}</p>
          <button type="button" className="btn ghost" onClick={onResetFilters}>{t("resetFilters")}</button>
        </div>
      )}

      <Section id="sec-overview" title={t("overview")}>
        <KpiGrid stats={stats} />
        <div className="grid grid-main">
          <TimelineCard stats={stats} grain={grain} onGrain={onGrain} />
          <HeatmapCard stats={stats} />
        </div>
      </Section>

      <Section id="sec-time" title={t("timePatterns")}>
        <div className="grid grid-time">
          <HourlyCard stats={stats} />
          <WeekdayCard stats={stats} />
          <ActivityTiles stats={stats} />
        </div>
      </Section>

      <Section id="sec-content" title={t("content")}>
        <div className="grid grid-content">
          <MessageKindsCard stats={stats} />
          <EmojiCard stats={stats} />
          <KeywordCard stats={stats} />
        </div>
      </Section>

      <Section
        id="sec-people"
        title={t("peopleInteraction")}
        // Only worth saying when a participant filter is on and seems to be ignored.
        {...(sender ? { scopeNote: t("peopleScope") } : {})}
      >
        <div className="grid grid-people">
          <div className="stack">
            <BalanceCard stats={stats} />
            <InteractionTiles stats={stats} />
          </div>
          <ResponseTimeCard stats={stats} />
        </div>
      </Section>

    </>
  );
}
