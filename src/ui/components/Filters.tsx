/* The two filters: the participant picker in the chat
   chip, and the date range with presets. A preset only fills the From/To
   fields; nothing is re-analysed until Apply. Both filters are
   always sent together, so changing one never drops the other. */
import { useEffect, useState } from "react";
import type { DatePreset, IsoDate, ParticipantId, ParticipantStats, Stats } from "@/model";
import { presetRange } from "@/lib/presets";
import { formatCount, formatDate, formatShare, initials } from "../format";
import { Icon } from "./Icon";
import { Popover } from "./Popover";
import { participantColor } from "../participantColors";
import { useI18n } from "../i18n/context";
import type { Locale } from "../i18n/types";

export interface DateSelection {
  /** null = a custom range typed by hand. */
  readonly preset: DatePreset | null;
  readonly start: IsoDate | null;
  readonly end: IsoDate | null;
}

export const ALL_DATES: DateSelection = { preset: "all", start: null, end: null };

interface ParticipantProps {
  stats: Stats;
  /** Everyone in the whole chat, so a person stays pickable when a date range leaves them out. */
  people: readonly ParticipantStats[];
  sender: ParticipantId | null;
  onSender: (sender: ParticipantId | null) => void;
  disabled?: boolean;
}

export function chatTitle(stats: Stats, people: readonly ParticipantStats[], locale: Locale = "en"): string {
  if (stats.meta.chatType.kind === "group") return locale === "tr" ? `${formatCount(people.length, locale)} katılımcı` : `${formatCount(people.length, locale)} participants`;
  // Legacy: a one-to-one chat is named after the other person, the last
  // first-seen sender (the export's owner usually writes first).
  const order = stats.meta.participants;
  const last = order[order.length - 1];
  return people.find((p) => p.id === last)?.name ?? people[0]?.name ?? (locale === "tr" ? "Sohbet" : "Chat");
}

export function ParticipantPicker({ stats, people, sender, onSender, disabled = false }: ParticipantProps) {
  const { locale, t } = useI18n();
  const selected = people.find((p) => p.id === sender) ?? null;
  const label = selected ? selected.name : chatTitle(stats, people, locale);
  const inRange = new Map(stats.participants.map((p) => [p.id, p]));
  const total = stats.participants.reduce((a, p) => a + p.messages, 0);
  return (
    <Popover
      label={selected ? t("participantNamed", { name: selected.name }) : t("participantEveryone")}
      title={t("participant")}
      trigger={
        <>
          {selected
            ? <span className="avatar" aria-hidden="true" style={{ background: participantColor(String(selected.id)) }}>{initials(selected.name)}</span>
            : <Icon name="users" size={16} />}
          <span className="pill-text">{selected ? label : t("everyone")}</span>
          <Icon name="chevron" size={14} />
        </>
      }
      triggerClassName={`pill${selected ? " filtered" : ""}`}
      panelClassName="people-pop"
      disabled={disabled}
    >
      {(close) => {
        const pick = (id: ParticipantId | null) => {
          if (id !== sender) onSender(id);
          close();
        };
        return (
          <>
            <p className="pop-lede">{t("showActivity")}</p>
            <ul className="pick-list">
              <li>
                <button type="button" aria-pressed={sender === null} onClick={() => pick(null)}>
                  <span className="dot all" aria-hidden="true" />
                  <span className="name">{t("everyone")}</span>
                  <span className="muted">{formatCount(stats.meta.conversationTotal, locale)}</span>
                </button>
              </li>
              {people.map((p) => {
                const now = inRange.get(p.id);
                return (
                  <li key={p.id}>
                    <button type="button" aria-pressed={sender === p.id} onClick={() => pick(p.id)}>
                      <span className="dot" style={{ background: participantColor(String(p.id)) }} aria-hidden="true" />
                      <span className="name">{p.name}</span>
                      <span className="muted">
                        {now ? `${formatCount(now.messages, locale)} · ${formatShare(now.share, now.messages, total, locale)}` : t("noneInDates")}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        );
      }}
    </Popover>
  );
}

interface DateProps {
  stats: Stats;
  selection: DateSelection;
  onApply: (selection: DateSelection) => void;
  disabled?: boolean;
}

export function DateFilter({ stats, selection, onApply, disabled = false }: DateProps) {
  const { locale, t } = useI18n();
  const range = stats.meta.range;
  const label = range ? `${formatDate(range.start, locale)} – ${formatDate(range.end, locale)}` : t("noMessagesDates");
  return (
    <Popover
      label={t("dateRangeLabel", { range: label })}
      title={t("dateRange")}
      trigger={
        <>
          <Icon name="calendar" size={16} />
          <span className="pill-text">{label}</span>
          <Icon name="chevron" size={14} />
        </>
      }
      triggerClassName={`pill${selection.preset === "all" ? "" : " filtered"}`}
      panelClassName="date-pop"
      disabled={disabled}
    >
      {(close) => <DatePanel stats={stats} selection={selection} onApply={(s) => { onApply(s); close(); }} />}
    </Popover>
  );
}

function DatePanel({ stats, selection, onApply }: { stats: Stats; selection: DateSelection; onApply: (s: DateSelection) => void }) {
  const { locale, t } = useI18n();
  const presets: readonly { id: DatePreset; label: string; name: string }[] = [
    { id: "7", label: locale === "tr" ? "7g" : "7d", name: locale === "tr" ? "Sohbetin son 7 günü" : "Last 7 days of the chat" }, { id: "30", label: locale === "tr" ? "30g" : "30d", name: locale === "tr" ? "Sohbetin son 30 günü" : "Last 30 days of the chat" },
    { id: "90", label: locale === "tr" ? "3a" : "3m", name: locale === "tr" ? "Sohbetin son 3 ayı" : "Last 3 months of the chat" }, { id: "180", label: locale === "tr" ? "6a" : "6m", name: locale === "tr" ? "Sohbetin son 6 ayı" : "Last 6 months of the chat" }, { id: "365", label: "1y", name: locale === "tr" ? "Sohbetin son yılı" : "Last year of the chat" },
    { id: "all", label: t("all"), name: t("wholeChat") },
  ];
  const full = stats.meta.fullRange;
  const current = stats.meta.range ?? full;
  const [preset, setPreset] = useState<DatePreset | null>(selection.preset);
  const [start, setStart] = useState<string>(current.start);
  const [end, setEnd] = useState<string>(current.end);
  useEffect(() => {
    setPreset(selection.preset);
    setStart(current.start);
    setEnd(current.end);
  }, [selection, current.start, current.end]);

  const stage = (p: DatePreset) => {
    setPreset(p);
    const r = presetRange(p, full);
    setStart(r.start ?? full.start);
    setEnd(r.end ?? full.end);
  };
  const invalid = !start || !end ? t("chooseBoth") : start > end ? t("startAfterEnd") : null;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (invalid) return;
        onApply(preset === "all" ? ALL_DATES : preset ? { preset, ...presetRange(preset, full) } : { preset: null, start, end });
      }}
    >
      <div className="presets" role="group" aria-label={t("presetsLabel")}>
        {presets.map((p) => (
          <button key={p.id} type="button" className="seg" aria-pressed={preset === p.id} aria-label={p.name} onClick={() => stage(p.id)}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="date-fields">
        <label>
          {t("from")}
          <input type="date" value={start} min={full.start} max={full.end} required onChange={(e) => { setPreset(null); setStart(e.target.value); }} />
        </label>
        <label>
          {t("to")}
          <input type="date" value={end} min={full.start} max={full.end} required onChange={(e) => { setPreset(null); setEnd(e.target.value); }} />
        </label>
      </div>
      {invalid && <p className="error" role="alert">{invalid}</p>}
      <div className="row-actions">
        <button type="button" className="btn ghost" onClick={() => onApply(ALL_DATES)}>{t("reset")}</button>
        <button type="submit" className="btn" disabled={invalid !== null}>{t("apply")}</button>
      </div>
    </form>
  );
}
