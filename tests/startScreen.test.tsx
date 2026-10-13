// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StartScreen } from "@/ui/components/StartScreen";
import { I18nProvider } from "@/ui/i18n/context";
import type { Locale } from "@/ui/i18n/types";

afterEach(cleanup);

const renderStart = (locale: Locale = "en", onFile = vi.fn()) => {
  render(<I18nProvider initialLocale={locale}><StartScreen onFile={onFile} /></I18nProvider>);
  return onFile;
};

describe("landing screen", () => {
  it("shows the approved English copy, limit and privacy note", () => {
    renderStart("en");
    expect(screen.getByRole("heading", { level: 2, name: "Every conversation tells a story. Discover yours." })).toBeTruthy();
    expect(screen.getByText("Explore the moments, patterns, and connections in your WhatsApp chats.")).toBeTruthy();
    expect(screen.getByText("TXT or ZIP · up to 25 MB of chat text")).toBeTruthy();
    expect(screen.getAllByText("Your chat stays on your device.")).toHaveLength(1);
    // The Export → Upload → Explore line was removed; the guide explains the steps.
    expect(screen.queryByText("Explore")).toBeNull();
  });

  it("shows the approved Turkish copy", () => {
    renderStart("tr");
    expect(screen.getByRole("heading", { name: "Her sohbetin bir hikâyesi var. Seninkini keşfet." })).toBeTruthy();
    expect(screen.getByText("Sohbetlerindeki anları, alışkanlıkları ve etkileşimleri keşfet.")).toBeTruthy();
    expect(screen.getByText("Sohbetin cihazında kalır.")).toBeTruthy();
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
    expect(onFile).toHaveBeenCalledWith(file);

    const drop = document.querySelector(".drop")!;
    fireEvent.dragOver(drop);
    expect(drop.classList.contains("drag")).toBe(true);
    fireEvent.drop(drop, { dataTransfer: { files: [file] } });
    expect(drop.classList.contains("drag")).toBe(false);
    expect(onFile).toHaveBeenCalledTimes(2);
  });

  it("keeps the decorative backdrop away from assistive tech and has no eyebrow label", () => {
    renderStart("en");
    expect(document.querySelector(".start-backdrop")?.getAttribute("aria-hidden")).toBe("true");
    expect(document.querySelector(".eyebrow")).toBeNull();
  });
});
