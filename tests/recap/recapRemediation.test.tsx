// @vitest-environment jsdom
/* Recap audit regressions that do not need layout: privacy of hide names, what
   the copy may claim, saving the right image, dialog semantics, error isolation. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RefObject } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyze } from "@/analytics";
import { en, type TranslationKey } from "@/i18n/en";
import { tr } from "@/i18n/tr";
import type { Locale, TranslationParams } from "@/i18n/types";
import type { Stats } from "@/model";
import { NO_FILTERS } from "@/model";
import { parseExport } from "@/parser";
import { I18nProvider } from "@/ui/i18n";
import { distinctColorIndexes, participantColorIndex } from "@/ui/participantColors";
import { Ribbon } from "@/ui/recap/figures";
import { Recap } from "@/ui/recap/Recap";
import { RecapBoundary } from "@/ui/recap/RecapBoundary";
import { buildStory, MAX_MONTH_BARS, type Scene, type Story } from "@/ui/recap/story";
import { contrast, GROUNDS } from "@/ui/recap/tokens";

const posterBlob = vi.hoisted(() => vi.fn());
const downloadBlob = vi.hoisted(() => vi.fn(() => true));
vi.mock("@/ui/recap/poster", async (real) => ({ ...(await real<typeof import("@/ui/recap/poster")>()), posterBlob, downloadBlob }));

const translate = (locale: Locale) => (key: TranslationKey, params?: TranslationParams) =>
  (locale === "tr" ? tr : en)[key].replace(/\{(\w+)\}/g, (_, k: string) => String(params?.[k] ?? `{${k}}`));
const storyOf = (stats: Stats, locale: Locale = "en"): Story => buildStory(stats, locale, translate(locale));
const find = <K extends Scene["kind"]>(story: Story, kind: K) => story.scenes.find((s) => s.kind === kind) as Extract<Scene, { kind: K }> | undefined;
const pad = (n: number) => String(n).padStart(2, "0");
const line = (at: number, who: string, text: string) => {
  const d = new Date(at);
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} - ${who}: ${text}`;
};
const statsOf = (lines: readonly string[]) => analyze(parseExport(lines.join("\n")), NO_FILTERS);
const DAY = 86_400_000;
const START = Date.UTC(2024, 0, 1, 10);
/** Conversations a day apart, each opened by the named person. */
const opened = (openers: readonly string[]) => openers.flatMap((who, i) => [line(START + i * DAY, who, "selam"), line(START + i * DAY + 60_000, who === "Asu" ? "Bora" : "Asu", "merhaba")]);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  posterBlob.mockReset();
  downloadBlob.mockClear();
});

describe("H1, L1: hide names", () => {
  const talk = Array.from({ length: 300 }, (_, i) => line(START + i * 7_200_000, i % 2 ? "Mert Aydın" : "Selin Koç", i % 2 ? "Selin Selin nasılsın" : "Mert geliyor musun"));
  const nicknames = Array.from({ length: 300 }, (_, i) => line(START + i * 7_200_000, i % 2 ? "Mehmet Demir" : "Zeynep Kara", i % 2 ? "Zeyno Zeyno bak" : "Memo gel"));

  it("a top word is on the named poster and never on the hidden one, whatever it is", () => {
    for (const lines of [talk, nicknames]) {
      const { poster } = storyOf(statsOf(lines));
      const word = poster.cells.find((c) => c.label === "Top word");
      expect(word).toBeDefined();
      expect(poster.cellsHidden.some((c) => c.label === "Top word" || c.value === word!.value)).toBe(false);
    }
  });

  it("the hidden summary has no name and no free text, in both languages", () => {
    for (const locale of ["en", "tr"] as const) {
      const finale = find(storyOf(statsOf(talk), locale), "finale")!;
      expect(finale.summary).toMatch(/Mert Aydın/);
      expect(finale.summaryHidden).not.toMatch(/mert|selin|aydın|koç/i);
      expect(finale.summaryHidden).toContain(finale.poster.span);
    }
  });

  it("no fixture's hidden poster text carries any participant's name or part of it", () => {
    const stats = statsOf(talk);
    const hidden = JSON.stringify(storyOf(stats).poster.cellsHidden) + storyOf(stats).poster.titleHidden;
    for (const person of stats.participants) for (const part of person.name.split(" ")) expect(hidden.toLowerCase()).not.toContain(part.toLowerCase());
  });
});

describe("M1: folded months", () => {
  const months = Array.from({ length: 80 }, (_, m) => {
    const n = m === 40 ? 300 : m >= 60 && m < 63 ? 200 : 20;
    return Array.from({ length: n }, (_, i) => ({ at: Date.UTC(2018, m, 1 + (i % 27), 9, i % 60), who: i % 2 ? "Asu" : "Bora" }));
  }).flat().sort((a, b) => a.at - b.at).map((r) => line(r.at, r.who, "kahve"));

  it("keeps the true peak, its own count, and says a bar is several months", () => {
    const t = find(storyOf(statsOf(months)), "timeline")!;
    expect(t.bars.length).toBeLessThanOrEqual(MAX_MONTH_BARS);
    expect(t.month).toBe("May 2021");
    expect(t.peakValue).toBe(300);
    expect(t.fold).toContain("3 months");
    expect(t.summary).toContain("3 months");
    // The folded bar with the peak month really is shorter than another bar.
    expect(t.bars[t.peak]).toBeLessThan(Math.max(...t.bars));
    expect(t.bars.reduce((a, b) => a + b, 0)).toBe(months.length);
  });

  it("draws the peak month to scale inside its bar, not as the whole bar", () => {
    const { container } = render(<Ribbon bars={[100, 600, 340]} peak={2} peakValue={300} />);
    const rects = [...container.querySelectorAll("rect")];
    const peak = rects.filter((r) => r.classList.contains("is-peak"));
    expect(peak).toHaveLength(1);
    expect(Number(peak[0]!.getAttribute("height"))).toBeCloseTo((300 / 600) * 92, 1);
    expect(rects).toHaveLength(4);
  });

  it("a month that is one bar lights that bar alone", () => {
    const { container } = render(<Ribbon bars={[100, 300]} peak={1} peakValue={300} />);
    expect(container.querySelectorAll("rect")).toHaveLength(2);
    expect(container.querySelectorAll("rect.is-peak")).toHaveLength(1);
  });

  it("an unfolded chart has no fold note", () => {
    const short = [line(Date.UTC(2024, 0, 15, 9), "Asu", "a"), ...Array.from({ length: 20 }, (_, i) => line(Date.UTC(2024, 1, 15, 9, i), "Bora", "b"))];
    expect(find(storyOf(statsOf(short)), "timeline")!.fold).toBeNull();
  });
});

describe("M2: the busiest weekday", () => {
  // 8 Mondays (10 each) against 7 Fridays (11 each): Friday wins per calendar
  // day while Monday has more messages in all.
  const rows: string[] = [];
  for (let t = Date.UTC(2024, 0, 1, 10); t <= Date.UTC(2024, 1, 19, 10); t += DAY) {
    const wd = (new Date(t).getUTCDay() + 6) % 7;
    const n = wd === 0 ? 10 : wd === 4 ? 11 : 3;
    for (let i = 0; i < n; i++) rows.push(line(t + i * 60_000, i % 2 ? "Asu" : "Bora", "kahve"));
  }
  const week = find(storyOf(statsOf(rows)), "week")!;

  it("leads with the metric it ranks by, labelled as an average", () => {
    expect(week.day).toBe("Friday");
    expect(week.average).toBe("11 messages per Friday on average");
    expect(week.total).toBe("77 messages in total · 29.4% of all messages");
  });

  it("says so when another weekday has the larger total", () => {
    expect(week.note).toBe("Most in total: Monday, 80 messages");
    expect(week.summary).toContain("11 messages per Friday on average");
  });

  it("has no note when both agree", () => {
    const plain = find(storyOf(statsOf(Array.from({ length: 30 }, (_, i) => line(Date.UTC(2024, 0, 5 + (i % 3 ? 7 : 0), 9, i), i % 2 ? "Asu" : "Bora", "kahve")))), "week");
    expect(plain?.note ?? null).toBeNull();
  });
});

describe("M3: colours", () => {
  it("gives everyone drawn their own colour, keeping the stable one where it is free", () => {
    const ids = ["0", "8", "11", "1", "9", "2", "3", "4"];
    const colors = distinctColorIndexes(ids);
    expect(participantColorIndex("0")).toBe(participantColorIndex("8"));
    expect(new Set(colors.values()).size).toBe(ids.length);
    expect(colors.get("0")).toBe(participantColorIndex("0"));
    expect(colors.get("3")).toBe(participantColorIndex("3"));
  });

  it("a 12-person group's balance has no repeated colour", () => {
    const counts = [50, 30, 20, 15, 3, 3, 3, 3, 45, 25, 3, 40];
    const rows = counts.flatMap((n, p) => Array.from({ length: n }, (_, i) => line(Date.UTC(2024, 0, 1 + p, 9, i), `P${p}`, "selam")));
    const b = find(storyOf(statsOf(rows)), "balance")!;
    expect(b.segments).toHaveLength(7);
    expect(new Set(b.segments.map((p) => p.color)).size).toBe(7);
  });
});

describe("M5: who writes first", () => {
  const starter = (openers: readonly string[]) => find(storyOf(statsOf(opened(openers))), "behavior")?.starter ?? null;

  it("says nothing from a small sample", () => {
    expect(starter(["Asu", "Bora"])).toBeNull();
    expect(starter(["Asu", "Asu", "Asu", "Bora"])).toBeNull();
  });

  it("names nobody in a tie, in copy or summary", () => {
    const s = starter(["Asu", "Bora", "Asu", "Bora", "Asu", "Bora"])!;
    expect(s.person).toBeNull();
    expect(s.kicker).toBe("Who writes first");
    expect(s.headline).toBe("2 people tied");
    expect(s.text).toBe("Each started 3 of 6 conversations");
    expect(find(storyOf(statsOf(opened(["Asu", "Bora", "Asu", "Bora", "Asu", "Bora"]))), "behavior")!.summary).toContain("tied");
  });

  it("calls a weak lead 'most often', not 'usually'", () => {
    const s = starter(["Asu", "Asu", "Asu", "Bora", "Bora"].concat(["Asu", "Bora", "Bora", "Asu", "Bora", "Asu"]))!; // 6 of 11, 55%
    expect(s.person!.name).toBe("Asu");
    expect(s.kicker).toBe("Most often writes first");
    expect(s.text).toBe("Started 6 of 11 conversations");
  });

  it("keeps 'usually' for a clear majority, over the right denominator", () => {
    const s = starter(["Asu", "Asu", "Asu", "Asu", "Bora", "Bora"])!; // 4 of 6
    expect(s.kicker).toBe("Usually writes first");
    expect(s.text).toBe("Started 4 of 6 conversations");
  });

  it("is the same in Turkish", () => {
    const stats = statsOf(opened(["Asu", "Bora", "Asu", "Bora", "Asu", "Bora"]));
    expect(find(storyOf(stats, "tr"), "behavior")!.starter!.headline).toBe("2 kişi eşit");
  });
});

describe("L5: weak signals", () => {
  it("a tiny chat's poster claims no pattern, as its scenes do not", () => {
    const { poster, scenes } = storyOf(statsOf([line(START, "Alice", "hi")]));
    expect(poster.cells).toEqual([]);
    expect(scenes.map((s) => s.kind)).toEqual(["opening", "volume", "finale"]);
  });

  it("a shared first place is not a poster fact, and the scene says it is shared", () => {
    // Every month, hour-slot and word level.
    const stats = statsOf(Array.from({ length: 24 }, (_, m) => line(Date.UTC(2022, m, 15, 12), m % 2 ? "Asu" : "Bora", "tek çift")));
    const story = storyOf(stats);
    expect(story.poster.cells.some((c) => c.label === "Loudest month")).toBe(false);
    expect(story.poster.cells.some((c) => c.label === "Top word")).toBe(false);
    expect(find(story, "timeline")!.tied).toBe("Tied with 23 more");
  });

  it("a stray late message makes nobody a night owl, nor does a tie", () => {
    const stray = Array.from({ length: 40 }, (_, i) => line(START + i * DAY, i % 2 ? "Asu" : "Bora", "selam")).concat(line(START + 41 * DAY - 11 * 3_600_000, "Asu", "gece"));
    expect(find(storyOf(statsOf(stray.sort())), "behavior")?.owl ?? null).toBeNull();
    const tied = Array.from({ length: 40 }, (_, i) => line(Date.UTC(2024, 0, 1 + i, 2, i), i % 2 ? "Asu" : "Bora", "gece"));
    const stats = statsOf(tied);
    expect(stats.insights.nightOwl.tied).toBe(1);
    expect(find(storyOf(stats), "behavior")?.owl ?? null).toBeNull();
  });
});

describe("L3: text on participant colours", () => {
  it("reaches 4.5:1 on every ground, measured", () => {
    for (const g of Object.values(GROUNDS)) for (const p of g.participants) expect(contrast(g.onParticipant, p)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("L4: media the export does not type", () => {
  const rows = Array.from({ length: 40 }, (_, i) => line(START + i * DAY, i % 2 ? "Asu" : "Bora", "<Media omitted>"));

  it("gives the total alone instead of a category called Other", () => {
    const s = find(storyOf(statsOf(rows)), "shared")!;
    expect(s.media!.untyped).toBe(true);
    expect(s.summary).toContain("40 media files shared.");
    expect(s.summary).not.toContain("Other");
  });

  it("keeps the breakdown when the export has types", () => {
    const typed = [...rows, line(START + 50 * DAY, "Asu", "image omitted")];
    const media = find(storyOf(statsOf(typed)), "shared")!.media!;
    if (media.items.length > 1) expect(media.untyped).toBe(false);
    else expect(media.items[0]!.kind).toBe("Other");
  });
});

/* The player and the finale, with poster drawing under test control. */
describe("player", () => {
  const stats = analyze(parseExport(readFileSync(join(__dirname, "../fixtures/chats/long_android_12h.chat"), "utf8")), NO_FILTERS);

  beforeEach(() => {
    posterBlob.mockResolvedValue(null);
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => `blob:${Math.random()}`), revokeObjectURL: vi.fn() }));
    if (!("PointerEvent" in window)) {
      class PointerEventShim extends MouseEvent {}
      vi.stubGlobal("PointerEvent", PointerEventShim);
    }
  });

  function open(extra?: { returnFocusTo?: RefObject<HTMLElement> }) {
    const onClose = vi.fn();
    const view = render(<I18nProvider initialLocale="en"><main data-testid="page"><button type="button">behind</button></main><div data-testid="root"><Recap stats={stats} onClose={onClose} {...extra} /></div></I18nProvider>);
    return { dialog: screen.getByRole("dialog", { name: "Recap" }), onClose, ...view };
  }
  const toEnd = () => {
    for (let i = 0; i < 20; i++) fireEvent.keyDown(document, { key: "ArrowRight" });
  };
  const blobOf = (hide: boolean) => Object.assign(new Blob(["x"], { type: "image/png" }), { tag: hide ? "hidden" : "named" });
  const savedTag = () => (downloadBlob.mock.calls[0] as unknown as [{ tag: string }])[0].tag;
  /** Resolves each drawing by hand, so the order of results is the test's to choose. */
  function controlledDrawings() {
    const pending: { hide: boolean; resolve: (b: Blob | null) => void }[] = [];
    posterBlob.mockImplementation((_p: unknown, hide: boolean) => new Promise((resolve) => pending.push({ hide, resolve })));
    return pending;
  }
  const settle = () => act(async () => void (await Promise.resolve()));

  it("M6: Save right after Hide names waits for and writes the hidden image", async () => {
    const pending = controlledDrawings();
    const { dialog } = open();
    toEnd();
    await act(async () => pending.shift()!.resolve(blobOf(false)));
    fireEvent.click(within(dialog).getByRole("button", { name: "Hide names in the image" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save image" }));
    await settle();
    expect(downloadBlob).not.toHaveBeenCalled();
    for (const drawing of pending) expect(drawing.hide).toBe(true);
    await act(async () => pending.splice(0).forEach((d) => d.resolve(blobOf(true))));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledOnce());
    expect(savedTag()).toBe("hidden");
  });

  it("M6: turning names back on mid-save writes the image now asked for, never the older one", async () => {
    const pending = controlledDrawings();
    const { dialog } = open();
    toEnd();
    await act(async () => pending.shift()!.resolve(blobOf(false)));
    const hide = within(dialog).getByRole("button", { name: "Hide names in the image" });
    fireEvent.click(hide); // now hidden, drawing
    fireEvent.click(within(dialog).getByRole("button", { name: "Save image" }));
    await settle();
    fireEvent.click(hide); // back to named while that save draws
    fireEvent.click(hide); // and hidden again
    await act(async () => pending.splice(0).forEach((d) => d.resolve(blobOf(d.hide))));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledOnce());
    expect(savedTag()).toBe("hidden");
  });

  it("M6: a slower, older drawing never replaces a newer one, and every URL is revoked", async () => {
    const pending = controlledDrawings();
    const { dialog, unmount } = open();
    toEnd();
    await act(async () => pending.shift()!.resolve(blobOf(false)));
    const hide = within(dialog).getByRole("button", { name: "Hide names in the image" });
    fireEvent.click(hide);
    fireEvent.click(hide);
    fireEvent.click(hide);
    await settle();
    const [oldest, , newest] = pending.splice(0);
    await act(async () => newest!.resolve(blobOf(true)));
    const url = dialog.querySelector("img")!.getAttribute("src");
    await act(async () => oldest!.resolve(blobOf(true)));
    expect(dialog.querySelector("img")!.getAttribute("src")).toBe(url);
    expect(dialog.querySelector("img")!.getAttribute("aria-busy")).toBe("false");
    const create = URL.createObjectURL as unknown as ReturnType<typeof vi.fn>;
    const revoke = URL.revokeObjectURL as unknown as ReturnType<typeof vi.fn>;
    unmount();
    expect(revoke.mock.calls.length).toBe(create.mock.calls.length);
  });

  it("M6: a failed drawing reports failure and writes nothing", async () => {
    posterBlob.mockResolvedValue(null);
    const { dialog } = open();
    toEnd();
    await within(dialog).findByRole("img", { name: /^Recap poster preview\./ });
    await act(async () => void fireEvent.click(within(dialog).getByRole("button", { name: "Save image" })));
    expect(await within(dialog).findByText("Couldn’t save the image.")).toBeTruthy();
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it("M6, L1: the choice survives leaving the finale, and hidden text follows it", async () => {
    posterBlob.mockImplementation(async (_p: unknown, hide: boolean) => blobOf(hide));
    const { dialog } = open();
    toEnd();
    const hideButton = () => within(dialog).getByRole("button", { name: "Hide names in the image" });
    fireEvent.click(hideButton());
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(hideButton().getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(dialog.querySelector("img")).toBeTruthy());
    const finale = find(storyOf(stats), "finale")!;
    expect(dialog.querySelector("img")!.getAttribute("alt")).toContain(finale.summaryHidden);
    expect(dialog.querySelector("[aria-live]")!.textContent).toContain(finale.summaryHidden);
    fireEvent.click(within(dialog).getByRole("button", { name: "Watch again" }));
    toEnd();
    expect(hideButton().getAttribute("aria-pressed")).toBe("true");
  });

  it("H2: the page behind is inert while open and only what Recap changed is restored", () => {
    const { getByTestId, unmount } = render(<div />);
    unmount();
    const outside = document.createElement("div");
    outside.setAttribute("inert", "");
    document.body.append(outside);
    const { dialog } = open();
    expect(screen.getByTestId("page").hasAttribute("inert")).toBe(true);
    expect(dialog.closest("[inert]")).toBeNull();
    expect(getByTestId).toBeDefined();
    cleanup();
    expect(outside.hasAttribute("inert")).toBe(true);
    expect(document.querySelectorAll("[inert]")).toHaveLength(1);
    outside.remove();
  });

  it("H2: a disabled or removed control hands focus to the dialog, and close returns it", () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const { dialog, unmount } = open();
    expect(document.activeElement).toBe(dialog);
    const next = within(dialog).getByRole("button", { name: "Next scene" });
    next.focus();
    toEnd();
    expect((next as HTMLButtonElement).disabled).toBe(true);
    expect(document.activeElement).toBe(dialog);
    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it("H2: focus landing outside is sent back", () => {
    const stray = document.createElement("button");
    document.body.append(stray);
    const { dialog } = open();
    stray.removeAttribute("inert");
    stray.focus();
    expect(document.activeElement).toBe(dialog);
    stray.remove();
  });

  it("H5: blur and pointer cancel end a hold; a hold never navigates", () => {
    vi.useFakeTimers();
    try {
      const { dialog } = open();
      const stage = dialog.querySelector<HTMLElement>(".rc-stage")!;
      fireEvent.pointerDown(stage, { clientX: 200, clientY: 200 });
      act(() => void vi.advanceTimersByTime(400));
      expect(dialog.classList.contains("is-paused")).toBe(true);
      act(() => void window.dispatchEvent(new Event("blur")));
      expect(dialog.classList.contains("is-paused")).toBe(false);
      fireEvent.pointerUp(stage, { clientX: 200, clientY: 200 });
      expect(dialog.querySelector(".rc-slide")!.getAttribute("aria-label")).toBe("Scene 1 of 12");
      fireEvent.pointerDown(stage, { clientX: 200, clientY: 200 });
      act(() => void vi.advanceTimersByTime(400));
      fireEvent.pointerCancel(stage);
      expect(dialog.classList.contains("is-paused")).toBe(false);
      fireEvent.pointerDown(stage, { clientX: 200, clientY: 200 });
      act(() => void vi.advanceTimersByTime(400));
      fireEvent.lostPointerCapture(stage);
      expect(dialog.classList.contains("is-paused")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("M8, H4: one state for Play and Pause, with a status for assistive technology", () => {
    const { dialog } = open();
    const pause = within(dialog).getByRole("button", { name: "Pause" });
    expect(pause.hasAttribute("aria-pressed")).toBe(false);
    fireEvent.click(pause);
    const play = within(dialog).getByRole("button", { name: "Play" });
    expect(play.hasAttribute("aria-pressed")).toBe(false);
    expect(within(dialog).getAllByRole("status").some((s) => s.textContent === "Story paused")).toBe(true);
    // The visible status replaces the counter, inside the navigation row.
    expect(dialog.querySelector(".rc-nav .rc-pip")!.textContent).toBe("Paused");
    expect(dialog.querySelector(".rc-counter")).toBeNull();
  });

  it("nothing plays on the finale: Space there changes nothing for later", () => {
    const { dialog } = open();
    toEnd();
    fireEvent.keyDown(document, { key: " " });
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(dialog.classList.contains("is-paused")).toBe(false);
  });

  it("L2: the dialog is titled by its h1 and each scene has one h2, beats an h3", () => {
    const { dialog } = open();
    expect(dialog.getAttribute("aria-labelledby")).toBe(dialog.querySelector("h1")!.id);
    for (let i = 0; i < 12; i++) {
      expect(dialog.querySelectorAll(".rc-stage h2").length, `scene ${i + 1}`).toBe(1);
      const kind = dialog.querySelector(".rc-scene")!.getAttribute("data-kind");
      if (kind === "behavior") expect(dialog.querySelectorAll(".rc-stage h3").length).toBe(2);
      fireEvent.keyDown(document, { key: "ArrowRight" });
    }
  });

  it("L11: removed hooks stay removed, and the state hook tests read stays", () => {
    const { dialog } = open();
    expect(dialog.hasAttribute("data-ground")).toBe(false);
    expect(dialog.querySelector('[class*="rc-family"]')).toBeNull();
    expect(dialog.querySelector(".rc-night")).toBeNull();
  });
});

describe("L10: error isolation", () => {
  function Boom(): never {
    throw new Error("synthetic failure");
  }

  it("a throwing Recap shows a way back and leaves the page standing", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const onClose = vi.fn();
    render(<I18nProvider initialLocale="en"><p>chat still here</p><RecapBoundary onClose={onClose}><Boom /></RecapBoundary></I18nProvider>);
    expect(screen.getByText("chat still here")).toBeTruthy();
    const dialog = screen.getByRole("alertdialog", { name: "The Recap couldn’t be shown" });
    const back = within(dialog).getByRole("button", { name: "Back to the chat" });
    expect(document.activeElement).toBe(back);
    fireEvent.click(back);
    expect(onClose).toHaveBeenCalledOnce();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
    quiet.mockRestore();
  });

  it("is transparent when nothing fails", () => {
    render(<I18nProvider initialLocale="en"><RecapBoundary onClose={() => {}}><p>fine</p></RecapBoundary></I18nProvider>);
    expect(screen.getByText("fine")).toBeTruthy();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
