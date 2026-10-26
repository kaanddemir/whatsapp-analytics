/* Deterministic questions: deterministic question routing. Supported questions get the
   right plan and numbers that equal an independent count over the same
   messages; a reason or decision gets related messages with the limitation
   stated; judgements and syntheses are refused, not guessed. */
import { describe, expect, it } from "vitest";
import { parseExport } from "@/parser";
import { route } from "@/ask/router";
import { answer } from "@/ask/answer";
import { ChatSession } from "@/conversation/session";
import { NO_FILTERS } from "@/model";
import { android, lines } from "../support/export";
import { en } from "@/i18n/en";

const rows: string[] = [];
const add = (d: string, t: string, who: string, text: string) => rows.push(android(d, t, who, text));
add("10/01/23", "09:00", "Ayşe Yılmaz", "Paris'e gitmeyi düşünüyorum");
add("10/01/23", "09:05", "Can", "paris çok pahalı ama");
add("15/03/24", "10:00", "Ayşe Yılmaz", "yarın buluşalım mı?");
add("15/03/24", "10:02", "Can", "olur");
add("16/03/24", "11:00", "Ayşe Yılmaz", "12 Nisan'da konser var");
add("20/03/24", "12:00", "Can", "kusura bakma, geç kaldım");
add("21/03/24", "12:00", "Can", "tatil planı ne oldu");
add("22/03/24", "12:00", "Ayşe Yılmaz", "tatil için Antalya'ya bakıyorum");
add("01/05/24", "08:00", "Can", "Paris fotoğraflarını gördün mü");
const parsed = parseExport(lines(...rows));
const session = new ChatSession(parsed);
const ask = (q: string) => answer(q, session, NO_FILTERS);

describe("routing", () => {
  const plan = (q: string) => route(q, parsed.participants);
  it.each([
    ["Who sent more messages?", "statistic"], ["Kim daha çok mesaj attı?", "statistic"],
    ["How many messages did we send in 2023?", "statistic"], ["2024'te kaç mesaj var?", "statistic"],
    ["Which month was busiest?", "statistic"], ["Who starts conversations more?", "statistic"],
    ["Who suggests meeting more often?", "behaviour"], ["Kim daha çok buluşma öneriyor?", "behaviour"],
    ["Who apologizes more?", "behaviour"], ["Kim daha çok özür diliyor?", "behaviour"],
    ["Find messages about the holiday", "fact"], ["tatil hakkındaki mesajlar", "fact"],
    ["When did we first talk about Paris?", "temporal"], ["Paris'ten ilk ne zaman bahsettik?", "temporal"],
    ["Show messages mentioning 12 April", "temporal"], ["12 Nisan geçen mesajlar", "temporal"],
  ])("%s -> %s", (q, type) => expect(plan(q).type).toBe(type));

  it.each([
    "Does she love me?", "How does he feel about me?", "Bana gerçekten aşık mı?", "Kim daha çok erteliyor?", "Who postpones plans more?",
  ])("refuses: %s", (q) => expect(plan(q).type).toBe("unsupported"));

  // Summary questions retrieve messages and explicitly state the limitation.
  it.each(["Summarise last summer", "What were our main disagreements?", "Tartışmalarımızı özetle"])("finds messages for a summary: %s", (q) =>
    expect(plan(q)).toMatchObject({ type: "recall", limitation: "summary" }));

  it.each([
    ["Why did we stop talking about Paris?", "reason"], ["Tatil için neden Antalya'yı seçtik?", "reason"],
    ["What did we decide about the holiday?", "decision"], ["Yaz tatili için nereye gitmeye karar verdik?", "decision"],
  ] as const)("finds related messages for a reason or decision it cannot state: %s", (q, limitation) => expect(plan(q)).toMatchObject({ type: "recall", limitation, fallback: false }));

  it.each([
    "When is the cat's vet appointment?", "What's the wifi password at the cabin?", "Kedinin veteriner randevusu ne zaman?",
    "Yazlıktaki internet şifresi neydi?", "Paris", "asdf qwerty",
  ])("treats a question no pattern recognises as finding related messages: %s", (q) => expect(plan(q)).toMatchObject({ type: "recall", fallback: true, limitation: null }));

  it("keeps first and last mentions on their exact path, however the question is phrased", () => {
    for (const q of ["When did we last mention Paris?", "When did we first mention Paris?", "When did we last talk about Paris?"]) expect(plan(q), q).toMatchObject({ type: "temporal", search: "paris" });
    expect(ask("When did we last mention Paris?").evidence[0]!.message.id).toBe(8);
  });

  it("recognises people by full or first name, with Turkish suffixes", () => {
    expect(route("Ayşe'nin kaç mesajı var?", parsed.participants)).toMatchObject({ type: "statistic", metric: "message_count", person: 0 });
    expect(route("How many messages did Can send?", parsed.participants)).toMatchObject({ person: 1 });
  });
});

describe("answers are computed, not estimated", () => {
  it("message counts per person and per period", () => {
    const a = ask("Who sent more messages?");
    expect(a.text).toBe("Can sent the most messages in the whole chat.");
    expect(a.rows).toEqual([{ label: "Can", value: "5 messages", detail: "56%", lead: true, share: 56, magnitude: 5 }, { label: "Ayşe Yılmaz", value: "4 messages", detail: "44%", lead: false, share: 44, magnitude: 4 }]);
    expect(a.basis).toBe("count");
    expect(ask("How many messages did we send in 2023?").text).toBe("There are 2 messages in 2023.");
    expect(ask("Ayşe kaç mesaj attı?").text).toBe("Ayşe Yılmaz sent 4 messages in the whole chat.");
    expect(ask("How many messages in March 2024?").text).toBe("There are 6 messages in March 2024.");
  });

  it("first and last mention, with the cited message", () => {
    const a = ask("When did we first talk about Paris?");
    expect(a.evidence[0]!.message.id).toBe(0);
    expect(a.evidenceTotal).toBe(3);
    expect(a.text).toContain("10 Jan 2023 at 09:00");
    expect(ask("last message about paris").evidence[0]!.message.id).toBe(8);
  });

  it("topic search totals are exact", () => {
    const a = ask("tatil hakkındaki mesajlar");
    expect(a.evidenceTotal).toBe(2);
    expect(a.result).toMatchObject({ kind: "search", query: "tatil" });
  });

  it("date mentions", () => {
    const a = ask("12 Nisan geçen mesajlar");
    expect(a.evidence.map((e) => e.message.id)).toEqual([4]);
  });

  it("behaviour: validated comparisons give rates, wording categories say they cannot compare", () => {
    expect(ask("Kim daha çok buluşma öneriyor?").text).toContain("too few");
    const apology = ask("Who apologizes more?");
    expect(apology.supported).toBe(true);
    expect(apology.result).toMatchObject({ kind: "behaviour", value: { status: "wording" } });
    // Wording counts are matches, never named as the behaviour, and the note says why.
    expect(apology.rows.find((r) => r.label === "Can")).toMatchObject({ value: "1 match", detail: expect.stringMatching(/per 100 messages$/) });
    expect(apology.text).toContain("can’t reliably compare");
    expect(apology.note).toBe(en.a_wordingNote);
  });

  it("a decision question gets the related messages and says the decision itself is not stated", () => {
    // Words only here (no model): the Turkish chat is asked in Turkish.
    const a = ask("Tatil konusunda ne karar verdik?");
    expect(a.supported).toBe(true);
    expect(a.text).toBe(en.r_decision.replace("{scope}", en.a_whole));
    expect(a.evidence.map((e) => e.message.id)).toEqual(expect.arrayContaining([6, 7]));
    const why = ask("Why did we stop talking about Paris?");
    expect(why.text).toBe(en.r_reason.replace("{scope}", en.a_whole));
    expect(why.evidence.map((e) => e.message.id)).toEqual(expect.arrayContaining([0, 1, 8]));
  });

  it("judgements are refused with a way forward", () => {
    const a = ask("Does she love me?");
    expect(a.supported).toBe(false);
    expect(a.evidence).toEqual([]);
  });
});

describe("chat-native requests", () => {
  it.each(["Show our plans", "Planlarımızı göster", "Planları göster", "Show plans in March 2024"])("routes explicit plan messages: %s", (q) => {
    const a = ask(q);
    expect(a.plan.type).toBe("timeline");
    expect(a.result).toMatchObject({ kind: "timeline", needsRange: false });
  });
  it.each(["Show our plans from last summer", "Geçen yazki planlarımızı göster", "Show plans tomorrow", "Show plans April", "Show plans between March 2024 and April 2024", "Show plans from 2023"])("asks for dates instead of inventing a period: %s", (q) => {
    const a = ask(q);
    expect(a.supported).toBe(false);
    expect(a.result).toMatchObject({ kind: "timeline", needsRange: true, page: null });
    expect(a.evidence).toHaveLength(0);
  });
  it.each(["Show confirmed plans", "Show cancelled plans", "Show plans about our relationship"])("does not infer plan outcomes: %s", (q) => {
    expect(ask(q).supported).toBe(false);
  });
  it("preserves exact literal terms and quotes independently of the interface language", () => {
    for (const locale of ["en", "tr"] as const) {
      const a = answer('Ara: "Paris fotoğraflarını"', session, NO_FILTERS, undefined, locale);
      expect(a.result).toMatchObject({ kind: "search", query: '"Paris fotoğraflarını"' });
      expect(a.evidenceTotal).toBe(1);
      expect(a.evidence[0]!.message.id).toBe(8);
    }
  });
  it("answers a bare topic with related messages, and suggests a question for input that matches nothing", () => {
    const a = ask("Paris");
    expect(a).toMatchObject({ supported: true, basis: "match", result: { kind: "recall" } });
    expect(a.evidence.map((e) => e.message.id)).toEqual(expect.arrayContaining([0, 1, 8]));
    // An exact count stays the keyword search's job.
    expect(ask("Find messages about Paris").evidenceTotal).toBe(3);
    const none = ask("asdf qwerty");
    expect(none.supported).toBe(false); expect(none.evidence).toEqual([]); expect(none.result).toBeNull();
    expect(none.note).toBe("You could ask “Find messages about asdf qwerty” instead.");
    // A longer question with no matching word is looked up, and the answer says nothing was found.
    const long = ask("Could you tell me something interesting here please");
    expect(long).toMatchObject({ supported: true, evidence: [], text: en.r_none.replace("{scope}", en.a_whole) });
  });
  it("answers the busiest calendar day from the dashboard highlight", () => {
    for (const q of ["En çok hangi gün konuşmuşuz?", "Which day did we talk the most?", "Busiest day?"]) expect(route(q, parsed.participants), q).toMatchObject({ type: "statistic", metric: "busiest_day" });
    const a = ask("Which day did we talk the most?"), day = session.stats(NO_FILTERS).highlights.busiestDay!;
    expect(a.supported).toBe(true);
    expect(a.text).toContain(`with ${day.count} messages`);
    expect(answer("En çok hangi gün konuşmuşuz?", session, NO_FILTERS, undefined, "tr").text).toMatch(/^Sohbetin tamamı kapsamında en çok .+ günü konuşmuşsunuz: o gün \d+ mesaj gönderildi\.$/);
  });
  it("attaches the actual scope for paging while retaining all-person behavior comparisons", () => {
    const scoped = { start: "2024-03-01", end: "2024-03-31", sender: 0 };
    const fact = answer("Search: tatil", session, scoped);
    expect(fact.result).toMatchObject({ kind: "search", filters: scoped });
    expect(fact.evidenceTotal).toBe(1);
    const b = answer("Who apologizes more?", session, scoped);
    expect(b.result).toMatchObject({ kind: "behaviour", filters: { ...scoped, sender: null }, value: { status: "wording" } });
  });
});
