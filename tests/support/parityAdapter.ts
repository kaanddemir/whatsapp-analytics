/* Maps both engines' output to one comparable view: the legacy display
   payload (tests/golden/*.json, recorded from the former Python engine) and the
   TypeScript Stats. TS numbers are formatted the way legacy formatted them,
   so the comparison is on the same terms. */
import type { ParseResult, Stats } from "@/model";

type View = Record<string, unknown>;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const pad = (n: number) => String(n).padStart(2, "0");
const parts = (iso: string) => iso.split("-").map(Number) as [number, number, number];
const dayLabel = (iso: string) => { const [y, m, d] = parts(iso); return `${MONTHS[m - 1]} ${pad(d)}, ${y}`; };
const monthLabel = (iso: string) => { const [y, m] = parts(iso); return `${MONTHS[m - 1]} ${y}`; };
const shortLabel = (iso: string) => { const [, m, d] = parts(iso); return `${MONTHS[m - 1]} ${pad(d)}`; };

/** legacy utils.fmt_duration over legacy's whole-second median. */
function fmtDuration(seconds: number): string {
  const s = Math.trunc(seconds);
  if (s <= 0) return "—";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return m ? `${h}h ${m}m` : `${h}h`; }
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600);
  return h ? `${d}d ${h}h` : `${d}d`;
}

export function legacyView(p: any): View {
  const t = p.messages_over_time;
  const i = p.insights;
  return {
    "meta.participants": p.meta.participants,
    "meta.active_sender": p.meta.active_sender,
    "meta.full_range": p.meta.full_range,
    "meta.range": p.meta.range_iso,
    "meta.is_group": p.meta.is_group,
    "kpis.total_messages": p.kpis.total_messages,
    "kpis.active_days": p.kpis.active_days,
    "kpis.msgs_per_day": p.kpis.msgs_per_day,
    "kpis.active_days_series": p.kpis.active_days_series,
    "kpis.msgs_per_day_series": p.kpis.msgs_per_day_series,
    "kpis.total_words": p.kpis.total_words,
    "kpis.words_per_message": p.kpis.words_per_message,
    "kpis.peak_hour": p.kpis.peak_hour,
    "kpis.peak_hour_share": p.kpis.peak_hour_share,
    "timeline.grain": t.grain,
    "timeline.daily": t.daily,
    "timeline.weekly": t.weekly,
    "timeline.monthly": t.monthly,
    hours: p.hours,
    heatmap: p.heatmap,
    top_emojis: p.top_emojis.map((e: any) => [e.emoji, e.count]),
    top_keywords: p.top_keywords.map((e: any) => [e.word, e.count]),
    emoji_summary: p.content_summary.emojis,
    keyword_summary: p.content_summary.keywords,
    "media.total": p.media.total,
    "media.share": p.media.share,
    "media.items": p.media.items.map((e: any) => [e.label, e.count]),
    "participants.balance": i.participants.map((x: any) => [x.name, x.count, x.pct]),
    "participants.response": i.participants.map((x: any) => [x.name, x.avg_response_label]),
    most_active_window: [i.most_active_time, i.most_active_share],
    busiest_day: i.busiest_day,
    streak: [i.longest_streak_days, i.longest_streak_range],
    starter: [i.conversation_starter, i.conversation_starter_pct, i.conversation_starter_count, i.conversation_count],
    night_owl: [i.night_owl, i.night_owl_count, i.night_owl_share],
    convo_total: i.convo_total,
  };
}

export function tsView(s: Stats, parsed: ParseResult): View {
  const name = (id: number | null) => (id === null ? "" : parsed.participants[id]!.name);
  const series = (x: Stats["timeline"]["daily"], label: (iso: string) => string) => ({
    labels: x.buckets.map(label), values: x.values, partial: x.partial,
  });
  const i = s.insights;
  const streak = i.longestStreak;
  let range = "";
  if (streak.start && streak.end) {
    range = streak.start.slice(0, 4) === streak.end.slice(0, 4)
      ? `${shortLabel(streak.start)} – ${dayLabel(streak.end)}`
      : `${dayLabel(streak.start)} – ${dayLabel(streak.end)}`;
  }
  const w = i.mostActiveWindow;
  return {
    "meta.participants": s.meta.participants.map(name),
    "meta.active_sender": s.meta.activeSender === null ? null : name(s.meta.activeSender),
    "meta.full_range": s.meta.fullRange,
    "meta.range": s.meta.range,
    "meta.is_group": s.meta.chatType.kind === "group",
    "kpis.total_messages": s.kpis.totalMessages,
    "kpis.active_days": s.kpis.activeDays,
    "kpis.msgs_per_day": s.kpis.messagesPerActiveDay,
    "kpis.active_days_series": s.kpis.activeDaysSeries,
    "kpis.msgs_per_day_series": s.kpis.messagesPerActiveDaySeries,
    "kpis.total_words": s.kpis.totalWords,
    "kpis.words_per_message": s.kpis.wordsPerMessage,
    "kpis.peak_hour": `${pad(s.kpis.peakHour ?? 0)}:00`,
    "kpis.peak_hour_share": s.kpis.peakHourShare,
    "timeline.grain": s.timeline.suggestedGrain,
    "timeline.daily": series(s.timeline.daily, dayLabel),
    "timeline.weekly": series(s.timeline.weekly, dayLabel),
    "timeline.monthly": series(s.timeline.monthly, monthLabel),
    hours: s.timing.hours,
    heatmap: s.timing.heatmap,
    top_emojis: s.content.topEmojis.map((e) => [e.key, e.count]),
    top_keywords: s.content.topKeywords.map((e) => [e.key, e.count]),
    emoji_summary: { message_count: s.content.emojiSummary.messageCount, uses: s.content.emojiSummary.uses },
    keyword_summary: s.content.keywordSummary,
    "media.total": s.content.media.total,
    "media.share": s.content.media.share,
    "media.items": s.content.media.items.map((e) => [e.key, e.count]),
    "participants.balance": s.participants.map((x) => [x.name, x.messages, x.share]),
    "participants.response": s.participants.map((x) => [x.name, fmtDuration(x.responseTime.median ?? 0)]),
    most_active_window: w ? [`${pad(w.startHour)}:00 - ${pad((w.startHour + 4) % 24)}:00`, w.share] : null,
    busiest_day: i.busiestWeekday === null ? null : DAYS[i.busiestWeekday],
    streak: [streak.days, range],
    starter: [name(i.conversationStarter.id), i.conversationStarter.share, i.conversationStarter.count, i.conversationStarter.conversations],
    night_owl: [name(i.nightOwl.id), i.nightOwl.count, i.nightOwl.share],
    convo_total: s.meta.conversationTotal,
  };
}

/** JSON with object keys sorted, so key order never counts as a difference. */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v);
}

/** Keys whose values differ. */
export function diffKeys(a: View, b: View): string[] {
  return Object.keys(a).filter((k) => canonical(a[k]) !== canonical(b[k]));
}
