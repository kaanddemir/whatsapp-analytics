/* Search by meaning in a real browser: the import screen's layout, the journey
   through the menu with the real workers, and every dialog state's layout at a
   phone and a desktop width. Model requests are refused: nothing is downloaded. */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, test, type Page } from "@playwright/test";
import { chat, DUO, openChat } from "./support";

const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

test.beforeEach(async ({ page }) => {
  await page.route("**/models/**", (route) => route.abort());
});

const overflow = (page: Page) => page.evaluate(() => {
  const root = document.documentElement;
  const dialog = document.querySelector(".dialog");
  const box = dialog?.getBoundingClientRect();
  const escaped = box ? [...dialog!.querySelectorAll("p, button, h2, h3, progress")].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.left < box.left - 0.5 || r.right > box.right + 0.5;
  }).map((el) => el.textContent) : [];
  return { page: root.scrollWidth - root.clientWidth, dialog: dialog ? dialog.scrollWidth - dialog.clientWidth : 0, escaped };
});

/** Playwright's WebKit build has no working Origin Private File System. */
const hasStorage = (page: Page) => page.evaluate(() => navigator.storage.getDirectory().then(() => true, () => false));

const STATES = {
  off: { status: "off" },
  preparing: { status: "preparing", phase: "load", loaded: 0, total: 0 },
  download: { status: "preparing", phase: "download", loaded: 40_000_000, total: 135_000_000 },
  indexing: { status: "indexing", done: 41_250, total: 118_400, device: "wasm" },
  paused: { status: "paused", done: 41_250, total: 118_400 },
  ready: { status: "ready", done: 118_400, total: 118_400, device: "wasm" },
  failed: { status: "failed", reason: "model_missing", done: 41_250, total: 118_400 },
  retry: { status: "failed", reason: "storage_full", done: 0, total: 118_400 },
  final: { status: "failed", reason: "too_large", done: 0, total: 118_400 },
} as const;

for (const width of [320, 768, 1280]) {
  for (const locale of ["en", "tr"] as const) {
    test(`the import opt-in fits at ${width}px in ${locale}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.addInitScript((l) => localStorage.setItem("whatsapp-analytics-language", l), locale);
      await page.goto("/");
      const option = page.locator(".meaning-option input");
      if (await hasStorage(page)) {
        await expect(option).toBeVisible();
        await expect(option).not.toBeChecked();
        // The explanation waits behind the "?", and stays on screen when it opens.
        await expect(page.locator(".meaning-option .help-tip")).toBeHidden();
        await page.locator(".meaning-option .help-btn").hover();
        await expect(page.locator(".meaning-option .help-tip")).toBeVisible();
        const tip = (await page.locator(".meaning-option .help-tip").boundingBox())!;
        expect(tip.x).toBeGreaterThanOrEqual(0);
        expect(tip.x + tip.width).toBeLessThanOrEqual(width);
      } else {
        // The model has nowhere to live, so nothing is offered; Search settings explains it once a chat is open.
        await expect(page.locator(".welcome")).toBeVisible();
        await expect(option).toHaveCount(0);
      }
      expect((await overflow(page)).page).toBeLessThanOrEqual(0);
    });
  }
}

test("Enable through the menu reports a missing model, and the chat and Ask keep working", async ({ page }) => {
  await openChat(page, chat(DUO, 60));
  await page.locator(".view-tab").nth(1).click();
  await page.locator(".menu-btn").click();
  await page.getByRole("button", { name: "Search settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Search settings" });
  await expect(dialog.getByText("Search by meaning is off.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
  await dialog.getByRole("button", { name: "Enable" }).click();
  await expect(dialog.getByRole("alert")).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByText("Ordinary Ask search still works.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.locator(".menu-btn")).toBeFocused();
  await page.locator("#ask-input").fill("How many messages?");
  await page.keyboard.press("Enter");
  await expect(page.locator(".ans-figure-value").first()).toBeVisible();
});

test("the import opt-in starts indexing only after the chat is open", async ({ page }) => {
  const models: string[] = [];
  await page.route("**/models/**", (route) => { models.push(route.request().url()); return route.abort(); });
  await page.goto("/");
  await page.locator("input[type=file]").first().setInputFiles({ name: "chat.txt", mimeType: "text/plain", buffer: Buffer.from(chat(DUO, 60), "utf8") });
  await expect(page.locator(".recap-btn")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(300);
  expect(models).toEqual([]);

  await page.goto("/");
  test.skip(!(await hasStorage(page)), "the opt-in needs browser storage");
  await page.locator(".meaning-option input").check();
  await page.locator("input[type=file]").first().setInputFiles({ name: "chat.txt", mimeType: "text/plain", buffer: Buffer.from(chat(DUO, 60), "utf8") });
  await expect(page.locator(".recap-btn")).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => models.length, { timeout: 30_000 }).toBeGreaterThan(0);
  // A refused model never held up the chat.
  await expect(page.locator(".dashboard")).toBeVisible();
});

for (const [width, height] of [[320, 568], [768, 1024], [1280, 800]] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`every state fits and passes axe at ${width}px, ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.addInitScript((mode) => localStorage.setItem("whatsapp-analytics-theme", mode), theme);
      await page.goto("/");
      await expect(page.locator(".welcome")).toBeVisible();
      await page.addScriptTag({ content: axeSource });
      for (const locale of ["en", "tr"] as const) {
        for (const [name, state] of Object.entries(STATES)) {
          await page.evaluate(async ([s, l]) => {
            const { mount } = await import(/* @vite-ignore */ "/tests/browser/fixtures/searchStates.tsx" as string);
            mount(s, l, false);
          }, [state, locale] as const);
          await expect(page.locator(".search-settings")).toBeVisible();
          const measured = await overflow(page);
          expect(measured, `${name} in ${locale}`).toEqual({ page: 0, dialog: 0, escaped: [] });
          const violations = await page.evaluate(async () => {
            const axe = (window as unknown as { axe: { run(el: Element): Promise<{ violations: { id: string; nodes: { html: string }[] }[] }> } }).axe;
            return (await axe.run(document.querySelector(".dialog")!)).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(" ")}`);
          });
          expect(violations, `${name} in ${locale}`).toEqual([]);
        }
      }
    });
  }
}
