/* The application: chat lifecycle, filters, dashboard and Recap.

   Owns all view state; components only render it. The chat itself lives in
   the worker: this file holds the load summary and Stats, never message
   text. A file is parsed once; every filter change is one analyze request.

   Lifecycle:
   - load: progress stages with Cancel; a failure shows a dialog and, when
     the file held no messages, the parse report explaining why.
   - the first analysis is the whole chat with no filters; it doubles as the
     Recap data, so the Recap never re-analyses.
   - filter change: the current dashboard stays on screen, marked busy, until
     the new Stats arrive. Only the latest request may update the view. A
     failed filter keeps the previous numbers and says so.
   - close: confirmation, then the worker drops the chat. A crashed worker
     takes the chat with it, so the app returns to the start and says why. */
import { useCallback, useRef, useState } from "react";
import type { Grain, ParticipantId, ParticipantStats, Stats } from "@/model";
import { NO_FILTERS } from "@/model";
import { WorkerRequestError, type AnalysisClient } from "@/worker/client";
import type { LoadSummary, Stage } from "@/worker/protocol";
import { Dashboard } from "./components/Dashboard";
import { Dialog } from "./components/Dialog";
import { FileDrop } from "./components/FileDrop";
import { ContextBar } from "./components/ContextBar";
import { ALL_DATES, type DateSelection } from "./components/Filters";
import { Icon } from "./components/Icon";
import { ChatInfo } from "./components/ChatInfo";
import { LoadingView, StartScreen, stageLabel } from "./components/StartScreen";
import { Popover } from "./components/Popover";
import { ParseReportView } from "./components/ParseReportView";
import { ThemeSelector, useThemeMode } from "./components/ThemeSelector";
import { errorMessage } from "./errors";
import { Recap } from "./recap/Recap";
import { useAnalysisClient } from "./useAnalysisClient";
import { useI18n } from "./i18n/context";
import { LanguageSelector } from "./components/LanguageSelector";

/** What App needs from the worker client; tests pass a fake. */
export type AnalysisPort = Pick<AnalysisClient, "load" | "analyze" | "clear" | "cancel">;

interface Loaded {
  readonly summary: LoadSummary;
  /** Whole chat, no filters: the Recap data and the full participant list. */
  readonly whole: Stats;
  /** What the dashboard shows, and the filters that produced it. */
  readonly stats: Stats;
  readonly dates: DateSelection;
  readonly sender: ParticipantId | null;
}

type View =
  | { readonly status: "idle" }
  | { readonly status: "loading"; readonly fileName: string; readonly stage: Stage }
  | { readonly status: "loaded"; readonly chat: Loaded };

interface Problem {
  readonly title: string;
  readonly message: string;
  readonly report?: LoadSummary["report"] | null;
  readonly action: string;
}

export function App({ client: injected }: { client?: AnalysisPort }) {
  const { locale, t } = useI18n();
  const own = useAnalysisClient(!injected);
  const client = (injected ?? own)!;
  // Applied here so the theme (and Auto's system tracking) holds while the
  // selector, which lives in the menu, is closed.
  const [themeMode, setThemeMode] = useThemeMode();
  const [view, setView] = useState<View>({ status: "idle" });
  const [pending, setPending] = useState<{ dates: DateSelection; sender: ParticipantId | null } | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [disclaimerOpen, setDisclaimerOpen] = useState(false);
  const [recapOpen, setRecapOpen] = useState(false);
  // The grain the user picked, remembered for one date range .
  const [grainChoice, setGrainChoice] = useState<{ grain: Grain; rangeKey: string } | null>(null);
  // Only the latest request may update the view.
  const latest = useRef(0);
  const recapButton = useRef<HTMLButtonElement>(null);

  const chat = view.status === "loaded" ? view.chat : null;
  const people: readonly ParticipantStats[] = chat?.whole.participants ?? [];

  const fail = useCallback((error: unknown, title: string, action: string) => {
    const code = error instanceof WorkerRequestError ? error.code : "internal";
    const fallback = error instanceof Error ? error.message : t("genericError");
    setProblem({ title, message: errorMessage(code, fallback, locale), report: error instanceof WorkerRequestError ? error.report : null, action });
  }, [locale, t]);

  /** The chat is gone from the worker: back to the start. */
  const lost = useCallback((error: unknown) => {
    latest.current++;
    setPending(null);
    setRecapOpen(false);
    setView({ status: "idle" });
    fail(error, t("closedTitle"), t("ok"));
  }, [fail, t]);

  async function open(file: File) {
    const ticket = ++latest.current;
    setConfirmReplace(false);
    setImportOpen(false);
    setRecapOpen(false);
    setPending(null);
    setProblem(null);
    setGrainChoice(null);
    setView({ status: "loading", fileName: file.name, stage: "reading" });
    try {
      const onStage = (stage: Stage) => ticket === latest.current && setView({ status: "loading", fileName: file.name, stage });
      const summary = await client.load(file, onStage);
      const whole = await client.analyze(NO_FILTERS, onStage);
      if (ticket !== latest.current) return;
      setView({ status: "loaded", chat: { summary, whole, stats: whole, dates: ALL_DATES, sender: null } });
    } catch (error) {
      if (ticket !== latest.current) return;
      setView({ status: "idle" });
      if (error instanceof WorkerRequestError && error.code === "cancelled") return;
      fail(error, t("readTitle"), t("tryAnother"));
    }
  }

  async function applyFilters(dates: DateSelection, sender: ParticipantId | null) {
    if (!chat) return;
    const ticket = ++latest.current;
    setPending({ dates, sender });
    try {
      const stats = await client.analyze({ start: dates.start, end: dates.end, sender });
      if (ticket !== latest.current) return;
      setView({ status: "loaded", chat: { ...chat, stats, dates, sender } });
      setPending(null);
    } catch (error) {
      if (ticket !== latest.current) return;
      setPending(null);
      const code = error instanceof WorkerRequestError ? error.code : null;
      if (code === "worker_lost" || code === "no_chat_loaded" || code === "cancelled") {
        lost(error);
        return;
      }
      // The previous numbers stay; nothing changed.
      fail(error, t("filterTitle"), t("close"));
    }
  }

  async function closeChat() {
    latest.current++;
    setConfirmClose(false);
    setImportOpen(false);
    setRecapOpen(false);
    setPending(null);
    setGrainChoice(null);
    setView({ status: "idle" });
    try {
      await client.clear();
    } catch {
      // A worker that cannot answer is discarded with the chat in it.
      client.cancel();
    }
  }

  // The selection on screen: a pending change is shown in the controls at once.
  const dates = pending?.dates ?? chat?.dates ?? ALL_DATES;
  const sender = pending ? pending.sender : chat?.sender ?? null;
  const stats = chat?.stats ?? null;
  const rangeKey = stats?.meta.range ? `${stats.meta.range.start}|${stats.meta.range.end}` : "";
  const grain: Grain = grainChoice && grainChoice.rangeKey === rangeKey ? grainChoice.grain : stats?.timeline.suggestedGrain ?? "monthly";
  const whole = chat?.whole ?? null;

  // Chat info (file, size, span, import status) is a dialog from the chat
  // menu or the context bar's notes link, not a dashboard section.
  const showImport = () => setImportOpen(true);

  return (
    <div className="app">
      <header className={chat ? "appbar" : "appbar no-chat"}>
        <div className="appbar-inner">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true"><Icon name="logo" size={20} /></span>
            <h1 className="brand-name">WhatsApp Analytics</h1>
          </div>
          <div className="appbar-actions">
            {chat && (
              <button ref={recapButton} type="button" className="btn recap-btn" aria-haspopup="dialog" onClick={() => setRecapOpen(true)}>
                <Icon name="play" size={14} /> <span>Recap</span>
              </button>
            )}
            {/* One menu for everything else: appearance always (the start
                screen needs it too), chat actions once a chat is open. */}
            <Popover label={chat ? t("chatActions") : t("settings")} title={chat ? t("menu") : t("settings")} trigger={<Icon name="more" size={20} />} triggerClassName="icon-btn menu-btn" panelClassName="menu-pop">
              {(close) => (
                <div className="menu">
                  <div className="menu-group" role="group" aria-labelledby="menu-language">
                    <p className="menu-label" id="menu-language">{t("language")}</p>
                    <LanguageSelector />
                  </div>
                  <div className="menu-group" role="group" aria-labelledby="menu-appearance">
                    <p className="menu-label" id="menu-appearance">{t("appearance")}</p>
                    <ThemeSelector mode={themeMode} onChange={setThemeMode} labelled />
                  </div>
                  {chat && (
                    <>
                      <ul className="menu-group menu-sep">
                        <li>
                          <button type="button" onClick={() => { close(); setImportOpen(true); }}>
                            <Icon name="info" size={16} /> {t("chatInfo")}
                          </button>
                        </li>
                        <li>
                          <button type="button" onClick={() => { close(); setConfirmReplace(true); }}>
                            <Icon name="upload" size={16} /> {t("openAnother")}
                          </button>
                        </li>
                      </ul>
                      <ul className="menu-group menu-sep">
                        <li>
                          <button type="button" className="danger" onClick={() => { close(); setConfirmClose(true); }}>
                            <Icon name="logout" size={16} /> {t("closeChat")}
                          </button>
                        </li>
                      </ul>
                    </>
                  )}
                  <ul className="menu-group menu-sep">
                    <li>
                      <button type="button" onClick={() => { close(); setDisclaimerOpen(true); }}>
                        <Icon name="info" size={16} /> {t("disclaimer")}
                      </button>
                    </li>
                  </ul>
                </div>
              )}
            </Popover>
          </div>
        </div>
      </header>

      <p className="sr-only" aria-live="polite">
        {view.status === "loading" ? `${stageLabel(view.stage, t)}…` : pending ? t("updatingDashboard") : ""}
      </p>

      <main id="main" className="content">
        {view.status === "idle" && <StartScreen onFile={(f) => void open(f)} />}

        {view.status === "loading" && (
          <LoadingView
            fileName={view.fileName}
            stage={view.stage}
            onCancel={() => {
              latest.current++;
              client.cancel();
              setView({ status: "idle" });
            }}
          />
        )}

        {chat && stats && (
          <>
            <ContextBar
              whole={chat.whole}
              stats={stats}
              people={people}
              summary={chat.summary}
              dates={dates}
              sender={sender}
              updating={pending !== null}
              onFilters={(d, s) => void applyFilters(d, s)}
              onShowImport={showImport}
            />
            <div className="dashboard" aria-busy={pending !== null}>
              <Dashboard
                stats={stats}
                people={people}
                grain={grain}
                onGrain={(g) => setGrainChoice({ grain: g, rangeKey })}
                onResetFilters={() => void applyFilters(ALL_DATES, null)}
              />
            </div>
          </>
        )}
      </main>

      {recapOpen && whole && (
        <Recap
          stats={whole}
          onClose={() => {
            setRecapOpen(false);
            recapButton.current?.focus();
          }}
        />
      )}

      {importOpen && chat && (
        <Dialog
          title={t("chatInfo")}
          onDismiss={() => setImportOpen(false)}
          actions={<button type="button" className="btn ghost" onClick={() => setImportOpen(false)}>{t("close")}</button>}
        >
          <ChatInfo summary={chat.summary} />
        </Dialog>
      )}

      {disclaimerOpen && (
        <Dialog
          title={t("disclaimer")}
          onDismiss={() => setDisclaimerOpen(false)}
          actions={<button type="button" className="btn ghost" onClick={() => setDisclaimerOpen(false)}>{t("close")}</button>}
        >
          <div className="disclaimer">
            <p>{t("disclaimerTrademark")}</p>
            <p>{t("disclaimerLocal")}</p>
            <p>{t("disclaimerUse")}</p>
          </div>
        </Dialog>
      )}

      {confirmReplace && (
        <Dialog
          title={t("replaceTitle")}
          onDismiss={() => setConfirmReplace(false)}
          actions={
            <>
              <button type="button" className="btn ghost" onClick={() => setConfirmReplace(false)}>{t("cancel")}</button>
              <FileDrop compact primary onFile={(f) => void open(f)} label={t("chooseExport")} />
            </>
          }
        >
          <p>{t("replaceBody")}</p>
        </Dialog>
      )}

      {confirmClose && (
        <Dialog
          title={t("closeTitle")}
          onDismiss={() => setConfirmClose(false)}
          actions={
            <>
              <button type="button" className="btn ghost" onClick={() => setConfirmClose(false)}>{t("cancel")}</button>
              <button type="button" className="btn danger" onClick={() => void closeChat()}>{t("closeChat").replace("…", "")}</button>
            </>
          }
        >
          <p>{t("closeBody")}</p>
        </Dialog>
      )}

      {problem && (
        <Dialog
          title={problem.title}
          role="alertdialog"
          onDismiss={() => setProblem(null)}
          actions={<button type="button" className="btn" onClick={() => setProblem(null)}>{problem.action}</button>}
        >
          <p>{problem.message}</p>
          {problem.report && <ParseReportView report={problem.report} />}
        </Dialog>
      )}
    </div>
  );
}
