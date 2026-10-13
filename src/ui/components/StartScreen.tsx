/* Before a chat is open: the upload screen, and the processing view with
   the worker's real stages. The worker reports stages, not byte progress, so
   no percentage is shown: a made-up number would be a guess presented as a
   measurement. */
import { useId, useRef, useState, type KeyboardEvent } from "react";
import type { Stage } from "@/worker/protocol";
import { FileDrop } from "./FileDrop";
import { Icon } from "./Icon";
import { useI18n } from "../i18n/context";
import type { TranslationKey } from "../i18n/en";

export function StartScreen({ onFile }: { onFile: (file: File) => void }) {
  const { t } = useI18n();
  return (
    <section className="start" aria-labelledby="start-title">
      {/* Decorative backdrop: pointer-transparent, hidden from assistive tech. */}
      <div className="start-backdrop" aria-hidden="true" />
      <div className="hero">
        <h2 id="start-title" className="hero-title">
          <span>{t("heroTitle")}</span>{" "}
          <span className="hero-highlight">{t("heroHighlight")}</span>
        </h2>
        <p className="hero-lede">{t("heroLede")}</p>
      </div>

      <div className="upload-panel" role="group" aria-label={t("uploadPanel")}>
        <FileDrop onFile={onFile} />
        <p className="privacy-note"><Icon name="shield" size={16} /> {t("privacyNote")}</p>
        <ExportGuide />
      </div>
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
        <Icon name="info" size={16} />
        <span>{t("guideToggle")}</span>
        <Icon name="chevron" size={16} />
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

const STAGES: readonly { id: Stage; key: TranslationKey }[] = [
  { id: "reading", key: "reading" }, { id: "decoding", key: "decoding" }, { id: "parsing", key: "parsing" }, { id: "analyzing", key: "analyzing" },
];

export const stageLabel = (stage: Stage, t: (key: TranslationKey) => string = (key) => ({ reading: "Reading the file", decoding: "Decoding the text", parsing: "Finding the messages", analyzing: "Calculating statistics" } as Partial<Record<TranslationKey, string>>)[key] ?? key) => t(STAGES.find((s) => s.id === stage)!.key);

export function LoadingView({ fileName, stage, onCancel }: { fileName: string; stage: Stage; onCancel: () => void }) {
  const { t } = useI18n();
  const current = STAGES.findIndex((s) => s.id === stage);
  return (
    <section className="card loading" aria-busy="true" aria-labelledby="loading-title">
      <div className="start-backdrop" aria-hidden="true" />
      <h2 id="loading-title">{t("openingChat")}</h2>
      <p className="muted file-name">{fileName}</p>
      <ol className="stages">
        {STAGES.map((s, i) => {
          const state = i < current ? "done" : i === current ? "active" : "todo";
          return (
            <li key={s.id} className={state} aria-current={state === "active" ? "step" : undefined}>
              <span className="stage-mark" aria-hidden="true">
                {state === "done" ? <Icon name="check" size={14} /> : state === "active" ? <span className="spinner" /> : null}
              </span>
              <span>{t(s.key)}</span>
              <span className="sr-only">{state === "done" ? ` (${t("done")})` : state === "active" ? ` (${t("inProgress")})` : ""}</span>
            </li>
          );
        })}
      </ol>
      <button type="button" className="btn ghost" onClick={onCancel}>{t("cancel")}</button>
    </section>
  );
}
