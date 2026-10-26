import { describe, expect, it } from "vitest";
import { parseExport } from "@/parser";
import { answer } from "@/ask/answer";
import { ChatSession } from "@/conversation/session";
import { NO_FILTERS } from "@/model";
import { android, lines } from "../support/export";
import { errorMessage } from "@/ui/errors";

const parsed = parseExport(lines(
  android("13/01/24", "09:00", "Ayşe", "yarın kahveye gidelim mi?"),
  android("13/01/24", "09:02", "Can", "olur, saat 19:30 uygun"),
  android("14/01/24", "10:00", "Ayşe", "12 Nisan'da konser var"),
  android("14/01/24", "10:01", "Can", "kusura bakma, geç kaldım"),
));
const session = new ChatSession(parsed);
const questions = [
  "Who sent more messages?", "Kim daha çok mesaj attı?", "How many messages in January 2024?",
  "Which month was busiest?", "Who starts conversations more?", "Kim daha çok buluşma öneriyor?",
  "Who apologizes more?", "kahve hakkındaki mesajlar", "When did we first talk about kahve?",
  "last message about kahve", "12 Nisan geçen mesajlar", "Who postpones plans more?",
  "Why did we argue?", "asdf qwerty", "Find messages about missingword",
];

describe("localized deterministic presentation", () => {
  it.each(questions)("keeps the same plan, counts and citations in both interfaces: %s", (q) => {
    const english = answer(q, session, NO_FILTERS, undefined, "en");
    const turkish = answer(q, session, NO_FILTERS, undefined, "tr");
    expect(turkish.plan).toEqual(english.plan);
    expect(turkish.supported).toBe(english.supported);
    expect(turkish.evidenceTotal).toBe(english.evidenceTotal);
    expect(turkish.evidence).toEqual(english.evidence);
    expect(turkish.text).not.toBe(english.text);
    expect(turkish.basis).toBe(english.basis);
    expect(turkish.rows.map((r) => [r.lead, r.share])).toEqual(english.rows.map((r) => [r.lead, r.share]));
    for (const a of [english, turkish]) {
      expect(a.text + (a.figure ? a.figure.value + a.figure.caption : "") + a.scope + (a.note ?? "") + a.rows.map((r) => r.value + (r.detail ?? "")).join("")).not.toMatch(/\{\w+\}/);
      for (const e of a.evidence) expect(e.message.text).toBe(parsed.messages[e.message.id]!.text);
    }
  });

  it("uses localized numbers and periods without changing totals", () => {
    const many = new ChatSession(parseExport(lines(...Array.from({ length: 1234 }, () => android("13/01/24", "09:00", "Ayşe", "merhaba")))));
    expect(answer("How many messages?", many, NO_FILTERS, undefined, "tr").text).toContain("1.234 mesaj");
    expect(answer("Kaç mesaj var?", many, NO_FILTERS, undefined, "en").text).toContain("1,234 messages");
    expect(answer("How many messages in January 2024?", session, NO_FILTERS, undefined, "tr").scope).toBe("Ocak 2024");
  });


  it.each(["en", "tr"] as const)("localizes every worker error, including raw fallback cases: %s", (locale) => {
    const codes = ["empty_file", "unsupported_type", "too_large", "not_text", "zip_invalid", "zip_unsupported", "zip_without_chat", "zip_ambiguous", "no_messages", "worker_lost", "no_chat_loaded", "invalid_filter", "out_of_memory", "storage_unavailable", "storage_full", "storage_failed", "not_found", "internal", "cancelled"] as const;
    for (const code of codes) {
      const text = errorMessage(code, "RAW_DIAGNOSTIC", locale);
      expect(text, code).not.toContain("RAW_DIAGNOSTIC");
      expect(text, code).not.toMatch(/\{\w+\}/);
      expect(text, code).not.toBe(errorMessage(code, "RAW_DIAGNOSTIC", locale === "tr" ? "en" : "tr"));
    }
    expect(errorMessage("too_large", "larger than 123 MB", locale)).toContain("123 MB");
  });
});
