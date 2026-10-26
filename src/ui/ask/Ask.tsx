/* Ask: a conversation with the chat's deterministic engine.

   The worker answers (src/ask/answer.ts); this view keeps the turns of the
   current conversation and renders each Answer. A question is sent with the
   scope on screen, the participant and date filters Overview uses, so both
   views count the same messages. The filters sit in the composer; when the
   scope changes between questions, the thread says so.

   Stopping cancels the question in the worker (worker/handler.ts): one
   still queued never runs and one waiting on the model stops waiting, while
   the chat and its indexes stay. A worker that is gone takes the chat with
   it (onLost).

   The view stays mounted while Overview shows, so the conversation and its
   scroll position survive switching; a new chat remounts it. */
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { AnalysisFilters, ParticipantId, ParticipantStats, Stats } from "@/model";
import type { Answer } from "@/ask/types";
import type { Stage } from "@/worker/protocol";
import type { SemanticState } from "@/semantic/indexer";
import { WorkerRequestError, type AnalysisClient } from "@/worker/client";
import { formatDate } from "@/i18n/format";
import { useI18n } from "@/ui/i18n";
import { ArrowUp, Calendar, ChartColumn, RotateCcw, Search, Square, SquarePen, Users } from "lucide-react";
import { DateFilter, ParticipantPicker, type DateSelection } from "../components/Filters";
import { AnswerView } from "./Answer";
import { scopeKey } from "./present";
import "./ask.css";

export type AskPort = Pick<AnalysisClient, "ask" | "context" | "search" | "behaviourEvidence" | "dateEvidence" | "timeline" | "semantic" | "onSemantic">;

type TurnState =
  | { readonly status: "pending"; readonly stage: Stage | null }
  | { readonly status: "done"; readonly answer: Answer }
  | { readonly status: "stopped" }
  | { readonly status: "failed" };

interface Turn {
  readonly id: number;
  readonly question: string;
  readonly filters: AnalysisFilters;
  /** The scope in words, as it was when asked. */
  readonly scope: string;
  readonly state: TurnState;
}

interface Props {
  client: AskPort;
  /** The current (filtered) statistics and everyone in the chat, for the scope pickers. */
  stats: Stats;
  people: readonly ParticipantStats[];
  dates: DateSelection;
  sender: ParticipantId | null;
  onFilters: (dates: DateSelection, sender: ParticipantId | null) => void;
  /** The worker lost the chat. */
  onLost: (error: unknown) => void;
  /** Ask is the view on screen. */
  active: boolean;
}

const SUGGESTIONS = [["ask.s1", "ask.s1Hint", Users], ["ask.s2", "ask.s2Hint", Calendar], ["ask.s3", "ask.s3Hint", ChartColumn], ["ask.s4", "ask.s4Hint", Search]] as const;
const MAX_QUESTION = 500; // the worker reads no more than this (worker/handler.ts)

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
const finePointer = () => typeof window !== "undefined" && window.matchMedia?.("(pointer: fine)").matches === true;

export function Ask({ client, stats, people, dates, sender, onFilters, onLost, active }: Props) {
  const { locale, t } = useI18n();
  const [turns, setTurns] = useState<readonly Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [semantic, setSemantic] = useState<SemanticState>({ status: "off" });
  const [announcement, setAnnouncement] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const thread = useRef<HTMLOListElement>(null);
  const composing = useRef(false);
  const seq = useRef(0);
  // Replies arriving after unmount are dropped. Set on every mount: StrictMode mounts twice.
  const live = useRef(true);
  // The question in flight, to cancel on Stop, on a new conversation and on unmount.
  const inFlight = useRef<AbortController | null>(null);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      inFlight.current?.abort();
    };
  }, []);

  const filters: AnalysisFilters = { start: dates.start, end: dates.end, sender };
  const who = people.find((p) => p.id === sender)?.name ?? t("ask.scopeEveryone");
  const when = dates.preset === "all" || !dates.start || !dates.end ? t("ask.scopeAllDates") : `${formatDate(dates.start, locale)} – ${formatDate(dates.end, locale)}`;
  const scope = `${who} · ${when}`;
  const pending = turns.some((turn) => turn.state.status === "pending");

  // Search by meaning: its state now, then every change while it prepares.
  useEffect(() => {
    const off = client.onSemantic((s) => live.current && setSemantic(s));
    client.semantic("status").then((s) => live.current && setSemantic(s), () => {});
    return off;
  }, [client]);

  // Arriving in Ask puts the cursor in the composer, where a keyboard is at hand (not on touch screens).
  useEffect(() => {
    if (active && finePointer()) input.current?.focus({ preventScroll: true });
  }, [active]);

  // The composer grows with its text, up to a few lines, then scrolls.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [draft]);

  // A new question moves to the top of the view, with its answer appearing beneath it.
  const asked = useRef(0);
  useEffect(() => {
    if (turns.length <= asked.current) {
      asked.current = turns.length;
      return;
    }
    asked.current = turns.length;
    const last = thread.current?.lastElementChild as HTMLElement | null;
    last?.scrollIntoView?.({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
  }, [turns.length]);

  const update = (id: number, next: (state: TurnState) => TurnState) =>
    setTurns((ts) => ts.map((turn) => (turn.id === id ? { ...turn, state: next(turn.state) } : turn)));

  function send(text: string) {
    const question = text.trim().slice(0, MAX_QUESTION);
    if (!question || pending) return;
    const id = ++seq.current;
    setTurns((ts) => [...ts, { id, question, filters, scope, state: { status: "pending", stage: null } }]);
    setDraft("");
    setAnnouncement(t("ask.working"));
    const stillPending = (s: TurnState) => s.status === "pending";
    const controller = new AbortController();
    inFlight.current = controller;
    const settled = () => { if (inFlight.current === controller) inFlight.current = null; };
    client.ask(question, filters, (stage) => live.current && update(id, (s) => (stillPending(s) ? { status: "pending", stage } : s)), locale, controller.signal).then(
      (answer) => {
        settled();
        if (!live.current || controller.signal.aborted) return;
        update(id, (s) => (stillPending(s) ? { status: "done", answer } : s));
        setAnnouncement(answer.text);
      },
      (error: unknown) => {
        settled();
        if (!live.current) return;
        const code = error instanceof WorkerRequestError ? error.code : null;
        if (code === "worker_lost" || code === "no_chat_loaded") return onLost(error);
        // "cancelled": stopped here, or the app cancelled everything to open or close a chat.
        update(id, (s) => (stillPending(s) ? (code === "cancelled" ? { status: "stopped" } : { status: "failed" }) : s));
        if (code !== "cancelled") setAnnouncement(t("ask.failed"));
      },
    );
  }

  function stop() {
    inFlight.current?.abort();
    setTurns((ts) => ts.map((turn) => (turn.state.status === "pending" ? { ...turn, state: { status: "stopped" } } : turn)));
    setAnnouncement(t("ask.stopped"));
    input.current?.focus();
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends and Shift+Enter starts a new line, except while an input method is composing (keyCode 229 covers Safari).
    if (e.key === "Enter" && !e.shiftKey && !composing.current && e.keyCode !== 229) {
      e.preventDefault();
      send(draft);
    } else if (e.key === "Escape" && pending) {
      e.preventDefault();
      stop();
    } else if (e.key === "ArrowUp" && !draft && turns.length) {
      // The last question back, to change it.
      e.preventDefault();
      setDraft(turns[turns.length - 1]!.question);
    }
  }

  // Its state then comes only from the indexer’s updates (onSemantic, above), which arrive in order; the reply to
  // "enable" is a snapshot that can arrive after a later update (a fast failure) and would undo it.
  const enableMeaning = () => { client.semantic("enable").catch(() => {}); };

  return (
    <div className="ask">
      <p className="sr-only" aria-live="polite">{announcement}</p>
      {turns.length === 0 ? (
        <section className="ask-empty" aria-labelledby="ask-title">
          <h2 id="ask-title" className="ask-title">{t("ask.title")}</h2>
          <p className="ask-lede">{t("ask.lede")}</p>
          <ul className="ask-examples" aria-label={t("ask.examples")}>
            {SUGGESTIONS.map(([q, hint, ExampleIcon]) => (
              <li key={q}>
                <button type="button" className="ask-example" onClick={() => send(t(q))}>
                  <span className="ask-example-icon" aria-hidden="true"><ExampleIcon size={18} /></span>
                  <span className="ask-example-text">
                    <span className="ask-example-q">{t(q)}</span>
                    <span className="ask-example-hint">{t(hint)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section className="ask-thread" aria-label={t("ask.conversation")}>
          <div className="ask-thread-head">
            <button type="button" className="link-btn" onClick={() => { inFlight.current?.abort(); setTurns([]); setAnnouncement(""); input.current?.focus(); }}>
              <SquarePen size={16} />{t("ask.newConversation")}
            </button>
          </div>
          <ol className="turns" ref={thread}>
            {turns.map((turn, i) => {
              const before = i > 0 ? turns[i - 1]!.filters : null;
              // The scope is said when it is not the whole chat at the start, and whenever it changes.
              const changed = before ? scopeKey(before) !== scopeKey(turn.filters) : scopeKey(turn.filters) !== scopeKey({ start: null, end: null, sender: null });
              return (
                <li key={turn.id} className="turn">
                  {changed && <p className="turn-scope"><span>{t("ask.scopeChange", { scope: turn.scope })}</span></p>}
                  <div className="turn-q">
                    <p className="turn-bubble"><span className="sr-only">{t("ask.you")} </span>{turn.question}</p>
                  </div>
                  <article className="turn-a" aria-label={t("ask.answer")} aria-busy={turn.state.status === "pending"}>
                    {turn.state.status === "pending" && (
                      <p className="ans-pending">
                        <span className="dots" aria-hidden="true"><i /><i /><i /></span>
                        {turn.state.stage === "indexing" ? t("x_indexing") : t("ask.working")}
                      </p>
                    )}
                    {turn.state.status === "done" && (
                      <AnswerView answer={turn.state.answer} client={client} semantic={semantic} onEnableMeaning={enableMeaning} onAskAgain={() => send(turn.question)} />
                    )}
                    {(turn.state.status === "stopped" || turn.state.status === "failed") && (
                      <div className={`ans-halt ${turn.state.status}`} role={turn.state.status === "failed" ? "alert" : undefined}>
                        <p>{t(turn.state.status === "failed" ? "ask.failed" : "ask.stopped")}</p>
                        {i === turns.length - 1 && (
                          <button type="button" className="btn ghost" disabled={pending} onClick={() => send(turn.question)}>
                            <RotateCcw size={16} />{t("ask.retry")}
                          </button>
                        )}
                      </div>
                    )}
                  </article>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      <div className="ask-dock">
        <form className="composer" onSubmit={(e) => { e.preventDefault(); send(draft); }}>
          <label htmlFor="ask-input" className="sr-only">{t("ask.input")}</label>
          <textarea
            id="ask-input"
            ref={input}
            rows={1}
            value={draft}
            maxLength={MAX_QUESTION}
            placeholder={t("ask.placeholder")}
            enterKeyHint="send"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            onCompositionStart={() => { composing.current = true; }}
            onCompositionEnd={() => { composing.current = false; }}
          />
          <div className="composer-bar">
            <div className="composer-scope" role="group" aria-label={t("ask.scope")}>
              <ParticipantPicker stats={stats} people={people} sender={sender} onSender={(s) => onFilters(dates, s)} />
              <DateFilter stats={stats} selection={dates} onApply={(d) => onFilters(d, sender)} />
            </div>
            {/* One button, so focus stays on it when sending turns into stopping and back. */}
            <button
              type={pending ? "button" : "submit"}
              className={pending ? "composer-send stop" : "composer-send"}
              aria-label={pending ? t("ask.stop") : t("ask.send")}
              title={pending ? t("ask.stop") : t("ask.send")}
              disabled={!pending && !draft.trim()}
              onClick={pending ? (e) => { e.preventDefault(); stop(); } : undefined}
            >
              {pending ? <Square size={18} /> : <ArrowUp size={18} />}
            </button>
          </div>
        </form>
        <p className="ask-footnote">{t("ask.footnote")}</p>
      </div>
    </div>
  );
}
