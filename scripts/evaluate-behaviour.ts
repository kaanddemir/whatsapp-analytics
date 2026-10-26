/* behaviour rule accuracy.
   vite-node scripts/evaluate-behaviour.ts -- dev | blind [--misses]
   dev:   the labelled behavior development set (used to develop the rules).
   blind: tests/fixtures/behaviourBlind.ts, run once after development; never used to tune.
   Reports per behaviour × language: precision, recall, false-positive rate; per style
   (formal / informal) precision and recall; per kind accuracy; and every miss / false alarm. */
import { detect, type Behaviour } from "@/behaviour/rules";
import { testItems } from "../tests/fixtures/behaviourDevelopment";
import { blindItems } from "../tests/fixtures/behaviourBlind";

const mode = process.argv[2] ?? "dev";
const showMisses = process.argv.includes("--misses");
interface Row { behaviour: Behaviour; lang: string; label: boolean; kind: string; style: string; text: string; prev?: string | undefined; core: number }
const rows: Row[] = mode === "blind"
  ? blindItems().map((x) => ({ ...x }))
  : testItems(4).filter((x) => x.b !== "postponement").map((x) => ({ behaviour: x.b as Behaviour, lang: x.lang, label: x.label, kind: x.kind, style: x.kind === "informal" ? "informal" : "formal", text: x.text, prev: x.prev, core: x.tpl }));

const r3 = (a: number, b: number) => (b ? +(a / b).toFixed(3) : null);
const score = (rs: (Row & { pred: boolean })[], rounded = true) => {
  const tp = rs.filter((r) => r.label && r.pred).length, fp = rs.filter((r) => !r.label && r.pred).length;
  const pos = rs.filter((r) => r.label).length, neg = rs.length - pos;
  const ratio = (a: number, b: number) => rounded ? r3(a, b) : b ? a / b : null;
  return { pos, neg, precision: ratio(tp, tp + fp), recall: ratio(tp, pos), fpRate: ratio(fp, neg) };
};
const scored = rows.map((r) => ({ ...r, pred: detect(r.behaviour, r.text, { prevOther: r.prev }) }));
const gated = scored.filter((r) => r.kind !== "sarcasm");
const cells: Record<string, unknown> = {};
for (const b of ["proposal", "acceptance", "apology", "cancellation"] as const) for (const lang of ["tr", "en"]) {
  const rs = gated.filter((r) => r.behaviour === b && r.lang === lang);
  const formal = score(rs.filter((r) => r.style === "formal")), informal = score(rs.filter((r) => r.style === "informal"));
  const all = score(rs);
  const rawFormal = score(rs.filter((r) => r.style === "formal"), false), rawInformal = score(rs.filter((r) => r.style === "informal"), false), rawAll = score(rs, false);
  cells[`${b}.${lang}`] = {
    ...all, formal, informal,
    precisionGap: formal.precision !== null && informal.precision !== null ? +Math.abs(rawFormal.precision! - rawInformal.precision!).toFixed(3) : null,
    recallGap: formal.recall !== null && informal.recall !== null ? +Math.abs(rawFormal.recall! - rawInformal.recall!).toFixed(3) : null,
    passes: (rawAll.precision ?? 0) >= 0.9 && (rawAll.recall ?? 0) >= 0.8
      && formal.precision !== null && informal.precision !== null && Math.abs(rawFormal.precision! - rawInformal.precision!) <= 0.1
      && formal.recall !== null && informal.recall !== null && Math.abs(rawFormal.recall! - rawInformal.recall!) <= 0.1,
  };
}
const kinds: Record<string, unknown> = {};
for (const k of [...new Set(scored.map((r) => r.kind))]) { const rs = scored.filter((r) => r.kind === k); kinds[k] = { n: rs.length, correct: r3(rs.filter((r) => r.pred === r.label).length, rs.length) }; }
const out = { mode, at: new Date().toISOString(), items: rows.length, cells, kinds };
console.log(JSON.stringify(out));
for (const [k, v] of Object.entries(cells)) {
  const c = v as { precision: number; recall: number; fpRate: number; passes: boolean; precisionGap: number; recallGap: number; pos: number; neg: number };
  console.log(k.padEnd(18), `P ${c.precision}  R ${c.recall}  FP ${c.fpRate}  gapP ${c.precisionGap} gapR ${c.recallGap}  n ${c.pos}/${c.neg}  ${c.passes ? "PASS" : "fail"}`);
}
console.log(JSON.stringify(kinds));
if (showMisses) {
  const uniq = (xs: string[]) => [...new Set(xs)];
  for (const b of ["proposal", "acceptance", "apology", "cancellation"]) {
    console.log(`\n## ${b} misses:`, uniq(gated.filter((r) => r.behaviour === b && r.label && !r.pred).map((r) => (r.prev ? r.prev + " → " : "") + r.text)).join(" | "));
    console.log(`## ${b} false alarms:`, uniq(gated.filter((r) => r.behaviour === b && !r.label && r.pred).map((r) => `[${r.kind}] ` + (r.prev ? r.prev + " → " : "") + r.text)).join(" | "));
  }
}
