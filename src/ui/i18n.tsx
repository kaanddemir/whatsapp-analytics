import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { TranslationKey } from "@/i18n/en";
import { translate } from "@/i18n/translate";
import type { Locale, TranslationParams } from "@/i18n/types";
export const LANGUAGE_STORAGE_KEY = "whatsapp-analytics-language";
export function detectLocale(languages: readonly string[] | undefined): Locale {
  return languages?.some((v) => v.toLocaleLowerCase().split("-")[0] === "tr") ? "tr" : "en";
}
export function readLanguagePreference(storage: Pick<Storage, "getItem"> | null, languages?: readonly string[]): Locale {
  try { const v = storage?.getItem(LANGUAGE_STORAGE_KEY); if (v === "en" || v === "tr") return v; } catch { /* unavailable */ }
  return detectLocale(languages);
}
export function storeLanguagePreference(storage: Pick<Storage, "setItem"> | null, locale: Locale) {
  try { storage?.setItem(LANGUAGE_STORAGE_KEY, locale); } catch { /* session only */ }
}
interface Value { locale: Locale; setLocale: (v: Locale) => void; t: (key: TranslationKey, params?: TranslationParams) => string }
const fallback: Value = { locale: "en", setLocale: () => undefined, t: (key, params) => translate("en", key, params) };
const Context = createContext<Value>(fallback);
const storage = () => { try { return window.localStorage; } catch { return null; } };
export function I18nProvider({ children, initialLocale }: { children: ReactNode; initialLocale?: Locale }) {
  const [locale, setState] = useState<Locale>(() => initialLocale ?? readLanguagePreference(storage(), typeof navigator === "undefined" ? [] : navigator.languages));
  const setLocale = (v: Locale) => { setState(v); storeLanguagePreference(storage(), v); };
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  const value = useMemo<Value>(() => ({ locale, setLocale, t: (key, params) => translate(locale, key, params) }), [locale]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useI18n() { return useContext(Context); }
