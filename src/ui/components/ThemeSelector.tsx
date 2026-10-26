import { useEffect, useState } from "react";
import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import {
  THEME_MODES,
  applyTheme,
  readThemePreference,
  storeThemePreference,
  type ThemeMode,
} from "../theme";
import { useI18n } from "@/ui/i18n";

const ICONS: Record<ThemeMode, LucideIcon> = { auto: Monitor, light: Sun, dark: Moon };
const mediaQuery = "(prefers-color-scheme: dark)";

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The theme preference: applied to <html>, persisted, and (in Auto) kept in
 * step with the system. App calls this once so the theme stays applied while
 * the selector itself is out of view (it lives in the chat menu).
 */
export function useThemeMode(): [ThemeMode, (mode: ThemeMode) => void] {
  const [mode, setMode] = useState<ThemeMode>(() => readThemePreference(browserStorage()));

  useEffect(() => {
    const media = typeof window.matchMedia === "function" ? window.matchMedia(mediaQuery) : null;
    const sync = () => applyTheme(document.documentElement, mode, media?.matches ?? false);
    sync();
    if (mode === "auto") media?.addEventListener("change", sync);
    return () => media?.removeEventListener("change", sync);
  }, [mode]);

  function choose(next: ThemeMode) {
    setMode(next);
    storeThemePreference(browserStorage(), next);
  }
  return [mode, choose];
}

interface Props {
  /** Controlled use (the menu). Without it the selector manages the theme itself. */
  mode?: ThemeMode;
  onChange?: (mode: ThemeMode) => void;
  /** Show the option names beside the icons. */
  labelled?: boolean;
}

function Selector({ mode, onChange, labelled }: { mode: ThemeMode; onChange: (mode: ThemeMode) => void; labelled: boolean }) {
  const { t } = useI18n();
  const labels: Record<ThemeMode, string> = { auto: t("auto"), light: t("light"), dark: t("dark") };
  return (
    <fieldset className={labelled ? "theme-selector labelled" : "theme-selector"} aria-label={t("colorTheme")}>
      <legend className="sr-only">{t("colorTheme")}</legend>
      {THEME_MODES.map((item) => {
        const ModeIcon = ICONS[item];
        return (
          <button
            key={item}
            type="button"
            className="theme-option"
            aria-pressed={mode === item}
            title={labelled ? undefined : labels[item]}
            onClick={() => onChange(item)}
          >
            <ModeIcon size={16} />
            <span className={labelled ? "theme-label" : "sr-only"}>{labels[item]}</span>
          </button>
        );
      })}
    </fieldset>
  );
}

function SelfManaged({ labelled }: { labelled: boolean }) {
  const [mode, setMode] = useThemeMode();
  return <Selector mode={mode} onChange={setMode} labelled={labelled} />;
}

export function ThemeSelector({ mode, onChange, labelled = false }: Props) {
  return mode && onChange ? <Selector mode={mode} onChange={onChange} labelled={labelled} /> : <SelfManaged labelled={labelled} />;
}
