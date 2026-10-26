export const LOCALES = ["en", "tr"] as const;
export type Locale = (typeof LOCALES)[number];
export type TranslationParams = Readonly<Record<string, string | number>>;
