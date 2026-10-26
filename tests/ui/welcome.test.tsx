// @vitest-environment jsdom
/* The welcome screen in the whole app, through the real worker handler: the
   synthetic demo (real engine, labelled, never saved, separate from saved
   chats), first-time and returning visitors, a file that is not an export,
   and coming back after closing a chat. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { analyze } from "@/analytics";
import { NO_FILTERS } from "@/model";
import { parseExport } from "@/parser";
import { App } from "@/ui/App";
import { I18nProvider } from "@/ui/i18n";
import { formatCount } from "@/i18n/format";
import { demoChat } from "@/demo/demoChat";
import { en } from "@/i18n/en";
import { tr } from "@/i18n/tr";
import type { Locale } from "@/i18n/types";
import { FakeClient } from "../support/uiClient";

const GROUP = readFileSync(join(__dirname, "../fixtures/chats/group_android_meta_ai.chat"), "utf8");

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});
afterEach(cleanup);

function start(locale: Locale = "en", client = new FakeClient()) {
  render(<I18nProvider initialLocale={locale}><App client={client} /></I18nProvider>);
  return client;
}
const kpi = (title: string) => screen.getByRole("region", { name: title });

describe("demo chat", () => {
  it("is synthetic, reproducible and parses cleanly in both languages", () => {
    for (const locale of ["en", "tr"] as const) {
      const text = demoChat(locale);
      expect(demoChat(locale)).toBe(text);
      const parsed = parseExport(text);
      expect(parsed.messages.length).toBeGreaterThan(1000);
      expect(parsed.report.warnings).toEqual([]);
      expect(parsed.participants.map((p) => p.name).sort()).toEqual(locale === "en" ? ["Leo", "Maya", "Sam"] : ["Elif", "Mert", "Zeynep"]);
    }
  });

  it("opens through the ordinary import, labelled as a demo, with the engine's own numbers in Overview, Ask and Recap", async () => {
    const client = start();
    // Ticking "keep" must not save the demo.
    fireEvent.click(await screen.findByRole("checkbox", { name: en.x_keepOnDevice }));
    fireEvent.click(screen.getByRole("button", { name: en["start.demo"] }));
    await screen.findByRole("heading", { name: "Overview" });
    expect(client.parses).toBe(1);
    expect(screen.getByText(en["start.demoBadge"], { selector: ".demo-badge", exact: false })).toBeTruthy();
    const whole = analyze(parseExport(demoChat("en")), NO_FILTERS);
    expect(within(kpi("Total Messages")).getByText(formatCount(whole.kpis.totalMessages))).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    fireEvent.click(screen.getByRole("button", { name: /Who sends more messages/ }));
    await waitFor(() => expect(client.asks).toHaveLength(1));
    await screen.findByText(/sent the most messages in the whole chat/, { selector: ".ans-text span" });

    fireEvent.click(screen.getByRole("button", { name: /Recap/ }));
    expect(await screen.findByRole("dialog", { name: "Recap" })).toBeTruthy();

    // Nothing was kept on the device, and the menu offers nothing to delete.
    expect(await client.store.list()).toEqual([]);
    fireEvent.keyDown(document, { key: "Escape" });
  });

  it("speaks the interface language", async () => {
    const client = start("tr");
    fireEvent.click(await screen.findByRole("button", { name: tr["start.demo"] }));
    await screen.findByRole("heading", { name: "Genel Bakış" });
    expect(screen.getAllByText(/Elif|Mert|Zeynep/).length).toBeGreaterThan(0);
    expect(client.parses).toBe(1);
  });

  it("returns to the welcome screen on close, with saved chats untouched", async () => {
    const client = new FakeClient();
    client.files.set("ours.txt", GROUP);
    start("en", client);
    // A real chat, kept on the device.
    fireEvent.click(await screen.findByRole("checkbox", { name: en.x_keepOnDevice }));
    fireEvent.change(screen.getByLabelText(en.chooseFile), { target: { files: [new File(["x"], "ours.txt")] } });
    await screen.findByRole("heading", { name: "Overview" });
    fireEvent.click(screen.getByRole("button", { name: "Chat actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Close chat…" }));
    fireEvent.click(screen.getByRole("button", { name: "Close chat" }));
    // Returning: the saved chat is listed, with a count.
    expect(await screen.findByRole("heading", { name: en.x_savedChats })).toBeTruthy();
    expect(screen.getByText("1 saved")).toBeTruthy();
    // The demo neither appears in nor changes that list.
    fireEvent.click(screen.getByRole("button", { name: en["start.demo"] }));
    await screen.findByRole("heading", { name: "Overview" });
    fireEvent.click(screen.getByRole("button", { name: "Chat actions" }));
    expect(screen.queryByRole("button", { name: "Delete from this device…" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close chat…" }));
    fireEvent.click(screen.getByRole("button", { name: "Close chat" }));
    await screen.findByRole("heading", { name: en.x_savedChats });
    const saved = await client.store.list();
    expect(saved.map((c) => c.fileName)).toEqual(["ours.txt"]);
    expect(screen.getAllByRole("button", { name: /^Open / })).toHaveLength(1);
  });
});

describe("welcome screen", () => {
  it("shows no saved section to a first-time visitor", async () => {
    start();
    await screen.findByRole("button", { name: en["start.demo"] });
    expect(screen.queryByRole("heading", { name: en.x_savedChats })).toBeNull();
    expect(screen.getByText(en["start.private"])).toBeTruthy();
  });

  it("explains a file that is not an export and lets the visitor try again", async () => {
    const client = new FakeClient();
    client.files.set("notes.txt", "shopping list\nmilk\neggs\n");
    start("en", client);
    fireEvent.change(await screen.findByLabelText(en.chooseFile), { target: { files: [new File(["x"], "notes.txt")] } });
    const alert = await screen.findByRole("alertdialog");
    expect(alert.textContent).toContain(en.err_no_messages);
    fireEvent.click(within(alert).getByRole("button", { name: en.tryAnother }));
    expect(screen.getByRole("button", { name: en["start.demo"] })).toBeTruthy();
  });

  it("opens a file dropped anywhere on the page", async () => {
    const client = new FakeClient();
    client.files.set("chat.txt", GROUP);
    start("en", client);
    const page = (await screen.findByRole("region", { name: /Every conversation/ })) as HTMLElement;
    const file = new File(["x"], "chat.txt");
    fireEvent.dragEnter(page, { dataTransfer: { types: ["Files"], files: [] } });
    fireEvent.drop(page, { dataTransfer: { types: ["Files"], files: [file] } });
    await screen.findByRole("heading", { name: "Overview" });
  });
});
