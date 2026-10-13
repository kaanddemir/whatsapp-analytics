// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { analyze } from "@/analytics";
import { NO_FILTERS } from "@/model";
import { parseExport } from "@/parser";
import { MessageKindsCard } from "@/ui/components/ContentCards";

afterEach(cleanup);

const statsOf = (body: string) => analyze(parseExport(
  `[01.01.24, 10:00:00] Ayşe: ${body}\n[01.01.24, 10:01:00] Can: hello\n`,
), NO_FILTERS);

describe("unified Message Types card", () => {
  it("does not repeat a lone unclassified media total", () => {
    render(<MessageKindsCard stats={statsOf("<Media omitted>")} />);
    const card = screen.getByRole("region", { name: "Message Types" });
    expect(within(card).getByText("Media")).toBeTruthy();
    expect(within(card).queryByText("Media types")).toBeNull();
    expect(within(card).queryByText("Other")).toBeNull();
  });

  it("shows identified media kinds as a subordinate distribution", () => {
    render(<MessageKindsCard stats={statsOf("<image omitted>")} />);
    const card = screen.getByRole("region", { name: "Message Types" });
    expect(within(card).getByRole("heading", { name: "Media types" })).toBeTruthy();
    expect(within(card).getByRole("list", { name: "Media types" }).textContent).toBe("Photos1");
  });
});
