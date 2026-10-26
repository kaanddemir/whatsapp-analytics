/* Deterministic calculations are independent of interface and question language.
   This file turns each plan's computed result into a conversational answer:
   a lead sentence, per-person rows when there is a comparison, and a note for
   what the figures do not establish. Templates are chosen per question type
   and per outcome, so a figure that cannot support a conclusion never reads
   like one. */
import type { AnalysisFilters, ParseResult } from "@/model";
import type { ChatSession } from "@/conversation/session";
import type { Behaviour } from "@/behaviour/rules";
import { translate } from "@/i18n/translate";
import type { Locale } from "@/i18n/types";
import type { TranslationKey } from "@/i18n/en";
import { route } from "./router";
import { foldAligned } from "@/text/fold";
import type { Answer, Period, Plan } from "./types";
import { CANDIDATES, contentTerms, passes, rank, type Meaning } from "@/semantic/hybrid";
import { E5_SMALL } from "@/semantic/model";
import type { Hit } from "@/semantic/vectors";
import type { SemanticState } from "@/semantic/indexer";
import { timeRange } from "@/conversation/session";
import { formatDuration, formatHourRange, formatPercent } from "@/i18n/format";
import { selectScope } from "@/analytics/scope";
import { DEFAULT_OPTIONS } from "@/model";

/** What the semantic tier contributed to a recall question, computed (asynchronously) before `answer`. */
export interface SemanticInput {
  /** Nearest messages among those `keep` accepts, best first; null when no vectors can be searched. */
  readonly search: ((keep: (id: number) => boolean) => readonly Hit[]) | null;
  /** Similarity of any indexed message to the question (for messages found by their words). */
  readonly similarity?: ((id: number) => number | null) | undefined;
  /** The model's ranking parameters (ModelSpec); the shipped model's by default. */
  readonly lexicalWeight?: number;
  readonly minSimilarity?: number;
  /** Share of the chat's indexable messages that were searchable. */
  readonly coverage: number;
  readonly status: SemanticState["status"];
  /** "too_large" / "unsupported" cannot be fixed by enabling. */
  readonly failure?: string | undefined;
}

/** Retrieved matches shown with a recall answer (each with its reply, when one is found). */
export const RECALL_LIMIT = 30;
const REPLY_SPAN = 8, REPLY_GAP_MS = 3 * 3_600_000, REPLY_WINDOW_MS = 12 * 3_600_000;

/** The message that answered `id`: the next one from someone else, close enough to belong to the same exchange. */
export function replyTo(messages: ParseResult["messages"], id: number): number | null {
  const m = messages[id];
  if (!m) return null;
  for (let j = id + 1, prev = m.ts; j < Math.min(messages.length, id + 1 + REPLY_SPAN); j++) {
    const n = messages[j]!;
    if (n.ts - prev > REPLY_GAP_MS || n.ts - m.ts > REPLY_WINDOW_MS) return null;
    prev = n.ts;
    if (n.sender !== m.sender) return j;
  }
  return null;
}

export const base = (plan: Plan, scope: string) => ({ plan, scope, figure: null, rows: [], note: null, evidence: [], evidenceTotal: 0, result: null, action: null }) as const;
/** Search terms as written, without the quotes that mark a phrase search. */
const shown = (query: string) => query.replace(/^"(.+)"$/u, "$1");

export function answer(question: string, session: ChatSession, filters: AnalysisFilters, onBuild?: () => void, locale: Locale = "en", semantic: SemanticInput | null = null, now = Date.now()): Answer {
  const intl = locale === "tr" ? "tr-TR" : "en-US";
  const n = (x: number) => x.toLocaleString(intl);
  const rate = (x: number) => x.toLocaleString(intl, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const day = (iso: string) => new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
  const longDay = (iso: string) => new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-GB", { day: "numeric", month: "long", year: "numeric", weekday: "long", timeZone: "UTC" }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
  const month = (iso: string) => new Intl.DateTimeFormat(intl, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso.slice(0, 7)}-01T00:00:00Z`));
  // 1 Jan 2024 was a Monday, matching the engine's Monday-first weekdays.
  const weekday = (i: number) => new Intl.DateTimeFormat(intl, { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 1 + i)));
  const parsed: ParseResult = session.parsed;
  const plan = route(question, parsed.participants, now);
  // {Scope} is the scope at the start of a sentence.
  let scope = "";
  const t = (key: TranslationKey, params?: Record<string, string | number>) =>
    translate(locale, key, { scope, Scope: scope.charAt(0).toLocaleUpperCase(intl) + scope.slice(1), ...params });
  if (plan.type === "unsupported") {
    // A short unrecognised question is usually a topic: say how to ask for it.
    const topic = plan.suggestion ?? (plan.reason === "not_understood" && question.trim().split(/\s+/).length <= 3 && question.length <= 60 ? question.trim().replace(/[?!.]+$/u, "") : null);
    return {
      ...base(plan, ""), supported: false,
      text: t(plan.reason === "topics" ? "a_unsupportedTopics" : plan.reason === "needs_understanding" ? "a_unsupportedMeaning" : plan.reason === "behaviour_not_validated" ? "a_unsupportedBehaviour" : plan.reason === "not_measured" ? "a_unsupportedStatistic" : "a_unsupportedOther"),
      note: plan.reason === "topics" ? t("a_topicsNote") : topic ? t("a_tryTopic", { topic: shown(topic) }) : null,
      basis: "none",
    };
  }
  const period: Period | null = plan.period;
  let start = filters.start, end = filters.end;
  if (period) { start = start && start > period.start ? start : period.start; end = end && end < period.end ? end : period.end; }
  const first = parsed.messages[0], last = parsed.messages[parsed.messages.length - 1];
  const s0 = start ?? (first ? new Date(first.ts).toISOString().slice(0, 10) : null);
  const e0 = end ?? (last ? new Date(last.ts).toISOString().slice(0, 10) : null);
  // A stated period is named as written when it is a whole year or a whole month, else by its dates.
  const wholeYear = period && period.start.slice(5) === "01-01" && period.end.slice(5) === "12-31" && period.start.slice(0, 4) === period.end.slice(0, 4);
  const wholeMonth = period && period.start.slice(0, 7) === period.end.slice(0, 7) && period.start.slice(8) === "01";
  scope = !start && !end ? t("a_whole") : period && start === period.start && end === period.end && (wholeYear || wholeMonth) ? (wholeYear ? period.start.slice(0, 4) : month(period.start)) : `${s0 ? day(s0) : t("a_start")} – ${e0 ? day(e0) : t("a_end")}`;
  const scoped = { start, end, sender: filters.sender };
  if (start && end && start > end) return { ...base(plan, scope), supported: true, text: t("a_emptyScope"), basis: "count" };
  const personName = (id: number | null) => id === null ? null : parsed.participants[id]?.name ?? null;
  const empty = () => t("a_empty");
  // The participant filter, said wherever it shapes the answer, and said when a comparison has to ignore it.
  const filtered = personName(scoped.sender);
  const joined = (...notes: (string | null)[]) => notes.filter(Boolean).join(" ") || null;
  const onlySender = (name: string | null) => name ? t("a_onlySender", { name }) : null;
  const notApplied = filtered ? t("a_senderNotApplied", { name: filtered }) : null;
  const unit = (count: number) => t(count === 1 ? "a_messageSingular" : "a_messageUnit");
  /** Related messages by meaning and words; `noExact`: a topic search found no exact match, and says so. */
  const recallAnswer = (plan: Extract<Plan, { type: "recall" }>, noExact = false, topicOf: string | null = null): Answer => {
    const range = timeRange(scoped), filter = { from: range.from ?? -Infinity, to: range.to ?? Infinity, sender: scoped.sender };
    const terms = contentTerms(plan.topic);
    const hits = semantic?.search ? semantic.search((id) => passes(parsed.messages[id]!, filter)).slice(0, CANDIDATES) : null;
    const meaning: Meaning | null = hits ? {
      hits, similarity: semantic?.similarity ?? ((id) => hits.find((h) => h.id === id)?.score ?? null),
      lexicalWeight: semantic?.lexicalWeight ?? E5_SMALL.lexicalWeight, minSimilarity: semantic?.minSimilarity ?? E5_SMALL.minSimilarity,
    } : null;
    const fused = rank(session.keywordIndex(onBuild), parsed.messages, terms, filter, meaning);
    const anyWord = fused.some((f) => f.coverage > 0);
    // A question nothing else recognised, sharing no word with the chat and too short to carry meaning on its own
    // ("asdf qwerty"), is not answered with whatever happens to be nearest.
    if (plan.fallback && !anyWord && terms.length < 3) {
      const topic = question.trim().split(/\s+/).length <= 3 && question.length <= 60 ? question.trim().replace(/[?!.]+$/u, "") : null;
      return { ...base({ type: "unsupported", reason: "not_understood", suggestion: null }, ""), supported: false, text: t("a_unsupportedOther"), note: topic ? t("a_tryTopic", { topic }) : null, basis: "none" };
    }
    const pairs: { match: number; reply: number | null }[] = [];
    const seen = new Set<number>();
    // A candidate that is itself the reply to another candidate stays with it, statement first.
    const candidates = new Set(fused.map((f) => f.id));
    // The same words sent again ("iptal edelim" three times) are shown once.
    const shownText = new Set<string>();
    for (const f of fused) {
      if (pairs.length >= RECALL_LIMIT) break;
      if (seen.has(f.id)) continue;
      const said = foldAligned(parsed.messages[f.id]!.text).replace(/\s+/g, " ").trim();
      if (shownText.has(said) && !plan.reply) continue;
      shownText.add(said);
      let match = f.id, reply: number | null = null;
      if (plan.reply) {
        const statement = [...candidates].find((c) => c < f.id && !seen.has(c) && replyTo(parsed.messages, c) === f.id);
        if (statement !== undefined) { match = statement; reply = f.id; }
        else { const r = replyTo(parsed.messages, f.id); reply = r !== null && !seen.has(r) ? r : null; }
      }
      seen.add(match);
      if (reply !== null) seen.add(reply);
      pairs.push({ match, reply });
    }
    const evidence = pairs.flatMap((p) => [session.evidence(p.match, terms), ...(p.reply !== null ? [session.evidence(p.reply)] : [])]);
    const usedMeaning = !!hits;
    const fixable = !semantic || (semantic.status !== "ready" && semantic.status !== "indexing" && semantic.status !== "preparing" && semantic.failure !== "too_large" && semantic.failure !== "unsupported");
    const coverage = semantic && usedMeaning && semantic.coverage < 1 ? t("r_partial", { percent: Math.max(1, Math.floor(semantic.coverage * 100)) }) : null;
    const text = !pairs.length ? (noExact ? t("r_noExactNone", { query: shown(topicOf ?? plan.topic) }) : t("r_none")) : noExact ? t("r_noExact", { query: shown(topicOf ?? plan.topic) }) : plan.limitation ? t(plan.limitation === "reason" ? "r_reason" : plan.limitation === "summary" ? "r_summary" : "r_decision")
      : plan.reply ? (pairs.some((p) => p.reply !== null) ? t("r_replies") : t("r_noReply")) : t("r_found");
    return { ...base(plan, scope), supported: true, basis: usedMeaning ? "meaning" : "match", text, evidence, evidenceTotal: evidence.length,
      result: { kind: "recall", filters: scoped, pairs },
      // Ranked by meaning alone, with no question word anywhere: possibly unrelated, and said so.
      note: joined(usedMeaning && pairs.length && !anyWord ? t("r_meaningOnly") : null, onlySender(filtered), plan.speakerWords && scoped.sender === null ? t("r_speaker") : null, plan.reply && pairs.length ? t("r_replyNote") : null,
        usedMeaning ? coverage : t(semantic?.failure === "too_large" ? "r_tooLarge" : "r_keywordOnly")),
      action: !usedMeaning && fixable ? "enable_semantic" : null };
  };
  /** Recent weeks against the weeks before, from the shared Stats.trends calculations. */
  const trendAnswer = (plan: Extract<Plan, { type: "statistic" }>, f: AnalysisFilters): Answer => {
    const aspect = plan.aspect ?? "activity";
    // Activity follows the participant filter; the comparisons between people never do.
    const stats = session.stats(aspect === "activity" ? f : { ...scoped, sender: null }), tr = stats.trends, w = tr.windows;
    const res = stats.meta.timestampResolution, name = (id: number) => personName(id) ?? "";
    const pct = (x: number) => formatPercent(x, locale);
    if (!w) return { ...base(plan, scope), supported: true, basis: "count", text: t("a_trendShort") };
    const range = (r: { start: string; end: string }) => `${day(r.start)} – ${day(r.end)}`;
    const ctx = { days: n(w.days), after: range(w.after), before: range(w.before) };
    const note = joined(aspect === "activity" ? onlySender(personName(f.sender)) : notApplied, t("a_methodTrend", ctx), aspect === "response_time" ? t("a_methodReply") : null);
    const dir = (d: string, up: TranslationKey = "a_dirUp", down: TranslationKey = "a_dirDown") =>
      t(d === "up" ? up : d === "down" ? down : d === "steady" ? "a_dirSteady" : "a_dirInsufficient");
    const shared = { ...base(plan, `${range(w.before)} · ${range(w.after)}`), supported: true, basis: "count" as const, note };
    if (aspect === "activity") {
      const a = tr.activity!, rate = (x: number) => x.toLocaleString(intl, { maximumFractionDigits: 1 });
      const p = { ...ctx, a: rate(a.perDayAfter), b: rate(a.perDayBefore), count: n(a.before + a.after) };
      return { ...shared, figure: { value: rate(a.perDayAfter), caption: t("a_figPerDayLately", { days: n(w.days) }) },
        rows: [
          { label: ctx.before, value: t("a_messages", { count: n(a.before) }), detail: t("a_perDayActive", { rate: rate(a.perDayBefore), active: n(a.activeDaysBefore) }), lead: false, share: null, magnitude: a.before },
          { label: ctx.after, value: t("a_messages", { count: n(a.after) }), detail: t("a_perDayActive", { rate: rate(a.perDayAfter), active: n(a.activeDaysAfter) }), lead: false, share: null, magnitude: a.after },
        ],
        text: t(a.direction === "up" ? "a_trendMore" : a.direction === "down" ? "a_trendLess" : a.direction === "steady" ? "a_trendSteady" : "a_trendFew", p) };
    }
    if (aspect === "response_time") {
      const list = tr.responseTime, changed = list.filter((r) => r.direction === "up" || r.direction === "down");
      const time = (x: number | null) => formatDuration(x, res, locale);
      const rows = list.map((r) => ({ label: name(r.id), value: `${time(r.before.median)} → ${time(r.after.median)}`, detail: dir(r.direction, "a_dirSlower", "a_dirFaster"), lead: false, share: null, magnitude: null }));
      const c = changed[0];
      const text = c ? t(c.direction === "up" ? "a_trendReplySlower" : "a_trendReplyFaster", { ...ctx, name: name(c.id), a: time(c.after.median), b: time(c.before.median) })
        : list.some((r) => r.direction === "steady") ? t("a_trendReplySteady", ctx) : t("a_trendReplyFew", ctx);
      return { ...shared, rows, text: changed.length > 1 ? `${text} ${t("a_trendAlso")}` : text };
    }
    const list = aspect === "share" ? tr.share : tr.starter, changed = list.filter((r) => r.direction === "up" || r.direction === "down");
    const rows = list.map((r) => ({ label: name(r.id), value: `${pct(r.before)} → ${pct(r.after)}`, detail: dir(r.direction), lead: false, share: null, magnitude: null }));
    // The largest change; between equal ones, the person who now does it more.
    const c = [...changed].sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before) || (b.direction === "up" ? 1 : 0) - (a.direction === "up" ? 1 : 0))[0];
    const keys = aspect === "share" ? ["a_trendShareUp", "a_trendShareDown", "a_trendShareSteady", "a_trendShareFew"] as const : ["a_trendStarterUp", "a_trendStarterDown", "a_trendStarterSteady", "a_trendStarterFew"] as const;
    const text = list.length < 2 ? t("a_trendOnePerson") : c ? t(c.direction === "up" ? keys[0] : keys[1], { ...ctx, name: name(c.id), a: pct(c.after), b: pct(c.before) })
      : list.some((r) => r.direction === "steady") ? t(keys[2], ctx) : t(keys[3], ctx);
    return { ...shared, rows, text, note: joined(note, aspect === "starter" ? t("a_methodStarter") : null) };
  };
  switch (plan.type) {
    case "statistic": {
      // Comparisons between people (who sends more, who starts, who replies faster) ignore the participant filter.
      const comparison = ["messages_by_person", "conversation_starter", "response_time", "message_length", "kind_by_person", "night_owl"] as const;
      const personal = !(comparison as readonly string[]).includes(plan.metric);
      const f = personal ? { ...scoped, sender: plan.person ?? scoped.sender } : { ...scoped, sender: null };
      const stats = session.stats(f), basis = "count" as const;
      if (plan.metric === "message_count" && plan.kind) {
        const k = plan.kind, who = personName(f.sender);
        const count = k === "media" ? stats.content.media.total : k === "deleted" ? stats.kpis.messagesByKind.deleted : stats.content.media.items.find((i) => i.key === k)?.count ?? 0;
        const what = t(`a_kind_${k}` as TranslationKey), c = n(count);
        return { ...base(plan, scope), supported: true, basis, figure: { value: c, caption: what },
          text: who ? t("a_countKindPerson", { name: who, count: c, what }) : t("a_countKind", { count: c, what }),
          note: k === "deleted" ? null : t("a_methodMedia") };
      }
      if (plan.metric === "message_count") {
        const who = personName(f.sender), count = n(stats.kpis.totalMessages);
        return { ...base(plan, scope), supported: true, basis, figure: { value: count, caption: t("a_figMessages") }, text: who ? t("a_countPerson", { name: who, count }) : t("a_countAll", { count }) };
      }
      if (plan.metric === "busiest_month") {
        const b = stats.highlights.busiestBucket.monthly;
        return { ...base(plan, scope), supported: true, basis, figure: b ? { value: month(b.bucket), caption: t("a_messages", { count: n(b.count) }) } : null, text: b ? t("a_busiest", { month: month(b.bucket), count: n(b.count), partial: b.partial ? t("a_partial") : "" }) : empty(), note: onlySender(personName(f.sender)) };
      }
      if (plan.metric === "busiest_day") {
        const b = stats.highlights.busiestDay, w = stats.highlights.busiestWeekdayByTotal;
        return { ...base(plan, scope), supported: true, basis, figure: b ? { value: day(b.date), caption: t("a_messages", { count: n(b.count) }) } : null,
          text: b ? t("a_busiestDay", { date: longDay(b.date), count: n(b.count) }) : empty(),
          note: joined(onlySender(personName(f.sender)), b && w !== null ? t("a_busiestWeekday", { weekday: weekday(w) }) : null) };
      }
      if (plan.metric === "response_time") {
        // Compared across people, as on the dashboard's Response Time card: never the participant filter.
        const res = stats.meta.timestampResolution;
        const timed = stats.participants.filter((p) => p.responseTime.median !== null).sort((a, b) => a.responseTime.median! - b.responseTime.median!);
        const asked = plan.person === null ? null : timed.find((p) => p.id === plan.person) ?? null;
        const rows = timed.map((p) => ({ label: p.name, value: formatDuration(p.responseTime.median, res, locale), detail: t("a_replySample", { count: n(p.responseTime.sampleSize) }), lead: false, share: null, magnitude: p.responseTime.median }));
        const method = joined(plan.person === null ? notApplied : null, t("a_methodReply"), res === "minute" ? t("a_minuteResolution") : null);
        if (plan.person !== null) return { ...base(plan, scope), supported: true, basis, rows, note: method,
          text: asked ? t("a_replyPerson", { name: asked.name, time: formatDuration(asked.responseTime.median, res, locale) }) : t("a_replyNone") };
        // "Who takes the longest to reply" names the other end of the same ranking.
        const [a, b] = plan.slowest ? [...timed].reverse() : timed;
        return { ...base(plan, scope), supported: true, basis, rows, note: method,
          text: !a ? t("a_replyNone") : !b ? t("a_replyPerson", { name: a.name, time: formatDuration(a.responseTime.median, res, locale) })
            : a.responseTime.median === b.responseTime.median ? t("a_replyTie", { time: formatDuration(a.responseTime.median, res, locale) })
            : t(plan.slowest ? "a_replySlowest" : "a_replyFastest", { name: a.name, time: formatDuration(a.responseTime.median, res, locale) }) };
      }
      if (plan.metric === "kind_by_person" && plan.kind) {
        // The same kinds the dashboard's media card counts, per sender of the human conversation: a comparison, never the participant filter.
        const k = plan.kind, what = t(`a_kind_${k}` as TranslationKey);
        const of = (m: ParseResult["messages"][number]) => k === "deleted" ? m.kind === "deleted" : m.kind === "media" && (k === "media" || (m.mediaKind ?? "Other") === k);
        const counts = new Map<number, number>();
        for (const m of selectScope(parsed, { ...scoped, sender: null }).humans) if (of(m)) counts.set(m.sender, (counts.get(m.sender) ?? 0) + 1);
        const ranked = stats.participants.map((p) => ({ p, count: counts.get(p.id) ?? 0 })).sort((a, b) => b.count - a.count);
        const [a, b] = ranked, lead = a && a.count > 0 && (!b || a.count > b.count) ? a.p.id : null;
        return { ...base(plan, scope), supported: true, basis,
          rows: ranked.map(({ p, count }) => ({ label: p.name, value: n(count), detail: null, lead: p.id === lead, share: null, magnitude: count })),
          text: !a || a.count === 0 ? t("a_kindNone", { what }) : lead === null ? t("a_kindTie", { what, count: n(a.count) }) : t("a_kindLeader", { name: a.p.name, what, count: n(a.count) }),
          note: joined(notApplied, k === "deleted" ? null : t("a_methodMedia")) };
      }
      if (plan.metric === "night_owl") {
        const o = stats.insights.nightOwl, [from, to] = DEFAULT_OPTIONS.nightHours, hours = formatHourRange(from, to);
        return { ...base(plan, scope), supported: true, basis, text: o.id === null ? t("a_nightNone", { hours }) : t("a_nightOwl", { name: personName(o.id) ?? "", share: formatPercent(o.share, locale), hours }),
          note: joined(notApplied, t("a_methodNight")) };
      }
      if (plan.metric === "emoji_count") {
        const u = stats.content.emojiSummary;
        return { ...base(plan, scope), supported: true, basis, figure: { value: n(u.uses), caption: t("a_figEmoji") },
          text: t(personName(f.sender) ? "a_emojiCountPerson" : "a_emojiCount", { count: n(u.uses), messages: n(u.messageCount), name: personName(f.sender) ?? "" }) };
      }
      if (plan.metric === "compare_periods" && plan.periods) {
        // Each period through the same engine, intersected with the date filter; a period the chat only partly covers is said.
        const firstDay = s0 ?? "", lastDay = e0 ?? "";
        const days = (a: string, b: string) => a > b ? 0 : Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1;
        const counted = plan.periods.map((p) => {
          const a = filters.start && filters.start > p.start ? filters.start : p.start, b = filters.end && filters.end < p.end ? filters.end : p.end;
          // Days the chat can have messages on: the period inside the date filter and the chat's own span.
          const covered = days(a > firstDay ? a : firstDay, b < lastDay ? b : lastDay);
          const count = a > b ? 0 : session.stats({ start: a, end: b, sender: plan.person ?? scoped.sender }).kpis.totalMessages;
          return { p, count, covered, perDay: covered ? count / covered : 0, partial: p.start < firstDay || p.end > lastDay };
        });
        // Periods of clearly different length (a month still under way, February against March): the per-day figures are pointed to.
        const lengths = counted.map((c) => c.covered), uneven = Math.min(...lengths) < 0.9 * Math.max(...lengths);
        const [x, y] = [...counted].sort((a, b) => b.count - a.count);
        const perDay = (c: (typeof counted)[number]) => c.perDay.toLocaleString(intl, { maximumFractionDigits: c.perDay < 1 ? 2 : 1 });
        const name = personName(plan.person ?? scoped.sender);
        return { ...base(plan, t("a_periodsScope")), supported: true, basis,
          rows: counted.map((c) => ({ label: c.p.label, value: t("a_messages", { count: n(c.count) }), detail: t("a_perDay", { rate: perDay(c) }), lead: x!.count > y!.count && c.p === x!.p, share: null, magnitude: c.count })),
          text: x!.count === y!.count ? t("a_periodsSame", { count: n(x!.count) }) : t("a_periodsMore", { more: x!.p.label, less: y!.p.label, a: n(x!.count), b: n(y!.count) }),
          note: joined(name ? t("a_onlySender", { name }) : null, counted.some((c) => c.partial) ? t("a_periodsPartial", { periods: counted.filter((c) => c.partial).map((c) => c.p.label).join(", ") }) : null,
            uneven ? t("a_periodsRateNote") : null) };
      }
      if (plan.metric === "trend") return trendAnswer(plan, f);
      if (plan.metric === "message_length") {
        // Per person from the same engine as the Words per message KPI; a comparison, so never the participant filter.
        const typed = stats.participants.filter((p) => p.wordsPerMessage > 0).sort((a, b) => b.wordsPerMessage - a.wordsPerMessage);
        const words = (x: number) => x.toLocaleString(intl, { maximumFractionDigits: 1 });
        const rows = typed.map((p) => ({ label: p.name, value: t("a_lengthWords", { words: words(p.wordsPerMessage) }), detail: null, lead: false, share: null, magnitude: p.wordsPerMessage }));
        const asked = plan.person === null ? null : typed.find((p) => p.id === plan.person) ?? null;
        const [a, b] = typed;
        const text = !a ? t("a_lengthNone") : plan.person !== null ? (asked ? t("a_lengthPerson", { name: asked.name, words: words(asked.wordsPerMessage) }) : t("a_lengthNone"))
          : !b ? t("a_lengthPerson", { name: a.name, words: words(a.wordsPerMessage) })
          : a.wordsPerMessage === b.wordsPerMessage ? t("a_lengthTie", { words: words(a.wordsPerMessage) }) : t("a_lengthLeader", { name: a.name, words: words(a.wordsPerMessage) });
        return { ...base(plan, scope), supported: true, basis, rows, text, note: joined(plan.person === null ? notApplied : null, t("a_methodLength")) };
      }
      if (plan.metric === "peak_hour") {
        const h = stats.kpis.peakHour, w = stats.insights.mostActiveWindow;
        return { ...base(plan, scope), supported: true, basis, figure: h === null ? null : { value: formatHourRange(h, 1, locale), caption: t("a_ofMessages", { share: formatPercent(stats.kpis.peakHourShare, locale) }) },
          text: h === null ? empty() : t("a_peakHour", { hours: formatHourRange(h, 1, locale), share: formatPercent(stats.kpis.peakHourShare, locale) }),
          note: joined(onlySender(personName(f.sender)), w ? t("a_peakWindow", { hours: formatHourRange(w.startHour, 4, locale), share: formatPercent(w.share, locale) }) : null) };
      }
      if (plan.metric === "busiest_weekday") {
        const w = stats.highlights.busiestWeekdayByTotal;
        return { ...base(plan, scope), supported: true, basis, figure: w === null ? null : { value: weekday(w), caption: t("a_ofMessages", { share: formatPercent(stats.highlights.weekdayShares[w] ?? 0, locale) }) },
          text: w === null ? empty() : t("a_weekday", { weekday: weekday(w), share: formatPercent(stats.highlights.weekdayShares[w] ?? 0, locale) }), note: onlySender(personName(f.sender)) };
      }
      if (plan.metric === "top_emoji" || plan.metric === "top_words") {
        const emoji = plan.metric === "top_emoji", list = (emoji ? stats.content.topEmojis : stats.content.topKeywords).slice(0, 5), top = list[0];
        const times = (count: number) => t(count === 1 ? "a_timeOne" : "a_times", { count: n(count) });
        return { ...base(plan, scope), supported: true, basis, rows: list.map((i) => ({ label: i.key, value: times(i.count), detail: null, lead: false, share: null, magnitude: i.count })),
          text: !top ? t(emoji ? "a_noEmoji" : "a_noWords") : t(emoji ? "a_topEmoji" : "a_topWord", { item: top.key, times: times(top.count) }),
          note: joined(onlySender(personName(f.sender)), !emoji && top ? t("a_methodWords") : null) };
      }
      if (plan.metric === "longest_streak") {
        const s = stats.insights.longestStreak;
        return { ...base(plan, scope), supported: true, basis, figure: s.days ? { value: n(s.days), caption: t("a_daysInRow") } : null,
          text: s.days && s.start && s.end ? t("a_streak", { days: n(s.days), start: day(s.start), end: day(s.end) }) : t("a_noStreak"), note: onlySender(personName(f.sender)) };
      }
      if (plan.metric === "active_days") {
        const k = stats.kpis;
        return { ...base(plan, scope), supported: true, basis, figure: { value: n(k.activeDays), caption: t("a_figActiveDays") },
          text: k.activeDays ? t("a_activeDays", { active: n(k.activeDays), days: n(stats.highlights.periodDays), average: k.messagesPerActiveDay.toLocaleString(intl, { maximumFractionDigits: 1 }) }) : empty(),
          note: onlySender(personName(f.sender)) };
      }
      if (plan.metric === "chat_span") {
        const range = timeRange(f), from = range.from ?? -Infinity, to = range.to ?? Infinity;
        const inScope = (i: number) => { const m = parsed.messages[i]!; return m.ts >= from && m.ts < to && (f.sender === null || m.sender === f.sender); };
        let firstId = -1, lastId = -1;
        for (let i = 0; i < parsed.messages.length; i++) if (inScope(i)) { firstId = i; break; }
        for (let i = parsed.messages.length - 1; i >= 0; i--) if (inScope(i)) { lastId = i; break; }
        if (firstId < 0) return { ...base(plan, scope), supported: true, basis, text: empty() };
        const a = session.view(firstId), z = session.view(lastId);
        const days = Math.round((Date.parse(`${z.at.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.at.slice(0, 10)}T00:00:00Z`)) / 86_400_000) + 1;
        return { ...base(plan, scope), supported: true, basis, evidence: [session.evidence(firstId)], evidenceTotal: 1,
          figure: { value: n(days), caption: t("a_figSpanDays") },
          text: t("a_span", { name: a.senderName, first: day(a.at), last: day(z.at), days: n(days) }), note: onlySender(personName(f.sender)) };
      }
      if (plan.metric === "conversation_starter") {
        const c = stats.insights.conversationStarter, name = personName(c.id);
        return { ...base(plan, scope), supported: true, basis, figure: name ? { value: `${n(c.count)} / ${n(c.conversations)}`, caption: t("a_figStarted", { name }) } : null, text: name ? t("a_starter", { name, count: n(c.count), total: n(c.conversations) }) : t("a_noStarter"), note: joined(notApplied, name ? t("a_methodStarter") : null) };
      }
      const people = [...stats.participants].sort((a, b) => b.messages - a.messages), top = people[0], second = people[1];
      const text = !top || !top.messages ? empty() : second && second.messages === top.messages ? t("a_mostTie", { name: top.name, other: second.name }) : t("a_most", { name: top.name });
      // The person who sent most leads; a tie has no leader.
      const leader = top && top.messages && !(second && second.messages === top.messages) ? top.id : null;
      return { ...base(plan, scope), supported: true, basis, text, note: top?.messages ? notApplied : null,
        rows: top?.messages ? people.map((p) => ({ label: p.name, value: t("a_messages", { count: n(p.messages) }), detail: locale === "tr" ? `%${p.share}` : `${p.share}%`, lead: p.id === leader, share: p.share, magnitude: p.messages })) : [],
      };
    }
    case "behaviour": {
      const report = session.behaviour({ ...scoped, sender: null }, onBuild);
      const r = report.results.find((x) => x.behaviour === plan.behaviour)!;
      const examples = session.behaviourEvidence(plan.behaviour, plan.person, { ...scoped, sender: null }, 0, 5, onBuild);
      const wording = r.status === "wording";
      const unitOf = (count: number) => t(`${count === 1 ? "a_u1" : "a_u"}_${wording ? "match" : plan.behaviour}` as TranslationKey);
      const rows = r.people.map((p) => ({ label: p.name, value: `${n(p.count)} ${unitOf(p.count)}`, detail: t("a_behaviourRate", { rate: rate(p.per100) }), lead: !wording && r.verdict.kind === "leader" && r.verdict.participant === p.participant, share: null, magnitude: null }));
      const behaviour = t(`a_${plan.behaviour}`);
      const shared = { ...base(plan, scope), evidence: examples.items, evidenceTotal: examples.total, supported: true, rows, result: { kind: "behaviour", value: r, filters: { ...scoped, sender: plan.person } } } as const;
      // One named person's count: the figure asked for, with everyone's rows for context but nobody named ahead.
      if (plan.person !== null) {
        const count = r.people.find((p) => p.participant === plan.person)?.count ?? 0;
        return { ...shared, rows: rows.map((row) => ({ ...row, lead: false })), basis: wording ? "match" : "rule", figure: { value: n(count), caption: unitOf(count) },
          text: t("a_behaviourPerson", { name: personName(plan.person) ?? "", count: n(count), unit: unitOf(count) }),
          note: joined(notApplied, wording ? t("a_wordingNote") : null, t("a_behaviourPersonNote")) };
      }
      if (wording) return { ...shared, text: t("a_wording", { behaviour }), note: joined(notApplied, t("a_wordingNote")), basis: "match" };
      const v = r.verdict;
      const text = v.kind === "leader" ? t(`a_leader_${plan.behaviour satisfies Behaviour}`, { name: personName(v.participant) ?? "" })
        : v.kind === "no_clear_difference" ? t("a_noDifference") : v.kind === "too_few" ? t("a_few", { count: n(v.total), unit: unitOf(v.total) }) : t("a_single");
      return { ...shared, text, note: joined(notApplied, v.kind === "leader" || v.kind === "no_clear_difference" ? t("a_rates") : null), basis: "rule" };
    }
    case "fact": {
      if (plan.byPerson) {
        // Messages containing the words, per person: what was written, matched by word beginnings like every search.
        const people = session.stats({ ...scoped, sender: null }).participants;
        const counts = people.map((p) => ({ p, count: session.search(plan.search, { ...scoped, sender: p.id }, "relevance", 0, 0, onBuild).total })).sort((a, b) => b.count - a.count);
        const all = session.search(plan.search, { ...scoped, sender: null }, "relevance", 0, 5, onBuild);
        const [a, b] = counts, lead = a && a.count > 0 && (!b || a.count > b.count) ? a.p.id : null, query = shown(plan.search);
        return { ...base(plan, scope), supported: true, basis: "match", evidence: all.items, evidenceTotal: all.total,
          result: { kind: "search", query: plan.search, filters: { ...scoped, sender: null }, sort: "relevance" },
          rows: counts.map(({ p, count }) => ({ label: p.name, value: `${n(count)} ${unit(count)}`, detail: t("a_behaviourRate", { rate: rate(p.messages ? count * 100 / p.messages : 0) }), lead: p.id === lead, share: null, magnitude: count })),
          text: !a || a.count === 0 ? t("a_noMatches", { who: "", query }) : lead === null ? t("a_phraseTie", { query }) : t("a_phraseLeader", { name: a.p.name, query, count: n(a.count), unit: unit(a.count) }),
          note: joined(notApplied, t("a_methodPhrase")) };
      }
      const f = { ...scoped, sender: plan.person ?? scoped.sender }, page = session.search(plan.search, f, "relevance", 0, 5, onBuild), name = personName(f.sender);
      // No message has these exact words: with meaning search on, say so and show what is related instead
      // (another language, a misspelling). An explicit "Search:" stays exact, and so does a person's search.
      if (!page.total && !plan.exact && f.sender === null && semantic?.search)
        return recallAnswer({ type: "recall", topic: question.trim(), period: plan.period, reply: false, speakerWords: false, limitation: null, fallback: false }, true, plan.search);
      return { ...base(plan, scope), supported: true, evidence: page.items, evidenceTotal: page.total, result: { kind: "search", query: plan.search, filters: f, sort: "relevance" },
        text: t(page.total ? "a_matches" : "a_noMatches", { count: n(page.total), unit: unit(page.total), who: name ? t("a_from", { name }) : "", query: shown(plan.search) }), basis: "match" };
    }
    case "timeline": {
      const page = plan.needsRange ? null : session.timelinePage(scoped, "newest", 0, 3, onBuild);
      return { ...base(plan, scope), supported: !plan.needsRange,
        text: plan.needsRange ? t("c_choosePlanDates") : page?.total ? t("c_planMatches", { count: n(page.total), unit: t(page.total === 1 ? "a_conversation" : "a_conversations") }) : t("x_noPlans"),
        note: plan.needsRange ? null : joined(onlySender(filtered), page?.total ? t("c_planNote") : null),
        basis: "match", result: { kind: "timeline", filters: scoped, needsRange: plan.needsRange, page } };
    }
    case "recall": return recallAnswer(plan);
    case "temporal": {
      if (plan.which === "in_period") {
        const range = timeRange(scoped), sender = plan.person ?? scoped.sender, ids: number[] = [];
        for (let id = 0; id < parsed.messages.length; id++) {
          const m = parsed.messages[id]!;
          if (m.ts >= (range.from ?? -Infinity) && m.ts < (range.to ?? Infinity) && (sender === null || m.sender === sender)) ids.push(id);
        }
        const shownIds = ids.slice(0, RECALL_LIMIT), name = personName(sender);
        if (!ids.length) return { ...base(plan, scope), supported: true, basis: "count", text: t("a_periodNone"), note: onlySender(name) };
        return { ...base(plan, scope), supported: true, basis: "count", evidence: shownIds.map((id) => session.evidence(id)), evidenceTotal: shownIds.length,
          result: { kind: "recall", filters: { ...scoped, sender }, pairs: shownIds.map((id) => ({ match: id, reply: null })) },
          figure: { value: n(ids.length), caption: unit(ids.length) }, text: t("a_periodList", { count: n(ids.length), unit: unit(ids.length) }),
          note: joined(onlySender(name), ids.length > shownIds.length ? t("a_onDateMore", { shown: n(shownIds.length) }) : null) };
      }
      if (plan.which === "on_date") {
        const range = timeRange(scoped), from = range.from ?? -Infinity, to = range.to ?? Infinity;
        const byYear = new Map<number, number[]>();
        for (let id = 0; id < parsed.messages.length; id++) {
          const m = parsed.messages[id]!, d = new Date(m.ts);
          if (d.getUTCDate() !== plan.day || d.getUTCMonth() + 1 !== plan.month || m.ts < from || m.ts >= to || (scoped.sender !== null && m.sender !== scoped.sender)) continue;
          if (plan.year !== null && d.getUTCFullYear() !== plan.year) continue;
          const list = byYear.get(d.getUTCFullYear()) ?? [];
          list.push(id);
          byYear.set(d.getUTCFullYear(), list);
        }
        const fmt = (y: number | null) => new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-GB", { day: "numeric", month: "long", ...(y ? { year: "numeric" } as const : {}), timeZone: "UTC" }).format(new Date(Date.UTC(y ?? 2000, plan.month - 1, plan.day)));
        const years = [...byYear.keys()].sort((a, b) => a - b);
        if (!years.length) return { ...base(plan, scope), supported: true, basis: "count", text: t("a_onDateNone", { date: fmt(plan.year) }), note: onlySender(filtered) };
        // A year is never invented: one candidate decides it, several are asked about.
        if (years.length > 1) {
          const list = new Intl.ListFormat(intl, { type: "conjunction" }).format(years.map(String));
          return { ...base(plan, scope), supported: false, basis: "none", text: t("a_onDateWhich", { date: fmt(null), years: list }),
            note: t("a_onDateAsk", { example: t("a_onDateExample", { date: fmt(years[years.length - 1]!) }) }) };
        }
        const year = years[0]!, ids = byYear.get(year)!, shownIds = ids.slice(0, RECALL_LIMIT);
        return { ...base(plan, scope), supported: true, basis: "count", evidence: shownIds.map((id) => session.evidence(id)), evidenceTotal: shownIds.length,
          result: { kind: "recall", filters: scoped, pairs: shownIds.map((id) => ({ match: id, reply: null })) },
          figure: { value: n(ids.length), caption: unit(ids.length) },
          text: t("a_onDate", { count: n(ids.length), unit: unit(ids.length), date: fmt(year) }),
          note: joined(onlySender(filtered), plan.year === null ? t("a_onDateYear", { year }) : null, ids.length > shownIds.length ? t("a_onDateMore", { shown: n(shownIds.length) }) : null) };
      }
      if (plan.which === "mentions_date") {
        const ids = session.mentioning(plan.day, plan.month, plan.year, scoped, onBuild);
        const date = new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-GB", { day: "numeric", month: "long", ...(plan.year ? { year: "numeric" } as const : {}), timeZone: "UTC" }).format(new Date(Date.UTC(plan.year ?? 2000, plan.month - 1, plan.day)));
        return { ...base(plan, scope), supported: true, evidence: ids.slice(0, 5).map((id) => session.evidence(id)), evidenceTotal: ids.length, result: { kind: "date", day: plan.day, month: plan.month, year: plan.year, filters: scoped },
          text: t(ids.length ? "a_dateMatches" : "a_noDate", { count: n(ids.length), unit: unit(ids.length), date }), note: joined(onlySender(filtered), t("a_methodDate")), basis: "match" };
      }
      const f = { ...scoped, sender: plan.person ?? scoped.sender };
      const page = session.search(plan.search, f, plan.which === "first" ? "oldest" : "newest", 0, 1, onBuild), hit = page.items[0];
      return { ...base(plan, scope), supported: true, evidence: hit ? [hit] : [], evidenceTotal: page.total, result: { kind: "search", query: plan.search, filters: f, sort: plan.which === "first" ? "oldest" : "newest" },
        text: hit ? t(plan.which === "first" ? "a_mentionFirst" : "a_mentionLast", { query: shown(plan.search), name: hit.message.senderName, date: day(hit.message.at), time: hit.message.at.slice(11, 16) }) : t("a_noMatches", { who: "", query: shown(plan.search) }),
        note: joined(onlySender(personName(f.sender)), hit ? `${t("a_mentionTotal", { query: shown(plan.search), count: n(page.total), unit: unit(page.total) })} ${t("a_methodMention")}` : null), basis: "match" };
    }
  }
}
