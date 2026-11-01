/* Synthetic chats, in memory, and the steps every browser test shares. */
import { expect, type Page } from "@playwright/test";

const pad = (n: number) => String(n).padStart(2, "0");
const stamp = (d: Date) => `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${String(d.getUTCFullYear()).slice(2)}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
const HOUR = 3_600_000;

/** A busy chat: every scene appears. Rows go round the people, one every few hours. */
export function chat(people: readonly string[], rows = 900, text: (i: number) => string = (i) => `selam kahve ${["😂", "❤️", "🔥"][i % 3]} rapor${i % 5}`): string {
  const start = Date.UTC(2023, 0, 2, 8);
  const lines: string[] = [];
  for (let i = 0; i < rows; i++) {
    // Skewed turns, so nobody ties for first place by construction.
    const who = people[Math.floor(i * i / 7) % people.length]!;
    const body = i % 40 === 0 ? "<Media omitted>" : text(i);
    lines.push(`${stamp(new Date(start + i * 5 * HOUR + (i % 11) * 60_000))} - ${who}: ${body}`);
  }
  return lines.join("\n") + "\n";
}

export const DUO = ["Ayşe Yılmaz", "İbrahim Çelik"];

export async function openChat(page: Page, content: string) {
  await page.goto("/");
  await page.locator("input[type=file]").first().setInputFiles({ name: "chat.txt", mimeType: "text/plain", buffer: Buffer.from(content, "utf8") });
  await expect(page.locator(".recap-btn")).toBeVisible({ timeout: 30_000 });
}

export async function openRecap(page: Page) {
  await page.locator(".recap-btn").click();
  await expect(page.locator(".rc")).toBeVisible();
}

export const sceneNumber = (page: Page) => page.locator(".rc-slide").getAttribute("aria-label").then((l) => Number(/\d+/.exec(l!)![0]));
export const sceneTotal = (page: Page) => page.locator(".rc-slide").getAttribute("aria-label").then((l) => Number(/(\d+)\D*$/.exec(l!)![1]));

export async function toFinale(page: Page) {
  const total = await sceneTotal(page);
  for (let i = 0; i < total; i++) await page.keyboard.press("ArrowRight");
  await expect(page.locator('[data-kind="finale"]')).toBeVisible();
}

export async function toScene(page: Page, kind: string) {
  const total = await sceneTotal(page);
  for (let i = 0; i < total; i++) await page.keyboard.press("ArrowLeft");
  for (let i = 0; i < total; i++) {
    if (await page.locator(`.rc-scene[data-kind="${kind}"]`).count()) return;
    await page.keyboard.press("ArrowRight");
  }
  throw new Error(`no ${kind} scene`);
}

/** Overlapping visible text, and anything hitting the chrome, on the current scene. */
export const layoutProblems = (page: Page) => page.evaluate(async () => {
  // The stage learns it must scroll from a ResizeObserver, a frame after the scene mounts.
  await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  const stage = document.querySelector(".rc-stage")!;
  const box = stage.getBoundingClientRect();
  const scrolls = stage.classList.contains("is-scroll");
  const hit = (a: DOMRect, b: DOMRect) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const chrome = [...document.querySelectorAll(".rc-btn, .rc-pip, .rc-hint, .rc-counter")].map((e) => e.getBoundingClientRect());
  const problems: string[] = [];
  const walker = document.createTreeWalker(stage, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const el = node.parentElement!;
    if (!node.textContent!.trim() || el.closest(".sr-only, svg, .rc-legend-name, .rc-split-name, .rc-word, .rc-name, .rc-split-rank, .rc-emoji-glyph")) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const r = range.getBoundingClientRect();
    if (!r.width) continue;
    const label = node.textContent!.slice(0, 24);
    if (Math.max(r.right - box.right, box.left - r.left) > 2) problems.push(`sideways: ${label}`);
    if (scrolls) continue; // Clipped by the scroller, and reachable by scrolling.
    if (Math.max(r.bottom - box.bottom, box.top - r.top) > 2) problems.push(`outside the stage: ${label}`);
    if (chrome.some((c) => hit(r, c) > 2)) problems.push(`on the controls: ${label}`);
  }
  return problems;
});
