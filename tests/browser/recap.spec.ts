/* Recap regressions that need a real browser. Each names the audit finding it guards. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, test, type Page } from "@playwright/test";
import { chat, DUO, layoutProblems, openChat, openRecap, sceneNumber, sceneTotal, toFinale, toScene } from "./support";

const FULL_LONG = "Muhammed Abdurrahman Karagöz";
const VERY_LONG = "Muhammed Abdurrahman Şahin-Karagöz Yıldırımoğulları Üçüncü Mahalle Muhtarlığı Başkanı";
const UNBROKEN = "K".repeat(100);
const paused = (page: Page) => page.locator(".rc").evaluate((e) => e.classList.contains("is-paused"));
const SIZES = [[320, 568], [375, 667], [390, 844], [568, 320], [844, 390], [768, 1024], [1024, 768], [1920, 1080]] as const;

test.describe("H1, M6, L1: hide names", () => {
  // Who talks about whom: the top word is the other person's first name.
  const named = chat(["Mert Aydın", "Selin Koç"], 400, (i) => (i % 2 ? "Selin Selin nasılsın" : "Mert geliyor musun"));

  async function savedPng(page: Page, act: () => Promise<void>) {
    const download = page.waitForEvent("download");
    await act();
    return createHash("sha1").update(readFileSync(await (await download).path())).digest("hex");
  }

  test("nothing drawn on the hidden poster names anyone, and no accessible text does", async ({ page }) => {
    await page.addInitScript(() => {
      const drawn: string[] = ((window as unknown as { drawn: string[] }).drawn = []);
      const real = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (text: string, x: number, y: number) {
        // The poster's canvas only: charts on the page behind have names too.
        if (this.canvas.width === 1080) drawn.push(text);
        return real.call(this, text, x, y);
      };
    });
    await openChat(page, named);
    await openRecap(page);
    await toFinale(page);
    await expect(page.locator("img.rc-poster")).toBeVisible();
    const drawn = () => page.evaluate(() => (window as unknown as { drawn: string[] }).drawn.join(" | "));
    expect(await drawn()).toMatch(/selin/i);
    await page.evaluate(() => void ((window as unknown as { drawn: string[] }).drawn.length = 0));
    await page.getByRole("button", { name: "Hide names in the image" }).click();
    await expect.poll(drawn).toContain("Person 1");
    for (const text of [await drawn(), await page.locator("img.rc-poster").getAttribute("alt") ?? "", await page.locator(".rc [aria-live]").innerText()]) {
      expect(text).not.toMatch(/selin|mert|aydın|koç/i);
    }
  });

  test("Save right after Hide names writes the hidden image, even on a slow CPU", async ({ page, browserName }) => {
    await openChat(page, named);
    await openRecap(page);
    await toFinale(page);
    await expect(page.locator("img.rc-poster")).toBeVisible();
    const save = page.getByRole("button", { name: "Save image" });
    const shown = await savedPng(page, () => save.click());
    await page.getByRole("button", { name: "Hide names in the image" }).click();
    await expect(page.locator('img.rc-poster[aria-busy="false"]')).toBeVisible();
    const hidden = await savedPng(page, () => save.click());
    expect(hidden).not.toBe(shown);
    await page.getByRole("button", { name: "Hide names in the image" }).click();
    await expect(page.locator('img.rc-poster[aria-busy="false"]')).toBeVisible();
    if (browserName === "chromium") await (await page.context().newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: 6 });
    const clickBoth = () => page.evaluate(() => {
      const buttons = [...document.querySelectorAll<HTMLButtonElement>(".rc-button")];
      buttons.find((b) => /Hide/.test(b.textContent!))!.click();
      setTimeout(() => buttons.find((b) => /Save/.test(b.textContent!))!.click(), 0);
    });
    expect(await savedPng(page, clickBoth)).toBe(hidden);
    // Rapid toggling ends on "hidden" (three flips from hidden): the save follows the last state.
    const flips = () => page.evaluate(() => {
      const buttons = [...document.querySelectorAll<HTMLButtonElement>(".rc-button")];
      const hide = buttons.find((b) => /Hide/.test(b.textContent!))!;
      hide.click();
      setTimeout(() => hide.click(), 0);
      setTimeout(() => buttons.find((b) => /Save/.test(b.textContent!))!.click(), 5);
    });
    expect(await savedPng(page, flips)).toBe(hidden);
  });

  test("the choice survives leaving the finale and coming back", async ({ page }) => {
    await openChat(page, named);
    await openRecap(page);
    await toFinale(page);
    await page.getByRole("button", { name: "Hide names in the image" }).click();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("button", { name: "Hide names in the image" })).toHaveAttribute("aria-pressed", "true");
  });
});

test.describe("H2: focus stays in the dialog", () => {
  test("a disabled or removed control hands focus to the dialog, and the page behind is inert", async ({ page }) => {
    await openChat(page, chat(DUO));
    await openRecap(page);
    const inRecap = () => page.evaluate(() => Boolean(document.activeElement?.closest(".rc")));
    const total = await sceneTotal(page);
    await expect(page.locator(".app > header")).toHaveAttribute("inert", "");
    await page.locator(".rc-nav-next").focus();
    for (let i = 1; i < total; i++) await page.keyboard.press("Enter");
    expect(await sceneNumber(page)).toBe(total);
    expect(await inRecap()).toBe(true);
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      expect(await inRecap()).toBe(true);
    }
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Shift+Tab");
      expect(await inRecap()).toBe(true);
    }
    await page.locator(".rc-nav-prev").focus();
    for (let i = 1; i < total; i++) await page.keyboard.press("Enter");
    expect(await sceneNumber(page)).toBe(1);
    expect(await inRecap()).toBe(true);
    // Pause goes away on the finale.
    for (let i = 2; i < total; i++) await page.keyboard.press("ArrowRight");
    await page.locator(".rc-btn-play").focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator(".rc-btn-play")).toHaveCount(0);
    expect(await inRecap()).toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.locator(".rc")).toHaveCount(0);
    await expect(page.locator(".recap-btn")).toBeFocused();
    await expect(page.locator("[inert]")).toHaveCount(0);
    expect(await page.evaluate(() => document.body.classList.contains("sheet-open"))).toBe(false);
  });
});

test.describe("H3, M7: small and zoomed viewports", () => {
  // 400% zoom on 1280x720 and 1280x1024 lays out as 320x180 and 320x256 at 4x.
  for (const [width, height] of [[320, 256], [320, 180], [480, 270]] as const) {
    test(`everything is reachable at ${width}x${height}, by scrolling where needed`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 4, reducedMotion: "reduce", baseURL: "http://127.0.0.1:4179/" });
      const page = await context.newPage();
      await openChat(page, chat(["Ali", "Ayşe", "Burak"]));
      await page.setViewportSize({ width: 1280, height: 800 });
      await openRecap(page);
      await page.setViewportSize({ width, height });
      const total = await sceneTotal(page);
      for (let i = 0; i < total; i++) {
        expect(await layoutProblems(page), `scene ${i + 1}`).toEqual([]);
        if (i < total - 1) await page.keyboard.press("ArrowRight");
      }
      for (const name of ["Save image", "Watch again", "Hide names in the image"]) {
        const button = page.getByRole("button", { name });
        await button.scrollIntoViewIfNeeded();
        await expect(button).toBeInViewport({ ratio: 1 });
      }
      await page.getByRole("button", { name: "Hide names in the image" }).click();
      await expect(page.getByRole("button", { name: "Hide names in the image" })).toHaveAttribute("aria-pressed", "true");
      // Controls never scroll away, and arrows scroll without changing scene.
      await expect(page.getByRole("button", { name: "Close Recap" })).toBeInViewport({ ratio: 1 });
      await page.keyboard.press("ArrowUp");
      expect(await sceneNumber(page)).toBe(total);
      await context.close();
    });
  }

  test("a wheel scroll on a scrolling scene does not change scene, and a tall scene stops autoplay", async ({ page }) => {
    await openChat(page, chat(["Ali", "Ayşe", "Burak"]));
    await page.setViewportSize({ width: 320, height: 256 });
    await openRecap(page);
    await page.keyboard.press("ArrowRight");
    await expect(page.locator(".rc-stage.is-scroll")).toHaveCount(1);
    await expect.poll(() => paused(page)).toBe(true);
    await expect(page.locator(".rc-stage")).toHaveAttribute("tabindex", "0");
    await page.mouse.move(160, 150);
    await page.mouse.wheel(0, 60);
    await expect.poll(() => page.locator(".rc-stage").evaluate((e) => e.scrollTop)).toBeGreaterThan(0);
    expect(await sceneNumber(page)).toBe(2);
  });

  for (const [width, height] of [[568, 320], [667, 375], [640, 360], [844, 390]] as const) {
    test(`the finale fits without scrolling at ${width}x${height}`, async ({ page }) => {
      // A group's title is the longest the finale normally carries.
      await openChat(page, chat(["Ali", "Ayşe", "Burak"]));
      await page.setViewportSize({ width, height });
      await openRecap(page);
      await toFinale(page);
      await expect(page.locator(".rc-stage.is-scroll")).toHaveCount(0);
      expect(await layoutProblems(page)).toEqual([]);
      for (const name of ["Save image", "Watch again", "Hide names in the image"]) await expect(page.getByRole("button", { name })).toBeInViewport({ ratio: 1 });
    });
  }
});

test.describe("H4: the paused status", () => {
  test("is never over a scene, on any scene or layout", async ({ page }) => {
    await openChat(page, chat(["Ali", "Ayşe", "Burak"]));
    await openRecap(page);
    await page.keyboard.press(" ");
    // Rest every figure: a paused entrance would otherwise hold content off its place.
    await page.addStyleTag({ content: ".rc-stage *, .rc-slide { animation: none !important; }" });
    const total = await sceneTotal(page);
    for (const [width, height] of [...SIZES, [320, 256]] as const) {
      await page.setViewportSize({ width, height });
      for (let i = 0; i < total; i++) await page.keyboard.press("ArrowLeft");
      for (let i = 0; i < total - 1; i++) {
        const label = `${width}x${height} scene ${i + 1}`;
        await expect(page.locator(".rc-pip"), label).toBeVisible();
        const clear = await page.evaluate(() => {
          const pip = document.querySelector(".rc-pip")!.getBoundingClientRect();
          const stage = document.querySelector(".rc-stage")!.getBoundingClientRect();
          const buttons = [...document.querySelectorAll(".rc-btn")].map((b) => b.getBoundingClientRect());
          const apart = (a: DOMRect, b: DOMRect) => a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1;
          return apart(pip, stage) && buttons.every((b) => apart(pip, b)) && pip.left >= 0 && pip.right <= innerWidth;
        });
        expect(clear, label).toBe(true);
        await page.keyboard.press("ArrowRight");
      }
    }
  });
});

test.describe("H5: a hold ends with the press", () => {
  test("releasing outside the stage resumes the story without navigating", async ({ page }) => {
    await openChat(page, chat(DUO));
    await openRecap(page);
    await page.mouse.move(800, 400);
    await page.mouse.down();
    await expect.poll(() => paused(page)).toBe(true);
    await page.mouse.move(640, 30, { steps: 5 });
    await page.mouse.up();
    await expect.poll(() => paused(page)).toBe(false);
    expect(await sceneNumber(page)).toBe(1);
    await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  });

  test("losing the window ends a hold", async ({ page }) => {
    await openChat(page, chat(DUO));
    await openRecap(page);
    await page.mouse.move(800, 400);
    await page.mouse.down();
    await expect.poll(() => paused(page)).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect.poll(() => paused(page)).toBe(false);
    await page.mouse.up();
    expect(await sceneNumber(page)).toBe(1);
  });

  test("a click and a mouse swipe still navigate; a hold does not", async ({ page }) => {
    await openChat(page, chat(DUO));
    await openRecap(page);
    await page.keyboard.press(" ");
    await page.mouse.click(800, 400);
    expect(await sceneNumber(page)).toBe(2);
    await page.mouse.click(150, 400);
    expect(await sceneNumber(page)).toBe(1);
    await page.mouse.move(900, 400);
    await page.mouse.down();
    await page.mouse.move(600, 405, { steps: 4 });
    await page.mouse.up();
    expect(await sceneNumber(page)).toBe(2);
    await page.mouse.move(800, 400);
    await page.mouse.down();
    await page.waitForTimeout(400);
    await page.mouse.up();
    expect(await sceneNumber(page)).toBe(2);
  });

  test("touch: tap, swipe, long press and release elsewhere", async ({ browser, browserName }) => {
    test.skip(browserName !== "chromium", "touch input goes through the Chromium DevTools protocol");
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, baseURL: "http://127.0.0.1:4179/" });
    const page = await context.newPage();
    await openChat(page, chat(DUO));
    await page.locator(".recap-btn").tap();
    const cdp = await context.newCDPSession(page);
    const touch = (type: string, x = 0, y = 0) => cdp.send("Input.dispatchTouchEvent", { type: type as "touchStart", touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
    await touch("touchStart", 300, 400);
    await touch("touchEnd");
    await expect.poll(() => sceneNumber(page)).toBe(2);
    await touch("touchStart", 40, 400);
    await touch("touchEnd");
    await expect.poll(() => sceneNumber(page)).toBe(1);
    await touch("touchStart", 330, 400);
    for (let x = 320; x >= 120; x -= 40) await touch("touchMove", x, 402);
    await touch("touchEnd");
    await expect.poll(() => sceneNumber(page)).toBe(2);
    await touch("touchStart", 300, 400);
    await expect.poll(() => paused(page)).toBe(true);
    await touch("touchMove", 300, 30);
    await touch("touchEnd");
    await expect.poll(() => paused(page)).toBe(false);
    expect(await sceneNumber(page)).toBe(2);
    await context.close();
  });
});

test.describe("M4, L7, L8: names and glyphs that test the layout", () => {
  for (const [label, people] of [
    ["28-32 characters", [FULL_LONG, "Ayşe Gülşen Yıldırımoğlu-Çelik"]],
    ["85 characters", [VERY_LONG, "Zeynep"]],
    ["100 characters, unbroken", [UNBROKEN, "Ş".repeat(99)]],
    ["emoji and right-to-left", ["👩🏽‍💻🧑🏿‍🚀🎉 Emoji Person 🎉", "محمد عبد الرحمن الكبير المعروف"]],
  ] as const) {
    test(`${label}: nothing collides at phone and tablet widths`, async ({ page }) => {
      await openChat(page, chat(people));
      await openRecap(page);
      await page.keyboard.press(" ");
      await page.addStyleTag({ content: ".rc-stage *, .rc-slide { animation: none !important; }" });
      const total = await sceneTotal(page);
      for (const [width, height] of [[320, 568], [360, 640], [375, 667], [390, 844], [430, 932], [768, 1024], [834, 1194]] as const) {
        await page.setViewportSize({ width, height });
        for (let i = 0; i < total; i++) await page.keyboard.press("ArrowLeft");
        for (let i = 0; i < total; i++) {
          expect(await layoutProblems(page), `${width}x${height} scene ${i + 1}`).toEqual([]);
          const clamped = await page.locator(".rc-name").evaluateAll((els) => els.every((e) => parseFloat(getComputedStyle(e).lineHeight) * 2.6 >= e.getBoundingClientRect().height));
          expect(clamped, "two lines at most").toBe(true);
          await page.keyboard.press("ArrowRight");
        }
      }
    });
  }

  test("a right-to-left name stays beside its swatch, and the full name stays available", async ({ page }) => {
    await openChat(page, chat(["Ali", "Burak", "محمد عبد الرحمن", VERY_LONG]));
    await page.setViewportSize({ width: 390, height: 844 });
    await openRecap(page);
    await toScene(page, "balance");
    const gaps = await page.locator(".rc-legend-list li").evaluateAll((rows) => rows.slice(0, 4).map((row) => {
      const swatch = row.querySelector(".rc-swatch")!.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(row.querySelector(".rc-legend-name")!);
      return range.getBoundingClientRect().left - swatch.right;
    }));
    for (const gap of gaps) expect(gap).toBeLessThan(16);
    await expect(page.locator(`.rc-legend-name[title="${VERY_LONG}"]`)).toHaveCount(1);
  });

  test("every emoji stays inside its circle and the row inside the stage", async ({ browser }) => {
    // At rest: mid-entrance the circles are scaled to nothing and anything fits.
    const context = await browser.newContext({ reducedMotion: "reduce", baseURL: "http://127.0.0.1:4179/" });
    const page = await context.newPage();
    const spread = chat(["Ali", "Burak"], 900, (i) => `kahve ${i === 450 ? "🎉" : i % 60 === 0 ? "👍" : i % 20 === 0 ? "🔥" : i % 3 === 0 ? "❤️" : "😂"}`);
    await openChat(page, spread);
    for (const [width, height] of [[320, 568], [390, 844], [844, 390], [1920, 1080]] as const) {
      await page.setViewportSize({ width, height });
      if (!(await page.locator(".rc").count())) await openRecap(page);
      await toScene(page, "shared");
      const fits = await page.locator(".rc-emoji-glyph").evaluateAll((glyphs) => {
        const stage = document.querySelector(".rc-stage")!.getBoundingClientRect();
        return glyphs.every((g) => {
          const circle = g.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(g);
          const glyph = range.getBoundingClientRect();
          return glyph.width <= circle.width + 1 && circle.left >= stage.left - 1 && circle.right <= stage.right + 1;
        });
      });
      expect(fits, `${width}x${height}`).toBe(true);
    }
    await context.close();
  });
});

test.describe("L6: the reduced-motion hint", () => {
  for (const [width, height] of [[700, 699], [760, 700], [568, 320], [1280, 800]] as const) {
    test(`never overlaps the scene in Turkish at ${width}x${height}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce", locale: "tr-TR", baseURL: "http://127.0.0.1:4179/" });
      const page = await context.newPage();
      await openChat(page, chat(DUO));
      await openRecap(page);
      await expect(page.locator(".rc-hint")).toBeVisible();
      expect(await layoutProblems(page)).toEqual([]);
      const apart = await page.evaluate(() => {
        const hint = document.querySelector(".rc-hint")!.getBoundingClientRect();
        const others = [...document.querySelectorAll(".rc-btn, .rc-chapter, .rc-copy")].map((e) => e.getBoundingClientRect());
        return others.every((o) => hint.right <= o.left + 1 || o.right <= hint.left + 1 || hint.bottom <= o.top + 1 || o.bottom <= hint.top + 1);
      });
      expect(apart).toBe(true);
      await context.close();
    });
  }
});

test.describe("M9: browser history", () => {
  test("Back closes the Recap and keeps the chat; Forward reopens it; closing leaves no extra entries", async ({ page }) => {
    await openChat(page, chat(DUO));
    await openRecap(page);
    await page.goBack();
    await expect(page.locator(".rc")).toHaveCount(0);
    await expect(page.locator(".recap-btn")).toBeVisible();
    await expect(page.locator(".recap-btn")).toBeFocused();
    await page.goForward();
    await expect(page.locator(".rc")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".rc")).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => (history.state as { recap?: boolean } | null)?.recap ?? false)).toBe(false);
    const length = await page.evaluate(() => history.length);
    for (let i = 0; i < 4; i++) {
      await openRecap(page);
      await page.getByRole("button", { name: "Close Recap" }).click();
      await expect(page.locator(".rc")).toHaveCount(0);
      await expect.poll(() => page.evaluate(() => (history.state as { recap?: boolean } | null)?.recap ?? false)).toBe(false);
    }
    expect(await page.evaluate(() => history.length)).toBe(length);
    await expect(page.locator(".recap-btn")).toBeVisible();
  });
});

test.describe("M1, M3: what the figures say", () => {
  test("a folded timeline says what a bar holds and lights only the month's own part", async ({ page }) => {
    const lines: string[] = [];
    const add = (month: number, n: number) => {
      for (let i = 0; i < n; i++) {
        const d = new Date(Date.UTC(2018, month, 1 + (i % 27), 9 + (i % 10), i % 60));
        lines.push({ at: d.getTime(), text: `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCFullYear()).slice(2)}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} - ${i % 2 ? "Asu" : "Bora"}: kahve` } as never);
      }
    };
    for (let m = 0; m < 80; m++) add(m, m === 40 ? 300 : m >= 60 && m < 63 ? 200 : 20);
    const content = (lines as unknown as { at: number; text: string }[]).sort((a, b) => a.at - b.at).map((l) => l.text).join("\n");
    await openChat(page, content);
    await openRecap(page);
    await toScene(page, "timeline");
    await expect(page.locator(".rc-note")).toContainText("Each bar adds up to 3 months");
    await expect(page.locator(".rc-copy")).toContainText("May 2021");
    const heights = await page.locator(".rc-fig-ribbon rect").evaluateAll((rects) => rects.map((r) => ({ peak: r.classList.contains("is-peak"), h: Number(r.getAttribute("height")), x: Number(r.getAttribute("x")) })));
    const peak = heights.filter((r) => r.peak);
    expect(peak).toHaveLength(1);
    const holder = heights.find((r) => !r.peak && r.x === peak[0]!.x)!;
    expect(peak[0]!.h).toBeLessThan(holder.h);
    // 300 messages against 92 units for the tallest bar (600): to scale, not stretched.
    expect(peak[0]!.h / Math.max(...heights.map((r) => r.h))).toBeCloseTo(300 / 600, 1);
  });

  test("twelve people: everyone drawn has their own colour and a rank", async ({ page }) => {
    // Ids 0, 8 and 11 hash to one colour, 1 and 9 to another: these people lead.
    const names = ["A0", "B1", "C2", "D3", "E4", "F5", "G6", "H7", "I8", "J9", "K10", "L11"];
    const counts = [50, 30, 20, 15, 3, 3, 3, 3, 45, 25, 3, 40];
    const lines: string[] = [];
    let hour = 0;
    names.forEach((name, i) => {
      for (let j = 0; j < counts[i]!; j++, hour++) {
        const d = new Date(Date.UTC(2024, 0, 1, 9) + hour * 3_600_000);
        lines.push(`${String(d.getUTCDate()).padStart(2, "0")}/01/24, ${String(d.getUTCHours()).padStart(2, "0")}:00 - ${name}: selam`);
      }
    });
    await openChat(page, lines.join("\n"));
    await openRecap(page);
    await toScene(page, "balance");
    const swatches = await page.locator(".rc-swatch.rank").evaluateAll((els) => els.map((e) => ({ color: getComputedStyle(e).backgroundColor, rank: e.textContent })));
    expect(new Set(swatches.map((s) => s.color)).size).toBe(swatches.length);
    expect(swatches.map((s) => s.rank)).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
    await expect(page.locator(".rc-split-rank").first()).toHaveText("1");
  });
});

test.describe("L10: a failed Recap keeps the chat", () => {
  test("the page survives a render error in the Recap", async ({ page }) => {
    await openChat(page, chat(DUO));
    // Make a figure's render throw, the way a bug would: the dial maps 24 hours.
    await page.evaluate(() => {
      const real = Array.prototype.map;
      (window as unknown as { disarm: () => void }).disarm = () => void (Array.prototype.map = real);
      (window as unknown as { armRecapFailure: () => void }).armRecapFailure = () => {
        Array.prototype.map = function (this: unknown[], ...args: unknown[]) {
          if (this.length === 24) throw new Error("synthetic");
          return (real as (...a: unknown[]) => unknown).apply(this, args);
        } as typeof Array.prototype.map;
      };
    });
    await openRecap(page);
    await page.evaluate(() => (window as unknown as { armRecapFailure: () => void }).armRecapFailure());
    await toScene(page, "clock").catch(() => undefined);
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page.evaluate(() => (window as unknown as { disarm: () => void }).disarm());
    await page.getByRole("button", { name: "Back to the chat" }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(page.locator(".recap-btn")).toBeVisible();
    await expect(page.locator("[inert]")).toHaveCount(0);
  });
});

test.describe("Time zones and date boundaries", () => {
  const edge = [
    "31/12/23, 23:59 - Asu: kapanış", "01/01/24, 00:00 - Bora: yılbaşı", "29/02/24, 12:00 - Asu: artık", "31/03/24, 02:30 - Bora: yaz saati",
    ...Array.from({ length: 20 }, (_, i) => `${String(i + 1).padStart(2, "0")}/04/24, 08:15 - ${i % 3 ? "Asu" : "Bora"}: nisan`),
  ].join("\n");
  const seen = new Map<string, string>();
  for (const timezoneId of ["UTC", "Asia/Tokyo", "America/Los_Angeles", "Europe/Istanbul", "Pacific/Kiritimati"]) {
    test(`the story reads the same in ${timezoneId}`, async ({ browser, browserName }) => {
      const context = await browser.newContext({ timezoneId, locale: "en-US", baseURL: "http://127.0.0.1:4179/" });
      const page = await context.newPage();
      await openChat(page, edge);
      await openRecap(page);
      const text: string[] = [];
      const total = await sceneTotal(page);
      for (let i = 0; i < total; i++) {
        text.push(await page.locator(".rc [aria-live]").innerText());
        await page.keyboard.press("ArrowRight");
      }
      const all = text.join("\n");
      expect(all).toContain("Dec 31, 2023 – Apr 20, 2024");
      expect(all).toContain("24 messages");
      const key = browserName;
      if (seen.has(key)) expect(all).toBe(seen.get(key));
      else seen.set(key, all);
      await context.close();
    });
  }
});

test.describe("Accessibility", () => {
  const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
  const axe = async (page: Page, label: string) => {
    await page.addScriptTag({ path: axePath });
    const violations = await page.evaluate(async () => {
      const run = (window as unknown as { axe: { run: (c: string, o: object) => Promise<{ violations: { id: string; nodes: { target: unknown[] }[] }[] }> } }).axe;
      const result = await run.run(".rc", { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] });
      return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => JSON.stringify(n.target)).join(", ")}`);
    });
    expect(violations, label).toEqual([]);
  };

  for (const [width, height] of [[1280, 800], [390, 844], [320, 256]] as const) {
    test(`axe finds nothing on any scene at ${width}x${height}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce", baseURL: "http://127.0.0.1:4179/" });
      const page = await context.newPage();
      await openChat(page, chat(["Ali", "Ayşe", "Burak"]));
      await openRecap(page);
      const total = await sceneTotal(page);
      for (let i = 0; i < total; i++) {
        if (i === total - 1) await expect(page.locator("img.rc-poster")).toBeVisible({ timeout: 5000 });
        await axe(page, `scene ${i + 1}`);
        await page.keyboard.press("ArrowRight");
      }
      await context.close();
    });
  }

  test("every scene has one h2 under the dialog's h1, with no skipped level", async ({ page }) => {
    await openChat(page, chat(["Ali", "Ayşe", "Burak"]));
    await openRecap(page);
    await expect(page.getByRole("dialog", { name: "Recap" })).toBeVisible();
    await expect(page.locator(".rc h1")).toHaveCount(1);
    const total = await sceneTotal(page);
    for (let i = 0; i < total; i++) {
      await expect(page.locator(".rc-stage h2"), `scene ${i + 1}`).toHaveCount(1);
      await page.keyboard.press("ArrowRight");
    }
  });

  test("reduced motion: nothing moves until Play, and Play only runs the clock", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce", baseURL: "http://127.0.0.1:4179/" });
    const page = await context.newPage();
    await openChat(page, chat(DUO));
    await openRecap(page);
    const moving = () => page.evaluate(() => [...document.querySelectorAll(".rc-stage *")].flatMap((e) => e.getAnimations()).length);
    expect(await moving()).toBe(0);
    expect(await paused(page)).toBe(true);
    await page.getByRole("button", { name: "Play" }).click();
    expect(await paused(page)).toBe(false);
    expect(await moving()).toBe(0);
    await context.close();
  });
});

test("the console stays clean through a full play of the story", async ({ page }) => {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") problems.push(m.text());
  });
  await openChat(page, chat(["Ali", "Ayşe", "Burak"]));
  await openRecap(page);
  await toFinale(page);
  await expect(page.locator("img.rc-poster")).toBeVisible();
  await page.getByRole("button", { name: "Watch again" }).click();
  expect(await sceneNumber(page)).toBe(1);
  expect(problems).toEqual([]);
});
