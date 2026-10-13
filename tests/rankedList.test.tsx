// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RankedList } from "@/ui/components/RankedList";

afterEach(cleanup);
const items = Array.from({ length: 7 }, (_, i) => ({ key: `word${i + 1}`, count: 70 - i * 5 }));

describe("RankedList pagination", () => {
  it("pages five rows at a time with labelled, correctly disabled controls", () => {
    render(<RankedList items={items} label="Top keywords" />);
    const list = screen.getByRole("list", { name: "Top keywords" });
    const prev = screen.getByRole("button", { name: "Previous page of top keywords" }) as HTMLButtonElement;
    const next = screen.getByRole("button", { name: "Next page of top keywords" }) as HTMLButtonElement;
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["word170", "word265", "word360", "word455", "word550"]);
    expect(prev.disabled).toBe(true);
    expect(next.disabled).toBe(false);
    // What a screen reader hears (the visual "/" is aria-hidden).
    const count = screen.getByRole("navigation", { name: "Top keywords pages" }).querySelector(".pager-count")!.cloneNode(true) as HTMLElement;
    count.querySelectorAll("[aria-hidden]").forEach((e) => e.remove());
    expect(count.textContent).toBe("Page 1 of 2");
    fireEvent.click(next);
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["word645", "word740"]);
    expect(list.getAttribute("start")).toBe("6");
    // The last page keeps five rows of space, so the pager does not move.
    expect(list.classList.contains("paged")).toBe(true);
    expect(next.disabled).toBe(true);
    expect(prev.disabled).toBe(false);
    fireEvent.click(prev);
    expect(within(list).getAllByRole("listitem")).toHaveLength(5);
  });

  it("has no pager for a single page", () => {
    render(<RankedList items={items.slice(0, 3)} label="Media types" />);
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.getByRole("list", { name: "Media types" }).classList.contains("paged")).toBe(false);
  });

  it("resets to the first page when filtering replaces the items", () => {
    const { rerender } = render(<RankedList items={items} label="Top emojis" />);
    fireEvent.click(screen.getByRole("button", { name: "Next page of top emojis" }));
    expect(screen.getByText("word6")).toBeTruthy();
    rerender(<RankedList items={items.slice(0, 3)} label="Top emojis" />);
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.getByText("word1")).toBeTruthy();
    expect(screen.queryByText("word6")).toBeNull();
  });
});
