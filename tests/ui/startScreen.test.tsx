// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StartScreen } from "@/ui/components/StartScreen";
import { I18nProvider } from "@/ui/i18n";
import { LanguageSelector } from "@/ui/components/LanguageSelector";
import { formatBytes, formatCount, formatDate } from "@/i18n/format";
import type { SavedChat } from "@/store/chatStore";
import { en } from "@/i18n/en";
import { tr } from "@/i18n/tr";
import type { Locale } from "@/i18n/types";

afterEach(cleanup);

const renderStart = (locale: Locale = "en", onFile = vi.fn()) => {
  render(<I18nProvider initialLocale={locale}><StartScreen onFile={onFile} /></I18nProvider>);
  return onFile;
};

describe("landing screen", () => {
  it("shows the approved English copy and limit without a repeated privacy line", () => {
    renderStart("en");
    expect(screen.getByRole("heading", { level: 2, name: "Every conversation tells a story. Discover yours." })).toBeTruthy();
    // The headline stands alone: no paragraph under it, and one short privacy line.
    expect(document.querySelector(".hero-lede")).toBeNull();
    expect(screen.getByText("Processed locally, never uploaded.")).toBeTruthy();
    expect(screen.getByText("TXT or ZIP")).toBeTruthy();
    expect(screen.queryByText("Your chat stays on your device.")).toBeNull();
    expect(document.querySelector(".privacy-note")).toBeNull();
    // The Export → Upload → Explore line was removed; the guide explains the steps.
    expect(screen.queryByText("Explore")).toBeNull();
  });

  it("shows the approved Turkish copy", () => {
    renderStart("tr");
    expect(screen.getByRole("heading", { name: "Her sohbetin bir hikâyesi var. Seninkini keşfet." })).toBeTruthy();
    expect(screen.getByText("Yerelde işlenir, asla yüklenmez.")).toBeTruthy();
    expect(screen.queryByText("Sohbetin cihazında kalır.")).toBeNull();
    expect(screen.getByRole("button", { name: "WhatsApp sohbeti nasıl dışa aktarılır?" })).toBeTruthy();
    expect(screen.getByLabelText("Dosya seç")).toBeTruthy();
  });

  it("expands and collapses the export guide with iPhone/Android tabs", () => {
    renderStart("en");
    const toggle = screen.getByRole("button", { name: "How to export a WhatsApp chat" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("tablist")).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const iphone = screen.getByRole("tab", { name: "iPhone" });
    const android = screen.getByRole("tab", { name: "Android" });
    expect(iphone.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").textContent).toContain("Export Chat");
    // The upload action stays available while the guide is open.
    expect(screen.getByLabelText("Choose file")).toBeTruthy();

    fireEvent.keyDown(iphone, { key: "ArrowRight" });
    expect(android.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(android);
    expect(screen.getByRole("tabpanel").textContent).toContain("Export chat");
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(android.id);

    fireEvent.click(iphone);
    expect(iphone.getAttribute("aria-selected")).toBe("true");

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("hands a picked or dropped file upward", () => {
    const onFile = renderStart("en");
    const file = new File(["15/01/24, 10:00 - A: hi"], "chat.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText("Choose file"), { target: { files: [file] } });
    // false: "keep on this device" is off unless the user ticks it.
    expect(onFile).toHaveBeenCalledWith(file, false);

    // A file can be dropped anywhere on the page; while it is held over it, the page says what dropping does.
    const page = document.querySelector(".welcome")!;
    fireEvent.dragEnter(page, { dataTransfer: { types: ["Files"], files: [] } });
    expect(page.classList.contains("dragging")).toBe(true);
    expect(screen.getByText("Drop to open this chat")).toBeTruthy();
    fireEvent.drop(page, { dataTransfer: { types: ["Files"], files: [file] } });
    expect(page.classList.contains("dragging")).toBe(false);
    expect(onFile).toHaveBeenCalledTimes(2);
    // Dragging text (not a file) changes nothing.
    fireEvent.dragEnter(page, { dataTransfer: { types: ["text/plain"], files: [] } });
    expect(page.classList.contains("dragging")).toBe(false);
  });

  it("keeps the decorative backdrop away from assistive tech and has no eyebrow label", () => {
    renderStart("en");
    expect(document.querySelector(".wallpaper")?.getAttribute("aria-hidden")).toBe("true");
    expect(document.querySelector(".eyebrow")).toBeNull();
  });
});

it("updates storage copy and saved dates on language changes while preserving the opt-in", () => {
  const chat: SavedChat = {
    id: "saved", fileName: "chat.txt", archiveEntry: null, textBytes: 6000, storedBytes: 4000,
    messageCount: 335255, firstMessageAt: "2024-01-01T09:00:00", lastMessageAt: "2024-02-01T09:00:00",
    dateOrder: "dmy", savedAt: "2026-10-24T12:34:56Z", version: 1,
  };
  const original = { ...chat };
  const onFile = vi.fn(), onOpen = vi.fn(), onDelete = vi.fn();
  render(<I18nProvider initialLocale="en"><LanguageSelector /><StartScreen saved={[chat]} onFile={onFile} onOpenSaved={onOpen} onDeleteSaved={onDelete} /></I18nProvider>);
  const file = new File(["chat"], "chat.txt");
  const checkbox = screen.getByRole("checkbox", { name: en.x_keepOnDevice }) as HTMLInputElement;
  expect(checkbox.checked).toBe(false);
  fireEvent.change(screen.getByLabelText(en.chooseFile), { target: { files: [file] } });
  expect(onFile).toHaveBeenLastCalledWith(file, false);
  fireEvent.click(checkbox);
  fireEvent.change(screen.getByLabelText(en.chooseFile), { target: { files: [file] } });
  expect(onFile).toHaveBeenLastCalledWith(file, true);
  for (const locale of ["tr", "en"] as const) {
    const d = locale === "tr" ? tr : en;
    fireEvent.click(screen.getByRole("button", { name: locale === "tr" ? "Türkçe" : "English" }));
    expect((screen.getByRole("checkbox", { name: d.x_keepOnDevice }) as HTMLInputElement).checked).toBe(true);
    expect(document.querySelector(".saved-meta")?.textContent).toBe(`${formatCount(chat.messageCount, locale)} ${locale === "tr" ? "mesaj" : "messages"} · ${formatBytes(chat.storedBytes, locale)} · ${formatDate("2026-10-24", locale)}`);
    fireEvent.click(screen.getByRole("button", { name: d["start.openSavedLabel"].replace("{name}", chat.fileName) }));
    expect(onOpen).toHaveBeenLastCalledWith(chat);
    fireEvent.click(screen.getByRole("button", { name: d.x_deleteSavedLabel.replace("{name}", chat.fileName) }));
    expect(onDelete).toHaveBeenLastCalledWith(chat);
    fireEvent.change(screen.getByLabelText(d.chooseFile), { target: { files: [file] } });
    expect(onFile).toHaveBeenLastCalledWith(file, true);
    expect(document.querySelector(".privacy-note")).toBeNull();
  }
  expect(chat).toEqual(original);
});
