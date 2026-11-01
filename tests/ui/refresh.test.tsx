// @vitest-environment jsdom
/* A reload, in a test DOM: unmount, drop the worker's memory, and mount a new
   App on the same history entry. FakeClient's store outlives its worker, as OPFS does. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { App } from "@/ui/App";
import { FakeClient } from "../support/uiClient";

const GROUP = readFileSync(join(__dirname, "../fixtures/chats/group_android_meta_ai.chat"), "utf8");

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});
beforeEach(() => history.replaceState(null, ""));
afterEach(cleanup);

const keep = () => screen.queryByRole("checkbox", { name: "Keep this chat on this device" });
const askTab = () => screen.getByRole("button", { name: "Ask" });

async function openChat(saved: boolean) {
  const client = new FakeClient();
  client.files.set("chat.txt", GROUP);
  render(<App client={client} />);
  await vi.waitFor(() => expect(keep()).not.toBeNull());
  if (saved) fireEvent.click(keep()!);
  fireEvent.change(screen.getAllByLabelText(/^Choose (file|export)$/).at(-1)!, { target: { files: [new File(["x"], "chat.txt")] } });
  await screen.findByRole("heading", { name: "Overview" });
  return client;
}

function reload(client: FakeClient) {
  cleanup();
  client.cancel();
  client.parses = 0;
  client.analyses.length = 0;
  render(<App client={client} />);
}

describe("refresh", () => {
  it("restores a saved chat and its view with one parse, no search request and no start screen", async () => {
    const client = await openChat(true);
    fireEvent.click(askTab());
    const semantic = vi.spyOn(client, "semantic");

    reload(client);
    // From the first paint: the loading view, not the import screen.
    expect(keep()).toBeNull();
    expect(document.querySelector(".loading")).not.toBeNull();

    await screen.findByRole("button", { name: "Ask" });
    expect(askTab().getAttribute("aria-current")).toBe("page");
    expect(client.parses).toBe(1);
    expect(client.analyses).toHaveLength(1);
    expect(semantic).not.toHaveBeenCalled();
  });

  it("restores Overview too, and survives a second reload", async () => {
    const client = await openChat(true);
    reload(client);
    await screen.findByRole("heading", { name: "Overview" });
    reload(client);
    await screen.findByRole("heading", { name: "Overview" });
    expect(keep()).toBeNull();
  });

  it("keeps only an id and a view in the history entry", async () => {
    await openChat(true);
    expect(Object.keys(history.state).sort()).toEqual(["chat", "page"]);
    expect(JSON.stringify(history.state)).not.toContain("chat.txt");
  });

  it("falls back to the import screen, without a dialog, when the saved chat is gone", async () => {
    history.replaceState({ chat: "gone-chat", page: "ask" }, "");
    render(<App client={new FakeClient()} />);
    expect(keep()).toBeNull();
    await vi.waitFor(() => expect(keep()).not.toBeNull());
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(history.state).toMatchObject({ chat: null, page: "overview" });
  });

  it("does not remember a chat that was not saved", async () => {
    const client = await openChat(false);
    fireEvent.click(askTab());
    expect(history.state.chat).toBeNull();
    reload(client);
    expect(document.querySelector(".loading")).toBeNull();
    await vi.waitFor(() => expect(keep()).not.toBeNull());
  });

  it("forgets the chat when it is closed", async () => {
    await openChat(true);
    expect(history.state.chat).toEqual(expect.any(String));
    fireEvent.click(screen.getByRole("button", { name: "Chat actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Close chat…" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Close this chat?" })).getByRole("button", { name: "Close chat" }));
    await vi.waitFor(() => expect(keep()).not.toBeNull());
    expect(history.state.chat).toBeNull();
  });

  it("restores the chat behind an open Recap, without reopening it", async () => {
    const client = await openChat(true);
    fireEvent.click(screen.getByRole("button", { name: "Recap" }));
    expect(history.state).toMatchObject({ recap: true, chat: expect.any(String) });

    reload(client);
    await screen.findByRole("heading", { name: "Overview" });
    expect(screen.queryByRole("dialog", { name: "Recap" })).toBeNull();
    expect(history.state.recap).toBe(false);
  });

  it("corrects an entry reached by Back or Forward to what is showing", async () => {
    await openChat(true);
    fireEvent.click(askTab());
    act(() => void window.dispatchEvent(new PopStateEvent("popstate", { state: { recap: true, chat: "older-chat", page: "overview" } })));
    expect(history.state).toMatchObject({ recap: true, page: "ask" });
    expect(history.state.chat).not.toBe("older-chat");
  });
});
