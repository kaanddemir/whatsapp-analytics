/* Recap scenes: one renderer per scene kind, built from the shared families.

   Every scene is a full-bleed composition with two regions, the figure and
   the copy, placed by the family's layout (data-layout) and re-arranged for
   portrait and landscape purely in recap.css through container queries on the
   stage. Scenes never scroll: type and figures size to the stage.

   Copy rule: one insight, a kicker, at most two short supporting lines. */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { formatCount } from "@/i18n/format";
import type { Locale } from "@/i18n/types";
import { Camera, CirclePlay, Contact, FileText, ImagePlay, LayoutGrid, Mic, Sticker, Video, type LucideIcon } from "lucide-react";
import type { MediaKind } from "@/model";
import {
  delay, Dial, DotField, HourStrip, NightRing, OpeningFigure, PeakColumns, pColor, Ribbon, SplitRegions, StarterBubbles, StreakPath, WeekColumns,
} from "./figures";
import type {
  BalanceScene, BehaviorScene, ClockScene, DividerScene, HighlightScene, OpeningScene, Scene, SharedScene, TimelineScene, VolumeScene, WeekScene, WordsScene,
} from "./story";

/** One line icon per media type, inside the media tiles. */
const MEDIA_ICONS: Record<MediaKind, LucideIcon> = {
  Photos: Camera, Videos: Video, "Video notes": CirclePlay, "Voice notes": Mic, Stickers: Sticker,
  GIFs: ImagePlay, Documents: FileText, Contacts: Contact, Other: LayoutGrid,
};
function MediaIcon({ kind }: { kind: MediaKind }) {
  const KindIcon = MEDIA_ICONS[kind] ?? LayoutGrid;
  return <KindIcon />;
}

/** What scenes need from the player: the clock state, never the timer. */
export interface PlaybackState {
  readonly paused: boolean;
  readonly reduced: boolean;
  readonly locale: Locale;
}
export const Playback = createContext<PlaybackState>({ paused: false, reduced: false, locale: "en" });

/** Counts a number up in step with its figure. It only advances while the
    story plays, so pausing freezes it with everything else; reduced motion
    shows the final value at once. The final value is always what assistive
    technology reads, and its width is reserved so the layout never shifts. */
export function CountUp({ value, start = 300, duration = 1100 }: { value: number; start?: number; duration?: number }) {
  const { paused, reduced, locale } = useContext(Playback);
  const instant = reduced || value < 10 || typeof requestAnimationFrame !== "function";
  const [shown, setShown] = useState(instant ? value : 0);
  const elapsed = useRef(0);
  useEffect(() => {
    if (instant) {
      setShown(value);
      return;
    }
    if (paused || elapsed.current >= start + duration) return;
    let frame = 0;
    let last = 0;
    const step = (now: number) => {
      if (last) elapsed.current += now - last;
      last = now;
      const t = Math.min(Math.max(elapsed.current - start, 0) / duration, 1);
      setShown(Math.round(value * (1 - Math.pow(1 - t, 3))));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, paused, instant, start, duration]);
  const final = formatCount(value, locale);
  return (
    <span className="rc-count" style={{ minWidth: `${final.length}ch` }}>
      <span aria-hidden="true">{formatCount(shown, locale)}</span>
      <span className="sr-only">{final}</span>
    </span>
  );
}

/** The formatted number's length, which bounds its display size to the column. */
const chars = (value: number, locale: Locale) => ({ ["--chars" as string]: Math.max(3, formatCount(value, locale).length) });

function Kicker({ children, at = 0 }: { children: ReactNode; at?: number }) {
  return <p className="rc-kicker rc-a-rise" style={delay(at)}>{children}</p>;
}

function Line({ children, at, className = "" }: { children: ReactNode; at: number; className?: string }) {
  return <p className={`rc-line rc-a-rise ${className}`} style={delay(at)}>{children}</p>;
}

function Frame({ scene, layout, figure, children, flip = false }: { scene: Scene; layout: string; figure: ReactNode; children: ReactNode; flip?: boolean }) {
  return (
    <div className={`rc-scene rc-family-${scene.family}`} data-kind={scene.kind} data-layout={layout} data-flip={flip || undefined}>
      <div className="rc-figure">{figure}</div>
      <div className="rc-copy">{children}</div>
    </div>
  );
}

function Opening({ s }: { s: OpeningScene }) {
  return (
    <Frame scene={s} layout="hero" figure={<OpeningFigure mode={s.mode} people={s.people} more={s.more} />}>
      <Kicker>{s.kicker}</Kicker>
      <h2 className="rc-display rc-title rc-a-rise" style={delay(150)}><bdi>{s.title}</bdi></h2>
      <Line at={450}>{s.subtitle}</Line>
      <Line at={600} className="rc-muted">{s.span}</Line>
    </Frame>
  );
}

function Volume({ s }: { s: VolumeScene }) {
  const { locale } = useContext(Playback);
  return (
    <Frame scene={s} layout="spot" figure={<DotField dots={s.dots} partial={s.partial} />}>
      <Kicker>{s.kicker}</Kicker>
      <p className="rc-display rc-number rc-a-rise" style={{ ...delay(150), ...chars(s.total, locale) }}><CountUp value={s.total} start={300} duration={1100} /></p>
      <Line at={500} className="rc-strong">{s.unitLabel} · {s.days}</Line>
      {(s.perDay || s.words) && <Line at={1500}>{[s.perDay, s.words].filter(Boolean).join(" · ")}</Line>}
      {s.legend && <Line at={1700} className="rc-muted rc-legend"><span className="rc-key-dot" aria-hidden="true" />{s.legend}</Line>}
    </Frame>
  );
}

function Timeline({ s }: { s: TimelineScene }) {
  return (
    <Frame scene={s} layout="wide" figure={<><Ribbon bars={s.bars} peak={s.peak} /><p className="rc-axis" aria-hidden="true"><span>{s.axis[0]}</span><span>{s.axis[1]}</span></p></>}>
      <Kicker>{s.kicker}</Kicker>
      <h2 className="rc-display rc-headline rc-reveal rc-a-rise" style={delay(1300)}>{s.month}</h2>
      <Line at={1500} className="rc-strong">{s.count}</Line>
      <Line at={1650} className="rc-muted">{s.of}</Line>
    </Frame>
  );
}

function Divider({ s }: { s: DividerScene }) {
  return (
    <Frame scene={s} layout="hero" figure={<Dial hours={Array.from({ length: 24 }, () => 0)} peak={-1} compact />}>
      <h2 className="rc-display rc-title rc-a-rise" style={delay(300)}>{s.title}</h2>
      <Line at={600} className="rc-muted">{s.subtitle}</Line>
    </Frame>
  );
}

function Clock({ s }: { s: ClockScene }) {
  return (
    <Frame scene={s} layout="spot" flip figure={<Dial hours={s.hours} peak={s.peak} />}>
      <Kicker>{s.kicker}</Kicker>
      <h2 className="rc-display rc-headline rc-reveal rc-a-rise" style={delay(1400)}>{s.range}</h2>
      <Line at={1650} className="rc-strong">{s.share}</Line>
    </Frame>
  );
}

function Week({ s }: { s: WeekScene }) {
  const slotAt = 2600;
  return (
    <Frame
      scene={s}
      layout="wide"
      figure={
        <div className="rc-week-wrap">
          <WeekColumns averages={s.averages} labels={s.labels} peak={s.peak} />
          {s.slot && (
            <div className="rc-slot rc-a-rise" style={delay(slotAt)}>
              <p className="rc-kicker">{s.slot.kicker}</p>
              <HourStrip hours={s.slot.hours} peak={s.slot.peak} start={slotAt + 150} />
              <p className="rc-line rc-strong">{s.slot.text}</p>
            </div>
          )}
        </div>
      }
    >
      <Kicker>{s.kicker}</Kicker>
      <h2 className="rc-display rc-headline rc-reveal rc-a-rise" style={delay(1000)}>{s.day}</h2>
      <Line at={1200} className="rc-strong">{s.detail}</Line>
    </Frame>
  );
}

function Balance({ s }: { s: BalanceScene }) {
  const duo = s.mode === "duo";
  return (
    <Frame scene={s} layout="compare" figure={<SplitRegions segments={s.segments} others={s.others} showLabels={duo} />}>
      <Kicker>{s.kicker}</Kicker>
      {duo ? (
        <h2 className="rc-display rc-headline rc-a-rise" style={delay(1200)}>
          <bdi>{s.segments[0]!.name}</bdi> <span className="rc-reveal">{s.segments[0]!.share}</span>
        </h2>
      ) : null}
      <ul className="rc-legend-list">
        {(duo ? s.segments : s.legend).map((p, i) => (
          <li key={p.id} className="rc-a-rise" style={delay(1000 + i * 110)}>
            <span className="rc-swatch" style={{ background: pColor(p) }} aria-hidden="true" />
            <bdi className="rc-legend-name">{p.name}</bdi>
            <span className="rc-legend-value">{p.share}</span>
          </li>
        ))}
        {!duo && s.others && (
          <li className="rc-a-rise" style={delay(1000 + s.legend.length * 110)}>
            <span className="rc-swatch" style={{ background: "var(--rc-muted)" }} aria-hidden="true" />
            <span className="rc-legend-name">{s.others.label}</span>
            <span className="rc-legend-value">{s.others.share}</span>
          </li>
        )}
      </ul>
    </Frame>
  );
}

function Behavior({ s }: { s: BehaviorScene }) {
  const second = s.starter ? 3400 : 0;
  return (
    <div className="rc-scene rc-family-comparison" data-kind="behavior" data-layout="beats" data-beats={s.starter && s.owl ? 2 : 1}>
      {s.starter && (
        <div className="rc-beat">
          <div className="rc-figure"><StarterBubbles bubbles={s.starter.bubbles} filled={s.starter.filled} person={s.starter.person} start={300} /></div>
          <div className="rc-copy">
            <Kicker>{s.starter.kicker}</Kicker>
            <h2 className="rc-display rc-headline rc-a-rise" style={delay(700)}>
              <span className="rc-swatch big" style={{ background: pColor(s.starter.person) }} aria-hidden="true" /><bdi>{s.starter.person.name}</bdi>
            </h2>
            <Line at={900} className="rc-strong">{s.starter.text}</Line>
            {s.starter.legend && <Line at={1000} className="rc-muted">{s.starter.legend}</Line>}
          </div>
        </div>
      )}
      {s.owl && (
        <div className="rc-beat rc-night">
          <div className="rc-figure"><NightRing share={s.owl.share} start={second + 300} /></div>
          <div className="rc-copy">
            <Kicker at={second}>{s.owl.kicker}</Kicker>
            <h2 className="rc-display rc-headline rc-a-rise" style={delay(second + 500)}>
              <span className="rc-swatch big" style={{ background: pColor(s.owl.person) }} aria-hidden="true" /><bdi>{s.owl.person.name}</bdi>
            </h2>
            <Line at={second + 800} className="rc-strong">{s.owl.text}</Line>
          </div>
        </div>
      )}
    </div>
  );
}

function Shared({ s }: { s: SharedScene }) {
  const emojiMax = Math.max(1, ...(s.emoji?.items.map((e) => e.count) ?? [1]));
  const mediaMax = Math.max(1, ...(s.media?.items.map((m) => m.count) ?? [1]));
  const mediaAt = s.emoji ? 1300 : 200;
  return (
    <div className="rc-scene rc-family-spotlight" data-kind="shared" data-layout="beats" data-beats={s.emoji && s.media ? 2 : 1}>
      {s.emoji && (
        <div className="rc-beat">
          <div className="rc-figure">
            {/* Circle area is proportional to use, so sizes scale with the square root. */}
            <ol className="rc-emoji" aria-hidden="true" style={{ ["--sum" as string]: s.emoji.items.reduce((a, e) => a + Math.sqrt(e.count / emojiMax), 0).toFixed(3) }}>
              {s.emoji.items.map((e, i) => (
                <li key={e.glyph} className={`rc-a-pop${i === 0 ? " is-peak" : ""}`} style={{ ["--s" as string]: Math.sqrt(e.count / emojiMax).toFixed(3), ...delay(250 + i * 150) }}>
                  <span className="rc-emoji-glyph">{e.glyph}</span>
                  <span className="rc-emoji-count">{e.label}</span>
                </li>
              ))}
            </ol>
          </div>
          <div className="rc-copy">
            <Kicker>{s.emoji.kicker}</Kicker>
            <p className="rc-display rc-headline rc-a-rise" style={delay(900)}>{s.emoji.items[0]!.glyph} <span className="rc-reveal">{s.emoji.items[0]!.label}</span></p>
          </div>
        </div>
      )}
      {s.media && (
        <div className="rc-beat">
          <div className="rc-figure">
            <ul className="rc-media" aria-hidden="true">
              {s.media.items.map((m, i) => (
                <li key={m.label} className="rc-a-pop" style={{ ["--s" as string]: Math.sqrt(m.count / mediaMax).toFixed(3), ...delay(mediaAt + 200 + i * 140) }}>
                  <span className="rc-media-tile"><MediaIcon kind={m.kind} /></span>
                  <span className="rc-media-text"><b>{m.text}</b> {m.label}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rc-copy">
            <Kicker at={mediaAt}>{s.media.kicker}</Kicker>
            <p className="rc-display rc-headline rc-a-rise" style={delay(mediaAt + 300)}>{s.media.total}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function Words({ s }: { s: WordsScene }) {
  return (
    <Frame
      scene={s}
      layout="wide"
      figure={
        <ol className="rc-words" aria-hidden="true">
          {s.words.map((w, i) => (
            <li key={w.word} className={`rc-a-rise${i === 0 ? " is-peak" : ""}`} style={{ ["--w" as string]: (0.42 + 0.58 * w.weight).toFixed(3), ...delay(300 + i * 160) }}>
              <bdi className="rc-word">{w.word}</bdi>
              <span className="rc-word-count">{w.label}</span>
            </li>
          ))}
        </ol>
      }
    >
      <Kicker>{s.kicker}</Kicker>
    </Frame>
  );
}

function Highlight({ s }: { s: HighlightScene }) {
  const { locale } = useContext(Playback);
  if (s.pick === "streak") {
    return (
      <Frame scene={s} layout="spot" figure={<StreakPath dots={s.dots} />}>
        <Kicker>{s.kicker}</Kicker>
        <p className="rc-display rc-number rc-reveal rc-a-rise" style={{ ...delay(150), ...chars(s.days, locale) }}><CountUp value={s.days} start={300} duration={1100} /></p>
        <Line at={500} className="rc-strong">{s.unit}</Line>
        <Line at={1500} className="rc-muted">{s.range}</Line>
        {s.legend && <Line at={1600} className="rc-muted">{s.legend}</Line>}
      </Frame>
    );
  }
  return (
    <Frame scene={s} layout="spot" flip figure={<PeakColumns average={s.average} count={s.count} averageLabel={s.averageLabel} countLabel={s.countText} />}>
      <Kicker>{s.kicker}</Kicker>
      <h2 className="rc-display rc-headline rc-reveal rc-a-rise" style={delay(900)}>{s.date}</h2>
      <Line at={1100} className="rc-strong">{s.countText} · {s.times}</Line>
      {s.streak && <Line at={1400} className="rc-muted">{s.streak}</Line>}
    </Frame>
  );
}

/** Renders any non-finale scene. */
export function SceneView({ scene }: { scene: Exclude<Scene, { kind: "finale" }> }) {
  switch (scene.kind) {
    case "opening": return <Opening s={scene} />;
    case "volume": return <Volume s={scene} />;
    case "timeline": return <Timeline s={scene} />;
    case "divider": return <Divider s={scene} />;
    case "clock": return <Clock s={scene} />;
    case "week": return <Week s={scene} />;
    case "balance": return <Balance s={scene} />;
    case "behavior": return <Behavior s={scene} />;
    case "shared": return <Shared s={scene} />;
    case "words": return <Words s={scene} />;
    case "highlight": return <Highlight s={scene} />;
  }
}
