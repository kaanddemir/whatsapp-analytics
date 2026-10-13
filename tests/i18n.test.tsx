// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StartScreen } from "@/ui/components/StartScreen";
import { LanguageSelector } from "@/ui/components/LanguageSelector";
import { I18nProvider, LANGUAGE_STORAGE_KEY, detectLocale, readLanguagePreference } from "@/ui/i18n/context";
import { en } from "@/ui/i18n/en";
import { tr } from "@/ui/i18n/tr";
import { formatCount, formatDate, formatDecimal, formatDuration, formatPercent, plural } from "@/ui/format";

describe("localization", () => {
  it("detects Turkish and otherwise falls back to English", () => {
    expect(detectLocale(["tr-TR", "en-US"])).toBe("tr");
    expect(detectLocale(["de-DE"])).toBe("en");
    expect(detectLocale(undefined)).toBe("en");
  });

  it("restores only valid stored preferences and tolerates storage failures", () => {
    expect(readLanguagePreference({ getItem: () => "tr" }, ["en-US"])).toBe("tr");
    expect(readLanguagePreference({ getItem: () => "broken" }, ["tr-TR"])).toBe("tr");
    expect(readLanguagePreference({ getItem: () => { throw new Error("denied"); } }, ["en-US"])).toBe("en");
    expect(LANGUAGE_STORAGE_KEY).toBe("whatsapp-analytics-language");
  });

  it("keeps English and Turkish dictionaries complete", () => {
    expect(Object.keys(tr).sort()).toEqual(Object.keys(en).sort());
  });

  it("switches immediately and updates the document language", () => {
    render(<I18nProvider initialLocale="en"><LanguageSelector /><StartScreen onFile={() => undefined} /></I18nProvider>);
    expect(screen.getByRole("heading", { name: "Every conversation tells a story. Discover yours." })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Türkçe" }));
    expect(screen.getByRole("heading", { name: "Her sohbetin bir hikâyesi var. Seninkini keşfet." })).toBeTruthy();
    expect(document.documentElement.lang).toBe("tr");
    // The drop zone's file hint was once left in English; the limit comes from io/limits.
    expect(screen.getByText("TXT veya ZIP · en fazla 25 MB sohbet metni")).toBeTruthy();
    expect(screen.getByText("Sohbetin cihazında kalır.")).toBeTruthy();
  });

  it("formats Turkish numbers, dates, percentages, plurals and durations", () => {
    expect(formatCount(2006, "tr")).toBe("2.006");
    expect(formatDecimal(12.5, "tr")).toBe("12,5");
    expect(formatPercent(12.5, "tr")).toContain("12,5");
    expect(formatDate("2024-01-05", "tr")).toMatch(/Oca/);
    expect(plural(2, "mesaj", "mesaj", "tr")).toBe("2 mesaj");
    expect(formatDuration(90, "minute", "tr")).toBe("1 dk");
  });
});
