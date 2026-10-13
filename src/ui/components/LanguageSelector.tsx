import { useI18n } from "../i18n/context";
import type { Locale } from "../i18n/types";
const OPTIONS: readonly Locale[] = ["tr", "en"];
export function LanguageSelector() {
  const { locale, setLocale, t } = useI18n();
  return <div className="theme-selector labelled language-selector" role="group" aria-label={t("language")}>
    {OPTIONS.map((v) => <button key={v} type="button" className="theme-option" aria-pressed={locale === v} onClick={() => setLocale(v)}><span className="theme-label">{t(v === "tr" ? "turkish" : "english")}</span></button>)}
  </div>;
}
