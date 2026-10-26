// @vitest-environment jsdom
/* Recap player: navigation by keyboard, buttons, taps and swipes;
   pause semantics (button, Space, long press) and the progress-driven clock;
   reduced motion; the finale's save, hide-names and replay; focus trap and
   cleanup; live language switching without re-analysis. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { analyze } from "@/analytics";
import { NO_FILTERS } from "@/model";
import { parseExport } from "@/parser";
import { I18nProvider, useI18n } from "@/ui/i18n";
import { Recap } from "@/ui/recap/Recap";

const stats = analyze(parseExport(readFileSync(join(__dirname, "../fixtures/chats/long_android_12h.chat"), "utf8")), NO_FILTERS);
const SCENES = 12;

let reduced = false;
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});
beforeEach(() => {
  reduced = false;
  // jsdom has no PointerEvent; without it the coordinates of a fired pointer
  // event are dropped. A MouseEvent carries them, which is all the player reads.
  if (!("PointerEvent" in window)) {
    class PointerEventShim extends MouseEvent {
      pointerType: string;
      constructor(type: string, init: MouseEventInit & { pointerType?: string } = {}) {
        super(type, init);
        this.pointerType = init.pointerType ?? "touch";
      }
    }
    vi.stubGlobal("PointerEvent", PointerEventShim);
  }
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce") && reduced, media: q, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function LocaleSwitch() {
  const { setLocale } = useI18n();
  return <button type="button" onClick={() => setLocale("tr")}>to-tr</button>;
}

function open(onClose = vi.fn()) {
  render(<I18nProvider initialLocale="en"><LocaleSwitch /><Recap stats={stats} onClose={onClose} /></I18nProvider>);
  return { dialog: screen.getByRole("dialog", { name: "Recap" }), onClose };
}
const scene = (dialog: HTMLElement) => within(dialog).getByRole("group");
const sceneNo = (dialog: HTMLElement) => Number(/Scene (\d+)/.exec(scene(dialog).getAttribute("aria-label")!)![1]);
const stage = (dialog: HTMLElement) => dialog.querySelector<HTMLElement>(".rc-stage")!;

describe("recap player", () => {
  it("opens on the story, announces each scene's insight and navigates by keyboard and buttons", () => {
    const { dialog } = open();
    expect(scene(dialog).getAttribute("aria-label")).toBe(`Scene 1 of ${SCENES}`);
    expect(dialog.querySelector("[aria-live]")!.textContent).toMatch(/^Scene 1 of 12\. Recap of Group chat, 3 participants/);
    expect((within(dialog).getByRole("button", { name: "Previous scene" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(sceneNo(dialog)).toBe(2);
    expect(dialog.querySelector("[aria-live]")!.textContent).toContain("7,844 messages over 421 active days");
    fireEvent.click(within(dialog).getByRole("button", { name: "Next scene" }));
    expect(sceneNo(dialog)).toBe(3);
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(sceneNo(dialog)).toBe(2);
  });

  it("advances only when the active progress fill itself ends", () => {
    const { dialog } = open();
    const fill = dialog.querySelector(".rc-seg.active .rc-fill")!;
    expect((fill as HTMLElement).style.animationDuration).toBe("4200ms");
    // An animation ending inside the scene bubbles nowhere near the clock.
    fireEvent.animationEnd(dialog.querySelector(".rc-stage .rc-a-rise")!);
    expect(sceneNo(dialog)).toBe(1);
    fireEvent.animationEnd(fill);
    expect(sceneNo(dialog)).toBe(2);
  });

  it("pauses and resumes with the button and Space, freezing the stage with the clock", () => {
    const { dialog } = open();
    fireEvent.keyDown(document, { key: " " });
    expect(dialog.classList.contains("is-paused")).toBe(true);
    const play = within(dialog).getByRole("button", { name: "Play" });
    expect(play.getAttribute("aria-pressed")).toBe("true");
    expect(within(dialog).getByText("Paused")).toBeTruthy();
    fireEvent.click(play);
    expect(dialog.classList.contains("is-paused")).toBe(false);
    expect(within(dialog).getByRole("button", { name: "Pause" })).toBeTruthy();
  });

  it("pauses while held, resumes on release, and does not navigate", () => {
    vi.useFakeTimers();
    const { dialog } = open();
    fireEvent.pointerDown(stage(dialog), { clientX: 200, clientY: 200 });
    act(() => void vi.advanceTimersByTime(400));
    expect(dialog.classList.contains("is-paused")).toBe(true);
    fireEvent.pointerUp(stage(dialog), { clientX: 200, clientY: 200 });
    expect(dialog.classList.contains("is-paused")).toBe(false);
    expect(sceneNo(dialog)).toBe(1);
  });

  it("swipes horizontally, taps forward, and ignores presses on real controls", () => {
    const { dialog } = open();
    fireEvent.pointerDown(stage(dialog), { clientX: 300, clientY: 200 });
    fireEvent.pointerMove(stage(dialog), { clientX: 200, clientY: 205 });
    fireEvent.pointerUp(stage(dialog), { clientX: 120, clientY: 210 });
    expect(sceneNo(dialog)).toBe(2);
    fireEvent.pointerDown(stage(dialog), { clientX: 100, clientY: 200 });
    fireEvent.pointerMove(stage(dialog), { clientX: 200, clientY: 200 });
    fireEvent.pointerUp(stage(dialog), { clientX: 260, clientY: 200 });
    expect(sceneNo(dialog)).toBe(1);
    // A vertical drag is not a swipe and, having moved, not a tap.
    fireEvent.pointerDown(stage(dialog), { clientX: 200, clientY: 100 });
    fireEvent.pointerMove(stage(dialog), { clientX: 200, clientY: 200 });
    fireEvent.pointerUp(stage(dialog), { clientX: 205, clientY: 300 });
    expect(sceneNo(dialog)).toBe(1);
    // A still press is a tap (jsdom has no layout, so it reads as forward).
    fireEvent.pointerDown(stage(dialog), { clientX: 200, clientY: 200 });
    fireEvent.pointerUp(stage(dialog), { clientX: 200, clientY: 200 });
    expect(sceneNo(dialog)).toBe(2);
  });

  it("ends on the finale, which holds, saves, hides names and replays", async () => {
    const { dialog } = open();
    for (let i = 0; i < 30; i++) fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(sceneNo(dialog)).toBe(SCENES);
    expect(dialog.querySelector(".rc-seg.active")).toBeNull();
    expect(within(dialog).queryByRole("button", { name: /Pause|Play/ })).toBeNull();
    expect((within(dialog).getByRole("button", { name: "Next scene" }) as HTMLButtonElement).disabled).toBe(true);
    // A tap on the finale does not navigate away from its controls.
    fireEvent.pointerDown(stage(dialog), { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(stage(dialog), { clientX: 10, clientY: 10 });
    expect(sceneNo(dialog)).toBe(SCENES);
    // Without a 2D canvas (jsdom) the poster falls back to HTML once drawing fails.
    const poster = await within(dialog).findByRole("img", { name: /^Recap poster preview\./ });
    expect(poster.textContent).toContain("Group chat · 3 participants");
    const hide = within(dialog).getByRole("button", { name: "Hide names in the image" });
    fireEvent.click(hide);
    expect(hide.getAttribute("aria-pressed")).toBe("true");
    expect(within(dialog).getByRole("button", { name: "Save image" })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Watch again" }));
    expect(sceneNo(dialog)).toBe(1);
  });

  it("reports when the image cannot be drawn", async () => {
    const { dialog } = open();
    for (let i = 0; i < 30; i++) fireEvent.keyDown(document, { key: "ArrowRight" });
    await act(async () => void fireEvent.click(within(dialog).getByRole("button", { name: "Save image" })));
    expect(await within(dialog).findByText("Couldn’t save the image.")).toBeTruthy();
  });

  it("with reduced motion opens paused with static scenes and keeps manual navigation", () => {
    reduced = true;
    const { dialog } = open();
    expect(dialog.classList.contains("is-reduced")).toBe(true);
    expect(dialog.classList.contains("is-paused")).toBe(true);
    expect(within(dialog).getByRole("button", { name: "Play" })).toBeTruthy();
    expect(within(dialog).getByText(/Autoplay is off because reduced motion is on/)).toBeTruthy();
    expect(within(dialog).queryByText("Paused")).toBeNull();
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(sceneNo(dialog)).toBe(2);
    // Count-ups show their final value at once.
    expect(scene(dialog).textContent).toContain("7,844");
  });

  it("switches language live without rebuilding from the worker", () => {
    const { dialog } = open();
    fireEvent.keyDown(document, { key: "ArrowRight" });
    fireEvent.click(screen.getByRole("button", { name: "to-tr" }));
    expect(scene(dialog).getAttribute("aria-label")).toBe(`Sahne 2 / ${SCENES}`);
    expect(within(dialog).getByText("Gönderilen mesajlar")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Recap’i kapat" })).toBeTruthy();
  });

  it("traps focus, closes on Escape and releases the page", () => {
    const { dialog, onClose } = open();
    expect(document.activeElement).toBe(dialog);
    expect(document.body.classList.contains("sheet-open")).toBe(true);
    const buttons = within(dialog).getAllByRole("button").filter((b) => !(b as HTMLButtonElement).disabled);
    buttons.at(-1)!.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(buttons[0]);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    cleanup();
    expect(document.body.classList.contains("sheet-open")).toBe(false);
  });
});
