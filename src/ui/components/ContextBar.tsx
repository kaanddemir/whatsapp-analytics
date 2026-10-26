/* Dashboard conversation identity and participant/date controls. */
import type { ParticipantId, ParticipantStats, Stats } from "@/model";
import { formatDate, plural } from "@/i18n/format";
import { DateFilter, ParticipantPicker, chatTitle, type DateSelection } from "./Filters";
import { MessageCircle, Users } from "lucide-react";
import { useI18n } from "@/ui/i18n";

interface Props {
  whole: Stats;
  stats: Stats;
  people: readonly ParticipantStats[];
  dates: DateSelection;
  sender: ParticipantId | null;
  onFilters: (dates: DateSelection, sender: ParticipantId | null) => void;
}

/** Name, imported range and participant count; the imported range, never the selected one. */
function ChatHeading({ whole, people }: { whole: Stats; people: readonly ParticipantStats[] }) {
  const { locale } = useI18n();
  const full = whole.meta.fullRange;
  return (
    <div className="context-chat">
      <span className="chat-mark" aria-hidden="true">{whole.meta.chatType.kind === "group" ? <Users size={18} /> : <MessageCircle size={18} />}</span>
      <div className="context-text">
        <p className="context-title name">{chatTitle(whole, people, locale)}</p>
        <p className="context-meta">
          {formatDate(full.start, locale)} – {formatDate(full.end, locale)}
          {/* A group is already titled "N participants". */}
          {whole.meta.chatType.kind !== "group" && ` · ${plural(people.length, locale === "tr" ? "katılımcı" : "participant", locale === "tr" ? "katılımcı" : "participants", locale)}`}
        </p>
      </div>
    </div>
  );
}

function FilterControls({ stats, people, dates, sender, onFilters }: Omit<Props, "whole">) {
  const { t } = useI18n();
  return (
    <div className="context-filters" role="group" aria-label={t("filters")}>
      <ParticipantPicker stats={stats} people={people} sender={sender} onSender={(s) => onFilters(dates, s)} />
      <DateFilter stats={stats} selection={dates} onApply={(d) => onFilters(d, sender)} />
    </div>
  );
}

export function ContextBar({ whole, ...rest }: Props) {
  const { t } = useI18n();
  return (
    <section className="card context" aria-label={t("chatAndFilters")}>
      <ChatHeading whole={whole} people={rest.people} />
      <FilterControls {...rest} />
    </section>
  );
}
