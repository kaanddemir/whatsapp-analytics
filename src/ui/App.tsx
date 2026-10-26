/* The application: chat lifecycle, filters, the two views (Overview and
   Ask) and Recap.

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
     failed filter keeps the previous numbers and says so. Overview and Ask
     share the filters, so both views always cover the same messages.
   - Ask keeps its conversation while Overview shows; a new chat starts a
     new conversation.
   - close: confirmation, then the worker drops the chat. A crashed worker
     takes the chat with it, so the app returns to the start and says why. */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Grain, ParticipantId, ParticipantStats, Stats } from "@/model";
import { NO_FILTERS } from "@/model";
import { WorkerRequestError, type AnalysisClient } from "@/worker/client";
import type { LoadSummary, Stage } from "@/worker/protocol";
import type { SavedChat } from "@/store/chatStore";
import { Dashboard } from "./components/Dashboard";
import { Dialog } from "./components/Dialog";
import { FileDrop } from "./components/FileDrop";
import { ContextBar } from "./components/ContextBar";
import { ALL_DATES, type DateSelection } from "./components/Filters";
import { Ellipsis, Info, LogOut, Play, Trash2, TriangleAlert, Upload } from "lucide-react";
import { ChatInfo } from "./components/ChatInfo";
import { LoadingView, StartScreen, stageLabel } from "./components/StartScreen";
import { Popover } from "./components/Popover";
import { ParseReportView } from "./components/ParseReportView";
import { ThemeSelector, useThemeMode } from "./components/ThemeSelector";
import type { TranslationKey } from "@/i18n/en";
import type { ClientErrorCode } from "@/worker/client";
import { errorMessage } from "./errors";
import { formatCount } from "@/i18n/format";
import { importNoteCount } from "./importStatus";
import { Recap } from "./recap/Recap";
import { useAnalysisClient } from "./useAnalysisClient";
import { useI18n } from "@/ui/i18n";
import { Ask, type AskPort } from "./ask/Ask";
import { DEMO_FILE_NAME, demoChat } from "@/demo/demoChat";

import { LanguageSelector } from "./components/LanguageSelector";

/** What App needs from the worker client; tests pass a fake. */
export type AnalysisPort = Pick<AnalysisClient, "load" | "analyze" | "clear" | "cancel" | "openSaved" | "listSaved" | "deleteSaved"> & AskPort;

type Page = "overview" | "ask";

/** Where the open chat came from, to read it again with a chosen date order. */
type Source = { readonly kind: "file"; readonly file: File } | { readonly kind: "saved"; readonly id: string };

interface Loaded {
  /** Counts opened chats: one Ask conversation each. */
  readonly session: number;
  /** The synthetic demo chat: labelled as such, and never kept on the device. */
  readonly demo: boolean;
  readonly source: Source;
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
  | { readonly status: "loading"; readonly fileName: string; readonly stage: Stage; readonly fraction?: number | undefined; readonly saving: boolean }
  | { readonly status: "loaded"; readonly chat: Loaded };

interface Problem {
  readonly title: TranslationKey;
  readonly code: ClientErrorCode;
  readonly fallback: string;
  readonly report?: LoadSummary["report"] | null;
  readonly action: TranslationKey;
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
  // Chats kept on this device; null when this browser cannot store them.
  const [saved, setSaved] = useState<readonly SavedChat[] | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<SavedChat | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [disclaimerOpen, setDisclaimerOpen] = useState(false);
  const [recapOpen, setRecapOpen] = useState(false);
  const [page, setPage] = useState<Page>("overview");
  // The grain the user picked, remembered for one date range .
  const [grainChoice, setGrainChoice] = useState<{ grain: Grain; rangeKey: string } | null>(null);
  // Only the latest request may update the view.
  const latest = useRef(0);
  const sessions = useRef(0);
  const recapButton = useRef<HTMLButtonElement>(null);

  const chat = view.status === "loaded" ? view.chat : null;
  const people: readonly ParticipantStats[] = chat?.whole.participants ?? [];

  const fail = useCallback((error: unknown, title: TranslationKey, action: TranslationKey) => {
    const code = error instanceof WorkerRequestError ? error.code : "internal";
    const fallback = error instanceof Error ? error.message : t("genericError");
    setProblem({ title, code, fallback, report: error instanceof WorkerRequestError ? error.report : null, action });
  }, [locale, t]);

  /** The chat is gone from the worker: back to the start. */
  const lost = useCallback((error: unknown) => {
    latest.current++;
    setPending(null);
    setRecapOpen(false);
    setPage("overview");
    setView({ status: "idle" });
    fail(error, "closedTitle", "ok");
  }, [fail, t]);

  /** Load from a file or from the device, then run the whole-chat analysis. */
  async function open(source: Source, fileName: string, dateOrder?: "dmy" | "mdy", keep = false, demo = false) {
    const ticket = ++latest.current;
    setConfirmReplace(false);
    setImportOpen(false);
    setRecapOpen(false);
    setPending(null);
    setProblem(null);
    setGrainChoice(null);
    setView({ status: "loading", fileName, stage: "reading", saving: keep });
    if (keep) void navigator.storage?.persist?.().catch(() => false);
    try {
      const onStage = (stage: Stage, fraction?: number) => ticket === latest.current && setView({ status: "loading", fileName, stage, fraction, saving: keep });
      const summary = source.kind === "file"
        ? await client.load(source.file, onStage, dateOrder, keep)
        : await client.openSaved(source.id, onStage, dateOrder);
      const whole = await client.analyze(NO_FILTERS, onStage);
      if (ticket !== latest.current) return;
      setView({ status: "loaded", chat: { session: ++sessions.current, demo, source: summary.saved ? { kind: "saved", id: summary.saved.id } : source, summary, whole, stats: whole, dates: ALL_DATES, sender: null } });
      if (summary.saveError) fail(new WorkerRequestError(summary.saveError, ""), "x_saveFailedTitle", "ok");
    } catch (error) {
      if (ticket !== latest.current) return;
      setView({ status: "idle" });
      if (error instanceof WorkerRequestError && error.code === "cancelled") return;
      fail(error, source.kind === "saved" ? "x_savedOpenTitle" : "readTitle", "tryAnother");
    }
  }

  const openFile = (file: File, dateOrder?: "dmy" | "mdy", keep = false) => open({ kind: "file", file }, file.name, dateOrder, keep);
  /** The demo goes through the ordinary import, as a file built in memory, in the interface language; it is never saved. */
  const openDemo = () => open({ kind: "file", file: new File([demoChat(locale)], DEMO_FILE_NAME, { type: "text/plain" }) }, t("start.demoBadge"), undefined, false, true);

  // The saved list is read whenever the start screen shows.
  useEffect(() => {
    if (view.status !== "idle") return;
    let live = true;
    client.listSaved().then((chats) => live && setSaved(chats), () => live && setSaved(null));
    return () => { live = false; };
  }, [view.status, client]);

  async function deleteSaved(target: SavedChat) {
    setConfirmDelete(null);
    try {
      await client.deleteSaved(target.id);
    } catch (error) {
      fail(error, "x_deleteSavedTitle", "close");
      return;
    }
    if (view.status === "idle") {
      client.listSaved().then(setSaved, () => setSaved(null));
    } else if (chat?.summary.saved?.id === target.id) {
      // The open chat stays in memory; only its device copy is gone.
      setView({ status: "loaded", chat: { ...chat, summary: { ...chat.summary, saved: null } } });
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
      fail(error, "filterTitle", "close");
    }
  }

  async function closeChat() {
    latest.current++;
    setConfirmClose(false);
    setImportOpen(false);
    setRecapOpen(false);
    setPending(null);
    setGrainChoice(null);
    setPage("overview");
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
  const notes = chat ? importNoteCount(chat.summary) : 0;
  const notesLabel = t(notes === 1 ? "importNote" : "importNotes", { count: formatCount(notes, locale) });

  const asking = chat !== null && page === "ask";

  return (
    <div className={asking ? "app app-ask" : "app"}>
      <header className={chat ? "appbar" : "appbar no-chat"}>
        <div className={chat ? "appbar-inner with-views" : "appbar-inner"}>
          <div className="brand">
            <img className="brand-mark" src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" aria-hidden="true" />
            <h1 className="brand-name">WhatsApp Analytics</h1>
            {chat?.demo && <span className="demo-badge" title={t("start.demoNote")}>{t("start.demoBadge")}<span className="sr-only">: {t("start.demoNote")}</span></span>}
          </div>
          {chat && (
            <nav className="view-tabs" aria-label={t("ask.views")}>
              {(["overview", "ask"] as const).map((p) => (
                <button key={p} type="button" className="view-tab" aria-current={page === p ? "page" : undefined} onClick={() => setPage(p)}>
                  {p === "overview" ? t("overview") : t("ask.nav")}
                </button>
              ))}
            </nav>
          )}
          <div className="appbar-actions">
            {notes > 0 && (
              <button type="button" className="icon-btn notes-btn" aria-label={notesLabel} title={notesLabel} onClick={showImport}>
                <TriangleAlert size={20} />
              </button>
            )}
            {chat && (
              <button ref={recapButton} type="button" className="btn recap-btn" aria-haspopup="dialog" onClick={() => setRecapOpen(true)}>
                <Play size={14} /> <span>{t("x_recapAction")}</span>
              </button>
            )}
            {/* One menu for everything else: appearance always (the start
                screen needs it too), chat actions once a chat is open. */}
            <Popover label={chat ? t("chatActions") : t("settings")} title={chat ? t("menu") : t("settings")} trigger={<Ellipsis size={20} />} triggerClassName="icon-btn menu-btn" panelClassName="menu-pop">
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
                            <Info size={16} /> {t("chatInfo")}
                          </button>
                        </li>
                        <li>
                          <button type="button" onClick={() => { close(); setConfirmReplace(true); }}>
                            <Upload size={16} /> {t("openAnother")}
                          </button>
                        </li>
                      </ul>
                      <ul className="menu-group menu-sep">
                        {chat.summary.saved && (
                          <li>
                            <button type="button" className="danger" onClick={() => { close(); setConfirmDelete(chat.summary.saved); }}>
                              <Trash2 size={16} /> {t("x_deleteFromDevice")}
                            </button>
                          </li>
                        )}
                        <li>
                          <button type="button" className="danger" onClick={() => { close(); setConfirmClose(true); }}>
                            <LogOut size={16} /> {t("closeChat")}
                          </button>
                        </li>
                      </ul>
                    </>
                  )}
                  <ul className="menu-group menu-sep">
                    <li>
                      <button type="button" onClick={() => { close(); setDisclaimerOpen(true); }}>
                        <Info size={16} /> {t("disclaimer")}
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
        {view.status === "loading" ? `${stageLabel(view.stage, t)}…` : pending && !asking ? t("updatingDashboard") : ""}
      </p>

      <main id="main" className="content">
        {view.status === "idle" && (
          <StartScreen
            onFile={(f, keep) => void openFile(f, undefined, keep)}
            onDemo={() => void openDemo()}
            saved={saved}
            onOpenSaved={(c) => void open({ kind: "saved", id: c.id }, c.fileName)}
            onDeleteSaved={setConfirmDelete}
          />
        )}

        {view.status === "loading" && (
          <LoadingView
            fileName={view.fileName}
            stage={view.stage}
            fraction={view.fraction}
            saving={view.saving}
            onCancel={() => {
              latest.current++;
              client.cancel();
              setView({ status: "idle" });
            }}
          />
        )}

        {chat && stats && page === "overview" && (
          <>
            <ContextBar
              whole={chat.whole}
              stats={stats}
              people={people}
              dates={dates}
              sender={sender}
              onFilters={(d, s) => void applyFilters(d, s)}
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

        {/* Mounted for the whole chat, hidden behind Overview, so the conversation survives switching. */}
        {chat && stats && (
          <div className="ask-view" hidden={!asking}>
            <Ask
              key={chat.session}
              client={client}
              stats={stats}
              people={people}
              dates={dates}
              sender={sender}
              onFilters={(d, s) => void applyFilters(d, s)}
              onLost={lost}
              active={asking}
            />
          </div>
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
          <ChatInfo summary={chat.summary} onDateOrder={chat.source.kind === "saved" && !chat.summary.saved ? undefined : (order) => void open(chat.source, chat.summary.file.fileName, order, false, chat.demo)} />
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
              <FileDrop compact primary onFile={(f) => void openFile(f)} label={t("chooseExport")} />
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
          <p>{chat?.summary.saved ? t("x_closeBodySaved") : t("closeBody")}</p>
        </Dialog>
      )}

      {confirmDelete && (
        <Dialog
          title={t("x_deleteSavedTitle")}
          onDismiss={() => setConfirmDelete(null)}
          actions={
            <>
              <button type="button" className="btn ghost" onClick={() => setConfirmDelete(null)}>{t("cancel")}</button>
              <button type="button" className="btn danger" onClick={() => void deleteSaved(confirmDelete)}>{t("x_deleteSaved")}</button>
            </>
          }
        >
          <p>{t("x_deleteSavedBody", { name: confirmDelete.fileName })}</p>
        </Dialog>
      )}

      {problem && (
        <Dialog
          title={t(problem.title)}
          role="alertdialog"
          onDismiss={() => setProblem(null)}
          actions={<button type="button" className="btn" onClick={() => setProblem(null)}>{t(problem.action)}</button>}
        >
          <p>{errorMessage(problem.code, problem.fallback, locale)}</p>
          {problem.report && <ParseReportView report={problem.report} />}
        </Dialog>
      )}
    </div>
  );
}
