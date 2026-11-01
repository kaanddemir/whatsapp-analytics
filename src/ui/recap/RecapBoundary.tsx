/* A failure inside the Recap stays inside the Recap: React would otherwise
   unmount the whole app, and the open chat with it. Shows why and how to leave;
   the chat and its worker were never touched, so closing returns to them. */
import { Component, useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { useI18n } from "@/ui/i18n";
import { groundVars } from "./tokens";
import "./recap.css";

function RecapFailed({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    button.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="rc rc-failed" style={groundVars("forest") as CSSProperties} role="alertdialog" aria-modal="true" aria-labelledby="rc-failed-title" aria-describedby="rc-failed-body">
      <h1 id="rc-failed-title" className="rc-display rc-headline">{t("rcErrorTitle")}</h1>
      <p id="rc-failed-body" className="rc-line">{t("rcErrorBody")}</p>
      <button ref={button} type="button" className="rc-button primary" onClick={onClose}>{t("rcErrorClose")}</button>
    </div>
  );
}

export class RecapBoundary extends Component<{ onClose: () => void; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    return this.state.failed ? <RecapFailed onClose={this.props.onClose} /> : this.props.children;
  }
}
