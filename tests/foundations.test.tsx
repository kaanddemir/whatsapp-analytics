// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeSelector } from "@/ui/components/ThemeSelector";
import { Popover } from "@/ui/components/Popover";
import { participantColor, participantColorIndex } from "@/ui/participantColors";
import {
  THEME_STORAGE_KEY,
  applyTheme,
  readThemePreference,
  resolveTheme,
} from "@/ui/theme";

class MediaQueryMock extends EventTarget {
  matches = false;
  readonly media = "(prefers-color-scheme: dark)";
  readonly onchange = null;
  readonly addListener = () => undefined;
  readonly removeListener = () => undefined;
  set(dark: boolean) {
    this.matches = dark;
    this.dispatchEvent(new Event("change"));
  }
}

const media = new MediaQueryMock();

beforeEach(() => {
  localStorage.clear();
  media.matches = false;
  vi.stubGlobal("matchMedia", () => media as unknown as MediaQueryList);
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-theme-mode");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("theme foundations", () => {
  it("keeps the pre-paint script dev-compatible and the mobile menu viewport-fixed", () => {
    const html = readFileSync(join(process.cwd(), "index.html"), "utf8");
    const css = readFileSync(join(process.cwd(), "src/ui/styles.css"), "utf8");
    expect(html).toContain('<script src="/theme-init.js"></script>');
    expect(html).not.toContain('<script type="module" src="/theme-init.js"></script>');
    expect(css).toMatch(/@media \(max-width: 640px\)[\s\S]*?\.appbar \{[^}]*backdrop-filter: none;/);
  });

  it("resolves auto and explicit modes", () => {
    expect(resolveTheme("auto", false)).toBe("light");
    expect(resolveTheme("auto", true)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("validates stored preferences and tolerates storage failures", () => {
    expect(readThemePreference({ getItem: () => "dark" })).toBe("dark");
    expect(readThemePreference({ getItem: () => "sepia" })).toBe("auto");
    expect(readThemePreference({ getItem: () => { throw new Error("blocked"); } })).toBe("auto");
  });

  it("applies document semantics", () => {
    expect(applyTheme(document.documentElement, "auto", true)).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.themeMode).toBe("auto");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("persists selection and follows system changes only in auto", async () => {
    render(<ThemeSelector />);
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));
    media.set(true);
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));

    fireEvent.click(screen.getByRole("button", { name: "Light" }));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));
    media.set(true);
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});

describe("participant colours", () => {
  it("is stable across calls and independent of list order", () => {
    const ids = ["participant-a", "participant-b", "Ayşe", "😀"];
    const forward = new Map(ids.map((id) => [id, participantColor(id)]));
    for (const id of [...ids].reverse()) expect(participantColor(id)).toBe(forward.get(id));
  });

  it("always selects one of the shared palette slots", () => {
    for (const id of ["a", "b", "c", "a long participant id"]) {
      expect(participantColorIndex(id)).toBeGreaterThanOrEqual(0);
      expect(participantColorIndex(id)).toBeLessThan(8);
      expect(participantColor(id)).toMatch(/^var\(--participant-[0-7]\)$/);
    }
  });
});

describe("shared component foundations", () => {
  it("moves focus into a popover and returns it on Escape", () => {
    render(
      <Popover label="Test filter" trigger={<span>Open</span>}>
        {() => <button type="button">First action</button>}
      </Popover>,
    );
    const trigger = screen.getByRole("button", { name: "Test filter" });
    fireEvent.click(trigger);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "First action" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.activeElement).toBe(trigger);
  });
});
