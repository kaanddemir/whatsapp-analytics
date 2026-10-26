import { en, type TranslationKey } from "@/i18n/en";
import { tr } from "@/i18n/tr";
import type { Locale, TranslationParams } from "@/i18n/types";

/** Shared by React and deterministic answer presentation in the worker. */
export function translate(locale: Locale, key: TranslationKey, params?: TranslationParams): string {
  return (locale === "tr" ? tr : en)[key].replace(/\{(\w+)\}/g, (_, k: string) => String(params?.[k] ?? `{${k}}`));
}
