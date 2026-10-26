/* Before a chat is open: the welcome screen and the processing view.

   Welcome: the headline, then the two ways in side by side (your own
   export, or the synthetic demo), one line on privacy and the opt-in to keep
   the chat, the chats kept on this device when there are any, and the
   export guide last. A file can be dropped anywhere on the page; the
   overlay says so while one is held over it. The wallpaper is decorative.

   Processing shows the worker's real stages. Only reading the file has a
   measured percentage (bytes read); the other stages show no number,
   because a made-up one would be a guess presented as a measurement. */
import { useId, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import type { Stage } from "@/worker/protocol";
import type { SavedChat } from "@/store/chatStore";
import { FileDrop } from "./FileDrop";
import { Check, ChevronDown, ChevronRight, Info, MessageCircle, Play, ShieldCheck, Trash2, Upload } from "lucide-react";
import { useI18n } from "@/ui/i18n";
import { translate } from "@/i18n/translate";
import type { TranslationKey } from "@/i18n/en";
import { formatBytes, formatCount, formatDate } from "@/i18n/format";

interface StartProps {
  onFile: (file: File, keep: boolean) => void;
  /** Open the synthetic demo chat (never saved). */
  onDemo?: () => void;
  /** Chats kept on this device; empty or null hides the list (null: storage unavailable). */
  saved?: readonly SavedChat[] | null;
  onOpenSaved?: (chat: SavedChat) => void;
  onDeleteSaved?: (chat: SavedChat) => void;
}

/** The welcome screen's wallpaper: original line motifs of chat, drawn as a tile in styles.css. Decorative. */
export function Wallpaper() {
  return <div className="wallpaper" aria-hidden="true" />;
}

export function StartScreen({ onFile, onDemo, saved = null, onOpenSaved, onDeleteSaved }: StartProps) {
  const { t } = useI18n();
  const [keep, setKeep] = useState(false);
  const [dragging, setDragging] = useState(false);
  // dragenter/dragleave fire for every child crossed; count them so the overlay does not flicker.
  const depth = useRef(0);
  const keepId = useId();
  const files = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    depth.current = 0;
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) onFile(file, keep);
  };
  return (
    <section
      className={dragging ? "welcome dragging" : "welcome"}
      aria-labelledby="start-title"
      onDragEnter={(e) => { if (!files(e)) return; e.preventDefault(); depth.current++; setDragging(true); }}
      onDragOver={(e) => { if (files(e)) e.preventDefault(); }}
      onDragLeave={() => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDragging(false); }}
      onDrop={onDrop}
    >
      <Wallpaper />
      <div className="welcome-main">
        <h2 id="start-title" className="hero-title">
          <span>{t("heroTitle")}</span>{" "}
          <span className="hero-highlight">{t("heroHighlight")}</span>
        </h2>

        <div className="welcome-actions" role="group" aria-label={t("uploadPanel")}>
          <FileDrop primary onFile={(file) => onFile(file, keep)} />
          {onDemo && (
            <button type="button" className="btn ghost welcome-demo" onClick={onDemo}>
              <Play size={16} />{t("start.demo")}
            </button>
          )}
        </div>
        <p className="welcome-hint">
          {t("fileTypes")}
        </p>

        {/* One quiet group under the actions: the save opt-in (its one control), where chats are processed, and export help. */}
        <div className="welcome-more">
          {saved !== null && (
            <div className="keep-option">
              <input id={keepId} type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
              <label htmlFor={keepId}>{t("x_keepOnDevice")}</label>
            </div>
          )}
          <p className="welcome-private"><ShieldCheck size={16} />{t("start.private")}</p>
          <ExportGuide />
        </div>

        {saved && saved.length > 0 && <SavedList chats={saved} onOpen={onOpenSaved} onDelete={onDeleteSaved} />}
      </div>
      {dragging && (
        <div className="welcome-drop" aria-hidden="true">
          <Upload size={28} />
          <p>{t("start.dropHere")}</p>
        </div>
      )}
    </section>
  );
}

/** Saved chats: each row opens it; deleting is the row's one secondary action. */
function SavedList({ chats, onOpen, onDelete }: { chats: readonly SavedChat[]; onOpen?: ((chat: SavedChat) => void) | undefined; onDelete?: ((chat: SavedChat) => void) | undefined }) {
  const { locale, t } = useI18n();
  return (
    <section className="saved" aria-labelledby="saved-title">
      <div className="saved-head">
        <h3 id="saved-title" className="saved-title">{t("x_savedChats")}</h3>
        <span className="saved-count">{t("start.savedCount", { count: formatCount(chats.length, locale) })}</span>
      </div>
      <ul className="saved-list">
        {chats.map((chat) => (
          <li key={chat.id} className="saved-item">
            <button type="button" className="saved-open" aria-label={t("start.openSavedLabel", { name: chat.fileName })} onClick={() => onOpen?.(chat)}>
              <span className="saved-mark" aria-hidden="true"><MessageCircle size={18} /></span>
              <span className="saved-text">
                <span className="saved-name">{chat.fileName}</span>
                <span className="saved-meta">{t("x_savedMeta", { messages: formatCount(chat.messageCount, locale), size: formatBytes(chat.storedBytes, locale), date: formatDate(chat.savedAt.slice(0, 10), locale) })}</span>
              </span>
              <ChevronRight size={16} />
            </button>
            <button type="button" className="icon-btn saved-delete" aria-label={t("x_deleteSavedLabel", { name: chat.fileName })} title={t("x_deleteSaved")} onClick={() => onDelete?.(chat)}>
              <Trash2 size={16} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

const PLATFORMS = ["ios", "android"] as const;
type Platform = (typeof PLATFORMS)[number];
const GUIDE: Record<Platform, readonly TranslationKey[]> = {
  ios: ["guideIos1", "guideIos2", "guideIos3", "guideIos4"],
  android: ["guideAndroid1", "guideAndroid2", "guideAndroid3", "guideAndroid4"],
};

/** Collapsed by default; iPhone/Android as tabs (arrow keys move between them). */
function ExportGuide() {
  const { t } = useI18n();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [platform, setPlatform] = useState<Platform>("ios");
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    const i = PLATFORMS.indexOf(platform);
    const next = event.key === "ArrowRight" ? (i + 1) % 2 : event.key === "ArrowLeft" ? (i + 1) % 2 : event.key === "Home" ? 0 : event.key === "End" ? 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    setPlatform(PLATFORMS[next]!);
    tabs.current[next]?.focus();
  }

  return (
    <div className={open ? "guide open" : "guide"}>
      <button type="button" className="guide-toggle" aria-expanded={open} aria-controls={`${id}-guide`} onClick={() => setOpen(!open)}>
        <Info size={16} />
        <span>{t("guideToggle")}</span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <div id={`${id}-guide`} className="guide-body">
          <div className="guide-tabs" role="tablist" aria-label={t("guidePlatform")} onKeyDown={onKey}>
            {PLATFORMS.map((p, i) => (
              <button
                key={p}
                ref={(el) => { tabs.current[i] = el; }}
                type="button"
                role="tab"
                id={`${id}-tab-${p}`}
                aria-selected={platform === p}
                aria-controls={`${id}-panel`}
                tabIndex={platform === p ? 0 : -1}
                className="guide-tab"
                onClick={() => setPlatform(p)}
              >
                {p === "ios" ? "iPhone" : "Android"}
              </button>
            ))}
          </div>
          <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${platform}`} className="guide-panel">
            <ol className="guide-steps">
              {GUIDE[platform].map((key) => <li key={key}>{t(key)}</li>)}
            </ol>
            <p className="guide-note">{t("guideNote")}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// Each import stage uses the selected interface language.
const STAGES: readonly { id: Stage; key: TranslationKey | null }[] = [
  { id: "reading", key: "reading" }, { id: "decoding", key: "decoding" }, { id: "parsing", key: "parsing" }, { id: "saving", key: "x_saving" }, { id: "analyzing", key: "analyzing" },
];

const label = (entry: { id: Stage; key: TranslationKey | null }, t: (key: TranslationKey) => string) => entry.key ? t(entry.key) : t("x_saving");

export const stageLabel = (stage: Stage, t: (key: TranslationKey) => string = (key) => translate("en", key)) => stage === "indexing" ? t("x_indexing") : label(STAGES.find((s) => s.id === stage)!, t);

interface LoadingProps {
  fileName: string;
  stage: Stage;
  /** Share of the current stage done, when measured (reading only). */
  fraction?: number | undefined;
  /** Show the "saving" step (the user asked to keep the chat). */
  saving?: boolean;
  onCancel: () => void;
}

export function LoadingView({ fileName, stage, fraction, saving = false, onCancel }: LoadingProps) {
  const { t } = useI18n();
  const stages = STAGES.filter((s) => s.id !== "saving" || saving);
  const current = stages.findIndex((s) => s.id === stage);
  return (
    <section className="card loading" aria-busy="true" aria-labelledby="loading-title">
      <Wallpaper />
      <h2 id="loading-title">{t("openingChat")}</h2>
      <p className="muted file-name">{fileName}</p>
      <ol className="stages">
        {stages.map((s, i) => {
          const state = i < current ? "done" : i === current ? "active" : "todo";
          return (
            <li key={s.id} className={state} aria-current={state === "active" ? "step" : undefined}>
              <span className="stage-mark" aria-hidden="true">
                {state === "done" ? <Check size={14} /> : state === "active" ? <span className="spinner" /> : null}
              </span>
              <span>{label(s, t)}</span>
              {state === "active" && fraction !== undefined && <span className="stage-progress">{t("x_readingPercent", { percent: Math.round(fraction * 100) })}</span>}
              <span className="sr-only">{state === "done" ? ` (${t("done")})` : state === "active" ? ` (${t("inProgress")})` : ""}</span>
            </li>
          );
        })}
      </ol>
      <button type="button" className="btn ghost" onClick={onCancel}>{t("cancel")}</button>
    </section>
  );
}
