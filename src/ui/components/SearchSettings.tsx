/* Search by meaning, for Ask only: the opt-in beside the import, and the
   Search settings dialog, which shows the indexer's real state and offers what
   can be done in it. The explanation waits behind a "?". Percentages are only
   ever measured ones: bytes while downloading, messages while indexing. */
import { useEffect, useId, useRef, useState } from "react";
import { Check, CircleHelp, Pause, Search, TriangleAlert } from "lucide-react";
import type { SemanticFailure, SemanticState } from "@/semantic/indexer";
import { E5_SMALL, modelBytes } from "@/semantic/model";
import type { TranslationKey } from "@/i18n/en";
import { formatBytes, formatCount } from "@/i18n/format";
import { useI18n } from "@/ui/i18n";
import type { SemanticAction } from "../useSemanticSearch";
import { Dialog } from "./Dialog";

const modelSize = (locale: "en" | "tr") => formatBytes(modelBytes(E5_SMALL), locale);

/** A "?" whose text shows on hover and on keyboard or touch focus. */
function HelpTip({ text, label }: { text: string; label: string }) {
  const id = useId();
  return (
    <span className="help">
      <button type="button" className="help-btn" aria-label={label} aria-describedby={id}><CircleHelp size={16} aria-hidden="true" /></button>
      <span id={id} role="tooltip" className="help-tip">{text}</span>
    </span>
  );
}

/** The import screen's opt-in; off unless ticked, for each import. */
export function MeaningOption({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  const { locale, t } = useI18n();
  const id = useId();
  return (
    <div className="keep-option meaning-option">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <label htmlFor={id}>{t("search.option")}</label>
      <HelpTip text={t("search.help", { size: modelSize(locale) })} label={t("search.helpLabel")} />
    </div>
  );
}

const FAILURES: Record<SemanticFailure, TranslationKey> = {
  too_large: "search.fail.tooLarge", unsupported: "search.fail.unsupported", model_missing: "search.fail.modelMissing",
  integrity: "search.fail.integrity", storage_full: "search.fail.storageFull", memory: "search.fail.memory", failed: "search.fail.failed",
};
/** Trying again cannot change these on this device. */
const isFinal = (reason: SemanticFailure) => reason === "too_large" || reason === "unsupported";

interface Props {
  state: SemanticState;
  /** The chat is kept on this device, so its index is too. */
  saved: boolean;
  /** The last request could not be carried out. */
  failed: boolean;
  onAction: (action: SemanticAction) => void;
  onClose: () => void;
}

export function SearchSettings({ state, saved, failed, onAction, onClose }: Props) {
  const { locale, t } = useI18n();
  const [confirming, setConfirming] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const removeButton = useRef<HTMLButtonElement>(null);
  const keepButton = useRef<HTMLButtonElement>(null);
  const returning = useRef(false);

  const hasProgress = state.status === "indexing" || state.status === "paused" || state.status === "ready" || state.status === "failed";
  const done = hasProgress ? state.done : 0;
  const total = hasProgress ? state.total : 0;
  const percent = total ? Math.min(state.status === "ready" ? 100 : 99, Math.floor((done / total) * 100)) : 0;
  // Removal needs confirming only when there are vectors to lose.
  const removable = hasProgress && done > 0;
  // With nothing indexed there is nothing to confirm, and a saved chat stops trying again on each visit.
  const turnOff = done === 0 && (state.status === "paused" || (state.status === "failed" && !isFinal(state.reason)));
  const asking = confirming && removable;
  const running = state.status === "indexing" || state.status === "paused" || state.status === "ready";

  // A control can vanish with the state that offered it; focus then stays in the dialog, on its first action.
  useEffect(() => {
    if (asking) { keepButton.current?.focus(); return; }
    if (returning.current) { returning.current = false; removeButton.current?.focus(); }
    if (document.activeElement === document.body) root.current?.closest(".dialog")?.querySelector<HTMLElement>(".dialog-actions button")?.focus();
  }, [state.status, asking]);

  const primary = state.status === "off" ? { action: "enable", label: "search.enable", ghost: false } as const
    : state.status === "preparing" || state.status === "indexing" ? { action: "pause", label: "search.pause", ghost: true } as const
    : state.status === "paused" ? { action: "enable", label: "search.resume", ghost: false } as const
    : state.status === "failed" && !isFinal(state.reason) ? { action: "enable", label: "search.tryAgain", ghost: false } as const
    : null;

  const heading: string = state.status === "off" ? t("search.off")
    : state.status === "preparing" ? t("search.preparing")
    : state.status === "indexing" ? t("search.indexing")
    : state.status === "paused" ? t("search.paused")
    : state.status === "ready" ? t("search.ready")
    : t(FAILURES[state.reason]);

  const detail: string | null = state.status === "preparing" ? (state.phase === "download" && state.total > 0 ? t("search.download", { percent: Math.floor((state.loaded / state.total) * 100) }) : t(state.phase === "verify" ? "search.verify" : "search.load"))
    : state.status === "failed" ? t("search.stillWorks")
    : null;

  const help = [t("search.help", { size: modelSize(locale) }), state.status === "indexing" || state.status === "paused" ? t("search.partial") : null, running && !saved ? t("search.unsaved") : null].filter(Boolean).join(" ");

  return (
    <Dialog
      title={t("search.settings")}
      onDismiss={onClose}
      actions={asking ? (
        <>
          <button ref={keepButton} type="button" className="btn ghost search-action" onClick={() => { returning.current = true; setConfirming(false); }}>{t("cancel")}</button>
          <button type="button" className="btn danger search-action" onClick={() => { setConfirming(false); onAction("remove"); }}>{t("search.remove")}</button>
        </>
      ) : (
        <>
          <button type="button" className="btn ghost search-action" onClick={onClose}>{t("close")}</button>
          {removable && <button ref={removeButton} type="button" className="btn ghost search-action search-remove" onClick={() => setConfirming(true)}>{t("search.remove")}</button>}
          {turnOff && <button type="button" className="btn ghost search-action" onClick={() => onAction("remove")}>{t("search.turnOff")}</button>}
          {/* One button across states, so focus stays on it when Pause turns into Resume. */}
          {primary && <button type="button" className={primary.ghost ? "btn ghost search-action" : "btn search-action"} onClick={() => onAction(primary.action)}>{t(primary.label)}</button>}
        </>
      )}
    >
      <div className="search-settings" ref={root}>
        {asking ? (
          <>
            <p className="search-state-line">{t("search.removeTitle")}</p>
            <p className="search-fine">{t("search.removeBody")}</p>
          </>
        ) : (
          <>
            <div className="search-state-row">
              <p className={state.status === "failed" ? "search-state-line failed" : "search-state-line"} role={state.status === "failed" ? "alert" : "status"}>
                {state.status === "preparing" || state.status === "indexing" ? <span className="spinner" aria-hidden="true" />
                  : state.status === "ready" ? <Check size={16} className="search-ok" aria-hidden="true" />
                  : state.status === "failed" ? <TriangleAlert size={16} aria-hidden="true" />
                  : state.status === "paused" ? <Pause size={16} aria-hidden="true" />
                  : <Search size={16} aria-hidden="true" />}
                <span>{heading}</span>
              </p>
              <HelpTip text={help} label={t("search.helpLabel")} />
            </div>
            {(state.status === "indexing" || state.status === "paused") && total > 0 && <progress className="search-progress" max={total} value={done} aria-label={t("search.progressLabel")} />}
            {total > 0 && (done > 0 || state.status === "indexing" || state.status === "paused") && (
              <p className="search-count">
                {state.status === "ready"
                  ? t("search.coverageAll", { total: formatCount(total, locale) })
                  : t("search.progress", { done: formatCount(done, locale), total: formatCount(total, locale), percent })}
              </p>
            )}
            {detail && <p className="search-fine">{detail}</p>}
            {failed && <p className="search-error" role="alert">{t("search.actionFailed")}</p>}
          </>
        )}
      </div>
    </Dialog>
  );
}
