/* A ranked list, five rows a page. Bars are
   scaled to the overall leader, not the page leader, so a bar means the same
   thing on every page. The page resets when the list itself changes. */
import { useEffect, useState, type ReactNode } from "react";
import type { RankedItem } from "@/model";
import { formatCount } from "../format";
import { Empty } from "./Card";
import { Icon } from "./Icon";
import { useI18n } from "../i18n/context";

const PAGE_SIZE = 5;

interface Props {
  items: readonly RankedItem[];
  /** Accessible name of the list, e.g. "Top emojis". */
  label: string;
  renderKey?: (key: string) => ReactNode;
  emptyText?: string;
}

export function RankedList({ items, label, renderKey = (k) => k, emptyText }: Props) {
  const { locale, t } = useI18n();
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [items]);
  if (items.length === 0) return <Empty>{emptyText}</Empty>;

  const pages = Math.ceil(items.length / PAGE_SIZE);
  const current = Math.min(page, pages - 1);
  const max = Math.max(1, ...items.map((i) => i.count));
  const shown = items.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);
  return (
    <>
      {/* A paged list keeps five rows of space, so the last page does not
          shrink the card and move the pager. */}
      <ol className={`rank-list${pages > 1 ? " paged" : ""}`} aria-label={label} start={current * PAGE_SIZE + 1}>
        {shown.map((item) => (
          <li key={item.key} className="rank-item">
            <span className="rank-key" title={item.key}>{renderKey(item.key)}</span>
            <span className="rank-bar" aria-hidden="true"><i style={{ width: `${(item.count / max) * 100}%` }} /></span>
            <span className="rank-count">{formatCount(item.count, locale)}</span>
          </li>
        ))}
      </ol>
      {pages > 1 && (
        <div className="card-foot">
          <nav className="pager" aria-label={t("pages", { label })}>
            <button type="button" onClick={() => setPage(current - 1)} disabled={current === 0} aria-label={t("previousPage", { label: label.toLocaleLowerCase(locale === "tr" ? "tr-TR" : "en-US") })}>
              <Icon name="chevronLeft" size={16} />
            </button>
            <span className="pager-count" aria-live="polite">
              <span className="sr-only">{t("page")} </span>{current + 1}<span aria-hidden="true">/</span><span className="sr-only"> {t("of")} </span>{pages}
            </span>
            <button type="button" onClick={() => setPage(current + 1)} disabled={current === pages - 1} aria-label={t("nextPage", { label: label.toLocaleLowerCase(locale === "tr" ? "tr-TR" : "en-US") })}>
              <Icon name="chevronRight" size={16} />
            </button>
          </nav>
        </div>
      )}
    </>
  );
}
