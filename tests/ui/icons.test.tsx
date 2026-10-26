// @vitest-environment jsdom
/* Icons are lucide-react throughout: decorative, so hidden from assistive
   technology, and never the only name a button has. Checked on every view a
   loaded chat has, with the menu open. */
import { afterEach, beforeAll, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { App } from "@/ui/App";
import { FakeClient } from "../support/uiClient";
import { ASK_CHAT } from "../fixtures/askChat";

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});
afterEach(cleanup);

function check() {
  const icons = [...document.querySelectorAll("svg")].filter((svg) => svg.classList.contains("lucide"));
  expect(icons.length).toBeGreaterThan(0);
  for (const svg of icons) expect(svg.getAttribute("aria-hidden"), svg.getAttribute("class") ?? "").toBe("true");
  // Every visible button has a name, icon-only ones included.
  for (const button of screen.getAllByRole("button")) {
    const name = button.getAttribute("aria-label") ?? button.textContent ?? "";
    expect(name.trim(), button.outerHTML.slice(0, 120)).not.toBe("");
  }
}

it("keeps icons decorative and buttons named on the start screen, Overview, the menu and Ask", async () => {
  const client = new FakeClient();
  client.files.set("chat.txt", ASK_CHAT);
  render(<App client={client} />);
  check();
  fireEvent.change(screen.getAllByLabelText(/^Choose (file|export)$/).at(-1)!, { target: { files: [new File(["x"], "chat.txt")] } });
  await screen.findByRole("heading", { name: "Overview" });
  check();
  // The old hand-drawn set is gone: no unclassed inline icons outside charts.
  expect(document.querySelectorAll("svg.icon")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Chat actions" }));
  check();
  fireEvent.keyDown(document, { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
  check();
});
