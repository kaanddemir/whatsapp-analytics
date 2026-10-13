/* A dashboard card: a heading, optional header controls, and the body.
   Chart cards add the Chart/Table switch and a fixed-height view region, so
   switching views never changes the card's size. */
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { CARD_TITLE_KEYS, type CardKey } from "../cardInfo";
import { useI18n } from "../i18n/context";
import { Icon } from "./Icon";

interface Props {
  cardKey: CardKey;
  controls?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function Card({ cardKey, controls, className = "", children }: Props) {
  const { t } = useI18n();
  const headingId = `card-${cardKey}`;
  return (
    <section className={`card ${className}`} aria-labelledby={headingId}>
      <div className="card-head">
        <h3 id={headingId}>{t(CARD_TITLE_KEYS[cardKey])}</h3>
        {controls && <div className="card-actions">{controls}</div>}
      </div>
      {children}
    </section>
  );
}

export type View = "chart" | "table";
const VIEWS: readonly { id: View; key: "chartView" | "tableView"; icon: "chart" | "table" }[] = [
  { id: "chart", key: "chartView", icon: "chart" },
  { id: "table", key: "tableView", icon: "table" },
];

/** Two-button segmented switch; arrow keys move between the options. */
export function ViewToggle({ view, onView }: { view: View; onView: (view: View) => void }) {
  const { t } = useI18n();
  const group = useRef<HTMLDivElement>(null);
  function onKey(e: KeyboardEvent) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next = view === "chart" ? "table" : "chart";
    onView(next);
    group.current?.querySelector<HTMLButtonElement>(`[data-view="${next}"]`)?.focus();
  }
  return (
    <div ref={group} className="view-toggle" role="group" aria-label={t("view")} onKeyDown={onKey}>
      {VIEWS.map((v) => (
        <button key={v.id} type="button" data-view={v.id} aria-pressed={view === v.id} aria-label={t(v.key)} title={t(v.key)} onClick={() => onView(v.id)}>
          <Icon name={v.icon} size={16} />
        </button>
      ))}
    </div>
  );
}

/** Chart or table in one region of fixed height; the table scrolls inside it. */
export function ChartView({ view, height, chart, table }: { view: View; height: number; chart: () => ReactNode; table: () => ReactNode }) {
  return (
    <div className="view-region" style={{ height }}>
      {view === "chart" ? chart() : table()}
    </div>
  );
}

export function useView() {
  return useState<View>("chart");
}

/**
 * One labelled figure inside a shared card (a "stat strip"): small
 * insights sit side by side in one surface instead of each getting a card.
 */
export function Stat({ cardKey, value, sub }: { cardKey: CardKey; value: string; sub: string }) {
  const { t } = useI18n();
  return (
    <div className="stat" role="group" aria-label={t(CARD_TITLE_KEYS[cardKey])}>
      <h3>{t(CARD_TITLE_KEYS[cardKey])}</h3>
      <p className="stat-value">{value}</p>
      <p className="stat-sub">{sub}</p>
    </div>
  );
}

export function Empty({ children }: { children?: ReactNode }) {
  const { t } = useI18n();
  return <p className="empty">{children ?? t("empty")}</p>;
}
