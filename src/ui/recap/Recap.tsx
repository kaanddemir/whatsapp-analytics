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
   leave. The rest of the page is inert while open, so focus cannot leave; a
   focused control that gets disabled or removed hands focus to the dialog, and
   focus returns to the trigger on close.

   A press captures its pointer, so releasing anywhere ends the gesture; blur
   and pointer cancel end it too, so a hold can never outlive the press.

   Scenes fit the stage. When a scene cannot (400% zoom, a very short window,
   large text) the stage scrolls instead of clipping, and autoplay stops there
   so the viewer has time to read. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
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
  /** Where focus goes on close; defaults to whatever had focus on open. */
  returnFocusTo?: RefObject<HTMLElement>;
}

/** Makes everything outside `root` inert; returns the undo. Only touches what it changed. */
function inertOutside(root: HTMLElement): () => void {
  const changed: Element[] = [];
  for (let node: Element = root; node.parentElement; node = node.parentElement) {
    for (const sibling of node.parentElement.children) {
      if (sibling === node || sibling.hasAttribute("inert")) continue;
      sibling.setAttribute("inert", "");
      changed.push(sibling);
    }
  }
  return () => changed.forEach((el) => el.removeAttribute("inert"));
}

export function Recap({ stats, onClose, returnFocusTo }: Props) {
  const { locale, t } = useI18n();
  const story = useMemo(() => buildStory(stats, locale, t), [stats, locale, t]);
  const scenes = story.scenes;
  const reduced = useReducedMotion();
  const [index, setIndexState] = useState(0);
  const [userPaused, setUserPaused] = useState(reduced);
  const [held, setHeld] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [run, setRun] = useState(0);
  // Lives here, not in the finale, so leaving that scene and coming back cannot turn it off.
  const [hideNames, setHideNames] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const overlay = useRef<HTMLDivElement>(null);
  // Read while rendering: the effects below move focus into the dialog.
  const opener = useRef(document.activeElement);
  const stageRef = useRef<HTMLDivElement>(null);
  const slideRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ x: number; y: number; at: number; moved: boolean; held: boolean } | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout>>();

  const last = scenes.length - 1;
  const at = Math.min(index, last);
  const scene = scenes[at]!;
  const paused = userPaused || held || hidden;
  const playable = scene.duration > 0;

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

  // Ends a press without acting on it: nothing may stay held once it is over.
  const endGesture = useCallback(() => {
    clearTimeout(holdTimer.current);
    gesture.current = null;
    setHeld(false);
  }, []);

  useEffect(() => {
    const root = overlay.current!;
    const restore = inertOutside(root);
    root.focus();
    document.body.classList.add("sheet-open");
    const onVisibility = () => {
      setHidden(document.visibilityState === "hidden");
      if (document.visibilityState === "hidden") endGesture();
    };
    // Anything that still takes focus outside (a new sibling) is sent back.
    const onFocusIn = (e: FocusEvent) => {
      if (e.target instanceof Node && !root.contains(e.target)) root.focus();
    };
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("focusin", onFocusIn);
    window.addEventListener("blur", endGesture);
    return () => {
      document.body.classList.remove("sheet-open");
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("blur", endGesture);
      clearTimeout(holdTimer.current);
      restore();
      // After the page is interactive again: an inert element cannot take focus.
      const back = returnFocusTo?.current ?? opener.current;
      if (back instanceof HTMLElement && back.isConnected) back.focus({ preventScroll: true });
    };
  }, [endGesture, returnFocusTo]);

  // A focused control can be disabled (Next on the last scene) or removed
  // (Pause on the finale, Watch again on replay) by the scene change itself.
  useLayoutEffect(() => {
    const root = overlay.current!;
    const active = document.activeElement;
    if (!active || !root.contains(active) || (active as HTMLButtonElement).disabled) root.focus({ preventScroll: true });
    if (stageRef.current) stageRef.current.scrollTop = 0;
  }, [at, run]);

  // Layout heights, not scrollHeight: an entrance transform must not read as overflow.
  useEffect(() => {
    const stage = stageRef.current;
    const slide = slideRef.current;
    if (!stage || !slide || typeof ResizeObserver !== "function") return;
    const measure = () => setOverflowing(slide.offsetHeight > stage.clientHeight + 1);
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    observer.observe(slide);
    measure();
    return () => observer.disconnect();
  }, [at, run]);

  useEffect(() => {
    if (overflowing) setUserPaused(true);
  }, [overflowing, at]);

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
      } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && stageRef.current?.classList.contains("is-scroll")) {
        e.preventDefault();
        stageRef.current.scrollBy({ top: e.key === "ArrowDown" ? 64 : -64 });
      } else if (e.key === " " && !control) {
        e.preventDefault();
        // Nothing plays on the finale: a silent toggle there would surface later.
        if (playable) setUserPaused((p) => !p);
      } else if (e.key === "Tab" && overlay.current) {
        const items = [...overlay.current.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), .rc-stage[tabindex='0']")];
        if (items.length === 0) return;
        // One cycle everywhere: Safari's own Tab skips buttons unless the system says otherwise.
        e.preventDefault();
        const from = items.indexOf(document.activeElement as HTMLElement);
        const to = from < 0 ? (e.shiftKey ? items.length - 1 : 0) : (from + (e.shiftKey ? -1 : 1) + items.length) % items.length;
        items[to]!.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [next, prev, onClose, playable]);

  // Gestures on the stage: a press that stays put long enough pauses until
  // release; a horizontal drag past the threshold swipes; a short still press
  // taps. Real controls are excluded, so pressing a button never navigates.
  const interactive = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest("button, input, label, a"));
  const pointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (interactive(e.target) || (e.pointerType === "mouse" && e.button !== 0)) return;
    // The stage's own scrollbar is not the story.
    const box = e.currentTarget;
    if (box.classList.contains("is-scroll") && e.clientX > box.getBoundingClientRect().left + box.clientWidth) return;
    try {
      box.setPointerCapture?.(e.pointerId);
    } catch {
      // Not a live pointer (synthetic events); blur and cancel still end the gesture.
    }
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
  const pointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    endGesture();
    if (!g || g.held) return;
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
  const style = { ...groundVars(scene.ground) } as CSSProperties;

  return (
    <div
      ref={overlay}
      className={`rc${paused ? " is-paused" : ""}${reduced ? " is-reduced" : ""}`}
      style={style}
      role="dialog"
      aria-modal="true"
      aria-labelledby="rc-title"
      tabIndex={-1}
    >
      <h1 id="rc-title" className="sr-only">{t("rcDialog")}</h1>
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
            <span className="rc-chapter-name">{t(`rcChapter.${scene.chapter}` as TranslationKey)}</span>
          </p>
          <div className="rc-tools">
            {playable && (
              <button type="button" className="rc-btn rc-btn-play" onClick={() => setUserPaused((p) => !p)} aria-label={userPaused ? t("rcPlay") : t("rcPause")}>
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
        ref={stageRef}
        className={`rc-stage${overflowing ? " is-scroll" : ""}`}
        tabIndex={overflowing ? 0 : undefined}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerEnd}
        onPointerCancel={endGesture}
        onLostPointerCapture={endGesture}
      >
        <Playback.Provider value={{ paused, reduced, locale }}>
          <div ref={slideRef} key={`${at}-${run}`} className="rc-slide" role="group" aria-label={t("rcSceneOf", { n: at + 1, total: scenes.length })}>
            {scene.kind === "finale" ? <Finale scene={scene} hideNames={hideNames} onHideNames={setHideNames} onReplay={replay} /> : <SceneView scene={scene as Exclude<Scene, { kind: "finale" }>} />}
          </div>
        </Playback.Provider>
      </div>

      <div className="rc-nav">
        <button type="button" className="rc-btn rc-nav-prev" onClick={prev} disabled={at === 0} aria-label={t("rcPrev")}>
          <ChevronLeft size={20} />
        </button>
        {/* The status takes the counter's place: chrome, never over the scene.
            With reduced motion the first scene explains why nothing advances. */}
        {reduced && userPaused && at === 0
          ? <p className="rc-hint">{t("rcManual")}</p>
          : paused && playable && !reduced
            ? <p className="rc-pip" aria-hidden="true">{t("rcPaused")}</p>
            : <p className="rc-counter" aria-hidden="true">{at + 1} / {scenes.length}</p>}
        <button type="button" className="rc-btn rc-nav-next" onClick={next} disabled={at === last} aria-label={t("rcNext")}>
          <ChevronRight size={20} />
        </button>
      </div>

      <p className="sr-only" aria-live="polite" aria-atomic="true">{`${t("rcSceneOf", { n: at + 1, total: scenes.length })}. ${scene.kind === "finale" && hideNames ? scene.summaryHidden : scene.summary}`}</p>
      {/* Always mounted, so the change is what gets announced. */}
      <p className="sr-only" role="status">{userPaused && playable && !reduced ? t("rcPausedStatus") : ""}</p>
    </div>
  );
}
