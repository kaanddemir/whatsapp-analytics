/* A modal dialog (close chat, errors). Focus moves into it on
   open, Tab cycles inside it, Escape and the backdrop dismiss it, and focus
   returns to whatever had it before. */
import { useEffect, useId, useRef, type ReactNode } from "react";

interface Props {
  title: string;
  /** "alertdialog" for failures the user has to acknowledge. */
  role?: "dialog" | "alertdialog";
  onDismiss: () => void;
  children: ReactNode;
  /** Buttons; the first one receives focus. */
  actions: ReactNode;
}

const FOCUSABLE = 'button:not([disabled]), summary, [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({ title, role = "dialog", onDismiss, children, actions }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>(".dialog-actions button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        dismiss.current();
        return;
      }
      if (e.key !== "Tab" || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      if (previous && document.contains(previous)) previous.focus();
    };
  }, []);

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onDismiss()}>
      <div ref={panel} className="dialog" role={role} aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId}>
        <h2 id={titleId}>{title}</h2>
        <div id={bodyId}>{children}</div>
        <div className="dialog-actions">{actions}</div>
      </div>
    </div>
  );
}
