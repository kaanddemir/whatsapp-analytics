/* Which behaviour results may be shown as comparisons ("who does this
   more"), per language, and the measured accuracy behind each decision.

   Promotion gate: a behaviour becomes a
   comparison only when it passes the blind gate in that language
   (precision ≥ 0.90, recall ≥ 0.80, formal/informal precision and recall
   gaps ≤ 0.10) AND has been checked on real chats by the owner. Real-chat
   review is outstanding, so existing comparison eligibility is preserved;
   the others are wording counts
   ("messages with apology wording"), labelled as such. Postponement is not
   offered at all (measured recall 0.52–0.60).

   Blind cases are maintained in tests/fixtures/behaviourBlind.ts. */
import type { Behaviour } from "./rules";

export type Status = "comparison" | "wording";

export interface Accuracy {
  readonly precision: number;
  readonly recall: number;
  /** Formal vs informal writing, the proxy for different writers. */
  readonly precisionGap: number;
  readonly recallGap: number;
  readonly passesBlindGate: boolean;
}

export interface CatalogEntry {
  readonly status: Record<"tr" | "en", Status>;
  readonly blind: Record<"tr" | "en", Accuracy>;
}

const acc = (precision: number, recall: number, precisionGap: number, recallGap: number): Accuracy => ({
  precision, recall, precisionGap, recallGap,
  passesBlindGate: precision >= 0.9 && recall >= 0.8 && precisionGap <= 0.1 && recallGap <= 0.1,
});

export const CATALOG: Record<Behaviour, CatalogEntry> = {
  proposal: {
    // EN passed blind; stays wording until real-chat review supports promotion.
    status: { tr: "comparison", en: "wording" },
    blind: { tr: acc(0.953, 0.933, 0.008, 0), en: acc(0.98, 0.838, 0.038, 0.008) },
  },
  acceptance: {
    // Conservative proposal/hedge exclusions put EN below the existing recall gate.
    status: { tr: "comparison", en: "wording" },
    blind: { tr: acc(0.986, 1, 0.028, 0), en: acc(0.96, 0.692, 0.002, 0.038) },
  },
  apology: {
    // TR passed blind (awaiting real-chat review); EN failed (precision 0.82, informal gap 0.21).
    status: { tr: "wording", en: "wording" },
    blind: { tr: acc(1, 0.967, 0, 0), en: acc(0.82, 0.95, 0.208, 0.033) },
  },
  cancellation: {
    // EN passed blind (awaiting real-chat review); TR failed the informal recall gap (0.23).
    status: { tr: "wording", en: "wording" },
    blind: { tr: acc(0.957, 0.846, 0.012, 0.231), en: acc(0.995, 0.995, 0.01, 0.01) },
  },
};

/** A language must carry at least this share of a chat's text for its accuracy to matter. */
export const LANGUAGE_SHARE_THRESHOLD = 0.1;

/** Comparison only if every language with a meaningful share of the chat allows it. */
export function statusFor(behaviour: Behaviour, mix: { tr: number; en: number }): Status {
  const entry = CATALOG[behaviour];
  const langs = (["tr", "en"] as const).filter((l) => mix[l] >= LANGUAGE_SHARE_THRESHOLD);
  if (langs.length === 0) return "wording";
  return langs.every((l) => entry.status[l] === "comparison") ? "comparison" : "wording";
}
