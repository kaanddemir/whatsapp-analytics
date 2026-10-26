/* The Recap player: a full-screen, chaptered story over the whole
   chat, ignoring the dashboard filters. Story content comes from buildStory;
   this component owns only playback, navigation, focus and announcements.

   Clock: the active progress segment's fill is a CSS animation lasting the
   scene's duration, and its own animationend advances the story, so the
   progress bar and the scene timing cannot drift. Pausing (button, Space, a
   long press, or the tab being hidden) pauses that fill and every scene
   animation together, and resuming continues both from where they stopped.
   Scenes are keyed by index, so leaving one unmounts it with its frames and
   timers, and returning to it replays it from the start.

   Reduced motion: the story opens paused and every figure rests in its final
   state; arrows, swipes and taps navigate. Play is still offered, as an
   explicit choice, and then only the progress fill moves.

   Controls: arrows, tap (left third back, elsewhere forward), horizontal
   swipe, Space or a long press to pause, Escape or the close button to
   leave. Focus is trapped inside and returns to the trigger on close. */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronLeft, ChevronRight, Pause, Play, X } from "lucide-react";
import type { Stats } from "@/model";
import { useI18n } from "@/ui/i18n";
import type { TranslationKey } from "@/i18n/en";
import { Finale } from "./Finale";
import { Playback, SceneView } from "./scenes";
import { buildStory, type Scene } from "./story";
import { groundVars } from "./tokens";
import "./recap.css";

const HOLD_MS = 280;
const SWIPE_PX = 48;
const MOVE_TOLERANCE_PX = 10;

const query = "(prefers-reduced-motion: reduce)";
const prefersReduced = () => typeof matchMedia === "function" && matchMedia(query).matches;

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReduced);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const list = matchMedia(query);
    const on = () => setReduced(list.matches);
    list.addEventListener?.("change", on);
    return () => list.removeEventListener?.("change", on);
  }, []);
  return reduced;
}


interface Props {
  stats: Stats;
  onClose: () => void;
}

export function Recap({ stats, onClose }: Props) {
  const { locale, t } = useI18n();
  const story = useMemo(() => buildStory(stats, locale, t), [stats, locale, t]);
  const scenes = story.scenes;
  const reduced = useReducedMotion();
  const [index, setIndexState] = useState(0);
  const [userPaused, setUserPaused] = useState(reduced);
  const [held, setHeld] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [run, setRun] = useState(0);
  const overlay = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ x: number; y: number; at: number; moved: boolean; held: boolean } | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout>>();

  const last = scenes.length - 1;
  const at = Math.min(index, last);
  const scene = scenes[at]!;
  const paused = userPaused || held || hidden;

  const setIndex = useCallback((fn: (i: number) => number) => setIndexState((i) => Math.max(0, Math.min(fn(i), last))), [last]);
  const next = useCallback(() => setIndex((i) => i + 1), [setIndex]);
  const prev = useCallback(() => setIndex((i) => i - 1), [setIndex]);
  const replay = useCallback(() => {
    setIndexState(0);
    setRun((r) => r + 1);
    setUserPaused(reduced);
  }, [reduced]);

  // Turning reduced motion on mid-story stops autoplay at once.
  useEffect(() => {
    if (reduced) setUserPaused(true);
  }, [reduced]);

  useEffect(() => {
    overlay.current?.focus();
    document.body.classList.add("sheet-open");
    const onVisibility = () => setHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.body.classList.remove("sheet-open");
      document.removeEventListener("visibilitychange", onVisibility);
      clearTimeout(holdTimer.current);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const control = e.target instanceof HTMLButtonElement || e.target instanceof HTMLInputElement;
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        prev();
      } else if (e.key === " " && !control) {
        e.preventDefault();
        setUserPaused((p) => !p);
      } else if (e.key === "Tab" && overlay.current) {
        const items = [...overlay.current.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])")];
        if (items.length === 0) return;
        const first = items[0]!;
        const end = items[items.length - 1]!;
        const active = document.activeElement;
        if (e.shiftKey && (active === first || !overlay.current.contains(active) || active === overlay.current)) {
          e.preventDefault();
          end.focus();
        } else if (!e.shiftKey && active === end) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [next, prev, onClose]);

  // Gestures on the stage: a press that stays put long enough pauses until
  // release; a horizontal drag past the threshold swipes; a short still press
  // taps. Real controls are excluded, so pressing a button never navigates.
  const interactive = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest("button, input, label, a"));
  const pointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (interactive(e.target) || (e.pointerType === "mouse" && e.button !== 0)) return;
    gesture.current = { x: e.clientX, y: e.clientY, at: e.timeStamp, moved: false, held: false };
    clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(() => {
      if (gesture.current && !gesture.current.moved) {
        gesture.current.held = true;
        setHeld(true);
      }
    }, HOLD_MS);
  };
  const pointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (g && !g.moved && Math.hypot(e.clientX - g.x, e.clientY - g.y) > MOVE_TOLERANCE_PX) {
      g.moved = true;
      clearTimeout(holdTimer.current);
    }
  };
  const pointerEnd = (e: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    clearTimeout(holdTimer.current);
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.held) {
      setHeld(false);
      return;
    }
    if (cancelled) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0) next();
      else prev();
      return;
    }
    // The finale is for its controls: a stray tap there must not navigate.
    if (g.moved || scene.kind === "finale") return;
    const box = e.currentTarget.getBoundingClientRect();
    if (box.width && e.clientX - box.left < box.width / 3) prev();
    else next();
  };

  const chapters = useMemo(() => [...new Set(scenes.map((s) => s.chapter))], [scenes]);
  const playable = scene.duration > 0;
  const style = { ...groundVars(scene.ground) } as CSSProperties;

  return (
    <div
      ref={overlay}
      className={`rc${paused ? " is-paused" : ""}${reduced ? " is-reduced" : ""}`}
      style={style}
      data-ground={scene.ground}
      role="dialog"
      aria-modal="true"
      aria-label={t("rcDialog")}
      tabIndex={-1}
    >
      <div className="rc-top">
        <div className="rc-progress" aria-hidden="true">
          {scenes.map((s, i) => (
            <div key={i} className={`rc-seg${i < at || (i === at && !s.duration) ? " done" : ""}${i === at && s.duration ? " active" : ""}${i > 0 && scenes[i - 1]!.chapter !== s.chapter ? " chapter-start" : ""}`}>
              {i === at && s.duration ? (
                <i key={`fill-${at}-${run}`} className="rc-fill" style={{ animationDuration: `${s.duration}ms` }} onAnimationEnd={(e) => e.target === e.currentTarget && next()} />
              ) : (
                <i />
              )}
            </div>
          ))}
        </div>
        <div className="rc-bar">
          <p className="rc-chapter">
            <span className="rc-chapter-n" aria-hidden="true">{String(chapters.indexOf(scene.chapter) + 1).padStart(2, "0")}</span>
            {t(`rcChapter.${scene.chapter}` as TranslationKey)}
          </p>
          <div className="rc-tools">
            {playable && (
              <button type="button" className="rc-btn" onClick={() => setUserPaused((p) => !p)} aria-label={userPaused ? t("rcPlay") : t("rcPause")} aria-pressed={userPaused}>
                {userPaused ? <Play size={20} /> : <Pause size={20} />}
              </button>
            )}
            <button type="button" className="rc-btn" onClick={onClose} aria-label={t("rcClose")}>
              <X size={20} />
            </button>
          </div>
        </div>
      </div>

      <div
        className="rc-stage"
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={(e) => pointerEnd(e)}
        onPointerCancel={(e) => pointerEnd(e, true)}
      >
        <Playback.Provider value={{ paused, reduced, locale }}>
          <div key={`${at}-${run}`} className="rc-slide" role="group" aria-label={t("rcSceneOf", { n: at + 1, total: scenes.length })}>
            {scene.kind === "finale" ? <Finale scene={scene} onReplay={replay} /> : <SceneView scene={scene as Exclude<Scene, { kind: "finale" }>} />}
          </div>
        </Playback.Provider>
      </div>

      <div className="rc-nav">
        <button type="button" className="rc-btn rc-nav-prev" onClick={prev} disabled={at === 0} aria-label={t("rcPrev")}>
          <ChevronLeft size={20} />
        </button>
        {/* With reduced motion the first scene explains why nothing advances. */}
        {reduced && userPaused && at === 0
          ? <p className="rc-hint">{t("rcManual")}</p>
          : <p className="rc-counter" aria-hidden="true">{at + 1} / {scenes.length}</p>}
        <button type="button" className="rc-btn rc-nav-next" onClick={next} disabled={at === last} aria-label={t("rcNext")}>
          <ChevronRight size={20} />
        </button>
      </div>

      {paused && playable && !reduced && <span className="rc-pip" aria-hidden="true">{t("rcPaused")}</span>}
      <p className="sr-only" aria-live="polite" aria-atomic="true">{`${t("rcSceneOf", { n: at + 1, total: scenes.length })}. ${scene.summary}`}</p>
    </div>
  );
}
