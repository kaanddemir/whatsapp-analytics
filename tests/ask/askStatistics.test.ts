/* Ask and Genel Bakış answer the same statistic from the same engine
   (session.stats): every figure below equals the dashboard's own value, and
   questions that only look like statistics are not answered with unrelated
   messages. Regression tests for questions that used to be misrouted. */
import { describe, expect, it } from "vitest";
import { parseExport } from "@/parser";
import { route } from "@/ask/router";
import { answer } from "@/ask/answer";
import { ChatSession } from "@/conversation/session";
import { NO_FILTERS } from "@/model";
import { android, lines } from "../support/export";

const rows: string[] = [];
const add = (d: string, t: string, who: string, text: string) => rows.push(android(d, t, who, text));
add("10/01/24", "09:00", "Ayşe Yılmaz", "günaydın 😀");
add("10/01/24", "09:30", "Can", "günaydın, kahve içelim mi 😀😀");
add("11/01/24", "21:00", "Ayşe Yılmaz", "IMG-20240111-WA0001.jpg (file attached)");
add("11/01/24", "21:10", "Can", "çok güzel kahve ☕");
add("12/01/24", "21:00", "Can", "IMG-20240112-WA0002.jpg (file attached)");
add("12/01/24", "21:05", "Ayşe Yılmaz", "Bu mesaj silindi");
add("20/02/24", "10:00", "Ayşe Yılmaz", "kahve sonra");
add("05/05/25", "10:00", "Can", "PTT-20250505-WA0003.opus (file attached)");
add("06/05/25", "10:20", "Ayşe Yılmaz", "tamam");
const parsed = parseExport(lines(...rows));
const session = new ChatSession(parsed);
const NOW = Date.UTC(2025, 5, 15);
const ask = (q: string, locale: "en" | "tr" = "en") => answer(q, session, NO_FILTERS, undefined, locale, null, NOW);
const plan = (q: string) => route(q, parsed.participants, NOW);
const whole = session.stats(NO_FILTERS);

describe("dashboard statistics are reachable in words, Turkish and English", () => {
  it.each([
    ["How many photos did we send?", "message_count", "Photos"], ["Kaç fotoğraf gönderdik?", "message_count", "Photos"],
    ["How many voice notes did Can send?", "message_count", "Voice notes"], ["Kaç sesli mesaj var?", "message_count", "Voice notes"],
    ["How many deleted messages are there?", "message_count", "deleted"], ["Kaç mesaj silindi?", "message_count", "deleted"],
    ["Who replies faster?", "response_time", null], ["Kim daha hızlı cevap veriyor?", "response_time", null],
    ["What time do we usually talk?", "peak_hour", null], ["Genelde saat kaçta konuşuyoruz?", "peak_hour", null],
    ["Which weekday is the most active?", "busiest_weekday", null], ["Haftanın hangi günü daha çok konuşuyoruz?", "busiest_weekday", null],
    ["Which emoji do we use most?", "top_emoji", null], ["En çok hangi emojiyi kullanıyoruz?", "top_emoji", null],
    ["What are our most used words?", "top_words", null], ["En çok kullandığımız kelimeler neler?", "top_words", null],
    ["What is our longest streak?", "longest_streak", null], ["En uzun kaç gün üst üste konuştuk?", "longest_streak", null],
    ["How many days did we talk?", "active_days", null], ["Kaç gün konuştuk?", "active_days", null],
    ["How long have we been chatting?", "chat_span", null], ["İlk mesajımız ne zamandı?", "chat_span", null],
    ["Who usually starts the conversation?", "conversation_starter", null], ["Sohbeti genelde kim başlatıyor?", "conversation_starter", null],
    ["Who texts first more often?", "conversation_starter", null], ["Who talks the most?", "messages_by_person", null],
    ["how many msgs in 2024", "message_count", null],
  ] as const)("%s -> %s", (q, metric, kind) => expect(plan(q)).toMatchObject({ type: "statistic", metric, ...(kind ? { kind } : {}) }));

  it("applies 'last month' and 'geçen yıl' to counts, not only to recall", () => {
    expect(plan("How many messages did we send last month?")).toMatchObject({ metric: "message_count", period: { start: "2025-05-01", end: "2025-05-31" } });
    expect(plan("geçen yıl kim daha çok yazdı")).toMatchObject({ metric: "messages_by_person", period: { start: "2024-01-01", end: "2024-12-31" } });
    // May 2025 holds two messages; the whole chat holds nine.
    expect(ask("How many messages did we send last month?").figure?.value).toBe("2");
  });

  it("asks for plans in question form too", () => {
    for (const q of ["What plans did we make?", "Hangi planları yaptık?"]) expect(plan(q).type, q).toBe("timeline");
  });

  it("does not answer an unmeasured count or comparison with related messages", () => {
    for (const q of ["Who sent the longest message?", "En uzun mesajı kim attı?"]) {
      expect(plan(q), q).toMatchObject({ type: "unsupported", reason: "not_measured" });
      expect(ask(q).evidence).toHaveLength(0);
    }
  });

  it("'what did we say' is not a request for replies", () => {
    expect(plan("what did we say about coffee")).not.toMatchObject({ reply: true });
    expect(plan("What did she say when I asked about coffee?")).toMatchObject({ type: "recall", reply: true });
  });
});

describe("figures equal the dashboard's", () => {
  it("kind counts", () => {
    const photos = whole.content.media.items.find((i) => i.key === "Photos")!.count;
    expect(photos).toBe(2);
    expect(ask("How many photos did we send?").figure?.value).toBe(String(photos));
    expect(ask("How many deleted messages are there?").figure?.value).toBe(String(whole.kpis.messagesByKind.deleted));
    expect(ask("How many media files did Can send?").text).toMatch(/^Can sent 2 media files/);
    expect(ask("Kaç fotoğraf gönderdik?", "tr").text).toContain("2 fotoğraf");
  });
  it("reply times compare everyone, with the method stated", () => {
    const a = ask("Who replies faster?");
    expect(a.rows.map((r) => r.label).sort()).toEqual(whole.participants.filter((p) => p.responseTime.median !== null).map((p) => p.name).sort());
    expect(a.rows.every((r) => !r.lead)).toBe(true);
    expect(a.note).toMatch(/gap from someone else/);
  });
  it("hour, weekday, emoji, words, streak, active days and span", () => {
    expect(ask("What time do we usually talk?").text).toContain(`${String(whole.kpis.peakHour).padStart(2, "0")}:00`);
    expect(ask("Which emoji do we use most?").text).toContain(whole.content.topEmojis[0]!.key);
    expect(ask("What are our most used words?").text).toContain(whole.content.topKeywords[0]!.key);
    expect(ask("How many days did we talk?").figure?.value).toBe(String(whole.kpis.activeDays));
    expect(ask("What is our longest streak?").figure?.value).toBe(String(whole.insights.longestStreak.days));
    const span = ask("When was our first message?");
    expect(span.evidence[0]!.message.id).toBe(0);
    expect(span.text).toMatch(/sent by Ayşe Yılmaz/);
  });
  it("respects the participant filter where it applies, and says so", () => {
    const a = answer("How many photos did we send?", session, { ...NO_FILTERS, sender: 1 }, undefined, "en", null, NOW);
    expect(a.figure?.value).toBe("1");
    const r = answer("Who replies faster?", session, { ...NO_FILTERS, sender: 1 }, undefined, "en", null, NOW);
    expect(r.note).toMatch(/doesn’t apply to this comparison/);
  });
});
