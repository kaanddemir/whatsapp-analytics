/* Worker errors are presented in the interface language, never as raw diagnostics. */
import type { ClientErrorCode } from "@/worker/client";
import type { Locale } from "@/i18n/types";
import { translate } from "@/i18n/translate";
import { en, type TranslationKey } from "@/i18n/en";

export function errorMessage(code: ClientErrorCode, fallback: string, locale: Locale = "en"): string {
  const key = `err_${code}` as TranslationKey;
  const limit = code === "too_large" ? fallback.match(/([\d,.]+) MB/)?.[1] : null;
  return translate(locale, key in en ? key : "err_internal", { limit: limit ? ` (${Number(limit.replace(/,/g, "")).toLocaleString(locale === "tr" ? "tr-TR" : "en-US")} MB)` : "" });
}
