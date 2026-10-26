// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { App } from "@/ui/App";
import { I18nProvider } from "@/ui/i18n";
import { FakeClient } from "../support/uiClient";
import { android, lines } from "../support/export";

beforeAll(() => { HTMLCanvasElement.prototype.getContext = (() => null) as never; });
afterEach(cleanup);

it("renders untrusted filenames and senders as text in Dashboard and Recap", async () => {
  const sender = '<img src=x onerror=window.__chatXss=1>';
  const message = '<script>window.__chatXss=1</script> coffee <a href="javascript:alert(1)">click</a>';
  const name = '<svg onload="window.__chatXss=1">.txt';
  const client = new FakeClient();
  client.files.set(name, lines(android("13/02/24", "09:00", sender, message), android("14/02/24", "09:00", "Bob", "coffee")));
  render(<I18nProvider initialLocale="en"><App client={client} /></I18nProvider>);
  fireEvent.change(screen.getByLabelText("Choose file"), { target: { files: [new File(["x"], name)] } });
  await screen.findByRole("heading", { name: "Overview" });
  expect(screen.getAllByText(sender).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: "Chat actions" }));
  fireEvent.click(screen.getByRole("button", { name: "Chat info" }));
  expect((await screen.findByRole("dialog", { name: "Chat info" })).textContent).toContain(name);
  fireEvent.keyDown(document, { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "Recap" }));
  expect(await screen.findByRole("dialog", { name: /recap/i })).toBeTruthy();
  expect(document.querySelector('[src="x"], [href^="javascript:"], [onerror], [onload], script')).toBeNull();
  expect((window as unknown as Record<string, unknown>).__chatXss).toBeUndefined();
});
