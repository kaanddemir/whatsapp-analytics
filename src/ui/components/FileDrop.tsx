// The file picker. Hands a File upward and nothing else; reading it is the
// worker's job. Dropping a file is handled by the screen around it (the
// welcome page accepts a drop anywhere). Compact: the "Open another chat"
// dialog's button.
import type { ChangeEvent } from "react";
import { Upload } from "lucide-react";
import { useI18n } from "@/ui/i18n";

interface Props {
  onFile: (file: File) => void;
  disabled?: boolean;
  compact?: boolean;
  label?: string;
  /** In the primary style (the welcome screen's and a dialog's main action). */
  primary?: boolean;
}

const ACCEPT = ".txt,.zip,text/plain,application/zip";

export function FileDrop({ onFile, disabled = false, compact = false, primary = false, label }: Props) {
  const { t } = useI18n();
  const visibleLabel = label ?? (compact ? t("chooseExport") : t("chooseFile"));

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // picking the same file again must fire change again
    if (file) onFile(file);
  }

  // A real <input> inside the label: keyboard focus lands on it and Enter or
  // Space opens the picker; it is visually hidden, not display:none.
  return (
    <label className={compact && !primary ? "btn ghost file-btn" : "btn file-btn"}>
      {!compact && <Upload size={16} />}
      {visibleLabel}
      <input className="sr-only" type="file" accept={ACCEPT} onChange={onPick} disabled={disabled} />
    </label>
  );
}
