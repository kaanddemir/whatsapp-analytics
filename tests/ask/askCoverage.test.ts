/* Held-out question coverage: phrasings written for this evaluation, not
   copied from the router's own tests. Each family is checked for routing,
   and the families added here also for the answer itself. Per-family
   routing accuracy is printed (TR and EN separately) so a regression shows
   which family broke; retrieval quality is evaluated elsewhere
   (tests/retrieval/semantic*.test.ts) and is deliberately not mixed in. */
import { afterAll, describe, expect, it } from "vitest";
import { parseExport } from "@/parser";
import { route } from "@/ask/router";
import { answer } from "@/ask/answer";
import { ChatSession } from "@/conversation/session";
import { NO_FILTERS } from "@/model";
import { android, lines } from "../support/export";

const rows: string[] = [];
const add = (d: string, t: string, who: string, text: string) => rows.push(android(d, t, who, text));
add("14/02/23", "20:00", "Ayşe Yılmaz", "sevgililer günün kutlu olsun");
add("14/02/23", "20:05", "Can", "seninki de, akşam yemeğe çıkalım mı");
add("14/02/24", "21:00", "Can", "kusura bakma bugün arayamadım");
add("14/02/24", "21:40", "Ayşe Yılmaz", "tamam");
add("01/03/24", "09:00", "Can", "özür dilerim dün geç kaldım");
add("01/03/24", "09:10", "Ayşe Yılmaz", "sorun değil");
add("03/03/24", "18:00", "Ayşe Yılmaz", "bugün taşınma kutularını aldım, yarın hepsini paketleyip yeni eve götürmeyi düşünüyorum");
add("03/03/24", "18:30", "Can", "süper");
const parsed = parseExport(lines(...rows));
const session = new ChatSession(parsed);
const NOW = Date.UTC(2025, 5, 15);
const plan = (q: string) => route(q, parsed.participants, NOW);
const ask = (q: string, locale: "en" | "tr" = "en") => answer(q, session, NO_FILTERS, undefined, locale, null, NOW);

type Case = readonly [family: string, lang: "tr" | "en", question: string, expected: Record<string, unknown>];
const CAN = 1;
const CASES: readonly Case[] = [
  ["reply speed", "en", "Who takes the longest to reply?", { metric: "response_time", slowest: true }],
  ["reply speed", "tr", "Cevap vermesi en uzun süren kim?", { metric: "response_time", slowest: true }],
  ["reply speed", "en", "who answers quicker", { metric: "response_time" }],
  ["reply speed", "tr", "kim daha geç cevap veriyor", { metric: "response_time", slowest: true }],
  ["reply speed", "tr", "Can ne kadar sürede cevap veriyor?", { metric: "response_time", person: CAN }],
  ["message length", "en", "Who writes longer messages?", { metric: "message_length" }],
  ["message length", "tr", "Kim daha uzun mesaj yazıyor?", { metric: "message_length" }],
  ["message length", "en", "whose texts are shorter", { metric: "message_length" }],
  ["message length", "tr", "Kimin mesajları daha kısa?", { metric: "message_length" }],
  ["message length", "en", "the longest message ever sent", { type: "unsupported", reason: "not_measured" }],
  ["one person's behaviour", "en", "How many times did Can apologise?", { type: "behaviour", behaviour: "apology", person: CAN }],
  ["one person's behaviour", "tr", "Can kaç kez özür diledi?", { type: "behaviour", behaviour: "apology", person: CAN }],
  ["one person's behaviour", "tr", "Ayşe kaç defa iptal etti?", { type: "behaviour", behaviour: "cancellation", person: 0 }],
  ["behaviour comparison", "en", "Who apologizes more, me or Can?", { type: "behaviour", behaviour: "apology", person: null }],
  ["behaviour comparison", "tr", "Kim daha çok özür diliyor?", { type: "behaviour", behaviour: "apology", person: null }],
  ["messages on a day", "tr", "14 Şubat'ta ne konuştuk?", { which: "on_date", day: 14, month: 2, year: null }],
  ["messages on a day", "tr", "3 Mart 2024'te neler konuşmuştuk", { which: "on_date", day: 3, month: 3, year: 2024 }],
  ["messages on a day", "en", "What did we talk about on 14 February?", { which: "on_date", day: 14, month: 2, year: null }],
  ["messages on a day", "en", "show me the messages from 3 March 2024", { which: "on_date", day: 3, month: 3, year: 2024 }],
  ["messages on a day", "tr", "14 Şubat'taki mesajlar", { which: "on_date", day: 14, month: 2 }],
  ["mentions of a date", "tr", "12 Nisan geçen mesajlar", { which: "mentions_date" }],
  ["mentions of a date", "en", "messages mentioning 12 April", { which: "mentions_date" }],
  ["counts", "en", "how many texts did we exchange in 2024", { metric: "message_count" }],
  ["counts", "tr", "2024'te toplam kaç mesaj yazdık", { metric: "message_count" }],
  ["media by person", "en", "Who sends more voice notes?", { metric: "kind_by_person", kind: "Voice notes" }],
  ["media by person", "tr", "Kim daha çok fotoğraf atıyor?", { metric: "kind_by_person", kind: "Photos" }],
  ["night activity", "en", "Who is more active at night?", { metric: "night_owl" }],
  ["night activity", "tr", "Gece kim daha çok yazıyor?", { metric: "night_owl" }],
  ["night activity", "tr", "geçen yıl kim daha çok yazdı", { metric: "messages_by_person" }],
  ["emoji count", "en", "How many emojis did we send?", { metric: "emoji_count" }],
  ["emoji count", "tr", "Kaç emoji kullandık?", { metric: "emoji_count" }],
  ["busiest time", "en", "When are we most active?", { metric: "peak_hour" }],
  ["busiest time", "tr", "En çok ne zaman konuşuyoruz?", { metric: "peak_hour" }],
  ["busiest time", "en", "Which month did we talk the most?", { metric: "busiest_month" }],
  ["busiest time", "tr", "Hangi ay daha çok konuştuk?", { metric: "busiest_month" }],
  ["two periods", "en", "Did we talk more in 2024 than in 2023?", { metric: "compare_periods" }],
  ["two periods", "tr", "2023'te mi 2024'te mi daha çok konuştuk?", { metric: "compare_periods" }],
  ["two periods", "en", "How have our messaging habits changed?", { metric: "trend", aspect: "activity" }],
  ["two periods", "tr", "Mesajlaşma alışkanlıklarımız nasıl değişti?", { metric: "trend", aspect: "activity" }],
  ["two periods", "en", "Compare last month with this month", { metric: "compare_periods" }],
  ["two periods", "tr", "Geçen ay ile bu ayı karşılaştır.", { metric: "compare_periods" }],
  ["change", "en", "Have we been texting less lately?", { metric: "trend", aspect: "activity" }],
  ["change", "tr", "Son aylarda konuşma sıklığımız değişti mi?", { metric: "trend", aspect: "activity" }],
  ["change", "en", "Did our response times change this year?", { metric: "trend", aspect: "response_time" }],
  ["change", "tr", "Cevap verme sürelerimiz değişti mi?", { metric: "trend", aspect: "response_time" }],
  ["change", "en", "Has who starts our conversations changed?", { metric: "trend", aspect: "starter" }],
  ["change", "tr", "Sohbeti kimin başlattığı değişti mi?", { metric: "trend", aspect: "starter" }],
  ["change", "en", "Has the message balance changed recently?", { metric: "trend", aspect: "share" }],
  ["change", "tr", "Mesaj dengemiz son zamanlarda değişti mi?", { metric: "trend", aspect: "share" }],
  ["topics", "en", "What topics do we talk about most?", { type: "unsupported", reason: "topics" }],
  ["topics", "tr", "En çok konuştuğumuz konular neler?", { type: "unsupported", reason: "topics" }],
  ["routine", "en", "Who usually starts conversations?", { metric: "conversation_starter" }],
  ["routine", "tr", "Hangi saatlerde daha aktifiz?", { metric: "peak_hour" }],
  ["phrase by person", "en", "Who uses 'haha' more?", { type: "fact", search: "haha", byPerson: true }],
  ["phrase by person", "tr", "Kim daha çok 'seni seviyorum' yazıyor?", { type: "fact", search: '"seni seviyorum"', byPerson: true }],
  ["phrase by person", "tr", "Kaç kez 'seni seviyorum' dedik?", { type: "fact", search: '"seni seviyorum"' }],
  ["recent period", "en", "What did we talk about yesterday?", { which: "in_period", period: { start: "2025-06-14", end: "2025-06-14" } }],
  ["recent period", "tr", "Dün ne konuştuk?", { which: "in_period", period: { start: "2025-06-14" } }],
  ["recent period", "en", "What did we talk about last week?", { which: "in_period", period: { start: "2025-06-02", end: "2025-06-08" } }],
  ["recent period", "tr", "Mart 2024'te ne konuştuk?", { which: "in_period", period: { start: "2024-03-01", end: "2024-03-31" } }],
  ["recent period", "tr", "Can dün ne yazdı?", { which: "in_period", person: CAN }],
  ["recent period", "tr", "bugün taşınma kutularını aldım mesajını bul", { type: "recall", period: null }],
  ["recent period", "tr", "dün buluşma hakkında ne konuştuk", { type: "fact" }],
  ["last mention", "en", "When was the last time we mentioned Paris?", { which: "last", search: "paris" }],
  ["plans", "en", "Which plans did we discuss?", { type: "timeline" }],
  ["not inferable", "en", "Is she angry at me?", { type: "unsupported", reason: "needs_understanding" }],
  ["not inferable", "tr", "Bana kızgın mı?", { type: "unsupported", reason: "needs_understanding" }],
  ["not inferable", "en", "Does Can love me?", { type: "unsupported", reason: "needs_understanding" }],
  ["not inferable", "tr", "Bu ilişki nereye gidiyor?", { type: "unsupported", reason: "needs_understanding" }],
];

const tally = new Map<string, { tr: [number, number]; en: [number, number] }>();
afterAll(() => {
  const line = ([ok, all]: [number, number]) => all ? `${ok}/${all}` : "–";
  console.info(["family | TR | EN", ...[...tally].map(([f, r]) => `${f} | ${line(r.tr)} | ${line(r.en)}`)].join("\n"));
});

describe("held-out routing, by family", () => {
  it.each(CASES)("%s (%s): %s", (family, lang, q, expected) => {
    const row = tally.get(family) ?? { tr: [0, 0], en: [0, 0] };
    tally.set(family, row);
    row[lang][1]++;
    expect(plan(q)).toMatchObject(expected);
    row[lang][0]++;
  });
});

describe("answers for the families above", () => {
  it("names the slowest replier from the same ranking as the fastest", () => {
    const fast = ask("Who replies faster?"), slow = ask("Who takes the longest to reply?");
    expect(fast.rows.map((r) => r.label)).toEqual(slow.rows.map((r) => r.label));
    expect(slow.text).toContain(`${fast.rows[fast.rows.length - 1]!.label} usually takes longest`);
  });

  it("message length equals the shared per-person words-per-message figure", () => {
    const stats = session.stats(NO_FILTERS), a = ask("Who writes longer messages?");
    const top = [...stats.participants].sort((x, y) => y.wordsPerMessage - x.wordsPerMessage)[0]!;
    expect(a.text).toContain(`${top.name} writes the longest messages`);
    expect(a.text).toContain(String(top.wordsPerMessage));
    expect(a.note).toMatch(/Words per typed text message/);
  });

  it("one person's behaviour is that person's count, with that person's examples", () => {
    const a = ask("How many times did Can apologise?");
    // A chat this small only supports counting matching wording, and the answer says "matches".
    expect(a.text).toMatch(/^I detected 2 (apologies|matches) from Can/);
    expect(a.figure?.value).toBe("2");
    expect(a.evidence.every((e) => e.message.sender === CAN)).toBe(true);
    expect(a.rows.some((r) => r.lead)).toBe(false);
    expect(a.note).toMatch(/not what anyone intended/);
    expect(ask("Can kaç kez özür diledi?", "tr").text).toContain("Can için 2");
  });

  it("a day without a year asks which year when the chat has several, and never guesses", () => {
    for (const [q, locale] of [["What did we talk about on 14 February?", "en"], ["14 Şubat'ta ne konuştuk?", "tr"]] as const) {
      const a = ask(q, locale);
      expect(a.supported, q).toBe(false);
      expect(a.evidence).toHaveLength(0);
      expect(a.text).toMatch(/2023.*2024/);
    }
  });

  it("a day with one candidate year, or a stated year, lists that day's messages in order", () => {
    const inferred = ask("What did we talk about on 3 March?");
    expect(inferred.evidence.map((e) => e.message.id)).toEqual([6, 7]);
    expect(inferred.note).toMatch(/2024 is the only year/);
    const stated = ask("14 Şubat 2024'te ne konuştuk?", "tr");
    expect(stated.evidence.map((e) => e.message.id)).toEqual([2, 3]);
    expect(stated.basis).toBe("count");
  });

  it("a day with no messages says so instead of showing related ones", () => {
    const a = ask("What did we talk about on 5 June 2024?");
    expect(a.evidence).toHaveLength(0);
    expect(a.text).toMatch(/^No messages were sent on 5 June 2024/);
  });

  it("media, night, emoji and phrase comparisons use the same counts as the dashboard and search", () => {
    const night = ask("Who is more active at night?");
    expect(night.text).toMatch(/Nobody wrote between|writes at night the most/);
    const emoji = ask("How many emojis did we send?");
    expect(emoji.figure?.value).toBe(String(session.stats(NO_FILTERS).content.emojiSummary.uses));
    const phrase = ask("Who uses 'tamam' more?");
    expect(phrase.text).toMatch(/^Ayşe Yılmaz wrote “tamam” in the most messages/);
    expect(phrase.rows.find((r) => r.label === "Ayşe Yılmaz")?.value).toBe(`${session.search("tamam", { ...NO_FILTERS, sender: 0 }, "relevance", 0, 0).total} message`);
    const photos = ask("Who sends more photos?");
    expect(photos.text).toMatch(/^No photos were sent/);
  });

  it("compares two years with the dashboard engine, and says when the chat covers only part of one", () => {
    const a = ask("Did we talk more in 2024 than in 2023?");
    const y23 = session.stats({ start: "2023-01-01", end: "2023-12-31", sender: null }).kpis.totalMessages;
    const y24 = session.stats({ start: "2024-01-01", end: "2024-12-31", sender: null }).kpis.totalMessages;
    expect([y23, y24]).toEqual([2, 6]);
    expect(a.text).toBe("2024 had more messages than 2023: 6 against 2.");
    expect(a.note).toMatch(/covers only part of 2024, 2023/);
    expect(ask("2023'te mi 2024'te mi daha çok konuştuk?", "tr").text).toContain("2024 döneminde 2023 dönemine göre daha çok mesaj var: 6 / 2");
  });

  it("lists a period's messages in order, never searching for the word 'yesterday'", () => {
    const march = ask("Mart 2024'te ne konuştuk?", "tr");
    expect(march.evidence.map((e) => e.message.id)).toEqual([4, 5, 6, 7]);
    expect(march.basis).toBe("count");
    const y = ask("What did we talk about yesterday?");
    expect(y.evidence).toHaveLength(0);
    expect(y.text).toMatch(/^No messages were sent/);
  });

  it("feelings are refused, not answered with related messages", () => {
    for (const q of ["Is she angry at me?", "Bana kızgın mı?"]) {
      const a = ask(q);
      expect(a.supported).toBe(false);
      expect(a.evidence).toHaveLength(0);
    }
  });

  it("respects the participant filter on a day", () => {
    const a = answer("What did we talk about on 3 March 2024?", session, { ...NO_FILTERS, sender: CAN }, undefined, "en", null, NOW);
    expect(a.evidence.map((e) => e.message.id)).toEqual([7]);
  });
});
