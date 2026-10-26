/* Behaviour analysis: behaviour detection and comparison.

   1. Governance: the accuracy published in catalog.ts must equal a fresh
      evaluation of the current rules on the blind set, and the blind set
      must be the frozen one. Changing a rule without re-measuring (and
      re-deciding what ships) fails here.
   2. Units: several messages of one proposal count once; a question back
      does not split it; a refusal does.
   3. Comparisons: rates decide, small numbers are not compared, wording
      categories are never compared, mixed-language chats need every
      language validated. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { detect, BEHAVIOURS, type Behaviour } from "@/behaviour/rules";
import { CATALOG, statusFor } from "@/behaviour/catalog";
import { behaviourReport, matchAll } from "@/behaviour/analysis";
import { parseExport } from "@/parser";
import { blindItems } from "../fixtures/behaviourBlind";
import { android, lines } from "../support/export";

const BLIND_SHA256 = "0fef33a256a192b3260ce3818864b6ac0e42a2e3c105af634fe133461a15862b";

describe("blind set governance", () => {
  it("the blind set is the frozen one", () => {
    const sha = createHash("sha256").update(readFileSync(new URL("../fixtures/behaviourBlind.ts", import.meta.url))).digest("hex");
    expect(sha).toBe(BLIND_SHA256);
  });

  it("has at least 200 positives and 200 negatives per behaviour and language", () => {
    const items = blindItems().filter((x) => x.kind !== "sarcasm");
    for (const b of BEHAVIOURS) for (const lang of ["tr", "en"] as const) {
      const cell = items.filter((x) => x.behaviour === b && x.lang === lang);
      expect(cell.filter((x) => x.label).length, `${b}.${lang} positives`).toBeGreaterThanOrEqual(200);
      expect(cell.filter((x) => !x.label).length, `${b}.${lang} negatives`).toBeGreaterThanOrEqual(200);
    }
  });

  it("catalog accuracy equals the current rules on the blind set", () => {
    const items = blindItems().filter((x) => x.kind !== "sarcasm");
    const round = (x: number) => Math.round(x * 1000) / 1000;
    for (const b of BEHAVIOURS) for (const lang of ["tr", "en"] as const) {
      const cell = items.filter((x) => x.behaviour === b && x.lang === lang).map((x) => ({ ...x, pred: detect(b, x.text, { prevOther: x.prev }) }));
      const pr = (rs: typeof cell) => {
        const tp = rs.filter((r) => r.label && r.pred).length, fp = rs.filter((r) => !r.label && r.pred).length;
        return { p: tp / Math.max(1, tp + fp), r: tp / Math.max(1, rs.filter((r) => r.label).length) };
      };
      const all = pr(cell), f = pr(cell.filter((x) => x.style === "formal")), i = pr(cell.filter((x) => x.style === "informal"));
      const published = CATALOG[b].blind[lang];
      expect(round(all.p), `${b}.${lang} precision`).toBe(published.precision);
      expect(round(all.r), `${b}.${lang} recall`).toBe(published.recall);
      expect(round(Math.abs(f.p - i.p)), `${b}.${lang} precision gap`).toBe(published.precisionGap);
      expect(round(Math.abs(f.r - i.r)), `${b}.${lang} recall gap`).toBe(published.recallGap);
      // Nothing ships as a comparison without passing the blind gate.
      if (CATALOG[b].status[lang] === "comparison") expect(published.passesBlindGate, `${b}.${lang}`).toBe(true);
    }
  });

  it("ships exactly the approved comparisons", () => {
    expect(CATALOG.proposal.status).toEqual({ tr: "comparison", en: "wording" });
    expect(CATALOG.acceptance.status).toEqual({ tr: "comparison", en: "wording" });
    expect(CATALOG.acceptance.blind.en.passesBlindGate).toBe(false);
    expect(CATALOG.apology.status).toEqual({ tr: "wording", en: "wording" });
    expect(CATALOG.cancellation.status).toEqual({ tr: "wording", en: "wording" });
  });
});

describe("rules: person, negation, quotes, questions", () => {
  const yes = (b: Behaviour, t: string, prev?: string) => expect(detect(b, t, { prevOther: prev }), t).toBe(true);
  const no = (b: Behaviour, t: string, prev?: string) => expect(detect(b, t, { prevOther: prev }), t).toBe(false);
  it("Turkish person marking", () => {
    yes("apology", "özür dilerim, geç kaldım"); no("apology", "Selin sonunda özür diledi");
    yes("cancellation", "yarın gelemiyorum"); no("cancellation", "Mert gelemiyormuş");
    yes("proposal", "yarın buluşalım mı?"); no("proposal", "onlar yarın buluşuyorlar");
  });
  it("negation, reported speech and questions", () => {
    no("proposal", "bu akşam buluşmayalım"); no("proposal", "Ece 'yarın buluşalım' dedi"); no("proposal", "yarın geliyor musun?");
    no("apology", "I'm not sorry at all"); no("apology", "did you apologize to her?"); no("apology", "sorry for your loss");
    no("cancellation", "the concert was cancelled"); no("cancellation", "I can't wait for saturday!");
  });
  it("acceptance needs a proposal by someone else first", () => {
    yes("acceptance", "olur, görüşürüz", "yarın kahve içelim mi?");
    no("acceptance", "olur", "fatura geldi");
    no("acceptance", "tamam mı?", "yarın buluşalım mı?");
    no("acceptance", "olur");
  });
});

const chat = (rows: [string, string, string, string][]) => parseExport(lines(...rows.map(([d, t, who, text]) => android(d, t, who, text))));

describe("units", () => {
  it("a proposal spread over messages counts once; a clarifying question does not split it", () => {
    const p = chat([
      ["01/03/24", "10:00", "Ayşe", "cumartesi buluşalım mı?"], ["01/03/24", "10:01", "Ayşe", "ya da pazar kahve içelim mi"],
      ["01/03/24", "10:05", "Can", "nereye?"], ["01/03/24", "10:06", "Ayşe", "moda sahile gidelim mi"],
      ["01/03/24", "10:10", "Can", "olur"],
    ]);
    const r = behaviourReport(p, matchAll(p), { from: null, to: null }, { from: null, to: null });
    const prop = r.results.find((x) => x.behaviour === "proposal")!;
    expect(prop.unit).toBe("proposals");
    expect(prop.people.find((x) => x.name === "Ayşe")!.count).toBe(1);
    expect(r.results.find((x) => x.behaviour === "acceptance")!.people.find((x) => x.name === "Can")!.count).toBe(1);
  });

  it("a refusal closes a proposal: the next one is new", () => {
    const p = chat([
      ["01/03/24", "10:00", "Can", "bu akşam buluşalım mı"], ["01/03/24", "10:02", "Ayşe", "olmaz, yorgunum"],
      ["01/03/24", "10:03", "Can", "o zaman yarın akşam buluşalım mı"],
    ]);
    const r = behaviourReport(p, matchAll(p), { from: null, to: null }, { from: null, to: null });
    expect(r.results.find((x) => x.behaviour === "proposal")!.people.find((x) => x.name === "Can")!.count).toBe(2);
  });
});

function synthChat(aProposals: number, bProposals: number, filler: number) {
  const rows: [string, string, string, string][] = [];
  let minute = 0;
  const add = (who: string, text: string) => {
    const d = new Date(Date.UTC(2024, 0, 1) + minute * 3_600_000);
    minute += 2; // two hours apart: every proposal is its own
    rows.push([`${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCFullYear()).slice(2)}`, `${String(d.getUTCHours()).padStart(2, "0")}:00`, who, text]);
  };
  for (let i = 0; i < Math.max(aProposals, bProposals, filler); i++) {
    if (i < aProposals) add("Ayşe", "yarın buluşalım mı?");
    if (i < bProposals) add("Can", "yarın buluşalım mı?");
    if (i < filler) { add("Ayşe", "bugün çok yoğunum"); add("Can", "bugün çok yoğunum"); }
  }
  return parseExport(lines(...rows.map(([d, t, who, text]) => android(d, t, who, text))));
}

describe("comparisons", () => {
  const verdictOf = (p: ReturnType<typeof parseExport>, b: Behaviour = "proposal") => behaviourReport(p, matchAll(p), { from: null, to: null }, { from: null, to: null }).results.find((x) => x.behaviour === b)!;

  it("names a leader only for a clear difference in rate", () => {
    const r = verdictOf(synthChat(40, 5, 200));
    expect(r.status).toBe("comparison");
    expect(r.verdict.kind).toBe("leader");
    expect(r.people[0]!.name).toBe("Ayşe");
  });

  it("similar rates: no clear difference", () => {
    expect(verdictOf(synthChat(20, 18, 200)).verdict.kind).toBe("no_clear_difference");
  });

  it("too few matches are not compared", () => {
    expect(verdictOf(synthChat(4, 1, 50)).verdict).toEqual({ kind: "too_few", total: 5 });
  });

  it("wording categories are never compared", () => {
    const p = chat([["01/03/24", "10:00", "Ayşe", "özür dilerim"], ["01/03/24", "11:00", "Can", "tamam"]]);
    const r = verdictOf(p, "apology");
    expect(r.status).toBe("wording");
    expect(r.verdict.kind).toBe("not_compared");
  });

  it("mixed-language chats are compared only when every language is validated", () => {
    expect(statusFor("proposal", { tr: 1, en: 0 })).toBe("comparison");
    expect(statusFor("proposal", { tr: 0.5, en: 0.5 })).toBe("wording"); // English proposals are not validated
    expect(statusFor("proposal", { tr: 0.95, en: 0.05 })).toBe("comparison");
    expect(statusFor("acceptance", { tr: 0.5, en: 0.5 })).toBe("wording");
    expect(statusFor("acceptance", { tr: 0.95, en: 0.05 })).toBe("comparison");
  });

  it("counts every message in the period, not a sample", () => {
    const p = synthChat(40, 5, 200);
    const all = behaviourReport(p, matchAll(p), { from: null, to: null }, { from: null, to: null });
    expect(all.messagesChecked).toBe(p.messages.length);
    const first = p.messages[0]!.ts, mid = p.messages[200]!.ts;
    const part = behaviourReport(p, matchAll(p), { from: first, to: mid }, { from: null, to: null });
    const expected = p.messages.slice(0, 200).filter((m) => m.text === "yarın buluşalım mı?" && m.sender === 0).length;
    expect(part.results.find((x) => x.behaviour === "proposal")!.people.find((x) => x.name === "Ayşe")!.count).toBe(expected);
  });
});

describe("Turkish suggestions are not conditionals", () => {
  it.each(["gitsek mi", "buluşsak", "otursak biraz", "yesek bir şeyler", "dolaşsak mı"])("suggestion: %s", (text) => expect(detect("proposal", text)).toBe(true));
  it.each(["Kahvaltıya gidersek eğer 2 saatten aşağı kalkamazsın", "gelirsek haber veririz", "oturursak geç kalırız", "yersek doyarız"])("conditional: %s", (text) => expect(detect("proposal", text)).toBe(false));
});
