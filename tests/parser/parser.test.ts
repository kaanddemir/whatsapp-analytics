import { describe, expect, it } from "vitest";
import { parseExport } from "@/parser";
import type { ParseResult } from "@/model";
import { LRM, NNBSP, android, ios, lines } from "../support/export";

const iso = (ts: number) => new Date(ts).toISOString().slice(0, 16);
const texts = (r: ParseResult) => r.messages.map((m) => m.text);
const names = (r: ParseResult) => r.participants.map((p) => p.name);
const warning = (r: ParseResult, code: string) => r.report.warnings.find((w) => w.code === code);
const days = (r: ParseResult) => r.messages.map((m) => iso(m.ts).slice(0, 10));

describe("line formats", () => {
  it("parses Android 24-hour lines", () => {
    const r = parseExport(lines(
      android("31/12/2023", "21:05", "Alice", "hello"),
      android("31/12/2023", "21:06", "Bob", "hi"),
    ));
    expect(texts(r)).toEqual(["hello", "hi"]);
    expect(iso(r.messages[0]!.ts)).toBe("2023-12-31T21:05");
    expect(r.report.format).toMatchObject({ platform: "android", dateOrder: "dmy", dateOrderCertainty: "proven", clock: "24h" });
    expect(r.report.completeness).toBe("complete");
  });

  it("parses iOS 12-hour lines with seconds and a narrow no-break space before PM", () => {
    const r = parseExport(lines(
      ios("12/31/23", `9:05:33${NNBSP}PM`, "Alice", "evening"),
      ios("1/1/24", `12:00:01${NNBSP}AM`, "Bob", "midnight"),
      ios("1/1/24", `12:30:00${NNBSP}PM`, "Bob", "noon"),
    ));
    expect(r.messages.map((m) => iso(m.ts))).toEqual(["2023-12-31T21:05", "2024-01-01T00:00", "2024-01-01T12:30"]);
    expect(r.report.format).toMatchObject({ platform: "ios", dateOrder: "mdy", clock: "12h" });
  });

  it("parses Turkish ÖÖ/ÖS markers and dotted dates", () => {
    const r = parseExport(lines(
      ios("31.12.2023", "09:05:00 ÖS", "Ayşe", "akşam"),
      ios("01.01.2024", "08:00:00 ÖÖ", "Mehmet", "sabah"),
    ));
    expect(r.messages.map((m) => iso(m.ts))).toEqual(["2023-12-31T21:05", "2024-01-01T08:00"]);
  });

  it("parses year-first dates, hyphen separators and dotted times", () => {
    const r = parseExport(lines(
      "2024-01-31, 21.05 - Alice: iso",
      "2024-02-01 07:30 - Bob: no comma",
    ));
    expect(r.messages.map((m) => iso(m.ts))).toEqual(["2024-01-31T21:05", "2024-02-01T07:30"]);
    expect(r.report.format.dateOrder).toBe("ymd");
  });

  it("accepts a.m./p.m. markers", () => {
    const r = parseExport(lines(android("1/2/24", "9:15 p.m.", "Alice", "x")));
    expect(iso(r.messages[0]!.ts).slice(11)).toBe("21:15");
  });

  it("does not mistake text that merely contains a date for a header", () => {
    const r = parseExport(lines(
      android("01/02/24", "09:15", "Alice", "meet on 03/04/24, 10:00 please"),
    ));
    expect(r.messages).toHaveLength(1);
  });
});

describe("date order", () => {
  it("is proven by an impossible date under the other order", () => {
    const r = parseExport(lines(
      android("05/01/24", "10:00", "Alice", "a"),
      android("13/01/24", "10:00", "Alice", "b"),
    ));
    expect(r.report.format).toMatchObject({ dateOrder: "dmy", dateOrderCertainty: "proven" });
    expect(iso(r.messages[0]!.ts).slice(0, 10)).toBe("2024-01-05");
  });

  it("is inferred from chronology when every date fits both orders", () => {
    // M/D/Y keeps these in order (Jan 2, Jan 3, Feb 1); D/M/Y would jump backwards.
    const r = parseExport(lines(
      android("01/02/24", "10:00", "Alice", "a"),
      android("01/03/24", "10:00", "Alice", "b"),
      android("02/01/24", "10:00", "Alice", "c"),
    ));
    expect(r.report.format).toMatchObject({ dateOrder: "mdy", dateOrderCertainty: "inferred" });
    // A guess, however good, is never presented as certain.
    expect(warning(r, "ambiguous_date_order")).toBeDefined();
  });

  it("is assumed day-first, with a warning, when nothing distinguishes the orders", () => {
    const r = parseExport(lines(android("03/04/24", "10:00", "Alice", "a")));
    expect(r.report.format).toMatchObject({ dateOrder: "dmy", dateOrderCertainty: "assumed" });
    expect(warning(r, "ambiguous_date_order")).toBeDefined();
  });

  it("is inferred from day-to-day continuity when both orders stay valid and chronological", () => {
    // 1/3 -> 1/4 -> 1/5 moves forward either way, but read day-first the
    // 40 minutes around midnight would become a month.
    const r = parseExport(lines(
      android("1/3/24", "11:30 PM", "Alice", "a"),
      android("1/4/24", "12:10 AM", "Bob", "b"),
      android("1/5/24", "9:00 AM", "Alice", "c"),
    ));
    expect(r.report.format).toMatchObject({ dateOrder: "mdy", dateOrderCertainty: "inferred" });
    expect(warning(r, "ambiguous_date_order")).toBeDefined();
    expect(days(r)).toEqual(["2024-01-03", "2024-01-04", "2024-01-05"]);
  });

  it("warns when continuity points the wrong way: sparse chats are genuinely ambiguous", () => {
    // Day-first truths that read as consecutive (or closer) days month-first:
    // monthly on the 1st (1 Feb, 1 Mar, 1 Apr) and 2 Jan -> 3 Feb.
    for (const dates of [["01/02/24", "01/03/24", "01/04/24"], ["02/01/24", "03/02/24"]]) {
      const r = parseExport(lines(...dates.map((d, i) => android(d, "10:00", i % 2 ? "Bob" : "Alice", "x"))));
      expect(r.report.format).toMatchObject({ dateOrder: "mdy", dateOrderCertainty: "inferred" });
      expect(warning(r, "ambiguous_date_order")).toBeDefined();
    }
  });

  it("lets the user choose the order, without a warning, when it is not proven", () => {
    const text = lines(android("01/02/24", "10:00", "Alice", "a"), android("01/03/24", "10:00", "Bob", "b"));
    const r = parseExport(text, { dateOrder: "dmy" });
    expect(r.report.format).toMatchObject({ dateOrder: "dmy", dateOrderCertainty: "user" });
    expect(warning(r, "ambiguous_date_order")).toBeUndefined();
    expect(days(r)).toEqual(["2024-02-01", "2024-03-01"]);
    expect(days(parseExport(text, { dateOrder: "mdy" }))).toEqual(["2024-01-02", "2024-01-03"]);
  });

  it("ignores a user choice when the file proves the order", () => {
    const r = parseExport(lines(android("05/01/24", "10:00", "Alice", "a"), android("13/01/24", "10:00", "Bob", "b")), { dateOrder: "mdy" });
    expect(r.report.format).toMatchObject({ dateOrder: "dmy", dateOrderCertainty: "proven" });
    expect(r.messages).toHaveLength(2);
  });

  it("applies one order to the whole file instead of falling back per line", () => {
    // 13/01 proves D/M/Y; legacy would still read 01/13 by M/D/Y.
    const r = parseExport(lines(
      android("12/01/24", "10:00", "Alice", "a"),
      android("13/01/24", "10:00", "Alice", "b"),
      android("01/13/24", "10:00", "Alice", "impossible under D/M/Y"),
    ));
    expect(r.messages).toHaveLength(2);
    expect(warning(r, "invalid_timestamp")?.sampleLines).toEqual([3]);
    expect(warning(r, "conflicting_date_order")).toBeDefined();
    expect(r.report.completeness).toBe("partial");
  });
});

describe("multi-line messages and odd lines", () => {
  it("joins continuation lines, keeping blank lines inside a message", () => {
    const r = parseExport(lines(
      android("01/02/24", "09:00", "Alice", "first line"),
      "second line",
      "",
      "fourth line",
      android("01/02/24", "09:01", "Bob", "next"),
    ));
    expect(texts(r)).toEqual(["first line\nsecond line\n\nfourth line", "next"]);
    expect(r.report.continuationLines).toBe(2);
  });

  it("handles CRLF and CR line endings", () => {
    const r = parseExport("01/02/24, 09:00 - Alice: a\r\nmore\r01/02/24, 09:01 - Bob: b");
    expect(texts(r)).toEqual(["a\nmore", "b"]);
  });

  it("reports lines before the first message instead of dropping them silently", () => {
    const r = parseExport(lines("some header text", android("01/02/24", "09:00", "Alice", "a")));
    expect(warning(r, "orphan_lines")).toMatchObject({ count: 1, sampleLines: [1] });
    expect(r.report.completeness).toBe("partial");
  });

  it("skips and reports impossible times", () => {
    const r = parseExport(lines(
      android("01/02/24", "25:00", "Alice", "bad hour"),
      android("01/02/24", "13:00 PM", "Alice", "bad 12h hour"),
      android("31/02/24", "10:00", "Alice", "no Feb 31"),
      android("01/02/24", "10:00", "Alice", "good"),
    ));
    expect(texts(r)).toEqual(["good"]);
    expect(r.report.skippedRecords).toBe(3);
  });

  it("keeps an empty message body", () => {
    const r = parseExport(lines("01/02/24, 09:00 - Alice:"));
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0]!.text).toBe("");
  });

  it("sorts out-of-order records stably and says so", () => {
    const r = parseExport(lines(
      android("01/02/24", "10:00", "Alice", "later"),
      android("01/02/24", "09:00", "Bob", "earlier"),
      android("01/02/24", "10:00", "Bob", "same minute as first"),
    ));
    expect(texts(r)).toEqual(["earlier", "later", "same minute as first"]);
    expect(warning(r, "out_of_order")).toBeDefined();
  });

  it("returns an empty result with a report for a file with no messages", () => {
    const r = parseExport("just some text\nnot an export\n");
    expect(r.messages).toHaveLength(0);
    expect(r.report.completeness).toBe("empty");
    expect(warning(r, "orphan_lines")?.count).toBe(2);
  });

  it("handles an empty string", () => {
    expect(parseExport("").report.completeness).toBe("empty");
  });
});

describe("C1: media placeholders", () => {
  it("recognises Android <Media omitted> and the Turkish form", () => {
    const r = parseExport(lines(
      android("01/02/24", "09:00", "Alice", "<Media omitted>"),
      android("01/02/24", "09:01", "Bob", "<Medya dahil edilmedi>"),
      android("01/02/24", "09:02", "Bob", "real text"),
    ));
    expect(r.messages.map((m) => [m.kind, m.mediaKind])).toEqual([
      ["media", "Other"], ["media", "Other"], ["text", undefined],
    ]);
    expect(r.report.messagesByKind).toMatchObject({ media: 2, text: 1 });
  });

  it("recognises iOS placeholders, typed by kind", () => {
    const cases: [string, string][] = [
      [`${LRM}image omitted`, "Photos"],
      [`${LRM}video omitted`, "Videos"],
      [`${LRM}audio omitted`, "Voice notes"],
      [`${LRM}sticker omitted`, "Stickers"],
      [`${LRM}GIF omitted`, "GIFs"],
      [`${LRM}Contact card omitted`, "Contacts"],
      [`report.pdf • 6 pages ${LRM}document omitted`, "Documents"],
      [`${LRM}görüntü dahil edilmedi`, "Photos"],
      [`${LRM}ses kaydı dahil edilmedi`, "Voice notes"],
      [`${LRM}<attached: 00000012-PHOTO-2024-01-31-21-05-33.jpg>`, "Photos"],
      [`${LRM}<attached: 00000013-AUDIO-2024-01-31-21-05-34.opus>`, "Voice notes"],
      ["IMG-20240131-WA0001.jpg (file attached)", "Photos"],
      ["VID-20240131-WA0002.mp4 (dosya ekli)", "Videos"],
    ];
    const r = parseExport(lines(...cases.map(([text], i) => ios("31.01.24", `10:${String(i).padStart(2, "0")}:00`, "Alice", text))));
    expect(r.messages.map((m) => m.mediaKind)).toEqual(cases.map(([, kind]) => kind));
  });

  it("does not treat a sentence ending in a placeholder word as media unless WhatsApp marked it", () => {
    const r = parseExport(lines(android("01/02/24", "09:00", "Alice", "the best part of the video omitted")));
    expect(r.messages[0]!.kind).toBe("text");
  });

  it("keeps an unrecognised <…> placeholder as text but reports it, never guessing its kind", () => {
    const r = parseExport(lines(
      android("15/01/24", "10:00", "Alice", "<View once message omitted>"),
      android("15/01/24", "10:01", "Bob", "<Media omitted>"),
      android("15/01/24", "10:02", "Alice", "I <3 you"),
      android("15/01/24", "10:03", "Bob", "<b>bold</b>"),
    ));
    expect(r.messages.map((m) => m.kind)).toEqual(["text", "media", "text", "text"]);
    expect(warning(r, "unknown_placeholder")).toMatchObject({ count: 1, sampleLines: [1] });
    expect(r.report.completeness).toBe("complete");
  });

  it("classifies deleted, unavailable and edited messages", () => {
    const r = parseExport(lines(
      android("01/02/24", "09:00", "Alice", "This message was deleted"),
      android("01/02/24", "09:01", "Bob", "Bu mesaj silindi"),
      android("01/02/24", "09:02", "Bob", "Waiting for this message. This may take a while."),
      android("01/02/24", "09:03", "Alice", "fixed typo <This message was edited>"),
      android("01/02/24", "09:04", "Alice", "düzelttim <Bu mesaj düzenlendi>"),
    ));
    expect(r.messages.map((m) => m.kind)).toEqual(["deleted", "deleted", "unavailable", "text", "text"]);
    expect(r.messages[3]).toMatchObject({ text: "fixed typo", edited: true });
    expect(r.messages[4]).toMatchObject({ text: "düzelttim", edited: true });
    expect(r.report.editedMessages).toBe(2);
  });
});

describe("C2: system events vs ordinary messages", () => {
  it("keeps ordinary sentences that share group-event wording", () => {
    const r = parseExport(lines(
      android("01/02/24", "09:00", "Alice", "I added sugar to the tea"),
      android("01/02/24", "09:01", "Bob", "annem çorbaya tuz ekledi"),
      android("01/02/24", "09:02", "Alice", "you updated the doc?"),
      android("01/02/24", "09:03", "Bob", "Mom removed the stain"),
      android("01/02/24", "09:04", "Alice", "hello"),
      android("01/02/24", "09:05", "Bob", "hi"),
    ));
    expect(r.messages).toHaveLength(6);
    expect(r.systemEvents).toHaveLength(0);
    expect(warning(r, "possible_system_event")?.count).toBe(3);
  });

  it("treats Android sender-less lines as system events, including quoted subjects with colons", () => {
    const r = parseExport(lines(
      android("01/02/24", "09:00", null, "Messages and calls are end-to-end encrypted. No one outside of this chat can read them."),
      android("01/02/24", "09:01", null, "Alice created group \"Trip: 2024\""),
      android("01/02/24", "09:02", null, "Alice added Bob"),
      android("01/02/24", "09:03", null, "Alice changed the subject from \"a: b\" to \"c\""),
      android("01/02/24", "09:04", "Bob", "thanks"),
    ));
    expect(texts(r)).toEqual(["thanks"]);
    expect(r.report.systemEventsByType).toMatchObject({ encryption: 1, group: 3 });
    expect(r.chatType.kind).toBe("group");
  });

  it("uses the iOS LRM mark as evidence for sender-prefixed group events", () => {
    const r = parseExport(lines(
      ios("01.02.24", "09:00:00", "Trip", `${LRM}Messages and calls are end-to-end encrypted.`),
      ios("01.02.24", "09:01:00", "Trip", `${LRM}Alice added Bob`),
      ios("01.02.24", "09:02:00", "Alice", `${LRM}Alice changed the group description`),
      ios("01.02.24", "09:03:00", "Alice", "Bob added sugar"),
      ios("01.02.24", "09:04:00", "Bob", "hi"),
    ));
    expect(texts(r)).toEqual(["Bob added sugar", "hi"]);
    expect(names(r)).toEqual(["Alice", "Bob"]);
  });

  it("treats a sender that only posts system wording (one unmistakable) as the chat itself", () => {
    // The legacy fixture shape: group notices under the group's name, no LRM.
    const r = parseExport(lines(
      android("01/01/24", "09:00", "Alice", "project update"),
      android("01/01/24", "09:01", "Group name", "You were added"),
      android("01/01/24", "09:02", "Group name", "Bakırköy removed you"),
      android("01/01/24", "09:03", "Group name", "Messages and calls are end-to-end encrypted. Only people in this chat can read them."),
      android("01/01/24", "09:04", "Call record", "Missed voice call"),
      android("01/01/24", "09:05", "Call record", "Cevapsız görüntülü arama"),
      android("01/01/24", "09:06", "Alice", "Voice call. 8 sec • You joined"),
      android("01/01/24", "09:07", "You", "You started a video call"),
    ));
    expect(texts(r)).toEqual(["project update"]);
    expect(names(r)).toEqual(["Alice"]);
    expect(r.report.systemEventsByType).toMatchObject({ group: 2, encryption: 1, call: 4 });
  });

  it("does not let a single ambiguous line turn a person into the chat", () => {
    const r = parseExport(lines(
      android("01/02/24", "09:00", "Carol", "Kaan started a voice call"),
      android("01/02/24", "09:01", "Alice", "ok"),
    ));
    expect(names(r)).toEqual(["Carol", "Alice"]);
  });

  it("counts unrecognised sender-less lines instead of hiding them", () => {
    const r = parseExport(lines(
      android("01/02/24", "09:00", "Alice", "a"),
      android("01/02/24", "09:01", null, "something new WhatsApp says"),
    ));
    expect(r.report.systemEventsByType.unknown).toBe(1);
    expect(warning(r, "unrecognized_system_lines")).toBeDefined();
  });
});

describe("C8: chat type", () => {
  it("is unknown for two senders and no group evidence", () => {
    const r = parseExport(lines(
      android("01/02/24", "09:00", "Alice", "a"),
      android("01/02/24", "09:01", "Bob", "b"),
    ));
    expect(r.chatType).toEqual({ kind: "unknown", evidence: [], humanParticipants: 2 });
  });

  it("is a group with three or more human senders", () => {
    const r = parseExport(lines(
      android("01/02/24", "09:00", "Alice", "a"),
      android("01/02/24", "09:01", "Bob", "b"),
      android("01/02/24", "09:02", "Carol", "c"),
    ));
    expect(r.chatType).toMatchObject({ kind: "group", evidence: ["three_or_more_senders"] });
  });

  it("is a group with two senders when group events prove it", () => {
    const r = parseExport(lines(
      android("01/02/24", "09:00", null, "Alice created group \"Book club\""),
      android("01/02/24", "09:01", "Alice", "a"),
      android("01/02/24", "09:02", "Bob", "b"),
    ));
    expect(r.chatType).toMatchObject({ kind: "group", evidence: ["group_events"], humanParticipants: 2 });
  });

  it("does not count Meta AI as a human participant", () => {
    const r = parseExport(lines(
      android("01/02/24", "09:00", "Alice", "a"),
      android("01/02/24", "09:01", "Meta AI", "summary"),
      android("01/02/24", "09:02", "Bob", "b"),
    ));
    expect(r.participants.find((p) => p.name === "Meta AI")?.isMetaAI).toBe(true);
    expect(r.chatType).toMatchObject({ kind: "unknown", humanParticipants: 2 });
  });
});

describe("participants", () => {
  it("keeps names with emoji, phone numbers and directional marks, normalised", () => {
    const r = parseExport(lines(
      android("01/02/24", "09:00", "Eray Kağıthane💅", "a"),
      android("01/02/24", "09:01", "‪+90 555 123 45 67‬", "b"),
      android("01/02/24", "09:02", "Zoé", "c"), // decomposed é
    ));
    expect(names(r)).toEqual(["Eray Kağıthane💅", "+90 555 123 45 67", "Zoé"]);
  });

  it("skips and reports rows whose sender is only directional marks", () => {
    const r = parseExport(lines(
      android("01/02/24", "09:15", LRM, "orphan"),
      android("01/02/24", "09:16", "Alice", "real"),
    ));
    expect(names(r)).toEqual(["Alice"]);
    expect(warning(r, "empty_sender")).toBeDefined();
  });

  it("reports ~ aliases as candidates without merging them", () => {
    const r = parseExport(lines(
      android("01/01/24", "09:00", "~ Eray", "first"),
      android("01/01/24", "09:01", "Eray Kağıthane💅", "second"),
      android("01/01/24", "09:02", "~ Ali", "x"),
      android("01/01/24", "09:03", "Ali One", "y"),
      android("01/01/24", "09:04", "Ali Two", "z"),
    ));
    expect(names(r)).toHaveLength(5);
    expect(r.aliasCandidates).toEqual([
      { alias: 0, candidates: [1], match: "first_name" },
      { alias: 2, candidates: [3, 4], match: "first_name" },
    ]);
  });

  it("keeps a colon inside the message text", () => {
    const r = parseExport(lines(android("01/02/24", "09:00", "Alice", "note: buy milk: 2L")));
    expect(r.messages[0]!.text).toBe("note: buy milk: 2L");
  });
});

describe("unicode", () => {
  it("preserves emoji sequences, RTL text and combining marks in message text", () => {
    const body = "👨‍👩‍👧 🇹🇷 👍🏽 مرحبا İstanbul ğüşöçı";
    const r = parseExport(lines(android("01/02/24", "09:00", "Alice", body)));
    expect(r.messages[0]!.text).toBe(body);
  });

  it("strips WhatsApp's own marks from message text", () => {
    const r = parseExport(lines(ios("01.02.24", "09:00:00", "Alice", `call me ‪+90 555 000 00 00‬`)));
    expect(r.messages[0]!.text).toBe("call me +90 555 000 00 00");
  });
});

describe("robustness", () => {
  it("parses a large export in linear time", () => {
    const rows: string[] = [];
    for (let i = 0; i < 100_000; i++) {
      const day = String((i % 28) + 1).padStart(2, "0");
      rows.push(android(`${day}/01/24`, `${String(i % 24).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}`, `P${i % 7}`, `message ${i}`));
    }
    const started = performance.now();
    const r = parseExport(lines(...rows));
    const elapsed = performance.now() - started;
    expect(r.messages).toHaveLength(100_000);
    expect(elapsed).toBeLessThan(5_000);
  });

  it("survives pathological lines without catastrophic backtracking", () => {
    const evil = "[" + "1".repeat(50_000) + ":" + " ".repeat(50_000);
    const started = performance.now();
    parseExport(lines(evil, android("01/02/24", "09:00", "A", "x".repeat(200_000))));
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it("handles a very long multi-line message", () => {
    const body = Array.from({ length: 20_000 }, (_, i) => `line ${i}`);
    const r = parseExport(lines(android("01/02/24", "09:00", "Alice", body[0]!), ...body.slice(1)));
    expect(r.messages[0]!.text.split("\n")).toHaveLength(20_000);
  });
});
