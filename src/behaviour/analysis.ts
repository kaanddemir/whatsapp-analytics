/* Behaviour counts per participant over the WHOLE selected period: every
   text message is checked, none are sampled. Matching runs once per chat
   (one bit per behaviour per message); a date change only re-aggregates.

   Units, always stated:
   - proposal:     distinct proposals. Consecutive proposal messages by the
                   same person within 30 minutes are one proposal
                   ("cumartesi buluşalım mı?" / "ya da pazar" / "akşam 7
                   gibi?"), unless someone else answered in between with
                   more than a question back.
   - acceptance:   messages accepting a proposal made by someone else.
   - apology, cancellation: messages.

   Comparison: a person "does it more" only when the behaviour is a
   validated comparison for this chat's languages (catalog.ts), there are at
   least MIN_TOTAL matches, and the difference in rate per message sent is
   statistically clear (two-proportion z-test, |z| ≥ 1.96). Otherwise the
   counts are shown with "no clear difference" or "too few to compare".
   Rates, not raw counts, decide: someone who writes twice as much is not
   "more apologetic" for having twice the apologies. */
import type { Message, ParseResult, ParticipantId } from "@/model";
import { BEHAVIOURS, detect, type Behaviour } from "./rules";
import { statusFor, CATALOG, type Status } from "./catalog";
import { languageMix } from "@/text/lang";

const BIT: Record<Behaviour, number> = { proposal: 1, acceptance: 2, apology: 4, cancellation: 8 };
/** Proposal messages this close together, from one person, are one proposal. */
export const SAME_PROPOSAL_MS = 30 * 60_000;
/** A reply further than this from the proposal is not treated as answering it. */
const REPLY_WINDOW_MS = 12 * 3_600_000;
export const MIN_TOTAL = 10;

export interface Matches {
  /** BIT flags per message. */
  readonly flags: Uint8Array;
  /** 1 where a proposal message starts a new distinct proposal. */
  readonly proposalStart: Uint8Array;
  readonly mix: { tr: number; en: number; counted: number };
  readonly buildMs: number;
}

/** Immediate previous text, only if another sender is within the reply window and 5 messages. */
function previousOther(messages: readonly Message[], i: number): Message | undefined {
  const m = messages[i]!;
  // Do not skip the sender's intervening text to attach a later yes to an older proposal.
  for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
    const p = messages[j]!;
    if (m.ts - p.ts > REPLY_WINDOW_MS) return undefined;
    if (p.kind === "text") return p.sender !== m.sender ? p : undefined;
  }
  return undefined;
}

export function matchAll(parsed: ParseResult): Matches {
  const t0 = performance.now();
  const { messages, participants } = parsed;
  const flags = new Uint8Array(messages.length);
  const proposalStart = new Uint8Array(messages.length);
  const isMetaAI = (id: ParticipantId) => participants[id]?.isMetaAI === true;
  const lastProposal = new Map<ParticipantId, number>(); // sender -> index of their latest proposal message
  let lastOtherReply = -1;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    if (m.kind !== "text" || isMetaAI(m.sender)) continue;
    let f = 0;
    for (const b of BEHAVIOURS) {
      if (b === "acceptance") {
        const prev = previousOther(messages, i);
        if (prev && detect("acceptance", m.text, { prevOther: prev.text })) f |= BIT.acceptance;
      } else if (detect(b, m.text)) f |= BIT[b];
    }
    flags[i] = f;
    if (f & BIT.proposal) {
      const prev = lastProposal.get(m.sender);
      const continues = prev !== undefined && m.ts - messages[prev]!.ts <= SAME_PROPOSAL_MS && lastOtherReply < prev;
      if (!continues) proposalStart[i] = 1;
      lastProposal.set(m.sender, i);
    }
    // A reply from someone else closes the proposal, unless it is only a question back
    // ("nereye?", "what time?"), after which the proposer's follow-up is the same proposal.
    if (!/\?\s*$/u.test(m.text)) for (const [sender, idx] of lastProposal) if (sender !== m.sender && idx < i) lastOtherReply = Math.max(lastOtherReply, i);
  }
  const mix = languageMix(messages.filter((m) => m.kind === "text").map((m) => m.text));
  return { flags, proposalStart, mix, buildMs: Math.round(performance.now() - t0) };
}

export type Unit = "messages" | "proposals";
export type Verdict =
  | { readonly kind: "leader"; readonly participant: ParticipantId; readonly z: number }
  | { readonly kind: "no_clear_difference" }
  | { readonly kind: "too_few"; readonly total: number }
  | { readonly kind: "not_compared" }; // wording counts, or fewer than two people

export interface PersonCount {
  readonly participant: ParticipantId;
  readonly name: string;
  readonly count: number;
  /** Text messages they sent in the period. */
  readonly sent: number;
  /** count per 100 messages sent, 2 decimals. */
  readonly per100: number;
}

export interface BehaviourResult {
  readonly behaviour: Behaviour;
  readonly status: Status;
  readonly unit: Unit;
  readonly total: number;
  readonly people: readonly PersonCount[];
  readonly verdict: Verdict;
  /** Blind-set accuracy for the languages of this chat (for the method note). */
  readonly accuracy: { readonly tr: { precision: number; recall: number }; readonly en: { precision: number; recall: number } };
}

export interface BehaviourReport {
  readonly from: string | null;
  readonly to: string | null;
  readonly messagesChecked: number;
  readonly languageMix: { readonly tr: number; readonly en: number };
  readonly results: readonly BehaviourResult[];
}

function zTest(a: number, na: number, b: number, nb: number): number {
  const p = (a + b) / (na + nb);
  const se = Math.sqrt(p * (1 - p) * (1 / na + 1 / nb));
  return se === 0 ? 0 : (a / na - b / nb) / se;
}

/** Message indexes counted for `behaviour` (the start message of each proposal), in range. */
export function* counted(parsed: ParseResult, matches: Matches, behaviour: Behaviour, from: number, to: number, sender: ParticipantId | null = null): Generator<number> {
  const bit = BIT[behaviour];
  const { messages } = parsed;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    if (m.ts < from || m.ts >= to || !(matches.flags[i]! & bit)) continue;
    if (behaviour === "proposal" && !matches.proposalStart[i]) continue;
    if (sender !== null && m.sender !== sender) continue;
    yield i;
  }
}

export function behaviourReport(parsed: ParseResult, matches: Matches, range: { from: number | null; to: number | null }, labels: { from: string | null; to: string | null }): BehaviourReport {
  const from = range.from ?? -Infinity, to = range.to ?? Infinity;
  const { messages, participants } = parsed;
  const humans = participants.filter((p) => !p.isMetaAI);
  const sent = new Map<ParticipantId, number>(humans.map((p) => [p.id, 0]));
  let checked = 0;
  for (const m of messages) {
    if (m.ts < from || m.ts >= to || m.kind !== "text" || !sent.has(m.sender)) continue;
    sent.set(m.sender, sent.get(m.sender)! + 1);
    checked++;
  }
  const results = BEHAVIOURS.map((behaviour): BehaviourResult => {
    const counts = new Map<ParticipantId, number>(humans.map((p) => [p.id, 0]));
    for (const i of counted(parsed, matches, behaviour, from, to)) {
      const s = messages[i]!.sender;
      if (counts.has(s)) counts.set(s, counts.get(s)! + 1);
    }
    const people = humans.map((p) => {
      const c = counts.get(p.id)!, n = sent.get(p.id)!;
      return { participant: p.id, name: p.name, count: c, sent: n, per100: n ? Math.round((c / n) * 10000) / 100 : 0 };
    }).sort((a, b) => b.per100 - a.per100 || b.count - a.count);
    const total = people.reduce((n, p) => n + p.count, 0);
    const status = statusFor(behaviour, matches.mix);
    let verdict: Verdict = { kind: "not_compared" };
    const active = people.filter((p) => p.sent > 0);
    if (status === "comparison" && active.length >= 2) {
      if (total < MIN_TOTAL) verdict = { kind: "too_few", total };
      else {
        // Top rate against everyone else combined.
        const top = active[0]!;
        const rest = active.slice(1);
        const z = zTest(top.count, top.sent, rest.reduce((n, p) => n + p.count, 0), rest.reduce((n, p) => n + p.sent, 0));
        verdict = z >= 1.96 ? { kind: "leader", participant: top.participant, z: Math.round(z * 100) / 100 } : { kind: "no_clear_difference" };
      }
    }
    const b = CATALOG[behaviour].blind;
    return {
      behaviour, status, unit: behaviour === "proposal" ? "proposals" : "messages", total, people, verdict,
      accuracy: { tr: { precision: b.tr.precision, recall: b.tr.recall }, en: { precision: b.en.precision, recall: b.en.recall } },
    };
  });
  return { from: labels.from, to: labels.to, messagesChecked: checked, languageMix: { tr: matches.mix.tr, en: matches.mix.en }, results };
}
