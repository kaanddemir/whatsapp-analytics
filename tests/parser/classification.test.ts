/* Paired classification tests: each genuine export form next to a
   message a person could plausibly type. Expectations come from these sources,
   not from running the parser:
   [258]  Pustur/whatsapp-chat-parser#258 (iOS, 2024): notices attributed to
          the group name with an LRM, or to the actor with the actor's own
          name first and no LRM.
   [260]  Pustur/whatsapp-chat-parser#260 / #231 (Android with media): an LRM,
          "<file> (file attached)", caption on the next line.
   [TL]   timelinize datasources/whatsapp/testdata/fixtures/_chat.txt (iOS):
          "‎Video call, ‎5 min", "‎Missed voice call", "‎<attached: …>" after a
          document title, phone-number change attributed to a person.
   [CA]   mlomb/chat-analytics WhatsApp.ts: "<image omitted>"-style and
          "<Medya atlanmış>" placeholders.
   [LEG]  legacy tests (synthetic; the Turkish wording is not source-verified).
   All names and texts here are synthetic. */
import { describe, expect, it } from "vitest";
import { analyze } from "@/analytics";
import { NO_FILTERS, type ParseResult } from "@/model";
import { parseExport } from "@/parser";
import { LRM, android, ios, lines } from "../support/export";

/** How one row came out: a system event type, or the message kind. */
function classify(parsed: ParseResult, at: number) {
  const event = parsed.systemEvents.find((e) => e.ts === at);
  if (event) return `system:${event.type}`;
  const m = parsed.messages.find((x) => x.ts === at);
  return m ? (m.kind === "media" ? `media:${m.mediaKind}` : m.kind) : "missing";
}

// The row under test at 10:05, padded with ordinary messages from both people
// so no sender looks like the chat itself unless the case says so.
const IOS_AT = Date.UTC(2024, 7, 14, 10, 5);
function iosRow(sender: string, body: string) {
  const parsed = parseExport(lines(
    ios("14.08.24", "10:00:00", "Ann", "hi"),
    ios("14.08.24", "10:01:00", "Boris", "hello"),
    ios("14.08.24", "10:05:00", sender, body),
    ios("14.08.24", "10:06:00", "Ann", "ok"),
    ios("14.08.24", "10:07:00", "Boris", "ok"),
  ));
  return { parsed, kind: classify(parsed, IOS_AT), warned: parsed.report.warnings.some((w) => w.code === "possible_system_event") };
}
const ANDROID_AT = Date.UTC(2024, 7, 14, 10, 5);
function androidRow(sender: string | null, body: string) {
  const parsed = parseExport(lines(
    android("14/08/2024", "10:00", "Ann", "hi"),
    android("14/08/2024", "10:01", "Boris", "hello"),
    android("14/08/2024", "10:05", sender, body),
    android("14/08/2024", "10:06", "Ann", "ok"),
  ));
  return { parsed, kind: classify(parsed, ANDROID_AT) };
}

describe("system events vs look-alike messages", () => {
  it("[258] notices under the group name, marked with an LRM", () => {
    // The group name posts only notices, so it is the chat, not a person.
    const parsed = parseExport(lines(
      ios("14.08.24", "21:00:10", "Trip Group", `${LRM}Messages and calls are end-to-end encrypted. No one outside of this chat, not even WhatsApp, can read or listen to them.`),
      ios("14.08.24", "21:00:11", "Trip Group", `${LRM}Boris added you`),
      ios("14.08.24", "21:01:57", "Trip Group", `${LRM}You're now an admin`),
      ios("14.08.24", "21:02:00", "Ann", "hi all"),
    ));
    expect(parsed.systemEvents.map((e) => e.type)).toEqual(["encryption", "group", "group"]);
    expect(parsed.participants.map((p) => p.name)).toEqual(["Ann"]);
    expect(parsed.chatType.kind).toBe("group");
  });

  it("[258] actions attributed to the actor, actor's name first, no LRM", () => {
    expect(iosRow("Boris", "Boris created group “Trip Group”").kind).toBe("system:group");
    expect(iosRow("Boris", "Boris changed this group's icon").kind).toBe("system:group");
    // A person writing about the same thing stays a message.
    expect(iosRow("Boris", "I changed this group's icon, like it?").kind).toBe("text");
    expect(iosRow("Ann", "Boris created group chats for every trip").kind).toBe("text");
  });

  it("group description: confirmed notice vs a person talking about it", () => {
    expect(iosRow("Trip Group", `${LRM}Ann changed the group description`).kind).toBe("system:group");
    expect(iosRow("Ann", "Ann changed the group description").kind).toBe("system:group"); // [258] self-name form
    const typed = iosRow("Ann", "I changed the group description, check it");
    expect(typed.kind).toBe("text");
    expect(typed.warned).toBe(true); // template wording without evidence is flagged, not dropped
  });

  it("[TL] call records vs people discussing calls", () => {
    expect(iosRow("Ann", `${LRM}Video call, ${LRM}5 min`).kind).toBe("system:call");
    expect(iosRow("Ann", `${LRM}Missed voice call`).kind).toBe("system:call");
    expect(iosRow("Ann", "can we do a video call later?").kind).toBe("text");
    expect(iosRow("Ann", "that video call was 5 min too long").kind).toBe("text");
  });

  it("[TL] a phone-number notice attributed to a person", () => {
    expect(iosRow("Ann", `${LRM}Boris changed their phone number to a new number`).kind).toBe("system:security");
  });

  it("Android: sender-less lines are notices; the same words from a person are not", () => {
    expect(androidRow(null, "Boris added Carol").kind).toBe("system:group");
    expect(androidRow(null, "Missed voice call").kind).toBe("system:call");
    expect(androidRow("Ann", "I added sugar to the list").kind).toBe("text");
  });

  it("[LEG] Turkish (wording from legacy tests, not source-verified)", () => {
    expect(iosRow("Gezi Grubu", `${LRM}Ayşe grubu oluşturdu`).kind).toBe("system:group");
    expect(androidRow(null, "Ayşe gruptan ayrıldı").kind).toBe("system:group");
    expect(androidRow("Ann", "annem çorbaya tuz ekledi").kind).toBe("text");
  });

  it("a multi-line message is never a notice", () => {
    expect(iosRow("Ann", `Boris added Carol\nwhy though`).kind).toBe("text");
  });
});

describe("media placeholders vs ordinary text", () => {
  it("[260] Android attachment with its caption on the next line", () => {
    expect(androidRow("Ann", `${LRM}IMG-20240814-WA0001.jpg (file attached)\nnice view`).kind).toBe("media:Photos");
    expect(androidRow("Ann", `${LRM}0d1f.jpg (file attached)`).kind).toBe("media:Photos");
    expect(androidRow("Ann", "I sent the photo (file attached) yesterday\nok?").kind).toBe("text");
  });

  it("[TL] iOS attachments and document rows", () => {
    expect(iosRow("Ann", `${LRM}<attached: some-image.jpg>`).kind).toBe("media:Photos");
    expect(iosRow("Ann", `A PDF.pdf • ${LRM}1 page ${LRM}<attached: some-doc.pdf>`).kind).toBe("media:Documents");
    expect(iosRow("Ann", `${LRM}image omitted`).kind).toBe("media:Photos");
  });

  it("[CA] bracketed and Turkish placeholders", () => {
    expect(androidRow("Ann", "<Media omitted>").kind).toBe("media:Other");
    expect(androidRow("Ann", "<video omitted>").kind).toBe("media:Videos");
    expect(androidRow("Ann", "<Medya dahil edilmedi>").kind).toBe("media:Other");
    expect(androidRow("Ann", "<Medya atlanmış>").kind).toBe("media:Other");
  });

  it("ordinary text with media words stays text", () => {
    for (const body of ["the best part of the video omitted", "image omitted from the report?", "send me the <attached: file> thing", "photo"]) {
      expect(androidRow("Ann", body).kind).toBe("text");
    }
  });

  it("[TL] deleted, edited and unavailable", () => {
    expect(iosRow("Ann", `${LRM}You deleted this message.`).kind).toBe("deleted");
    expect(iosRow("Ann", `${LRM}This message was deleted.`).kind).toBe("deleted");
    expect(iosRow("Ann", "Waiting for this message. This may take a while.").kind).toBe("unavailable");
    const edited = iosRow("Ann", `An edited message ${LRM}<This message was edited>`);
    expect(edited.kind).toBe("text");
    expect(edited.parsed.messages.find((m) => m.ts === IOS_AT)).toMatchObject({ text: "An edited message", edited: true });
  });
});

describe("analytics see the corrected classification", () => {
  it("confirmed notices are out of every message count; messages and media are in", () => {
    const parsed = parseExport(lines(
      ios("14.08.24", "09:00:00", "Trip Group", `${LRM}Messages and calls are end-to-end encrypted. No one outside of this chat, not even WhatsApp, can read or listen to them.`),
      ios("14.08.24", "09:00:01", "Boris", "Boris created group “Trip Group”"),
      ios("14.08.24", "09:01:00", "Ann", "hi"),
      ios("14.08.24", "09:02:00", "Boris", `${LRM}Video call, ${LRM}5 min`),
      ios("14.08.24", "09:03:00", "Ann", `A PDF.pdf • ${LRM}1 page ${LRM}<attached: plan.pdf>`),
      ios("14.08.24", "09:04:00", "Boris", "I changed the group description, check it"),
      ios("14.08.24", "09:05:00", "Ann", `${LRM}This message was deleted.`),
    ));
    const stats = analyze(parsed, NO_FILTERS);
    expect(parsed.report.systemEvents).toBe(3);
    expect(stats.kpis.totalMessages).toBe(4);
    expect(stats.kpis.messagesByKind).toEqual({ text: 2, media: 1, deleted: 1, unavailable: 0 });
    expect(stats.content.media.items).toEqual([{ key: "Documents", count: 1 }]);
    expect(stats.timing.hours[9]).toBe(4);
    expect(stats.participants.map((p) => [p.name, p.messages])).toEqual([["Ann", 3], ["Boris", 1]]);
    expect(stats.meta.chatType.kind).toBe("group");
    // Filters do not change the chat type, and a sender filter sees only Boris's message.
    const boris = analyze(parsed, { ...NO_FILTERS, sender: parsed.participants.findIndex((p) => p.name === "Boris") });
    expect(boris.kpis.totalMessages).toBe(1);
    expect(boris.meta.chatType.kind).toBe("group");
  });
});
