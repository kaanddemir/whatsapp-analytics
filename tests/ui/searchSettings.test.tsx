// @vitest-environment jsdom
/* Search by meaning through the app: the opt-in at import, the Search settings
   dialog and what reaches the worker. The real handler and indexer run with a
   fake embedder and in-memory stores; no model is involved. */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { App } from "@/ui/App";
import { SearchSettings } from "@/ui/components/SearchSettings";
import { I18nProvider } from "@/ui/i18n";
import { en } from "@/i18n/en";
import { tr } from "@/i18n/tr";
import type { Locale } from "@/i18n/types";
import { ModelError } from "@/semantic/embedder";
import type { SemanticFailure, SemanticState } from "@/semantic/indexer";
import { MemorySemanticStore } from "@/semantic/store";
import { FakeClient } from "../support/uiClient";
import { fakeModel } from "../support/fakeEmbedder";
import { ASK_CHAT } from "../fixtures/askChat";

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});
afterEach(cleanup);

const OTHER_CHAT = "13/02/2024, 09:00 - Deniz: başka bir sohbetin ilk mesajı\n13/02/2024, 09:05 - Mert: bu da ikinci mesajı\n";

function start(client: FakeClient, locale: Locale = "en") {
  client.files.set("chat.txt", ASK_CHAT);
  client.files.set("other.txt", OTHER_CHAT);
  render(<I18nProvider initialLocale={locale}><App client={client} /></I18nProvider>);
}
const option = () => screen.findByRole<HTMLInputElement>("checkbox", { name: en["search.option"] });
const keep = () => screen.findByRole("checkbox", { name: en.x_keepOnDevice });
const choose = (name: string) => fireEvent.change(screen.getAllByLabelText(/^Choose (file|export)$/).at(-1)!, { target: { files: [new File(["x"], name)] } });
const opened = () => screen.findByRole("button", { name: en.x_recapAction });
const openSettings = async () => {
  fireEvent.click(screen.getByRole("button", { name: en.chatActions }));
  fireEvent.click(screen.getByRole("button", { name: en["search.settings"] }));
  return screen.findByRole("dialog", { name: en["search.settings"] });
};
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

describe("the opt-in at import", () => {
  it("is off by default: the chat opens, Ask answers by words, and no model is loaded", async () => {
    const model = fakeModel();
    const client = new FakeClient(model.factory);
    const semantic = vi.spyOn(client, "semantic");
    start(client);
    expect((await option()).checked).toBe(false);
    choose("chat.txt");
    await opened();
    // Opening Ask starts nothing either.
    fireEvent.click(screen.getByRole("button", { name: en["ask.nav"] }));
    await settle();
    expect(model.loads).toBe(0);
    expect(model.calls).toHaveLength(0);
    expect(semantic).not.toHaveBeenCalled();
  });

  it("starts indexing only after the chat has opened", async () => {
    const model = fakeModel();
    const client = new FakeClient(model.factory);
    const order: string[] = [];
    const analyze = client.analyze.bind(client);
    vi.spyOn(client, "analyze").mockImplementation(async (...args) => { order.push("analyze"); return analyze(...args); });
    const semanticCall = client.semantic.bind(client);
    vi.spyOn(client, "semantic").mockImplementation(async (action) => { order.push(action); return semanticCall(action); });
    start(client);
    fireEvent.click(await option());
    choose("chat.txt");
    await opened();
    await waitFor(() => expect(model.calls.length).toBeGreaterThan(0));
    expect(order).toEqual(["analyze", "enable"]);
    const dialog = await openSettings();
    await within(dialog).findByText(en["search.ready"], {}, { timeout: 4000 });
    expect(model.loads).toBe(1);
  });

  it("starts nothing when the import fails", async () => {
    const model = fakeModel();
    const client = new FakeClient(model.factory);
    start(client);
    client.files.set("empty.txt", "not a chat\n");
    fireEvent.click(await option());
    choose("empty.txt");
    await screen.findByRole("alertdialog");
    await settle();
    expect(model.loads).toBe(0);
  });

  it("keeps the chat usable while indexing is held up", async () => {
    const model = fakeModel();
    model.gate = new Promise(() => {});
    const client = new FakeClient(model.factory);
    start(client);
    fireEvent.click(await option());
    choose("chat.txt");
    await opened();
    expect(screen.getByRole("button", { name: en.overview })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: en["ask.nav"] }));
    expect(screen.getByRole("textbox", { name: en["ask.input"] })).toBeTruthy();
    expect(await client.ask("How many messages?", { start: null, end: null, sender: null })).toMatchObject({ supported: true });
  });
});

describe("Search settings", () => {
  it("enables, pauses, resumes and removes, from either view", async () => {
    const model = fakeModel();
    let release!: () => void;
    model.gate = new Promise((r) => (release = r));
    const client = new FakeClient(model.factory);
    start(client);
    await option();
    choose("chat.txt");
    await opened();
    const dialog = await openSettings();
    within(dialog).getByText(en["search.off"]);
    expect(within(dialog).getByRole("tooltip", { hidden: true }).textContent).toContain("in Ask");

    fireEvent.click(within(dialog).getByRole("button", { name: en["search.enable"] }));
    await within(dialog).findByText(en["search.indexing"]);
    expect(within(dialog).getByRole("tooltip", { hidden: true }).textContent).toContain(en["search.partial"]);
    // Enabling twice is one job on one model.
    await client.semantic("enable");

    const pause = within(dialog).getByRole("button", { name: en["search.pause"] });
    pause.focus();
    fireEvent.click(pause);
    await within(dialog).findByText(en["search.paused"]);
    const resume = within(dialog).getByRole("button", { name: en["search.resume"] });
    // The same button, so a keyboard user stays where they were.
    expect(resume).toBe(pause);
    expect(document.activeElement).toBe(resume);
    release();
    model.gate = null;
    await settle();

    fireEvent.click(resume);
    await within(dialog).findByText(en["search.ready"], {}, { timeout: 4000 });
    expect(model.loads).toBe(1);

    // Ask searches by meaning only until the index is removed.
    fireEvent.click(within(dialog).getByRole("button", { name: en["search.remove"] }));
    within(dialog).getByText(en["search.removeTitle"]);
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: en.cancel }));
    fireEvent.click(within(dialog).getByRole("button", { name: en.cancel }));
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: en["search.remove"] }));
    fireEvent.click(within(dialog).getByRole("button", { name: en["search.remove"] }));
    fireEvent.click(within(dialog).getAllByRole("button", { name: en["search.remove"] }).at(-1)!);
    await within(dialog).findByText(en["search.off"]);
    expect(document.activeElement && dialog.contains(document.activeElement)).toBe(true);

    // The chat and its statistics are untouched.
    fireEvent.click(within(dialog).getByRole("button", { name: en.close }));
    const answer = await client.ask("How many messages?", { start: null, end: null, sender: null });
    expect(answer.supported).toBe(true);
    expect(screen.getByRole("button", { name: en.x_recapAction })).toBeTruthy();
  });

  it("closes with Escape, returns focus, and shows the current state on reopening", async () => {
    const model = fakeModel();
    const client = new FakeClient(model.factory);
    start(client);
    await option();
    choose("chat.txt");
    await opened();
    let dialog = await openSettings();
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: en.close }));
    fireEvent.click(within(dialog).getByRole("button", { name: en["search.enable"] }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    await settle();
    dialog = await openSettings();
    await within(dialog).findByText(en["search.ready"], {}, { timeout: 4000 });
    expect(model.loads).toBe(1);
  });

  it("removes only this chat's index, and a saved chat can index again", async () => {
    const model = fakeModel();
    const store = new MemorySemanticStore();
    const client = new FakeClient(model.factory, store);
    await store.commit("someone-else", 0, null, { schema: 1, model: "m", fingerprint: "f", dim: 384, planned: 1, segments: 0, vectors: 0, complete: false });
    start(client);
    fireEvent.click(await keep());
    fireEvent.click(await option());
    choose("chat.txt");
    await opened();
    const dialog = await openSettings();
    await within(dialog).findByText(en["search.ready"], {}, { timeout: 4000 });
    const [saved] = await client.listSaved();
    expect(await store.manifest(saved!.id)).toMatchObject({ complete: true });
    fireEvent.click(within(dialog).getByRole("button", { name: en["search.remove"] }));
    fireEvent.click(within(dialog).getAllByRole("button", { name: en["search.remove"] }).at(-1)!);
    await within(dialog).findByText(en["search.off"]);
    expect(await store.manifest(saved!.id)).toBeNull();
    expect(await store.manifest("someone-else")).not.toBeNull();
    expect(await client.listSaved()).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole("button", { name: en["search.enable"] }));
    await within(dialog).findByText(en["search.ready"], {}, { timeout: 4000 });
    expect(await store.manifest(saved!.id)).toMatchObject({ complete: true });
  });

  it("restores a saved chat's index without embedding it again, and keeps a pause", async () => {
    const model = fakeModel();
    const store = new MemorySemanticStore();
    const client = new FakeClient(model.factory, store);
    start(client);
    fireEvent.click(await keep());
    fireEvent.click(await option());
    choose("chat.txt");
    await opened();
    let dialog = await openSettings();
    await within(dialog).findByText(en["search.ready"], {}, { timeout: 4000 });
    const embedded = model.calls.length, loads = model.loads;
    fireEvent.click(within(dialog).getByRole("button", { name: en.close }));

    const reopen = async () => {
      fireEvent.click(screen.getByRole("button", { name: en.chatActions }));
      fireEvent.click(screen.getByRole("button", { name: en.closeChat }));
      fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: en.closeChat.replace("…", "") }));
      fireEvent.click(await screen.findByRole("button", { name: en["start.openSavedLabel"].replace("{name}", "chat.txt") }));
      await opened();
    };
    await reopen();
    dialog = await openSettings();
    await within(dialog).findByText(en["search.ready"]);
    expect(model.calls).toHaveLength(embedded);
    expect(model.loads).toBe(loads);
    fireEvent.click(within(dialog).getByRole("button", { name: en.close }));

    // An interrupted index resumes by itself; one the user paused waits for them.
    const [saved] = await client.listSaved();
    const manifest = (await store.manifest(saved!.id))!;
    store.data.get(saved!.id)!.manifest = { ...manifest, segments: 0, vectors: 0, complete: false, paused: true };
    await reopen();
    dialog = await openSettings();
    await within(dialog).findByText(en["search.paused"]);
    await settle();
    expect(model.loads).toBe(loads);
    within(dialog).getByRole("button", { name: en["search.resume"] });
  });

  it("does not carry one chat's state to another", async () => {
    const model = fakeModel();
    const client = new FakeClient(model.factory);
    start(client);
    fireEvent.click(await option());
    choose("chat.txt");
    await opened();
    const dialog = await openSettings();
    await within(dialog).findByText(en["search.ready"], {}, { timeout: 4000 });
    fireEvent.click(within(dialog).getByRole("button", { name: en.close }));
    const loads = model.loads;

    fireEvent.click(screen.getByRole("button", { name: en.chatActions }));
    fireEvent.click(screen.getByRole("button", { name: en.openAnother }));
    const another = await screen.findByRole("dialog", { name: en.replaceTitle });
    // The opt-in starts off here too.
    expect((within(another).getByRole("checkbox", { name: en["search.option"] }) as HTMLInputElement).checked).toBe(false);
    choose("other.txt");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: en.replaceTitle })).toBeNull());
    await opened();
    const next = await openSettings();
    await within(next).findByText(en["search.off"]);
    await settle();
    expect(model.loads).toBe(loads);
  });

  it("explains a model that cannot be prepared, keeps Ask working, and recovers", async () => {
    const model = fakeModel();
    let loads = 0;
    const factory: typeof model.factory = (progress, signal) => (++loads === 1 ? Promise.reject(new ModelError("model_missing", "fake")) : model.factory(progress, signal));
    const client = new FakeClient(factory);
    start(client);
    await option();
    choose("chat.txt");
    await opened();
    const dialog = await openSettings();
    fireEvent.click(within(dialog).getByRole("button", { name: en["search.enable"] }));
    expect((await within(dialog).findByRole("alert")).textContent).toContain(en["search.fail.modelMissing"]);
    within(dialog).getByText(en["search.stillWorks"]);
    fireEvent.click(within(dialog).getByRole("button", { name: en["search.tryAgain"] }));
    await within(dialog).findByText(en["search.ready"], {}, { timeout: 4000 });
    expect(loads).toBe(2);
  });

  it("offers no retry where trying again cannot help", async () => {
    const client = new FakeClient(fakeModel({ failLoad: "unsupported" }).factory);
    start(client);
    await option();
    choose("chat.txt");
    await opened();
    const dialog = await openSettings();
    fireEvent.click(within(dialog).getByRole("button", { name: en["search.enable"] }));
    await within(dialog).findByText(en["search.fail.unsupported"]);
    expect(within(dialog).queryByRole("button", { name: en["search.tryAgain"] })).toBeNull();
    within(dialog).getByText(en["search.stillWorks"]);
  });
});

describe("what each state shows", () => {
  const show = (state: SemanticState, { locale = "en" as Locale, saved = true, onAction = vi.fn() } = {}) => {
    render(<I18nProvider initialLocale={locale}><SearchSettings state={state} saved={saved} failed={false} onAction={onAction} onClose={() => {}} /></I18nProvider>);
    return onAction;
  };

  it("gives no percentage for a model whose progress is unknown", () => {
    show({ status: "preparing", phase: "load", loaded: 0, total: 0 });
    expect(screen.getByRole("status").textContent).toBe(en["search.preparing"]);
    expect(document.body.textContent).toContain(en["search.load"]);
    expect(document.body.textContent).not.toContain("%");
  });

  it("gives the measured percentage while downloading", () => {
    show({ status: "preparing", phase: "download", loaded: 25, total: 100 });
    expect(document.body.textContent).toContain("Downloading the model: 25%");
  });

  it("shows counts and never rounds an unfinished index up to 100%", () => {
    show({ status: "indexing", done: 1_999, total: 2_000, device: "wasm" });
    expect(document.body.textContent).toContain("1,999 of 2,000 messages · 99%");
    expect((screen.getByRole("progressbar") as HTMLProgressElement).value).toBe(1999);
  });

  it("says when an index will not outlive the chat", () => {
    show({ status: "ready", done: 10, total: 10, device: "wasm" }, { saved: false });
    expect(document.body.textContent).toContain(en["search.unsaved"]);
    expect(document.body.textContent).toContain("All 10 messages indexed");
  });

  it("turns off a paused index with nothing in it without asking", () => {
    const onAction = show({ status: "paused", done: 0, total: 10 });
    fireEvent.click(screen.getByRole("button", { name: en["search.turnOff"] }));
    expect(onAction).toHaveBeenCalledWith("remove");
  });

  it("lets a failed preparation with nothing indexed be turned off, but not one that keeps vectors without asking", () => {
    const onAction = show({ status: "failed", reason: "model_missing", done: 0, total: 10 });
    fireEvent.click(screen.getByRole("button", { name: en["search.turnOff"] }));
    expect(onAction).toHaveBeenCalledWith("remove");
    cleanup();
    show({ status: "failed", reason: "model_missing", done: 5, total: 10 });
    expect(screen.queryByRole("button", { name: en["search.turnOff"] })).toBeNull();
    expect(screen.getByRole("button", { name: en["search.remove"] })).toBeTruthy();
  });

  it.each(["too_large", "unsupported", "model_missing", "integrity", "storage_full", "memory", "failed"] as SemanticFailure[])("explains %s in both languages", (reason) => {
    show({ status: "failed", reason, done: 0, total: 10 });
    expect(screen.getByRole("alert").textContent).toBeTruthy();
    cleanup();
    show({ status: "failed", reason, done: 0, total: 10 }, { locale: "tr" });
    expect(screen.getByText(tr["search.stillWorks"])).toBeTruthy();
    expect(screen.getByRole("alert").textContent).not.toMatch(/search|model file/i);
  });

  it("is in Turkish", () => {
    show({ status: "off" }, { locale: "tr" });
    expect(screen.getByRole("button", { name: tr["search.enable"] })).toBeTruthy();
    expect(screen.getByText(tr["search.off"])).toBeTruthy();
    expect(document.body.textContent).toContain("128,9 MB");
  });
});
