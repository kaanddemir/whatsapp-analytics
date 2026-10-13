// The file picker and drop zone. Hands a File upward and nothing else; reading
// it is the worker's job. The compact form is the toolbar's "Open another
// chat" button.
import { useState, type ChangeEvent, type DragEvent } from "react";
import { Icon } from "./Icon";
import { useI18n } from "../i18n/context";
import { MAX_TEXT_BYTES } from "@/io/limits";

interface Props {
  onFile: (file: File) => void;
  disabled?: boolean;
  compact?: boolean;
  label?: string;
  /** Compact button in the primary style (a dialog's main action). */
  primary?: boolean;
}

const ACCEPT = ".txt,.zip,text/plain,application/zip";

export function FileDrop({ onFile, disabled = false, compact = false, primary = false, label }: Props) {
  const { t } = useI18n();
  const visibleLabel = label ?? (compact ? t("chooseExport") : t("chooseFile"));
  const [dragging, setDragging] = useState(false);

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // picking the same file again must fire change again
    if (file) onFile(file);
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file && !disabled) onFile(file);
  }

  // A real <input> inside the label: keyboard focus lands on it and Enter or
  // Space opens the picker; it is visually hidden, not display:none.
  const picker = (
    <label className={compact && !primary ? "btn ghost file-btn" : "btn file-btn"}>
      {visibleLabel}
      <input className="sr-only" type="file" accept={ACCEPT} onChange={onPick} disabled={disabled} />
    </label>
  );
  if (compact) return picker;

  return (
    <div
      className={`drop${dragging ? " drag" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <span className="drop-icon" aria-hidden="true"><Icon name="upload" size={24} /></span>
      <p className="drop-title">{t("dropChat")}</p>
      {picker}
      {/* The limit comes from the reader's own rule, never a copy of it. */}
      <p className="drop-limit">{t("fileLimit", { size: MAX_TEXT_BYTES / 1024 / 1024 })}</p>
    </div>
  );
}
