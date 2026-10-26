// @vitest-environment jsdom
/* The application end to end in a test DOM: upload, every card, both
   filters, chart controls, failures, close, cancel and the Recap. The engine
   is the real one (through the real worker handler), so the assertions
   compare what is displayed with what analyze() returns. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { analyze } from "@/analytics";
import { presetRange } from "@/analytics/presets";
import { NO_FILTERS } from "@/model";
import { parseExport } from "@/parser";
import { App } from "@/ui/App";
import { CARD_TITLES } from "@/ui/cardInfo";
import { formatCount, formatDate } from "@/i18n/format";
import { I18nProvider } from "@/ui/i18n";
import { en } from "@/i18n/en";
import { tr } from "@/i18n/tr";
import { FakeClient } from "../support/uiClient";

const GROUP = readFileSync(join(__dirname, "../fixtures/chats/group_android_meta_ai.chat"), "utf8");
const parsed = parseExport(GROUP);
const whole = analyze(parsed, NO_FILTERS);
const idOf = (name: string) => parsed.participants.find((p) => p.name === name)!.id;

beforeAll(() => {
  // The test DOM has no canvas: charts fall back to their summary and table.
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});
afterEach(cleanup);

async function loaded(text = GROUP, name = "chat.txt") {
  const client = new FakeClient();
  client.files.set(name, text);
  render(<App client={client} />);
  pick(new File(["x"], name));
  await screen.findByRole("heading", { name: "Overview" });
  await screen.findByRole("heading", { name: "Overview" });
  return client;
}

function pick(file: File) {
  const input = screen.getAllByLabelText(/^Choose (file|export)$/).at(-1)!;
  fireEvent.change(input, { target: { files: [file] } });
}

const kpi = (title: string) => screen.getByRole("region", { name: title });

describe("dashboard", () => {
  it("shows every card with values from the engine, after one parse", async () => {
    const client = await loaded();
    expect(client.parses).toBe(1);
    expect(client.analyses).toEqual([NO_FILTERS]);
    for (const [key, title] of Object.entries(CARD_TITLES)) {
      if (key !== "media") expect(screen.getAllByText(title).length).toBeGreaterThan(0);
    }
    expect(screen.queryByText("Media Breakdown")).toBeNull();
    expect(within(kpi("Total Messages")).getByText(formatCount(whole.kpis.totalMessages))).toBeTruthy();
    expect(within(kpi("Active Days")).getByText(formatCount(whole.kpis.activeDays))).toBeTruthy();
    expect(within(kpi("Peak Hour")).getByText(`${String(whole.kpis.peakHour).padStart(2, "0")}:00`)).toBeTruthy();
    // Every person in the balance legend, with the engine's count.
    const balance = screen.getByRole("region", { name: "Message Balance" });
    for (const p of whole.participants) expect(within(balance).getByText(p.name)).toBeTruthy();
    // Meta AI is not a participant in interaction metrics.
    expect(within(balance).queryByText("Meta AI")).toBeNull();
    // Charts expose a text summary in place of the canvas.
    expect(screen.getByRole("img", { name: /Line chart of messages per day/ })).toBeTruthy();
  });

  it("filters to one participant through the worker without re-parsing, and keeps interaction metrics whole", async () => {
    const client = await loaded();
    const faruk = idOf("Faruk");
    fireEvent.click(screen.getByRole("button", { name: /Participant filter: everyone/ }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Participant" })).getByRole("button", { name: /Faruk/ }));
    const expected = analyze(parsed, { ...NO_FILTERS, sender: faruk });
    await waitFor(() => expect(within(kpi("Total Messages")).getByText(formatCount(expected.kpis.totalMessages))).toBeTruthy());
    expect(client.analyses.at(-1)).toEqual({ start: null, end: null, sender: faruk });
    expect(client.parses).toBe(1);
    expect(screen.queryByText(/^Showing/)).toBeNull();
    expect(screen.getByRole("button", { name: "Participant filter: Faruk" })).toBeTruthy();
    // Balance still lists everyone: it is an interaction metric.
    const balance = screen.getByRole("region", { name: "Message Balance" });
    for (const p of whole.participants) expect(within(balance).getByText(p.name)).toBeTruthy();
    expect(screen.getByText("The participant filter does not apply to this section.")).toBeTruthy();
  });

  it("applies a date preset, combines it with the participant filter, and resets both", async () => {
    const client = await loaded();
    fireEvent.click(screen.getByRole("button", { name: /^Date range:/ }));
    fireEvent.click(screen.getByRole("button", { name: "Last 7 days of the chat" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    const range = presetRange("7", whole.meta.fullRange);
    await waitFor(() => expect(client.analyses.at(-1)).toEqual({ ...range, sender: null }));
    await screen.findByRole("button", { name: `Date range: ${formatDate(range.start!)} – ${formatDate(range.end!)}` });

    const ece = idOf("Ece");
    fireEvent.click(screen.getByRole("button", { name: /Participant filter/ }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Participant" })).getByRole("button", { name: /^Ece/ }));
    await waitFor(() => expect(client.analyses.at(-1)).toEqual({ ...range, sender: ece }));
    const expected = analyze(parsed, { ...range, sender: ece });
    await waitFor(() => expect(within(kpi("Total Messages")).getByText(formatCount(expected.kpis.totalMessages))).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /Participant filter/ }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Participant" })).getByRole("button", { name: /^Everyone/ }));
    await waitFor(() => expect(client.analyses.at(-1)).toEqual({ ...range, sender: null }));
    fireEvent.click(screen.getByRole("button", { name: /^Date range:/ }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Date range" })).getByRole("button", { name: "Reset" }));
    await waitFor(() => expect(client.analyses.at(-1)).toEqual(NO_FILTERS));
    await waitFor(() => expect(within(kpi("Total Messages")).getByText(formatCount(whole.kpis.totalMessages))).toBeTruthy());
    expect(client.parses).toBe(1);
  });

  it("rejects a custom range that ends before it starts", async () => {
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: /^Date range:/ }));
    fireEvent.change(screen.getByLabelText("From"), { target: { value: whole.meta.fullRange.end } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: whole.meta.fullRange.start } });
    expect(screen.getByRole("alert").textContent).toContain("start date is after the end date");
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("switches the timeline grain", async () => {
    await loaded();
    const card = screen.getByRole("region", { name: "Messages Over Time" });
    const grain = within(card).getByRole("group", { name: "Chart granularity" });
    expect(within(grain).getByRole("button", { name: "Daily" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(grain).getByRole("button", { name: "Weekly" }));
    expect(within(grain).getByRole("button", { name: "Weekly" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(card).getByRole("img", { name: /messages per week/ })).toBeTruthy();
    expect(within(card).queryByText("Show data")).toBeNull();
    // Table view replaces the chart in the same fixed-height region.
    const region = card.querySelector<HTMLElement>(".view-region")!;
    const chartBtn = within(card).getByRole("button", { name: "Chart view" });
    const tableBtn = within(card).getByRole("button", { name: "Table view" });
    expect(chartBtn.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(tableBtn);
    expect(tableBtn.getAttribute("aria-pressed")).toBe("true");
    expect(chartBtn.getAttribute("aria-pressed")).toBe("false");
    expect(within(card).queryByRole("img")).toBeNull();
    expect(card.querySelector(".view-region")).toBe(region);
    expect(region.style.height).toBe("240px");
    expect(within(card).getByRole("columnheader", { name: "Week" })).toBeTruthy();
    // Same numbers as the series, one row per bucket.
    const rows = within(region).getAllByRole("row").slice(1);
    expect(rows.length).toBe(whole.timeline.weekly.values.length);
    expect(rows.map((r) => r.querySelector("td")!.textContent)).toEqual(whole.timeline.weekly.values.map((v) => formatCount(v)));
    // Arrow keys move between the two options; the chart comes back.
    fireEvent.keyDown(tableBtn, { key: "ArrowLeft" });
    expect(chartBtn.getAttribute("aria-pressed")).toBe("true");
    expect(document.activeElement).toBe(chartBtn);
    expect(within(card).getByRole("img", { name: /messages per week/ })).toBeTruthy();
    expect(within(card).queryByRole("table")).toBeNull();
    expect(region.style.height).toBe("240px");
  });

  it("offers the table view on every chart card", async () => {
    await loaded();
    for (const title of ["Messages Over Time", "Messages by Hour", "Weekday Averages"]) {
      const card = screen.getByRole("region", { name: title });
      fireEvent.click(within(card).getByRole("button", { name: "Table view" }));
      expect(within(card).getByRole("table")).toBeTruthy();
    }
    const hourly = screen.getByRole("region", { name: "Messages by Hour" });
    expect(within(hourly).getAllByRole("row").length).toBe(25);
  });

  it("shows empty states when the selection has no messages", async () => {
    // Gül writes only on the 12th, 13th and 16th; the 14th alone is empty for her.
    const client = await loaded();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Date range:/ }));
    });
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2024-05-14" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2024-05-14" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(client.analyses.at(-1)).toMatchObject({ start: "2024-05-14", end: "2024-05-14" }));
    fireEvent.click(screen.getByRole("button", { name: /Participant filter/ }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Participant" })).getByRole("button", { name: /^Gül Yılmaz/ }));
    await screen.findByText("Gül Yılmaz sent no messages in these dates.");
    expect(within(kpi("Total Messages")).getByText("0")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Messages Over Time" })).getByText(/Nothing to show/)).toBeTruthy();
  });
});

describe("failures and lifecycle", () => {
  it("keeps the previous numbers when a filter fails", async () => {
    const client = await loaded();
    client.failNext = "internal";
    fireEvent.click(screen.getByRole("button", { name: /Participant filter/ }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Participant" })).getByRole("button", { name: /Faruk/ }));
    const alert = await screen.findByRole("alertdialog", { name: "Couldn’t apply this filter" });
    expect(within(kpi("Total Messages")).getByText(formatCount(whole.kpis.totalMessages))).toBeTruthy();
    fireEvent.click(within(alert).getByRole("button", { name: "Close" }));
    expect(screen.getByRole("button", { name: "Participant filter: everyone" })).toBeTruthy();
  });

  it("returns to the start when the worker is lost", async () => {
    const client = await loaded();
    client.failNext = "worker_lost";
    fireEvent.click(screen.getByRole("button", { name: /Participant filter/ }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Participant" })).getByRole("button", { name: /Faruk/ }));
    const alert = await screen.findByRole("alertdialog");
    expect(alert.textContent).toContain("load it again");
    expect(screen.getByRole("heading", { name: "Every conversation tells a story. Discover yours." })).toBeTruthy();
  });

  it("explains a file without messages with its parse report", async () => {
    const client = new FakeClient();
    client.files.set("notes.txt", "shopping list\nmilk\n");
    render(<App client={client} />);
    pick(new File(["x"], "notes.txt"));
    const alert = await screen.findByRole("alertdialog", { name: "Couldn’t read this chat" });
    expect(alert.textContent).toContain("No WhatsApp messages were found");
    expect(alert.textContent).toContain("No messages were found.");
    expect(alert.textContent).not.toContain("milk");
  });

  it("closes the chat after confirmation and frees it in the worker", async () => {
    const client = await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Chat actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Close chat…" }));
    const dialog = screen.getByRole("dialog", { name: "Close this chat?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Close chat" }));
    await screen.findByRole("heading", { name: "Every conversation tells a story. Discover yours." });
    expect(client.cleared).toBe(1);
    expect(screen.queryByText("Faruk")).toBeNull();
  });

  it("cancels a load in progress", async () => {
    const client = new FakeClient();
    client.files.set("chat.txt", GROUP);
    client.hold = true;
    render(<App client={client} />);
    pick(new File(["x"], "chat.txt"));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(client.cancelled).toBe(1);
    expect(screen.getByRole("heading", { name: "Every conversation tells a story. Discover yours." })).toBeTruthy();
  });

  it("loads another chat in place of the first", async () => {
    const client = await loaded();
    const other = readFileSync(join(__dirname, "../fixtures/chats/dm_en_android.chat"), "utf8");
    client.files.set("other.txt", other);
    // Replacing a loaded chat asks first; the file is picked in the dialog.
    fireEvent.click(screen.getByRole("button", { name: "Chat actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Open another chat…" }));
    const confirm = screen.getByRole("dialog", { name: "Open another chat?" });
    expect(confirm.textContent).toContain("cleared from this tab’s memory");
    fireEvent.change(within(confirm).getByLabelText("Choose export"), { target: { files: [new File(["x"], "other.txt")] } });
    await screen.findByRole("heading", { name: "Overview" });
    const expected = analyze(parseExport(other), NO_FILTERS);
    await waitFor(() => expect(within(kpi("Total Messages")).getByText(formatCount(expected.kpis.totalMessages))).toBeTruthy());
    expect(screen.queryByText("Faruk")).toBeNull();
    expect(client.parses).toBe(2);
  });

  it("renders participant names as text, never as markup", async () => {
    const text = "01/02/2024, 09:00 - <img src=x onerror=alert(1)>: hi\n01/02/2024, 09:05 - Bob: hello\n";
    await loaded(text);
    expect(document.querySelector("img:not(.brand-mark)")).toBeNull();
    expect(screen.getAllByText("<img src=x onerror=alert(1)>").length).toBeGreaterThan(0);
  });
});

describe("app shell", () => {
  it("has no metric info buttons", async () => {
    await loaded();
    expect(screen.queryAllByRole("button", { name: /^About / })).toEqual([]);
  });

  it("keeps applied filters in their controls, with no separate status row", async () => {
    await loaded();
    expect(document.querySelector(".context-status")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Participant filter/ }));
    const sheet = screen.getByRole("dialog", { name: "Participant" });
    expect(within(sheet).getByRole("heading", { name: "Participant" })).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("button", { name: /^Ece/ }));
    await screen.findByRole("button", { name: "Participant filter: Ece" });
    expect(document.querySelector(".context-status")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Date range:/ }));
    const dates = screen.getByRole("dialog", { name: "Date range" });
    fireEvent.click(within(dates).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Date range" })).toBeNull();
  });

  it("opens Chat info from the notes link and the menu", async () => {
    // Two lines before the first message produce an orphan_lines note.
    await loaded("header line\nanother\n" + GROUP);
    expect(screen.queryByRole("heading", { name: "Import" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /1 import note/ }));
    let dialog = screen.getByRole("dialog", { name: "Chat info" });
    expect(within(dialog).getByText("Your results may be incomplete.")).toBeTruthy();
    expect(within(within(dialog).getByRole("list", { name: "Import notes" })).getByText(/at the start of the file/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Chat info" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Chat actions" }));
    fireEvent.click(screen.getByRole("button", { name: /Chat info/ }));
    dialog = screen.getByRole("dialog", { name: "Chat info" });
    expect(within(dialog).getByText("Messages")).toBeTruthy();
    expect(screen.queryAllByText("Follows filters")).toEqual([]);
    expect(screen.queryByText("All participants")).toBeNull();
  });

  it("shows real processing stages without a percentage", async () => {
    const client = new FakeClient();
    client.files.set("chat.txt", GROUP);
    client.hold = true;
    render(<App client={client} />);
    pick(new File(["x"], "chat.txt"));
    const stages = await screen.findByRole("list");
    const active = within(stages).getByText("Reading the file").closest("li")!;
    expect(active.getAttribute("aria-current")).toBe("step");
    expect(document.body.textContent).not.toMatch(/\d+%/);
    client.release();
    await screen.findByRole("heading", { name: "Overview" });
  await screen.findByRole("heading", { name: "Overview" });
  });
});

describe("recap", () => {
  it("tells the whole-chat story even when the dashboard is filtered, and is keyboard operable", async () => {
    const client = await loaded();
    fireEvent.click(screen.getByRole("button", { name: /Participant filter/ }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Participant" })).getByRole("button", { name: /Faruk/ }));
    await waitFor(() => expect(client.analyses.at(-1)?.sender).toBe(idOf("Faruk")));
    const calls = client.analyses.length;

    const trigger = screen.getByRole("button", { name: "Recap" });
    fireEvent.click(trigger);
    const recap = screen.getByRole("dialog", { name: "Recap" });
    expect(within(recap).getByText("Group chat")).toBeTruthy();
    expect(within(recap).getByText(`${whole.participants.length} participants`)).toBeTruthy();
    fireEvent.keyDown(document, { key: "ArrowRight" });
    // Scene 2 is the whole-chat total, not Faruk's.
    expect(within(recap).getByText(formatCount(whole.kpis.totalMessages))).toBeTruthy();
    fireEvent.keyDown(document, { key: " " });
    expect(within(recap).getByRole("button", { name: "Play" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Recap" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
    // The Recap reuses the whole-chat analysis: no extra worker request.
    expect(client.analyses.length).toBe(calls);
  });

  it("ends on the poster with save, hide names and replay", async () => {
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Recap" }));
    const recap = screen.getByRole("dialog", { name: "Recap" });
    for (let i = 0; i < 30; i++) fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(within(recap).getByRole("button", { name: "Save image" })).toBeTruthy();
    expect(within(recap).getByRole("button", { name: "Hide names in the image" })).toBeTruthy();
    expect((within(recap).getByRole("button", { name: "Next scene" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(recap).getByRole("button", { name: "Watch again" }));
    expect(within(recap).getByText("Group chat")).toBeTruthy();
  });
});


describe.each(["en", "tr"] as const)("compact filter header: %s", (locale) => {
  it("keeps status silent visually, exposes pending work accessibly, and resets inside controls", async () => {
    const d = locale === "tr" ? tr : en;
    const client = new FakeClient();
    client.files.set("chat.txt", GROUP);
    render(<I18nProvider initialLocale={locale}><App client={client} /></I18nProvider>);
    const input = document.querySelector('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [new File(["x"], "chat.txt")] } });
    await screen.findByRole("heading", { name: d.overview });
    await screen.findByRole("heading", { name: d.overview });
    const card = screen.getByRole("region", { name: d.chatAndFilters });
    const assertCompact = () => {
      expect(card.children.length).toBe(2);
      expect(card.querySelector(".context-status, .updating, .applied")).toBeNull();
      expect(within(card).queryByRole("button", { name: d.resetFilters })).toBeNull();
      expect(card.textContent).not.toMatch(/Showing|Gösterilen|Updating|Güncelleniyor/);
    };
    assertCompact();
    const analyze = client.analyze.bind(client);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const held = vi.spyOn(client, "analyze").mockImplementationOnce(async (...args) => {
      await gate;
      return analyze(...args);
    });
    fireEvent.click(within(card).getByRole("button", { name: d.participantEveryone }));
    fireEvent.click(within(screen.getByRole("dialog", { name: d.participant })).getByRole("button", { name: /^Ece/ }));
    await waitFor(() => expect(document.querySelector(".dashboard")?.getAttribute("aria-busy")).toBe("true"));
    assertCompact();
    expect(screen.getByText(d.updatingDashboard).className).toBe("sr-only");
    await act(async () => { release(); });
    held.mockRestore();
    await waitFor(() => expect(document.querySelector(".dashboard")?.getAttribute("aria-busy")).toBe("false"));
    const selected = d.participantNamed.replace("{name}", "Ece");
    fireEvent.click(within(card).getByRole("button", { name: selected }));
    fireEvent.click(within(screen.getByRole("dialog", { name: d.participant })).getByRole("button", { name: new RegExp(`^${d.everyone}`) }));
    await waitFor(() => expect(client.analyses.at(-1)).toEqual(NO_FILTERS));
    fireEvent.click(within(card).getByRole("button", { name: new RegExp(`^${d.dateRangeLabel.split("{range}")[0]}`) }));
    fireEvent.change(screen.getByLabelText(d.from), { target: { value: "2024-05-14" } });
    fireEvent.change(screen.getByLabelText(d.to), { target: { value: "2024-05-14" } });
    fireEvent.click(screen.getByRole("button", { name: d.apply }));
    await waitFor(() => expect(client.analyses.at(-1)).toEqual({ start: "2024-05-14", end: "2024-05-14", sender: null }));
    await waitFor(() => expect(document.querySelector(".dashboard")?.getAttribute("aria-busy")).toBe("false"));
    assertCompact();
    fireEvent.click(within(card).getByRole("button", { name: new RegExp(`^${d.dateRangeLabel.split("{range}")[0]}`) }));
    fireEvent.click(within(screen.getByRole("dialog", { name: d.dateRange })).getByRole("button", { name: d.reset }));
    await waitFor(() => expect(client.analyses.at(-1)).toEqual(NO_FILTERS));
    await waitFor(() => expect(within(kpi(d["card.total-messages"])).getByText(formatCount(whole.kpis.totalMessages, locale))).toBeTruthy());
    assertCompact();
    expect(client.parses).toBe(1);
  });
});
