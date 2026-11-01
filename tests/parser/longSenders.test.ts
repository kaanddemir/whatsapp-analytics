/* Sender names past the normal limit: real names repeat, stray sentences do not.
   The audit's case dropped 595 of 1,200 messages from one person. */
import { describe, expect, it } from "vitest";
import { analyze } from "@/analytics";
import { NO_FILTERS } from "@/model";
import { parseExport } from "@/parser";

const LONG = "Wolfeschlegelsteinhausenbergerdorffwelchevoralternwarengewissenhaftschaferswessenschafewarenwohlgepflegeundsorgfaltigkeitbeschutzenvonangreifendurchihrraubgierigfeinde";
const stamp = (i: number) => `${String(1 + (i % 28)).padStart(2, "0")}/0${1 + (i % 9)}/24, ${String(8 + (i % 12)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}`;

describe("long sender names", () => {
  it("keeps every message of a 175-character sender (595 of 1,200)", () => {
    expect(LONG.length).toBeGreaterThan(100);
    const lines = Array.from({ length: 1200 }, (_, i) => `${stamp(i)} - ${i % 2 && i < 1191 ? LONG : "Muhammed"}: mesaj ${i}`);
    const parsed = parseExport(lines.join("\n"));
    const counts = new Map(parsed.participants.map((p) => [p.name, parsed.messages.filter((m) => m.sender === p.id).length]));
    expect(parsed.messages).toHaveLength(1200);
    expect(counts.get(LONG)).toBe(595);
    expect(counts.get("Muhammed")).toBe(605);
    expect(analyze(parsed, NO_FILTERS).participants.map((p) => p.messages).sort()).toEqual([595, 605]);
    expect(parsed.report.warnings?.some((w) => w.code === "unrecognized_system_lines") ?? false).toBe(false);
  });

  it("still takes a name at exactly the old limit, once", () => {
    const name = "K".repeat(100);
    const parsed = parseExport(`01/01/24, 09:00 - ${name}: selam\n01/01/24, 09:01 - Asu: merhaba`);
    expect(parsed.participants.map((p) => p.name)).toEqual([name, "Asu"]);
  });

  it("does not invent a sender from one long line with a colon", () => {
    const sentence = "Bu sohbetteki eski mesajların bir kısmı artık bu cihazda bulunmadığı için dışa aktarılan dosyaya eklenemedi ve şu nedenle eksik kaldı: depolama";
    expect(sentence.indexOf(": ")).toBeGreaterThan(100);
    const parsed = parseExport(`01/01/24, 09:00 - ${sentence}\n01/01/24, 09:01 - Asu: merhaba\n01/01/24, 09:02 - Bora: selam`);
    expect(parsed.participants.map((p) => p.name)).toEqual(["Asu", "Bora"]);
    expect(parsed.messages).toHaveLength(2);
  });

  it("does not accept a repeated prefix past the hard cap", () => {
    const huge = "x".repeat(300);
    const parsed = parseExport(`01/01/24, 09:00 - ${huge}: a\n01/01/24, 09:01 - ${huge}: b\n01/01/24, 09:02 - Asu: c`);
    expect(parsed.participants.map((p) => p.name)).toEqual(["Asu"]);
  });

  it("does not take a quoted group subject for a sender, however often it repeats", () => {
    const subject = `Asu changed the subject from "${"eski ".repeat(25)}" to "yeni: konu"`;
    const parsed = parseExport(`01/01/24, 09:00 - ${subject}\n01/01/24, 09:01 - ${subject}\n01/01/24, 09:02 - Asu: selam\n01/01/24, 09:03 - Bora: selam`);
    expect(parsed.participants.map((p) => p.name)).toEqual(["Asu", "Bora"]);
  });

  it("leaves ordinary names and malformed lines as they were", () => {
    const parsed = parseExport(["01/01/24, 09:00 - Asu: selam", "bu bir devam satırı", "99/99/24, 09:00 - Bora: geçersiz", "01/01/24, 09:01 - Bora: merhaba: nasılsın"].join("\n"));
    expect(parsed.participants.map((p) => p.name)).toEqual(["Asu", "Bora"]);
    expect(parsed.messages[0]!.text).toContain("bu bir devam satırı");
    expect(parsed.messages.at(-1)!.text).toBe("merhaba: nasılsın");
  });
});
