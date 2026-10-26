// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StartScreen } from "@/ui/components/StartScreen";
import { LanguageSelector } from "@/ui/components/LanguageSelector";
import { I18nProvider, LANGUAGE_STORAGE_KEY, detectLocale, readLanguagePreference } from "@/ui/i18n";
import { en } from "@/i18n/en";
import { tr } from "@/i18n/tr";

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

  it("keeps all translated keys and interpolation parameters in sync", () => {
    expect(Object.keys(tr).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(tr[key].trim(), key).not.toBe("");
      // {Scope} is {scope} at the start of a sentence: the same parameter.
      const tokens = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!.toLowerCase()).sort();
      expect(tokens(tr[key]), key).toEqual(tokens(en[key]));
    }
  });

  it("switches immediately and updates the document language", () => {
    render(<I18nProvider initialLocale="en"><LanguageSelector /><StartScreen onFile={() => undefined} /></I18nProvider>);
    expect(screen.getByRole("heading", { name: "Every conversation tells a story. Discover yours." })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Türkçe" }));
    expect(screen.getByRole("heading", { name: "Her sohbetin bir hikâyesi var. Seninkini keşfet." })).toBeTruthy();
    expect(document.documentElement.lang).toBe("tr");
    // The file-type hint was once left in English.
    expect(screen.getByText("TXT veya ZIP")).toBeTruthy();
    expect(screen.queryByText("Sohbetin cihazında kalır.")).toBeNull();
  });


});
