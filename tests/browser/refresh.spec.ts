/* A real reload over the real worker and OPFS: what jsdom cannot show is that
   the saved chat comes back and the start screen never paints on the way. */
import { expect, test, type Page } from "@playwright/test";
import { chat, DUO, openRecap } from "./support";

async function openSaved(page: Page) {
  await page.goto("/");
  const storage = await page.evaluate(() => navigator.storage.getDirectory().then(() => true, () => false));
  test.skip(!storage, "keeping a chat needs browser storage");
  await page.getByRole("checkbox", { name: "Keep this chat on this device" }).check();
  await page.locator("input[type=file]").first().setInputFiles({ name: "chat.txt", mimeType: "text/plain", buffer: Buffer.from(chat(DUO, 120), "utf8") });
  await expect(page.locator(".recap-btn")).toBeVisible({ timeout: 30_000 });
}

test("a reload restores the saved chat and Ask, never painting the start screen", async ({ page }) => {
  const models: string[] = [];
  page.on("request", (r) => { if (/huggingface|\.onnx/.test(r.url())) models.push(r.url()); });
  await openSaved(page);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  // Any start screen added to the page at any moment after the reload is recorded.
  await page.addInitScript(() => {
    new MutationObserver(() => {
      if (document.querySelector(".welcome")) (window as unknown as { sawStart: boolean }).sawStart = true;
    }).observe(document, { childList: true, subtree: true });
  });
  await page.reload();
  await expect(page.getByRole("button", { name: "Ask", exact: true })).toHaveAttribute("aria-current", "page", { timeout: 30_000 });
  expect(await page.evaluate(() => (window as unknown as { sawStart?: boolean }).sawStart ?? false)).toBe(false);
  expect(models).toEqual([]);
});

test("a reload under an open Recap restores the chat, and Back still works", async ({ page }) => {
  await openSaved(page);
  await openRecap(page);
  await page.reload();
  await expect(page.locator(".recap-btn")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".rc")).toHaveCount(0);
  await page.goBack();
  await expect(page.locator(".recap-btn")).toBeVisible();
  await expect(page.locator(".rc")).toHaveCount(0);
});

test("a saved chat deleted in the meantime falls back to the start screen", async ({ page }) => {
  await openSaved(page);
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry("chats", { recursive: true });
  });
  await page.reload();
  await expect(page.locator(".welcome")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
});
