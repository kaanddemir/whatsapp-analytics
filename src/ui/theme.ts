export const THEME_STORAGE_KEY = "whatsapp-analytics-theme";

export const THEME_MODES = ["auto", "light", "dark"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];
export type ResolvedTheme = Exclude<ThemeMode, "auto">;

export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === "string" && (THEME_MODES as readonly string[]).includes(value);
}

export function readThemePreference(storage: Pick<Storage, "getItem"> | null): ThemeMode {
  if (!storage) return "auto";
  try {
    const value = storage.getItem(THEME_STORAGE_KEY);
    return isThemeMode(value) ? value : "auto";
  } catch {
    return "auto";
  }
}

export function storeThemePreference(storage: Pick<Storage, "setItem"> | null, mode: ThemeMode): void {
  if (!storage) return;
  try {
    storage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // Preferences are optional; private browsing and storage policies may reject writes.
  }
}

export function resolveTheme(mode: ThemeMode, prefersDark: boolean): ResolvedTheme {
  return mode === "auto" ? (prefersDark ? "dark" : "light") : mode;
}

export function applyTheme(root: HTMLElement, mode: ThemeMode, prefersDark: boolean): ResolvedTheme {
  const resolved = resolveTheme(mode, prefersDark);
  root.dataset.theme = resolved;
  root.dataset.themeMode = mode;
  root.style.colorScheme = resolved;
  return resolved;
}
