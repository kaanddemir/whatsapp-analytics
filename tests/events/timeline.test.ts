/* Plan and date analysis: plan timeline. Grouping by time, per-message tags, date lookup,
   filters, and no plan-state claims anywhere in the output or the UI text. */
import { describe, expect, it } from "vitest";
import { parseExport } from "@/parser";
import { matchAll } from "@/behaviour/analysis";
import { buildTimeline, threadsIn } from "@/events/timeline";
import { ChatSession } from "@/conversation/session";
import { en } from "@/i18n/en";
const S = Object.fromEntries(Object.entries(en).filter(([k]) => k.startsWith("x_")).map(([k,v]) => [k.slice(2), v]));
import { android, lines } from "../support/export";

const TEXT = lines(
  android("01/03/24", "10:00", "Ayşe", "cumartesi 19:30'da buluşalım mı?"),
  android("01/03/24", "10:05", "Can", "olur"),
  android("01/03/24", "10:06", "Can", "bugün çok yoğunum"),
  android("01/03/24", "18:00", "Can", "12 Nisan'da konser var, gidelim mi"),
  android("02/03/24", "09:00", "Ayşe", "yarın gelemiyorum, kusura bakma"),
  android("05/03/24", "09:00", "Ayşe", "fatura 450 lira geldi"),
);

describe("plan timeline", () => {
  const parsed = parseExport(TEXT);
  const t = buildTimeline(parsed, matchAll(parsed));

  it("collects plan-related messages and groups them by gaps over 3 hours", () => {
    expect(t.threads.map((th) => th.messages.map((m) => m.id))).toEqual([[0, 1], [3], [4]]);
  });

  it("tags what each message says, without plan states", () => {
    const tags = t.threads.flatMap((th) => th.messages.map((m) => m.tags));
    expect(tags[0]).toEqual(["suggestion", "time", "relative"]);
    expect(tags[1]).toEqual(["accepts"]);
    expect(tags[2]).toEqual(expect.arrayContaining(["suggestion", "date"]));
    expect(tags[3]).toEqual(expect.arrayContaining(["cancellation_wording", "relative"]));
  });

  it("finds messages naming a calendar day", () => {
    expect(t.byDayMonth.get("12/4")).toEqual([3]);
    const s = new ChatSession(parsed);
    expect(s.mentioning(12, 4, null, { start: null, end: null, sender: null })).toEqual([3]);
    expect(s.mentioning(12, 4, null, { start: null, end: null, sender: 0 })).toEqual([]);
  });

  it("filters by dates and participant", () => {
    const from = Date.UTC(2024, 2, 2), to = Date.UTC(2024, 2, 3);
    expect(threadsIn(t, parsed.messages, from, to, null).map((th) => th.first)).toEqual([4]);
    expect(threadsIn(t, parsed.messages, null, null, 1).map((th) => th.first)).toEqual([0, 3]);
  });

  it("the interface never claims a plan was confirmed, cancelled, decided or happened", () => {
    const claims = /\b(confirmed|was cancelled|is cancelled|decided|final decision|happened|agreed)\b/i;
    const timelineText = Object.entries(S).filter(([k]) => /^(tag|timeline|amb|conversation|noPlans|threadMore)/.test(k)).map(([, v]) => v);
    for (const v of timelineText) expect(v.replace(/whether a plan was confirmed, changed, cancelled or actually happened/, "")).not.toMatch(claims);
  });
});
