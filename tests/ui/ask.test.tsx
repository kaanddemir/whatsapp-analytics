// @vitest-environment jsdom
/* The Ask view end to end in a test DOM, through the real worker handler and
   engine: sending, each kind of answer, evidence and context, the shared
   scope, stopping, failures, keyboard use and both languages. Every figure
   on screen is compared with what the engine itself returns for the same
   question and scope, and with Overview. */
import { StrictMode } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { analyze } from "@/analytics";
import { answer } from "@/ask/answer";
import { ChatSession } from "@/conversation/session";
import { NO_FILTERS, type AnalysisFilters } from "@/model";
import { parseExport } from "@/parser";
import { App } from "@/ui/App";
import { I18nProvider } from "@/ui/i18n";
import { formatCount, formatDate } from "@/i18n/format";
import { en } from "@/i18n/en";
import { tr } from "@/i18n/tr";
import type { Locale } from "@/i18n/types";
import { FakeClient } from "../support/uiClient";
import { fakeModel } from "../support/fakeEmbedder";
import { ModelError } from "@/semantic/embedder";
import { ASK_CHAT } from "../fixtures/askChat";

const parsed = parseExport(ASK_CHAT);
const session = new ChatSession(parsed);
const idOf = (name: string) => parsed.participants.find((p) => p.name === name)!.id;
/** What the engine answers, for comparison with the screen. */
const engine = (q: string, filters: AnalysisFilters = NO_FILTERS, locale: Locale = "en") => answer(q, session, filters, undefined, locale);

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});
afterEach(cleanup);

async function openAsk({ locale = "en" as Locale, client = new FakeClient(), strict = false } = {}) {
  client.files.set("chat.txt", ASK_CHAT);
  const app = <I18nProvider initialLocale={locale}><App client={client} /></I18nProvider>;
  render(strict ? <StrictMode>{app}</StrictMode> : app);
  fireEvent.change(screen.getAllByLabelText(locale === "tr" ? /^(Dosya seç|Dışa aktarımı seç)$/ : /^Choose (file|export)$/).at(-1)!, { target: { files: [new File(["x"], "chat.txt")] } });
  const tab = await screen.findByRole("button", { name: locale === "tr" ? tr["ask.nav"] : en["ask.nav"] });
  fireEvent.click(tab);
  return client;
}

const composer = () => screen.getByRole("textbox", { name: en["ask.input"] });
function ask(question: string) {
  fireEvent.change(composer(), { target: { value: question } });
  fireEvent.keyDown(composer(), { key: "Enter" });
}
const answers = () => screen.queryAllByRole("article", { name: en["ask.answer"] });
async function lastAnswer(text: string) {
  await waitFor(() => expect(within(answers().at(-1)!).getByText(text)).toBeTruthy());
  return answers().at(-1)!;
}

describe("Ask view", () => {
  it("is a destination beside Overview, opening on an honest empty conversation", async () => {
    await openAsk();
    expect(screen.getByRole("navigation", { name: en["ask.views"] })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ask" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "Overview" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("heading", { name: en["ask.title"] })).toBeTruthy();
    expect(screen.getByText(en["ask.lede"])).toBeTruthy();
    expect(screen.getByText(en["ask.footnote"])).toBeTruthy();
    const examples = within(screen.getByRole("list", { name: en["ask.examples"] })).getAllByRole("button");
    expect(examples.map((b) => b.textContent)).toEqual([1, 2, 3, 4].map((i) => `${en[`ask.s${i}` as "ask.s1"]}${en[`ask.s${i}Hint` as "ask.s1Hint"]}`));
    // The dashboard is not on screen behind it.
    expect(screen.queryByRole("heading", { name: "Overview" })).toBeNull();
    expect((screen.getByRole("button", { name: en["ask.send"] }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("every suggestion is a question the engine supports", async () => {
    for (const i of [1, 2, 3, 4]) {
      for (const [locale, dict] of [["en", en], ["tr", tr]] as const) {
        const a = engine(dict[`ask.s${i}` as "ask.s1"], NO_FILTERS, locale);
        expect(a.supported, `${locale} s${i}`).toBe(true);
        expect(a.plan.type).not.toBe("recall");
      }
    }
  });

  it("answers a suggestion with the engine's comparison, drawn to scale", async () => {
    const client = await openAsk();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(en["ask.s1"].replace("?", "\\?")) }));
    const expected = engine(en["ask.s1"]);
    const a = await lastAnswer(expected.text);
    expect(client.asks).toEqual([{ question: en["ask.s1"], filters: NO_FILTERS, locale: "en" }]);
    // The question stays in the thread, as the user wrote it.
    expect(screen.getByText(en["ask.s1"], { selector: ".turn-bubble" })).toBeTruthy();
    const rows = within(a).getAllByRole("listitem");
    expect(rows).toHaveLength(expected.rows.length);
    expected.rows.forEach((row, i) => {
      expect(rows[i]!.textContent).toBe(`${row.label}${row.value}${row.detail ?? ""}`);
      expect(rows[i]!.classList.contains("lead")).toBe(row.lead);
    });
    // Bars come from magnitude: the leader's is full, the other in proportion.
    const bars = a.querySelectorAll<HTMLElement>(".row-bar i");
    const max = Math.max(...expected.rows.map((r) => r.magnitude!));
    expected.rows.forEach((row, i) => expect(parseFloat(bars[i]!.style.width)).toBeCloseTo((row.magnitude! / max) * 100, 5));
    expect(within(a).getByText(en["ask.basis.count"])).toBeTruthy();
    // Announced for screen readers once it arrives.
    expect(screen.getByText(expected.text, { selector: "[aria-live]" })).toBeTruthy();
  });

  it("shows a single figure as a headline, and changes over time as two measured windows", async () => {
    await openAsk();
    ask("Which month was busiest?");
    const busiest = engine("Which month was busiest?");
    const a = await lastAnswer(busiest.text);
    expect(a.querySelector(".ans-figure-value")!.textContent).toBe(busiest.figure!.value);
    expect(a.querySelector(".ans-figure-caption")!.textContent).toBe(busiest.figure!.caption);
    expect(a.querySelector(".ans-rows")).toBeNull();

    ask("Has messaging changed lately?");
    const trend = engine("Has messaging changed lately?");
    const b = await lastAnswer(trend.text);
    expect(b.querySelectorAll(".ans-rows.bars li")).toHaveLength(trend.rows.length);
    // What the comparison does not establish is shown with it.
    expect(within(b).getByText(trend.note!)).toBeTruthy();
  });

  it("shows cited messages with their words marked, pages through the rest, and opens one in context", async () => {
    await openAsk();
    ask("Find messages about concert");
    const expected = engine("Find messages about concert");
    const a = await lastAnswer(expected.text);
    const list = () => within(a).getByRole("list", { name: en["ask.messages"] });
    const items = () => within(list()).getAllByRole("listitem").filter((li) => li.classList.contains("msg"));
    expect(items()).toHaveLength(4);
    expect(within(a).getByText(`4 of ${expected.evidenceTotal}`)).toBeTruthy();
    const first = expected.evidence[0]!.message;
    expect(within(items()[0]!).getByText(first.senderName)).toBeTruthy();
    expect([...items()[0]!.querySelectorAll("mark")].map((m) => m.textContent?.toLowerCase())).toEqual(["concert"]);
    // The edited message says so.
    fireEvent.click(within(a).getByRole("button", { name: en["ask.showMore"] }));
    // Five came with the answer; the other two are read from the worker.
    await waitFor(() => expect(items()).toHaveLength(expected.evidenceTotal));
    expect(within(a).queryByRole("button", { name: en["ask.showMore"] })).toBeNull();
    expect(within(a).getAllByText(en.x_edited)).toHaveLength(1);

    fireEvent.click(within(items()[0]!).getByRole("button", { name: en["ask.context"] }));
    const context = await within(a).findByRole("list", { name: en["ask.contextLabel"] });
    const lines = within(context).getAllByRole("listitem");
    expect(lines.length).toBeGreaterThan(1);
    const cited = lines.find((l) => l.getAttribute("aria-current") === "true")!;
    expect(cited.textContent).toContain(first.text);
    // The neighbours are the chat's own messages around it, in order.
    const around = parsed.messages.slice(Math.max(0, first.id - 3), first.id + 5).map((m) => m.text);
    expect(lines.map((l) => l.querySelector(".msg-text")!.textContent)).toEqual(around);
    fireEvent.click(within(items()[0]!).getByRole("button", { name: en["ask.hideContext"] }));
    expect(within(a).queryByRole("list", { name: en["ask.contextLabel"] })).toBeNull();
  });

  it("reads a day's messages as a transcript under its date", async () => {
    await openAsk();
    const q = "What did we talk about on 1 March 2024?";
    ask(q);
    const expected = engine(q);
    const a = await lastAnswer(expected.text);
    expect(a.querySelectorAll(".msg-day")).toHaveLength(1);
    expect(a.querySelector(".msg-day")!.textContent).toBe(formatDate("2024-03-01"));
    // Times only: the heading carries the date.
    const times = [...a.querySelectorAll(".msg time")].map((t) => t.textContent);
    expect(times).toEqual(expected.evidence.slice(0, 4).map((e) => e.message.at.slice(11, 16)));
  });

  it("lists plan conversations with what each message mentions", async () => {
    await openAsk();
    ask(en["ask.s4"]);
    const expected = engine(en["ask.s4"]);
    const a = await lastAnswer(expected.text);
    const result = expected.result!;
    if (result.kind !== "timeline" || !result.page) throw new Error("expected plans");
    // One transcript: a dated section per conversation, then its plan messages.
    expect(a.querySelectorAll(".msg-list")).toHaveLength(1);
    expect(a.querySelectorAll(".msg-day")).toHaveLength(result.page.threads.length);
    expect(a.querySelectorAll(".msg")).toHaveLength(result.page.threads.reduce((n, th) => n + th.messages.length, 0));
    const tags = [...a.querySelectorAll(".msg-tag")].map((t) => t.textContent);
    const wanted = result.page.threads.flatMap((th) => th.messages.flatMap((m) => m.tags.map((tag) => en[`ask.tag.${tag}` as "ask.tag.date"])));
    expect(tags).toEqual(wanted);
    expect(within(a).getByText(expected.note!)).toBeTruthy();
  });

  it("states what it cannot do, without claiming a basis", async () => {
    await openAsk();
    ask("Who is more in love?");
    const a = await lastAnswer(en.a_unsupportedMeaning);
    expect(a.querySelector(".ans.limited")).toBeTruthy();
    expect(a.querySelector(".ans-basis")).toBeNull();
  });

  it("offers search by meaning when only words were searched, prepares it on the device, then asks again", async () => {
    const model = fakeModel();
    const client = await openAsk({ client: new FakeClient(model.factory) });
    ask("Where did we talk about moving?");
    const a = await lastAnswer(engine("Where did we talk about moving?").text);
    expect(within(a).getByText(en.r_keywordOnly)).toBeTruthy();
    fireEvent.click(within(a).getByRole("button", { name: en["ask.enableMeaning"] }));
    await within(a).findByText(en["ask.meaningReady"], {}, { timeout: 4000 });
    fireEvent.click(within(a).getByRole("button", { name: en["ask.retry"] }));
    await waitFor(() => expect(answers()).toHaveLength(2));
    const b = answers().at(-1)!;
    await waitFor(() => expect(within(b).getByText(en["ask.basis.meaning"])).toBeTruthy());
    // Found by meaning alone, and said to be possibly unrelated.
    expect(within(b).getByText("yeni eve geçsek mi diye düşünüyorum")).toBeTruthy();
    expect(b.textContent).toContain(en.r_meaningOnly);
    expect(model.loads).toBe(1);
    expect(client.asks.map((x) => x.question)).toEqual(["Where did we talk about moving?", "Where did we talk about moving?"]);
  });
});

describe("Ask search by meaning failures", () => {
  it("says when the model could not be prepared, and recovers on Try again", async () => {
    const model = fakeModel();
    let loads = 0;
    // The first load fails (as a model file that did not arrive would); the next succeeds.
    const factory: typeof model.factory = (progress, signal) => (++loads === 1 ? Promise.reject(new ModelError("failed", "fake load failure")) : model.factory(progress, signal));
    await openAsk({ client: new FakeClient(factory) });
    ask("Where did we talk about moving?");
    const a = await lastAnswer(engine("Where did we talk about moving?").text);
    fireEvent.click(within(a).getByRole("button", { name: en["ask.enableMeaning"] }));
    expect((await within(a).findByRole("alert")).textContent).toBe(en["ask.meaningCouldNot"]);
    fireEvent.click(within(a).getByRole("button", { name: en["ask.meaningTryAgain"] }));
    await within(a).findByText(en["ask.meaningReady"], {}, { timeout: 4000 });
    expect(loads).toBe(2);
  });
});

describe("Ask scope", () => {
  it("asks within the participant chosen in the composer, says so in the thread, and agrees with Overview", async () => {
    const client = await openAsk();
    ask("How many messages?");
    await lastAnswer(engine("How many messages?").text);
    expect(screen.queryByText(/^Asking about/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Participant filter: everyone/ }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Participant" })).getByRole("button", { name: /Can/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Participant filter: Can/ })).toBeTruthy());
    const can = idOf("Can");
    ask("How many messages?");
    const filters = { start: null, end: null, sender: can };
    const expected = engine("How many messages?", filters);
    const a = await lastAnswer(expected.text);
    expect(client.asks.at(-1)!.filters).toEqual(filters);
    expect(screen.getByText("Asking about Can · all dates")).toBeTruthy();
    const total = analyze(parsed, filters).kpis.totalMessages;
    expect(a.querySelector(".ans-figure-value")!.textContent).toBe(formatCount(total));

    // The same scope on Overview shows the same number.
    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    const kpi = await screen.findByRole("region", { name: "Total Messages" });
    expect(within(kpi).getByText(formatCount(total))).toBeTruthy();
  });

  it("asks within the chosen dates", async () => {
    const client = await openAsk();
    fireEvent.click(screen.getByRole("button", { name: /^Date range:/ }));
    const dialog = screen.getByRole("dialog", { name: "Date range" });
    fireEvent.change(within(dialog).getByLabelText("From"), { target: { value: "2024-02-01" } });
    fireEvent.change(within(dialog).getByLabelText("To"), { target: { value: "2024-02-29" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /^Date range: Feb/ })).toBeTruthy());
    ask("How many messages?");
    const filters = { start: "2024-02-01", end: "2024-02-29", sender: null };
    await lastAnswer(engine("How many messages?", filters).text);
    expect(client.asks.at(-1)!.filters).toEqual(filters);
    expect(screen.getByText(/^Asking about everyone · /)).toBeTruthy();
  });
});

describe("Ask conversation", () => {
  it("sends on Enter, adds a line on Shift+Enter, ignores blank input and recalls the last question", async () => {
    const client = await openAsk();
    fireEvent.change(composer(), { target: { value: "   " } });
    fireEvent.keyDown(composer(), { key: "Enter" });
    fireEvent.change(composer(), { target: { value: "How many" } });
    fireEvent.keyDown(composer(), { key: "Enter", shiftKey: true });
    expect(client.asks).toHaveLength(0);
    fireEvent.change(composer(), { target: { value: "How many\nmessages?" } });
    fireEvent.keyDown(composer(), { key: "Enter" });
    await waitFor(() => expect(answers()).toHaveLength(1));
    expect(client.asks[0]!.question).toBe("How many\nmessages?");
    expect((composer() as HTMLTextAreaElement).value).toBe("");
    fireEvent.keyDown(composer(), { key: "ArrowUp" });
    expect((composer() as HTMLTextAreaElement).value).toBe("How many\nmessages?");
    // The send button is a submit button: clicking it sends too.
    fireEvent.click(screen.getByRole("button", { name: en["ask.send"] }));
    await waitFor(() => expect(answers()).toHaveLength(2));
  });

  it("shows replies under StrictMode, as the app is mounted in main.tsx", async () => {
    // StrictMode mounts twice; a reply must not be taken for one arriving after unmount.
    await openAsk({ strict: true });
    ask("How many messages?");
    await lastAnswer(engine("How many messages?").text);
  });

  it("stops waiting on request, drops the late reply, and can ask again", async () => {
    const client = await openAsk();
    client.holdAsk = true;
    ask("How many messages?");
    await screen.findByText(en["ask.working"], { selector: ".ans-pending" });
    expect(answers()[0]!.getAttribute("aria-busy")).toBe("true");
    const stop = screen.getByRole("button", { name: en["ask.stop"] });
    // Escape in the composer stops too; here, the button.
    fireEvent.click(stop);
    expect(screen.getByText(en["ask.stopped"], { selector: ".ans-halt p" })).toBeTruthy();
    // The button that was Stop is Send again: focus does not fall out of the composer.
    expect(screen.getByRole("button", { name: en["ask.send"] })).toBe(stop);
    client.holdAsk = false;
    await act(async () => client.releaseAsk());
    expect(within(answers()[0]!).queryByText(engine("How many messages?").text)).toBeNull();
    fireEvent.click(within(answers()[0]!).getByRole("button", { name: en["ask.retry"] }));
    await lastAnswer(engine("How many messages?").text);
    expect(client.asks).toHaveLength(2);
  });

  it("cancels a question in the worker: the next one is answered while the model is still busy, and the chat stays", async () => {
    const model = fakeModel();
    const client = await openAsk({ client: new FakeClient(model.factory) });
    ask("Where did we talk about moving?");
    const first = await lastAnswer(engine("Where did we talk about moving?").text);
    fireEvent.click(within(first).getByRole("button", { name: en["ask.enableMeaning"] }));
    await within(first).findByText(en["ask.meaningReady"], {}, { timeout: 4000 });
    // Hold the model: the next search by meaning waits in the worker for its query.
    let release!: () => void;
    model.gate = new Promise<void>((r) => (release = r));
    ask("Where did we talk about moving?");
    await screen.findByText(en["ask.working"], { selector: ".ans-pending" });
    fireEvent.click(screen.getByRole("button", { name: en["ask.stop"] }));
    expect(screen.getByText(en["ask.stopped"], { selector: ".ans-halt p" })).toBeTruthy();
    ask("How many messages?");
    await lastAnswer(engine("How many messages?").text);
    await act(async () => { release(); await new Promise((r) => setTimeout(r, 20)); });
    expect(answers()[1]!.querySelector(".ans")).toBeNull(); // the stopped turn stays stopped
    expect(client.asks).toHaveLength(3);
  });

  it("stops with Escape", async () => {
    const client = await openAsk();
    client.holdAsk = true;
    ask("How many messages?");
    await screen.findByText(en["ask.working"], { selector: ".ans-pending" });
    fireEvent.keyDown(composer(), { key: "Escape" });
    expect(screen.getByText(en["ask.stopped"], { selector: ".ans-halt p" })).toBeTruthy();
    await act(async () => client.releaseAsk());
  });

  it("says when a question could not be answered and retries it", async () => {
    const client = await openAsk();
    client.failNextAsk = "internal";
    ask("How many messages?");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(en["ask.failed"]);
    fireEvent.click(within(alert).getByRole("button", { name: en["ask.retry"] }));
    await lastAnswer(engine("How many messages?").text);
  });

  it("returns to the start when the worker has lost the chat", async () => {
    const client = await openAsk();
    client.failNextAsk = "worker_lost";
    ask("How many messages?");
    await screen.findByRole("alertdialog");
    expect(screen.getByText(en.err_worker_lost)).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: en["ask.views"] })).toBeNull();
  });

  it("keeps the conversation while Overview shows, and starts afresh on request", async () => {
    await openAsk();
    ask("How many messages?");
    await lastAnswer(engine("How many messages?").text);
    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    expect(await screen.findByRole("heading", { name: "Overview" })).toBeTruthy();
    expect(answers()).toHaveLength(0); // hidden, not gone
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(answers()).toHaveLength(1);
    expect(document.activeElement).not.toBe(composer()); // no keyboard focus jump on touch-first test DOM
    fireEvent.click(screen.getByRole("button", { name: en["ask.newConversation"] }));
    expect(answers()).toHaveLength(0);
    expect(screen.getByRole("heading", { name: en["ask.title"] })).toBeTruthy();
  });

  it("speaks Turkish throughout, with the engine's Turkish answer", async () => {
    const client = await openAsk({ locale: "tr" });
    expect(screen.getByRole("heading", { name: tr["ask.title"] })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Genel Bakış" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(tr["ask.s1"].replace("?", "\\?")) }));
    const expected = engine(tr["ask.s1"], NO_FILTERS, "tr");
    await waitFor(() => expect(screen.getByText(expected.text, { selector: ".ans-text span" })).toBeTruthy());
    expect(client.asks[0]!.locale).toBe("tr");
    expect(screen.getByText(tr["ask.basis.count"])).toBeTruthy();
    expect(screen.getByRole("textbox", { name: tr["ask.input"] })).toBeTruthy();
  });
});

describe("Ask styles", () => {
  it("use only the shared colour tokens, so both themes follow", () => {
    const css = readFileSync(join(__dirname, "../../src/ui/ask/ask.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css.match(/#[0-9a-f]{3,8}\b/gi)).toBeNull();
    // Shadows are the one place a fixed (neutral, translucent) colour is used, as in styles.css.
    const fixed = css.split(/[;{}]/).filter((d) => /rgba?\(/.test(d)).map((d) => d.trim().split(":")[0]);
    expect(new Set(fixed)).toEqual(new Set(["box-shadow"]));
  });
});
