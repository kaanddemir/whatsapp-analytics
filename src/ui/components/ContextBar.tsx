/* The open chat at a glance, with the filters that shape the dashboard.

   Left: which chat this is (name, span, size). Right: the participant and
   date filters. Underneath, only when there is something to say: what is
   applied ("Showing Zeynep · Last 30 days") with a reset, an update in
   progress (so the dashboard never has to dim), and import notes. Import notes (parser warnings) are a
   link to the Import section rather than a banner over the analytics. */
import type { ParticipantId, ParticipantStats, Stats } from "@/model";
import type { LoadSummary } from "@/worker/protocol";
import { formatCount, formatDate, plural } from "../format";
import { ALL_DATES, DateFilter, ParticipantPicker, chatTitle, type DateSelection } from "./Filters";
import { Icon } from "./Icon";
import { importNoteCount } from "../importStatus";
import { useI18n } from "../i18n/context";
import type { Locale } from "../i18n/types";

const PRESET_NAMES: Record<string, string> = {
  "7": "Last 7 days", "30": "Last 30 days", "90": "Last 3 months", "180": "Last 6 months", "365": "Last year",
};

export function describeDates(dates: DateSelection, locale: Locale = "en"): string | null {
  if (dates.preset === "all") return null;
  if (dates.preset) {
    if (locale === "tr") return ({ "7": "Son 7 gün", "30": "Son 30 gün", "90": "Son 3 ay", "180": "Son 6 ay", "365": "Son yıl" } as Record<string, string>)[dates.preset] ?? null;
    return PRESET_NAMES[dates.preset] ?? null;
  }
  return dates.start && dates.end ? `${formatDate(dates.start, locale)} – ${formatDate(dates.end, locale)}` : locale === "tr" ? "Özel aralık" : "Custom range";
}

interface Props {
  whole: Stats;
  stats: Stats;
  people: readonly ParticipantStats[];
  summary: LoadSummary;
  dates: DateSelection;
  sender: ParticipantId | null;
  updating: boolean;
  onFilters: (dates: DateSelection, sender: ParticipantId | null) => void;
  onShowImport: () => void;
}

export function ContextBar({ whole, stats, people, summary, dates, sender, updating, onFilters, onShowImport }: Props) {
  const { locale, t } = useI18n();
  const full = whole.meta.fullRange;
  const person = people.find((p) => p.id === sender)?.name ?? null;
  const dateText = describeDates(dates, locale);
  const notes = importNoteCount(summary);
  const filtered = person !== null || dateText !== null;

  return (
    <section className="card context" aria-label={t("chatAndFilters")}>
      <div className="context-chat">
        <span className="chat-mark" aria-hidden="true"><Icon name={whole.meta.chatType.kind === "group" ? "users" : "logo"} size={20} /></span>
        <div className="context-text">
          <p className="context-title name">{chatTitle(whole, people, locale)}</p>
          <p className="context-meta">
            {formatDate(full.start, locale)} – {formatDate(full.end, locale)}
            {/* A group is already titled "N participants". */}
            {whole.meta.chatType.kind !== "group" && ` · ${plural(people.length, locale === "tr" ? "katılımcı" : "participant", locale === "tr" ? "katılımcı" : "participants", locale)}`}
          </p>
        </div>
      </div>

      <div className="context-filters" role="group" aria-label={t("filters")}>
        <ParticipantPicker stats={stats} people={people} sender={sender} onSender={(s) => onFilters(dates, s)} />
        <DateFilter stats={stats} selection={dates} onApply={(d) => onFilters(d, sender)} />
      </div>

      <div className="context-status" hidden={!filtered && !updating && notes === 0}>
        <p className="applied" aria-live="polite">
          {filtered && (
            <>
              {t("showing")} <b className="name">{person ?? t("everyone").toLocaleLowerCase(locale === "tr" ? "tr-TR" : "en-US")}</b>
              {dateText && <> · <b>{dateText}</b></>}
            </>
          )}
        </p>
        {filtered && (
          <button type="button" className="link-btn" onClick={() => onFilters(ALL_DATES, null)}>{t("resetFilters")}</button>
        )}
        {updating && (
          <span className="updating" role="status"><span className="spinner" aria-hidden="true" /> {t("updating")}</span>
        )}
        {notes > 0 && (
          <button type="button" className="link-btn notes" onClick={onShowImport}>
            <Icon name="warning" size={14} /> {t(notes === 1 ? "importNote" : "importNotes", { count: formatCount(notes, locale) })}
          </button>
        )}
      </div>
    </section>
  );
}
