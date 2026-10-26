import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import dev from "../fixtures/language/dev.json";
import integrity from "../fixtures/language/integrity.json";
import { detect, type Behaviour } from "@/behaviour/rules";
import { route, findPerson } from "@/ask/router";
import { answer } from "@/ask/answer";
import { ChatSession } from "@/conversation/session";
import { NO_FILTERS } from "@/model";
import { parseExport } from "@/parser";
import { collapseStretch, foldAligned } from "@/text/fold";
import { android, lines } from "../support/export";

const people = [{ id: 0, name: "Ayşe Yılmaz", isMetaAI: false }, { id: 1, name: "Can", isMetaAI: false }];
const NOW = Date.parse(dev.now);
describe("independent language development regressions", () => {
  it.each(dev.behaviour)("$lang $behaviour: $text", c => {
    expect(detect(c.behaviour as Behaviour, c.text, { prevOther: "prev" in c ? c.prev : undefined })).toBe(c.label);
  });
  it.each(dev.router)("$lang operation and scope: $question", c => {
    expect(route(c.question, people, NOW)).toMatchObject(c.expected);
  });
  it.each(dev.context)("acceptance attribution for $texts", c => {
    const parsed = parseExport(lines(...c.texts.map((t, i) => android("12/04/24", "09:00", ["Ayşe Yılmaz", "Can", "Deniz"][c.senders[i]!]!, t))));
    parsed.messages.forEach((m, i) => { (m as { ts: number }).ts += c.minutes[i]! * 60_000; });
    const session = new ChatSession(parsed);
    const ids = [...session.behaviourMatches().flags].flatMap((f, i) => f & 2 ? [i] : []);
    expect(ids).toEqual(c.gold);
    for (const id of ids) expect(session.parsed.messages[id]!.sender).toBe(c.senders[id]);
  });
  it("verifies the final fixture hash without evaluating its labels", () => {
    expect(createHash("sha256").update(readFileSync(new URL("../fixtures/language/final.json", import.meta.url))).digest("hex")).toBe(integrity.sha256);
  });
  it("keeps proper-name ambiguity, apostrophe suffixes and Turkish I folding bounded", () => {
    expect(findPerson("Can’ın mesajları", people)).toBe(1);
    expect(findPerson("Ayşe Yılmaz'ın mesajları", people)).toBe(0);
    expect(findPerson("Canan kaç mesaj attı?", people)).toBeNull();
    expect(findPerson("Ayşe kaç mesaj attı?", [...people, { id: 2, name: "Ayşe Kaya", isMetaAI: false }])).toBeNull();
    expect(foldAligned("IĞDIR İSTANBUL")).toBe("igdir istanbul");
    expect(collapseStretch(foldAligned("buluşmayalııım"))).toBe("bulusmayalim");
  });
  it("counts messages sent on a date, excludes mentions elsewhere, and refuses ambiguous date order", () => {
    const session = new ChatSession(parseExport(lines(
      android("12/04/24", "09:00", "Can", "hello"),
      android("12/04/24", "09:01", "Ayşe Yılmaz", "hi"),
      android("13/04/24", "09:00", "Can", "April 12 was nice"),
    )));
    for (const locale of ["en", "tr"] as const) {
      const a = answer("How many messages on April 12, 2024?", session, NO_FILTERS, undefined, locale, null, NOW);
      expect(a.plan).toMatchObject({ type: "statistic", metric: "message_count", period: { start: "2024-04-12", end: "2024-04-12" } });
      expect(a.figure?.value).toBe("2");
      expect(answer("How many messages on 03/04/2024?", session, NO_FILTERS, undefined, locale, null, NOW).supported).toBe(false);
    }
  });
});
