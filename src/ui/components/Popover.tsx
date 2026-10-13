/* A button that toggles a small panel: one shared
   behaviour for the filter pickers and the card explanations. Closes on an
   outside click and on Escape, which hands focus back to the button.
   Opening another popover closes this one, because that click is outside.
   Every panel has a visible heading and a close button: on narrow screens the
   stylesheet turns it into a bottom sheet over a scrim, where both matter. */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon";
import { useI18n } from "../i18n/context";

interface Props {
  /** Accessible name of the trigger. */
  label: string;
  /** Visible trigger content; defaults to the label. */
  trigger?: ReactNode;
  triggerClassName?: string;
  panelClassName?: string;
  disabled?: boolean;
  /** "dialog" for a panel with its own controls, the default. */
  role?: "dialog";
  /** Visible heading of the panel; defaults to the label. */
  title?: string;
  /** Render prop so the panel can close itself (e.g. after a pick). */
  children: (close: () => void) => ReactNode;
}

export function Popover({ label, title, trigger, triggerClassName = "pill", panelClassName = "", disabled = false, role = "dialog", children }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const headingId = useId();

  useEffect(() => {
    if (!open) return;
    // The first control of the content, not the close button.
    const first = panel.current?.querySelector(".pop-body")?.querySelector<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])");
    (first ?? panel.current)?.focus({ preventScroll: true });
    const onPointer = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };

  return (
    <div className="pop-wrap" ref={wrap}>
      <button
        ref={button}
        type="button"
        className={triggerClassName}
        aria-expanded={open}
        aria-controls={id}
        aria-haspopup={role}
        aria-label={trigger ? label : undefined}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        {trigger ?? label}
      </button>
      {open && (
        <>
          <div className="pop-scrim" aria-hidden="true" onPointerDown={() => setOpen(false)} />
          <div ref={panel} id={id} className={`pop ${panelClassName}`} role={role} aria-labelledby={headingId} tabIndex={-1}>
            <div className="pop-head">
              <h2 id={headingId} className="pop-heading">{title ?? label}</h2>
              <button type="button" className="icon-btn pop-close" aria-label={t("close")} onClick={close}>
                <Icon name="close" size={16} />
              </button>
            </div>
            <div className="pop-body">{children(close)}</div>
          </div>
        </>
      )}
    </div>
  );
}
