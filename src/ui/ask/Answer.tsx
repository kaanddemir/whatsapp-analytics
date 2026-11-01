/* One answer, laid out from what the engine returned for it:

     figure    the headline value, when the question asks for one number or date
     text      the engine's sentence(s), unchanged
     rows      bars when the rows are one measure on one scale, else a list
     note      what the figures do not establish, and why only words were searched when the thread
               has not said so yet; before any messages, so it is read first
     messages  the cited evidence, or plan conversations
     footer    how the result was obtained (basis)

   Every part is optional; a plain count is a figure and a sentence. */
import { useState } from "react";
import type { Answer, AnswerRow, Basis } from "@/ask/types";
import type { AnalysisClient } from "@/worker/client";
import type { TranslationKey } from "@/i18n/en";
import { formatCount } from "@/i18n/format";
import { useI18n } from "@/ui/i18n";
import { ChartColumn, EqualApproximately, Info, List, Search, type LucideIcon } from "lucide-react";
import { MessageList, Plans, type LoadMessages } from "./Messages";
import { ROW_LIMIT, barWidths, isTranscript, messageGroups, pageable, rowsView } from "./present";

export type AnswerPort = Pick<AnalysisClient, "context" | "timeline" | "search" | "behaviourEvidence" | "dateEvidence">;

const BASIS_ICON: Record<Exclude<Basis, "none">, LucideIcon> = { count: ChartColumn, match: Search, rule: List, meaning: EqualApproximately };

function Rows({ rows, bars }: { rows: readonly AnswerRow[]; bars: boolean }) {
  const { locale, t } = useI18n();
  const [all, setAll] = useState(false);
  const widths = barWidths(rows);
  // With a leader, only the leader's bar is accented; otherwise every bar is.
  const led = rows.some((r) => r.lead);
  const shown = all ? rows : rows.slice(0, ROW_LIMIT);
  return (
    <div className="ans-rows-wrap">
      <ul className={`ans-rows ${bars ? "bars" : "list"}${led ? " led" : ""}`}>
        {shown.map((r, i) => (
          <li key={`${r.label}-${i}`} className={r.lead ? "lead" : undefined}>
            <span className="row-label name">{r.label}</span>
            {bars && (
              <span className="row-bar" aria-hidden="true">
                <i style={{ width: `${widths[i]}%` }} className={widths[i]! > 0 ? undefined : "zero"} />
              </span>
            )}
            <span className="row-value">
              {r.value}
              {r.detail && <span className="row-detail">{r.detail}</span>}
            </span>
          </li>
        ))}
      </ul>
      {rows.length > ROW_LIMIT && (
        <button type="button" className="link-btn" aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? t("ask.showFewerRows") : t("ask.showAllRows", { count: formatCount(rows.length, locale) })}
        </button>
      )}
    </div>
  );
}

interface Props {
  answer: Answer;
  client: AnswerPort;
  /** Show `answer.meaningNote`; the thread says it once, not under every answer. */
  showMeaningNote: boolean;
}

export function AnswerView({ answer, client, showMeaningNote }: Props) {
  const { t } = useI18n();
  const note = [answer.note, showMeaningNote ? answer.meaningNote : null].filter(Boolean).join(" ");
  const view = rowsView(answer.rows);
  const result = answer.result;
  const groups = messageGroups(answer);
  const BasisIcon = answer.basis === "none" ? null : BASIS_ICON[answer.basis];
  let load: LoadMessages | undefined;
  if (pageable(answer) && result) {
    if (result.kind === "search") load = async (offset, limit) => (await client.search(result.query, result.filters, result.sort, offset, limit)).items;
    else if (result.kind === "behaviour") load = async (offset, limit) => (await client.behaviourEvidence(result.value.behaviour, result.filters.sender, { ...result.filters, sender: null }, offset, limit)).items;
    else if (result.kind === "date") load = async (offset, limit) => (await client.dateEvidence(result.day, result.month, result.year, result.filters, offset, limit)).items;
  }
  return (
    <div className={answer.supported ? "ans" : "ans limited"}>
      {answer.figure && (
        <p className="ans-figure">
          <span className="ans-figure-value">{answer.figure.value}</span>
          <span className="ans-figure-caption">{answer.figure.caption}</span>
        </p>
      )}
      <p className="ans-text">
        {!answer.supported && <Info size={18} />}
        <span>{answer.text}</span>
      </p>
      {view && <Rows rows={answer.rows} bars={view === "bars"} />}
      {note && <p className="ans-note">{note}</p>}
      {result?.kind === "timeline" && result.page && result.page.threads.length > 0 && <Plans result={result} client={client} />}
      {groups.length > 0 && (
        <MessageList groups={groups} total={load ? answer.evidenceTotal : groups.length} load={load} transcript={isTranscript(answer)} client={client} label={t("ask.messages")} />
      )}
      {answer.basis !== "none" && (
        <div className="ans-foot">
          <p className={`ans-basis basis-${answer.basis}`}>
            {BasisIcon && <BasisIcon size={14} />}
            {t(`ask.basis.${answer.basis}` as TranslationKey)}
          </p>
        </div>
      )}
    </div>
  );
}
