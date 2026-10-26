/* TypeScript engine vs the legacy Python engine on shared synthetic fixtures.

   Golden files are frozen output of the former Python engine, recorded
   before it was removed from the repository; they are not regenerated. Every
   difference must be listed in EXPECTED with the reason; an unlisted
   difference fails, and so does a listed one that never occurs (stale). */
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyze } from "@/analytics";
import { parseExport } from "@/parser";
import { canonical, diffKeys, legacyView, tsView } from "../support/parityAdapter";

const DIR = new URL("../fixtures/chats/", import.meta.url);
const GOLDEN = new URL("../golden/", import.meta.url);

// Reasons, one per deliberate change from the legacy engine.
const PERIOD = "period = date filter clamped to the chat, not the first/last message of the narrowed set";
const C1 = "C1: Android <Media omitted> is media, not two words of text";
const KEYWORDS = "C3/C4 + Unicode tokens: no Turkish I-folding of English, final doubles kept, 'café' kept";
const WEEKDAY = "busiest weekday ranked on exact averages; legacy ranked rounded ones (ties -> Monday)";
const NO_OWL = "nobody is the night owl when nobody wrote at night; legacy named someone with 0";
const ALIAS = "parser: '~ Gül' is reported as an alias candidate, not merged into 'Gül Yılmaz'";
const CLASSIFY = "classification: 2024 iOS notices under the group name, 'Video call, 5 min' records and '… <attached: …>' document rows are no longer counted as text messages";
const ENTITY = "parser: iOS notices posted under the group name are system events, not a participant's messages";

export const EXPECTED: Record<string, Record<string, string>> = {
  dm_en_android: {
    "meta.range": PERIOD, "timeline.daily": PERIOD, "timeline.weekly": PERIOD,
    top_keywords: KEYWORDS, keyword_summary: KEYWORDS,
  },
  edge_single_message: { night_owl: NO_OWL },
  edge_one_participant: { night_owl: NO_OWL },
  edge_only_media: { night_owl: NO_OWL },
  edge_five_years: {
    "meta.range": PERIOD, "timeline.daily": PERIOD, "timeline.weekly": PERIOD, "timeline.monthly": PERIOD,
    "kpis.active_days_series": PERIOD, "kpis.msgs_per_day_series": PERIOD,
    busiest_day: WEEKDAY, night_owl: NO_OWL,
  },
  edge_large_group: { "timeline.daily": PERIOD, "timeline.weekly": PERIOD, busiest_day: WEEKDAY },
  group_tr_ios: Object.fromEntries([
    "sender_not_a_participant", "meta.participants", "convo_total", "kpis.total_messages", "kpis.msgs_per_day",
    "kpis.msgs_per_day_series", "kpis.peak_hour_share", "kpis.total_words", "kpis.words_per_message", "hours", "heatmap",
    "timeline.daily", "timeline.weekly", "timeline.monthly", "media.share", "most_active_window", "busiest_day",
    "participants.balance", "participants.response", "starter", "top_keywords", "keyword_summary",
  ].map((k) => [k, ENTITY]).concat([["meta.range", PERIOD], ["night_owl", NO_OWL]])),
  group_android_meta_ai: {
    "meta.participants": ALIAS, "participants.balance": ALIAS, "participants.response": ALIAS,
    top_keywords: KEYWORDS, keyword_summary: KEYWORDS, "timeline.daily": PERIOD, "timeline.weekly": PERIOD,
  },
  ios_2024_group: Object.fromEntries([
    "convo_total", "heatmap", "hours", "keyword_summary", "kpis.msgs_per_day", "kpis.msgs_per_day_series", "kpis.peak_hour", "kpis.peak_hour_share", "kpis.total_messages", "kpis.total_words", "kpis.words_per_message", "media.items", "media.share", "media.total", "meta.participants", "most_active_window", "participants.balance", "participants.response", "starter", "timeline.daily", "timeline.monthly", "timeline.weekly", "top_keywords", "sender_not_a_participant",
  ].map((k) => [k, CLASSIFY]).concat([["night_owl", NO_OWL]])),
  long_android_12h: {
    "kpis.total_words": C1, "kpis.words_per_message": C1, "media.total": C1, "media.share": C1, "media.items": C1,
    top_keywords: `${C1}; ${KEYWORDS}`, keyword_summary: `${C1}; ${KEYWORDS}`,
    "timeline.daily": PERIOD, "timeline.weekly": PERIOD,
  },
};

const fixtures = readdirSync(DIR).filter((f) => f.endsWith(".chat")).map((f) => f.slice(0, -5));

describe("parity with the legacy Python engine", () => {
  for (const name of fixtures) {
    it(name, () => {
      const parsed = parseExport(readFileSync(new URL(`${name}.chat`, DIR), "utf8"));
      const cases = JSON.parse(readFileSync(new URL(`${name}.json`, GOLDEN), "utf8")) as any[];
      const seen = new Set<string>();
      const report: string[] = [];
      for (const c of cases) {
        const sender = c.filters.sender === null ? null : parsed.participants.findIndex((p) => p.name === c.filters.sender);
        if (sender === -1) {
          // Legacy treated this name as a participant; the TS parser does not.
          seen.add("sender_not_a_participant");
          if (!("sender_not_a_participant" in (EXPECTED[name] ?? {}))) report.push(`${c.filters.sender} is not a TS participant`);
          continue;
        }
        const stats = analyze(parsed, { start: c.filters.start, end: c.filters.end, sender });
        expect(c.error).toBeUndefined();
        const a = legacyView(c.stats);
        const b = tsView(stats, parsed);
        for (const key of diffKeys(a, b)) {
          seen.add(key);
          if (!(key in (EXPECTED[name] ?? {}))) report.push(`${JSON.stringify(c.filters)} ${key}\n  py: ${canonical(a[key]).slice(0, 400)}\n  ts: ${canonical(b[key]).slice(0, 400)}`);
        }
      }
      expect(report).toEqual([]);
      expect(Object.keys(EXPECTED[name] ?? {}).filter((k) => !seen.has(k))).toEqual([]);
    });
  }
});
