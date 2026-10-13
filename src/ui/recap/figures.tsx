/* Recap figures: the geometric vocabulary, each drawn from data.
     dots      quantities of messages (DotField)
     dial      time of day (Dial, the recurring motif)
     columns   volume over time (Ribbon, WeekColumns, HourStrip, PeakColumns)
     bubbles   messages and people (Bubble, OpeningFigure, StarterBubbles)
     regions   shares between people (SplitRegions)
     path      continuity (StreakPath)
   Figures are decorative to assistive technology (aria-hidden): every scene
   states its insight in text and in its summary.

   Motion lives in recap.css. Elements carry an rc-a-* class and a --d delay
   (ms); every keyframe animates *from* a hidden state, so the resting style is
   the final data state. Reduced motion and pause need nothing else. */
import type { CSSProperties, ReactNode } from "react";
import { initials } from "../format";
import type { Person } from "./story";

const delay = (ms: number): CSSProperties => ({ ["--d" as string]: Math.round(ms) });
const pColor = (p: Pick<Person, "color">) => `var(--rc-p${p.color})`;
/** Spreads `count` items over `span` ms of stagger. */
const stagger = (i: number, count: number, span: number, start = 0) => start + (count <= 1 ? 0 : (i / (count - 1)) * span);

const polar = (r: number, a: number) => [r * Math.cos(a), r * Math.sin(a)] as const;
const fmt = (n: number) => +n.toFixed(2);

/** An annular sector from angle a0 to a1 (radians, 0 = 3 o'clock). */
function sector(r0: number, r1: number, a0: number, a1: number): string {
  const [x0, y0] = polar(r1, a0);
  const [x1, y1] = polar(r1, a1);
  const [x2, y2] = polar(r0, a1);
  const [x3, y3] = polar(r0, a0);
  return `M${fmt(x0)} ${fmt(y0)}A${r1} ${r1} 0 0 1 ${fmt(x1)} ${fmt(y1)}L${fmt(x2)} ${fmt(y2)}A${r0} ${r0} 0 0 0 ${fmt(x3)} ${fmt(y3)}Z`;
}

/** A chat bubble: a rounded rectangle with one square corner as the tail. */
export function bubblePath(x: number, y: number, w: number, h: number, r: number, tail: "left" | "right"): string {
  const bl = tail === "left" ? 0 : r;
  const br = tail === "right" ? 0 : r;
  return [
    `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}`,
    `V${y + h - br}${br ? `A${br} ${br} 0 0 1 ${x + w - br} ${y + h}` : ""}`,
    `H${x + bl}${bl ? `A${bl} ${bl} 0 0 1 ${x} ${y + h - bl}` : ""}`,
    `V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`,
  ].join("");
}

function Svg({ viewBox, className, children }: { viewBox: string; className?: string; children: ReactNode }) {
  return (
    <svg className={`rc-svg ${className ?? ""}`} viewBox={viewBox} preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

/** Hour angle on a 24-hour dial with 00:00 at the top. */
const hourAngle = (h: number) => (h / 24) * Math.PI * 2 - Math.PI / 2;

function DialFace({ r, ticks = true, draw = 0 }: { r: number; ticks?: boolean; draw?: number }) {
  return (
    <g className="rc-dial-face">
      <circle className="rc-a-draw" r={r} pathLength={1} style={delay(draw)} />
      {ticks && Array.from({ length: 24 }, (_, h) => {
        const [x0, y0] = polar(r - (h % 6 ? 3 : 7), hourAngle(h));
        const [x1, y1] = polar(r, hourAngle(h));
        return <line key={h} className="rc-a-fade" x1={fmt(x0)} y1={fmt(y0)} x2={fmt(x1)} y2={fmt(y1)} style={delay(draw + 200 + h * 15)} />;
      })}
    </g>
  );
}

export function OpeningFigure({ mode, people, more }: { mode: "direct" | "group" | "solo"; people: readonly Person[]; more: number }) {
  const bubble = (p: Person | null, x: number, y: number, w: number, h: number, tail: "left" | "right", i: number, label?: string) => (
    <g key={i} className="rc-a-pop" style={delay(500 + i * 140)}>
      <path d={bubblePath(x, y, w, h, Math.min(w, h) * 0.32, tail)} fill={p ? pColor(p) : "var(--rc-muted)"} />
      <text x={x + w / 2} y={y + h / 2} className="rc-svg-label" fill="var(--rc-bg)" fontSize={h * 0.36} textAnchor="middle" dominantBaseline="central">
        {label ?? (p ? initials(p.name) : "")}
      </text>
    </g>
  );
  let bubbles: ReactNode;
  if (mode === "direct" && people.length === 2) {
    bubbles = [bubble(people[0]!, -82, -58, 104, 70, "left", 0), bubble(people[1]!, -22, 4, 104, 70, "right", 1)];
  } else if (mode === "solo" || people.length < 2) {
    bubbles = people[0] ? bubble(people[0], -52, -36, 104, 72, "left", 0) : null;
  } else {
    const items = [...people.map((p) => ({ p, label: undefined as string | undefined })), ...(more ? [{ p: null, label: `+${more}` }] : [])];
    const ring = 66;
    const size = Math.max(30, 56 - items.length * 2.5);
    bubbles = items.map(({ p, label }, i) => {
      const [x, y] = polar(ring, (i / items.length) * Math.PI * 2 - Math.PI / 2);
      return bubble(p, x - size / 2, y - size * 0.36, size, size * 0.72, i % 2 ? "right" : "left", i, label);
    });
  }
  return (
    <Svg viewBox="-120 -120 240 240" className="rc-fig-opening">
      <DialFace r={108} />
      {bubbles}
    </Svg>
  );
}

const MIN_FIELD = 6;

/** One dot per `unit` messages, laid out as a square-ish field. The last dot's
    area is its fraction of a unit, so the field's total area is exact. */
export function DotField({ dots, partial }: { dots: number; partial: number }) {
  const cols = Math.ceil(Math.sqrt(dots));
  const rows = Math.ceil(dots / cols);
  // A few dots sit centred in a field of at least MIN_FIELD cells a side, so
  // one message stays one dot rather than a disc filling the scene.
  const side = Math.max(MIN_FIELD, cols, rows) * 10;
  const ox = (side - cols * 10) / 2;
  const oy = (side - rows * 10) / 2;
  return (
    <Svg viewBox={`${-ox} ${-oy} ${Math.max(side, cols * 10)} ${Math.max(side, rows * 10)}`} className="rc-fig-dots">
      {Array.from({ length: dots }, (_, i) => {
        const last = i === dots - 1;
        return (
          <circle
            key={i}
            className={`rc-a-pop${last && partial < 1 ? " partial" : ""}`}
            cx={(i % cols) * 10 + 5}
            cy={Math.floor(i / cols) * 10 + 5}
            r={fmt(last ? 4 * Math.sqrt(partial) : 4)}
            style={delay(stagger(i, dots, 1100, 300))}
          />
        );
      })}
    </Svg>
  );
}

/** Monthly columns; the peak month is revealed. */
export function Ribbon({ bars, peak }: { bars: readonly number[]; peak: number }) {
  const max = Math.max(1, ...bars);
  const W = bars.length * 10;
  const H = 100;
  const top = (v: number) => H - (v / max) * (H - 8);
  return (
    <Svg viewBox={`0 0 ${W} ${H}`} className="rc-fig-ribbon">
      {bars.map((v, i) => (
        <rect
          key={i}
          className={`rc-a-grow-y${i === peak ? " is-peak" : ""}`}
          x={i * 10 + 1.5}
          y={fmt(top(v))}
          width={7}
          height={fmt(Math.max(v ? 1.5 : 0.6, H - top(v)))}
          rx={1.5}
          style={delay(stagger(i, bars.length, 900, 250))}
        />
      ))}
    </Svg>
  );
}

/** The 24-hour dial: one wedge per hour, sweeping round from midnight, with
    the peak hour revealed in the accent once the sweep lands. */
export function Dial({ hours, peak, compact = false }: { hours: readonly number[]; peak: number; compact?: boolean }) {
  const max = Math.max(1, ...hours);
  const r0 = 34;
  const r1 = 96;
  const half = (Math.PI / 24) * 0.82;
  return (
    <Svg viewBox="-118 -118 236 236" className="rc-fig-dial">
      <DialFace r={r1 + 8} ticks={false} />
      {hours.map((v, h) => {
        const a = hourAngle(h + 0.5);
        const r = v ? r0 + Math.max(3, (v / max) * (r1 - r0)) : r0 + 1;
        return <path key={h} className={`rc-a-sweep${h === peak ? " is-peak" : ""}`} d={sector(r0, r, a - half, a + half)} style={delay(250 + h * 38)} />;
      })}
      {!compact && [0, 6, 12, 18].map((h) => {
        const [x, y] = polar(r0 - 12, hourAngle(h));
        return <text key={h} className="rc-svg-axis rc-a-fade" x={fmt(x)} y={fmt(y)} textAnchor="middle" dominantBaseline="central" style={delay(1200)}>{String(h).padStart(2, "0")}</text>;
      })}
    </Svg>
  );
}

export function WeekColumns({ totals, labels, peak }: { totals: readonly number[]; labels: readonly string[]; peak: number }) {
  const max = Math.max(1, ...totals);
  return (
    <div className="rc-week" aria-hidden="true">
      {totals.map((v, d) => (
        <div key={d} className={`rc-week-col${d === peak ? " is-peak" : ""}`}>
          <span className="rc-week-bar rc-a-grow-y" style={{ ["--h" as string]: `${Math.max(v ? 3 : 1, (v / max) * 100)}%`, ...delay(250 + d * 90) }} />
          <span className="rc-week-label">{labels[d]}</span>
        </div>
      ))}
    </div>
  );
}

/** One weekday's 24 hours as a single readable strip, peak hour revealed. */
export function HourStrip({ hours, peak, start }: { hours: readonly number[]; peak: number; start: number }) {
  const max = Math.max(1, ...hours);
  return (
    <div className="rc-strip" aria-hidden="true">
      <div className="rc-strip-cells">
        {hours.map((v, h) => (
          <i key={h} className={`rc-a-pop${h === peak ? " is-peak" : ""}`} style={{ ["--v" as string]: v ? (0.18 + 0.82 * (v / max)).toFixed(3) : "0.06", ...delay(start + h * 22) }} />
        ))}
      </div>
      <p className="rc-strip-axis">{["00", "06", "12", "18", "24"].map((a) => <span key={a}>{a}</span>)}</p>
    </div>
  );
}

/** Proportional regions: each person's region is their exact message share
    along one axis (rows in portrait, columns in landscape). */
export function SplitRegions({ segments, others, showLabels }: {
  segments: readonly Person[];
  others: { label: string; messages: number; share: string } | null;
  showLabels: boolean;
}) {
  const all = [...segments.map((p) => ({ key: String(p.id), messages: p.messages, color: pColor(p), name: p.name, share: p.share })), ...(others ? [{ key: "others", messages: others.messages, color: "var(--rc-muted)", name: others.label, share: others.share }] : [])];
  const total = all.reduce((a, s) => a + s.messages, 0) || 1;
  return (
    <div className="rc-split rc-a-wipe" style={delay(250)} aria-hidden="true">
      {all.map((s) => (
        <div key={s.key} className="rc-split-region" style={{ flexGrow: s.messages, background: s.color }}>
          {showLabels && s.messages / total >= 0.14 && (
            <span className="rc-split-label rc-a-rise" style={delay(1150)}>
              <span className="rc-split-share">{s.share}</span>
              <span className="rc-split-name">{s.name}</span>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/** Conversations as bubbles; the ones the starter opened are filled. */
export function StarterBubbles({ bubbles, filled, person, start }: { bubbles: number; filled: number; person: Person; start: number }) {
  const cols = Math.min(bubbles, bubbles > 24 ? 8 : 6);
  const rows = Math.ceil(bubbles / cols);
  return (
    <Svg viewBox={`0 0 ${cols * 12} ${rows * 10}`} className="rc-fig-bubbles">
      {Array.from({ length: bubbles }, (_, i) => (
        <path
          key={i}
          className={`rc-a-pop${i < filled ? " is-filled" : ""}`}
          d={bubblePath((i % cols) * 12 + 1, Math.floor(i / cols) * 10 + 1, 10, 7.4, 2.6, i % 2 ? "right" : "left")}
          style={{ ...(i < filled ? { fill: pColor(person) } : {}), ...delay(stagger(i, bubbles, 700, start)) }}
        />
      ))}
    </Svg>
  );
}

/** A ring whose arc is the share (0-100) of someone's messages sent at night. */
export function NightRing({ share, start }: { share: number; start: number }) {
  return (
    <Svg viewBox="-60 -60 120 120" className="rc-fig-ring">
      <circle className="rc-ring-track" r={44} />
      <circle className="rc-ring-arc" r={44} pathLength={100} strokeDasharray={`${Math.max(0.8, share)} 100`} transform="rotate(-90)" style={delay(start)} />
    </Svg>
  );
}

/** A continuous path through one dot per day (or per `n` days), snaking row by row. */
export function StreakPath({ dots }: { dots: number }) {
  const cols = Math.min(dots, dots > 30 ? 10 : 7);
  const rows = Math.ceil(dots / cols);
  const at = (i: number) => {
    const row = Math.floor(i / cols);
    const col = row % 2 ? cols - 1 - (i % cols) : i % cols;
    return [col * 14 + 7, row * 14 + 7] as const;
  };
  const d = Array.from({ length: dots }, (_, i) => `${i ? "L" : "M"}${at(i).join(" ")}`).join("");
  return (
    <Svg viewBox={`0 0 ${cols * 14} ${rows * 14}`} className="rc-fig-streak">
      <path className="rc-streak-path rc-a-draw" d={d} pathLength={1} style={delay(300)} />
      {Array.from({ length: dots }, (_, i) => {
        const [x, y] = at(i);
        const end = i === 0 || i === dots - 1;
        return <circle key={i} className={`rc-a-pop${end ? " is-peak" : ""}`} cx={x} cy={y} r={end ? 4.4 : 3.2} style={delay(stagger(i, dots, 1100, 300))} />;
      })}
    </Svg>
  );
}

/** Two columns on one scale: an average active day against the busiest day. */
export function PeakColumns({ average, count, averageLabel, countLabel }: { average: number; count: number; averageLabel: string; countLabel: string }) {
  const max = Math.max(count, average, 1);
  return (
    <div className="rc-peak" aria-hidden="true">
      <div className="rc-peak-col">
        <span className="rc-peak-bar rc-a-grow-y" style={{ ["--h" as string]: `${Math.max(2, (average / max) * 100)}%`, ...delay(300) }} />
        <span className="rc-peak-label">{averageLabel}</span>
      </div>
      <div className="rc-peak-col is-peak">
        <span className="rc-peak-bar rc-a-grow-y" style={{ ["--h" as string]: "100%", ...delay(700) }} />
        <span className="rc-peak-label">{countLabel}</span>
      </div>
    </div>
  );
}

export { delay, pColor };
