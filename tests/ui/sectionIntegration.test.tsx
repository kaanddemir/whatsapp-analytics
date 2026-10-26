// @vitest-environment jsdom
/* Dashboard and saved-chat lifecycle through the real worker handler. */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App } from "@/ui/App";
import { FakeClient } from "../support/uiClient";
import { android, lines } from "../support/export";

const CHAT = lines(
  android("10/01/24", "09:00", "Ayşe", "yarın kahveye gidelim mi?"),
  android("10/01/24", "09:02", "Can", "olur, saat 19:30 uygun"),
  android("10/01/24", "09:03", "Ayşe", "süper"),
  android("11/01/24", "20:00", "Can", "kusura bakma, geç kaldım"),
  android("12/01/24", "08:00", "Ayşe", "12 Nisan'da konser var"),
);

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});
afterEach(cleanup);

async function open(client = new FakeClient(), keep = false) {
  client.files.set("chat.txt", CHAT);
  render(<App client={client} />);
  if (keep) fireEvent.click(await screen.findByLabelText("Keep this chat on this device"));
  fireEvent.change(screen.getAllByLabelText(/^Choose (file|export)$/).at(-1)!, { target: { files: [new File(["x"], "chat.txt")] } });
  await screen.findByRole("heading", { name: "Overview" });
  return client;
}

it("opens Overview directly with shared filters and Recap, without a question interface", async () => {
  await open();
  expect(screen.getByRole("region", { name: "Total Messages" })).toBeTruthy();
  expect(screen.getAllByRole("group", { name: "Filters" })).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Recap" })).toBeTruthy();
  expect(screen.queryByRole("tablist")).toBeNull();
  expect(screen.queryByRole("textbox")).toBeNull();
  const overview = screen.getByRole("heading", { name: "Overview" }).closest("section")!;
  const timeline = within(overview).getByRole("region", { name: "Messages Over Time" });
  const heatmap = within(overview).getByRole("region", { name: "Message Heatmap" });
  expect(timeline.parentElement).toBe(heatmap.parentElement);
  // Overview ends with the existing two-card grid, with no trailing wrapper or reserved row.
  expect(overview.lastElementChild).toBe(timeline.parentElement);
  expect(timeline.parentElement!.children).toHaveLength(2);
  expect(screen.queryByRole("region", { name: "Recent Changes" })).toBeNull();
});

describe("keeping a chat on the device", () => {
  it("keeps the saved-chat state when deleting its device copy fails", async () => {
    const client = await open(new FakeClient(), true);
    vi.spyOn(client, "deleteSaved").mockRejectedValue(new Error("storage permission denied"));
    fireEvent.click(screen.getByRole("button", { name: "Chat actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete from this device…" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const error = await screen.findByRole("alertdialog");
    fireEvent.click(within(error).getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Chat actions" }));
    expect(screen.getByRole("button", { name: "Delete from this device…" })).toBeTruthy();
    expect(await client.store.list()).toHaveLength(1);
  });

  it("saves on request, lists it on the start screen, reopens and deletes it", async () => {
    const client = await open(new FakeClient(), true);
    expect((await client.store.list()).length).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Chat actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Close chat…" }));
    expect(screen.getByText(/A copy stays on this device/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close chat" }));
    await screen.findByText("Saved on this device");
    fireEvent.click(screen.getByRole("button", { name: /^Open / }));
    await screen.findByRole("heading", { name: "Overview" });
    fireEvent.click(screen.getByRole("button", { name: "Chat actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete from this device…" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(async () => expect((await client.store.list()).length).toBe(0));
    fireEvent.click(screen.getByRole("button", { name: "Chat actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Chat info" }));
    const info = await screen.findByRole("dialog", { name: "Chat info" });
    // Re-parsing is unavailable once the only source text has been deleted.
    expect(within(info).queryByRole("group", { name: "Date order" })).toBeNull();
  });
});
