/* One answer, laid out from what the engine returned for it:

     figure    the headline value, when the question asks for one number or date
     text      the engine's sentence(s), unchanged
     rows      bars when the rows are one measure on one scale, else a list
     note      what the figures do not establish; before any messages, so it is read first
     messages  the cited evidence, or plan conversations
     footer    how the result was obtained (basis), and enabling search by meaning when it would help

   Every part is optional; a plain count is a figure and a sentence. */
import { useState } from "react";
import type { Answer, AnswerRow, Basis } from "@/ask/types";
import type { AnalysisClient } from "@/worker/client";
import type { SemanticState } from "@/semantic/indexer";
import type { TranslationKey } from "@/i18n/en";
import { formatCount } from "@/i18n/format";
import { useI18n } from "@/ui/i18n";
import { ChartColumn, EqualApproximately, Info, List, RotateCcw, Search, type LucideIcon } from "lucide-react";
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

function percent(state: SemanticState): number | null {
  if (state.status === "indexing" || state.status === "paused") return state.total ? Math.floor((state.done / state.total) * 100) : 0;
  return null;
}

/** Offered when only the question's words were searched and search by meaning could still be prepared. */
function MeaningAction({ semantic, onEnable, onAskAgain }: { semantic: SemanticState; onEnable: () => void; onAskAgain: () => void }) {
  const { t } = useI18n();
  switch (semantic.status) {
    case "preparing":
      return <p className="ans-action" role="status"><span className="spinner" aria-hidden="true" />{t("ask.meaningPreparing")}</p>;
    case "indexing":
      return <p className="ans-action" role="status"><span className="spinner" aria-hidden="true" />{t("ask.meaningIndexing", { percent: percent(semantic) ?? 0 })}</p>;
    case "ready":
      return (
        <div className="ans-action">
          <p>{t("ask.meaningReady")}</p>
          <button type="button" className="btn ghost" onClick={onAskAgain}><RotateCcw size={16} />{t("ask.retry")}</button>
        </div>
      );
    case "failed":
      if (semantic.reason === "too_large" || semantic.reason === "unsupported") return <p className="ans-action muted">{t("ask.meaningFailed")}</p>;
      break;
    default:
  }
  // A failure that trying again may fix (a file that did not load, memory, storage) is said, not hidden behind the same button.
  const retry = semantic.status === "failed";
  return (
    <div className="ans-action">
      <button type="button" className="btn ghost" onClick={onEnable}>
        {retry ? <RotateCcw size={16} /> : <EqualApproximately size={16} />}
        {retry ? t("ask.meaningTryAgain") : semantic.status === "paused" ? t("ask.meaningResume") : t("ask.enableMeaning")}
      </button>
      <p className={retry ? "ans-action-error" : "muted"} role={retry ? "alert" : undefined}>
        {retry ? t("ask.meaningCouldNot") : semantic.status === "paused" ? t("ask.meaningPaused", { percent: percent(semantic) ?? 0 }) : t("ask.meaningHint")}
      </p>
    </div>
  );
}

interface Props {
  answer: Answer;
  client: AnswerPort;
  semantic: SemanticState;
  onEnableMeaning: () => void;
  onAskAgain: () => void;
}

export function AnswerView({ answer, client, semantic, onEnableMeaning, onAskAgain }: Props) {
  const { t } = useI18n();
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
      {answer.note && <p className="ans-note">{answer.note}</p>}
      {result?.kind === "timeline" && result.page && result.page.threads.length > 0 && <Plans result={result} client={client} />}
      {groups.length > 0 && (
        <MessageList groups={groups} total={load ? answer.evidenceTotal : groups.length} load={load} transcript={isTranscript(answer)} client={client} label={t("ask.messages")} />
      )}
      {(answer.basis !== "none" || answer.action) && (
        <div className="ans-foot">
          {answer.basis !== "none" && (
            <p className={`ans-basis basis-${answer.basis}`}>
              {BasisIcon && <BasisIcon size={14} />}
              {t(`ask.basis.${answer.basis}` as TranslationKey)}
            </p>
          )}
          {answer.action === "enable_semantic" && <MeaningAction semantic={semantic} onEnable={onEnableMeaning} onAskAgain={onAskAgain} />}
        </div>
      )}
    </div>
  );
}
