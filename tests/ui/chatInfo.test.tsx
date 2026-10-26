// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { parseExport } from "@/parser";
import { ChatInfo } from "@/ui/components/ChatInfo";
import { Dialog } from "@/ui/components/Dialog";
import { importStatus } from "@/ui/importStatus";
import type { LoadSummary } from "@/worker/protocol";

afterEach(cleanup);

// Day 15 proves day-first order, so the clean chat has no warning at all.
const CHAT = [
  "15.01.2024 09:19 - Ayşe: Merhaba",
  "15.01.2024 09:28 - Mehmet: Selam",
  "16.01.2024 09:45 - Zeynep: Nasılsınız",
].join("\n");

function summaryOf(text: string, file: Partial<LoadSummary["file"]> = {}): LoadSummary {
  const parsed = parseExport(text);
  return {
    file: { fileName: "chat.txt", byteLength: 2048, encoding: "utf-8", hadBom: false, hadReplacementChars: false, archiveEntry: null, ...file } as LoadSummary["file"],
    report: parsed.report,
    participantCount: parsed.participants.length,
    chatType: parsed.chatType,
    aliasCandidates: 0,
    firstMessageAt: "2024-01-15T09:19:00",
    lastMessageAt: "2024-01-16T09:45:00",
    saved: null,
    saveError: null,
  };
}

describe("Chat info", () => {
  it("shows the file, counts, dates and a success status for a clean import", () => {
    render(<ChatInfo summary={summaryOf(CHAT)} />);
    expect(screen.getByText("chat.txt")).toBeTruthy();
    const stats = document.querySelector<HTMLElement>(".chat-info-stats")!;
    expect(within(stats).getAllByRole("term").map((t) => t.textContent)).toEqual(["Messages", "Participants", "Dates"]);
    expect(within(stats).getAllByText("3")).toHaveLength(2);
    expect(screen.getByRole("status").textContent).toContain("Chat imported successfully.");
    expect(screen.queryByRole("list", { name: "Import notes" })).toBeNull();
  });

  it("shows no technical diagnostics", () => {
    const { container } = render(<ChatInfo summary={summaryOf(CHAT)} />);
    expect(container.querySelector("details")).toBeNull();
    for (const t of ["Encoding", "utf-8", "Format", "System lines", "continuation", "Technical details"]) expect(container.textContent).not.toContain(t);
  });

  it("calls an import with only notes 'with some notes', not partial and not successful", () => {
    const s = importStatus(summaryOf(CHAT.replace(/15\.01|16\.01/g, "05.01")));
    expect(s.level).toBe("notes");
    expect(s.title).toBe("Imported with some notes.");
    expect(s.detail).toBeNull();
    expect(s.points.join(" ")).toMatch(/day-first/);
  });

  it("never says successful when the parser left something unread", () => {
    render(<ChatInfo summary={summaryOf("header line\nanother\n" + CHAT)} />);
    const status = screen.getByRole("status");
    expect(status.textContent).not.toMatch(/successfully/i);
    expect(status.textContent).toContain("Your results may be incomplete.");
    // Lines before the first message are lines, not counted as lost messages.
    expect(status.textContent).toContain("Some of the file couldn't be read.");
    expect(within(screen.getByRole("list", { name: "Import notes" })).getByText(/2 lines at the start of the file/)).toBeTruthy();
  });

  it("flags undecodable bytes as a note", () => {
    const s = importStatus(summaryOf(CHAT, { hadReplacementChars: true }));
    expect(s.level).toBe("notes");
    expect(s.points).toEqual(["Some characters could not be decoded and may look wrong."]);
  });

  it("keeps the dialog keyboard-closable with focus on Close", () => {
    render(
      <Dialog title="Chat info" onDismiss={() => {}} actions={<button type="button">Close</button>}>
        <ChatInfo summary={summaryOf(CHAT)} />
      </Dialog>,
    );
    const close = screen.getByRole("button", { name: "Close" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(close);
  });
});

describe("date order choice", () => {
  // 01/02 and 01/03 fit both orders: a guess, so the user may correct it.
  const AMBIGUOUS = ["01/02/2024 10:00 - Ayşe: a", "01/03/2024 10:00 - Mehmet: b"].join("\n");

  it("is offered for a guessed order, says which order was used, and reports the choice", () => {
    const chosen: string[] = [];
    render(<ChatInfo summary={summaryOf(AMBIGUOUS)} onDateOrder={(o) => chosen.push(o)} />);
    expect(screen.getByRole("status").textContent).toContain("month-first was used");
    const group = screen.getByRole("group", { name: "Date order" });
    expect(within(group).getByRole("button", { name: "Month/Day (12/31)" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(group).getByRole("button", { name: "Day/Month (31/12)" }));
    fireEvent.click(within(group).getByRole("button", { name: "Month/Day (12/31)" })); // already in use: no re-read
    expect(chosen).toEqual(["dmy"]);
  });

  it("is not offered when the file proves the order", () => {
    render(<ChatInfo summary={summaryOf(CHAT)} onDateOrder={() => {}} />);
    expect(screen.queryByRole("group", { name: "Date order" })).toBeNull();
  });
});
