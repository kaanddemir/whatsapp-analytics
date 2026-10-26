/* Question -> plan, by pattern, Turkish and English. Deterministic: the same
   question always gets the same plan, and the plan is shown with the answer.

   Recognised (examples):
     statistic  who sent more messages / kim daha çok mesaj attı
                which day did we talk the most / en çok hangi gün konuşmuşuz
                how many messages in March 2024 / 2023'te kaç mesaj var
                how many messages did Ayşe send / Ayşe kaç mesaj attı
                which month was busiest / en yoğun ay hangisi
                who starts conversations more / sohbeti kim daha çok başlatıyor
                who writes longer messages / kim daha uzun mesaj yazıyor
                did we talk more lately / son aylarda konuşma sıklığımız değişti mi (trend)
                compare last month with this month / geçen ay ile bu ayı karşılaştır
     behaviour  who suggests meeting more / kim daha çok buluşma öneriyor
                how many times did Can apologise / Can kaç kez özür diledi (one person's count)
                who accepts plans more / kim daha çok kabul ediyor
                who apologises more / kim daha çok özür diliyor
                who cancels more / kim daha çok iptal ediyor
     fact       find messages about the holiday / tatil hakkındaki mesajlar
     recall     find the conversation where I said I missed her / onu özlediğimi söylediğim konuşmayı bul
                what did she reply when I said I didn't want to go / gitmek istemediğimi söylediğimde ne cevap vermişti
                in which conversation did we talk about moving last summer / geçen yaz hangi konuşmamızda taşınmaktan bahsettik
     temporal   when did we first talk about Paris / Paris'ten ilk ne zaman bahsettik
                last message about rent / kira hakkındaki son mesaj
                messages mentioning 12 April / 12 Nisan geçen mesajlar
                what did we talk about on 14 February / 14 Şubat'ta ne konuştuk (messages sent that day)
   Asking why or what was decided needs understanding beyond this engine:
   such a question gets the related messages, and the answer says it cannot
   state the reason or decision itself. Summaries, disagreements, changes of
   mind, feelings and the relationship are refused instead of guessed.
   A question no other pattern recognises is a recall question (find related
   messages), not a refusal: users ask in their own words. */
import type { Participant } from "@/model";
import { foldAligned } from "@/text/fold";
import { extractDates } from "@/events/dates";
import { contentTerms } from "@/semantic/hybrid";
import type { CountKind, Period, Plan, StatisticMetric, TrendAspect } from "./types";

const MONTHS: Record<string, number> = {
  ocak: 1, subat: 2, mart: 3, nisan: 4, mayis: 5, haziran: 6, temmuz: 7, agustos: 8, eylul: 9, ekim: 10, kasim: 11, aralik: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** "March 2024", "Mart 2024'te", "in 2023", "2023'te". */
export function findPeriod(q: string): Period | null {
  return findPeriods(q)[0] ?? null;
}

/** Named months/years in either language order; Turkish case suffixes stay bounded. */
export function findPeriods(q: string): Period[] {
  const f = foldAligned(q), out: { at: number; p: Period }[] = [];
  const months = Object.keys(MONTHS).join("|");
  const suffix = "(?:'?(?:ta|te|da|de|in|un|nin|nun|inda|inde|unda|unde|i|u|a|e))?";
  const re = new RegExp(`\\b(?:(${months})${suffix}\\s+((?:199\\d|20\\d\\d))|((?:199\\d|20\\d\\d))\\s+(${months})${suffix})\\b`, "gu");
  const occupied: [number, number][] = [];
  for (const m of f.matchAll(re)) {
    const mm = MONTHS[(m[1] ?? m[4])!]!, y = Number(m[2] ?? m[3]);
    if (y < 1990 || y > 2099) continue;
    out.push({ at: m.index!, p: { start: `${y}-${pad(mm)}-01`, end: `${y}-${pad(mm)}-${pad(lastDay(y, mm))}`, label: `${MONTH_NAMES[mm - 1]} ${y}` } });
    occupied.push([m.index!, m.index! + m[0].length]);
  }
  for (const m of f.matchAll(/\b(199\d|20\d\d)\b/g)) {
    if (occupied.some(([a, b]) => m.index! >= a && m.index! < b)) continue;
    const y = m[1]!;
    out.push({ at: m.index!, p: { start: `${y}-01-01`, end: `${y}-12-31`, label: y } });
  }
  return out.sort((a, b) => a.at - b.at).map(x => x.p).filter((p, i, all) => all.findIndex(o => o.start === p.start && o.end === p.end) === i);
}

/** A participant named in the question (whole name or first name, any case, Turkish letters optional). */
export function findPerson(q: string, people: readonly Participant[]): number | null {
  const f = foldAligned(q).replace(/[^\p{L}\p{N}\s']/gu, " ").replace(/\s+/g, " ").trim();
  const candidates = people.filter(p => !p.isMetaAI).flatMap(p => {
    const full = foldAligned(p.name).replace(/[^\p{L}\p{N}\s]/gu, " ").trim();
    const first = full.split(/\s+/)[0] ?? "";
    return [{ id: p.id, key: full }, ...(first.length >= 3 && first !== full ? [{ id: p.id, key: first }] : [])];
  });
  const matches: { id: number; score: number }[] = [];
  for (const c of candidates) {
    if (!c.key || candidates.some(d => d.key === c.key && d.id !== c.id)) continue;
    const escaped = c.key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = new RegExp(`(?:^|\\s)${escaped}(?:'?(nin|nun|in|un|ya|ye|dan|den|da|de|a|e))?(?=\\s|$)`, "u").exec(f);
    if (m) matches.push({ id: c.id, score: /^(nin|nun|in|un)$/.test(m[1] ?? "") ? 1 : 0 });
  }
  const best = Math.max(...matches.map(m => m.score));
  const ids = [...new Set(matches.filter(m => m.score === best).map(m => m.id))];
  return ids.length === 1 ? ids[0]! : null;
}

/** The search words a fact or temporal question is about: after "about"/"hakkında", or the quoted part. */
function topicOf(q: string): string | null {
  const quoted = q.match(/["“”«»']([^"“”«»']{2,})["“”«»']/);
  if (quoted) return `"${quoted[1]!.trim()}"`;
  const f = foldAligned(q).replace(/[?!.]+$/, "").trim();
  const en = f.match(/\b(?:about|mentioning|mentioned|mention|brought up|regarding|on the topic of|containing|with the words?)\s+(?:the\s+|a\s+|an\s+|our\s+|my\s+)?(.+)$/);
  if (en) return clean(en[1]!);
  const tr = f.match(/^(.+?)\s+(?:hakkinda|hakkindaki|ile ilgili|konusunda|konusundaki|gecen|gecen mesajlar|iceren)\b/);
  if (tr) return clean(tr[1]!.replace(/^(bana\s+)?/, ""));
  const tr2 = f.match(/^(.+?)['\s]?(?:ten|tan|den|dan)\s+(?:ilk|en son|son)\b/);
  if (tr2) return clean(tr2[1]!);
  return null;
}

const FILLER = /\b(messages?|mesajlar?i?|mesajlari|we|did|talk|talked|discuss|discussed|first|last|when|time|the|bul|goster|ara|find|show|search|for|me|all|our|ne zaman|ilk|son|en son|konustuk|bahsettik|kez|defa|bize|bana|mi|mu|chat|in the|in)\b/g;
function clean(s: string): string | null {
  const t = s.replace(FILLER, " ").replace(/\s+/g, " ").trim();
  return t.length >= 2 ? t : null;
}

const has = (f: string, re: RegExp) => re.test(f);

/** "last year", "this year", "last month", "last summer" (geçen yıl/sene, bu yıl, geçen ay, geçen yaz), relative to `now`. */
export function relativePeriod(f: string, now: number): Period | null {
  const d = new Date(now), y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
  const year = (yy: number, label: string): Period => ({ start: `${yy}-01-01`, end: `${yy}-12-31`, label });
  const month = (yy: number, mm: number): Period => ({ start: `${yy}-${pad(mm)}-01`, end: `${yy}-${pad(mm)}-${pad(lastDay(yy, mm))}`, label: `${MONTH_NAMES[mm - 1]} ${yy}` });
  if (/\b(gecen (yil|sene)|last year)\b/.test(f)) return year(y - 1, String(y - 1));
  if (/\b(bu (yil|sene)|this year)\b/.test(f)) return year(y, String(y));
  if (/\b(bu ay|this month)\b/.test(f)) return month(y, m);
  if (/\b(gecen ay|last month)\b/.test(f)) { const yy = m === 1 ? y - 1 : y, mm = m === 1 ? 12 : m - 1; return { start: `${yy}-${pad(mm)}-01`, end: `${yy}-${pad(mm)}-${pad(lastDay(yy, mm))}`, label: `${MONTH_NAMES[mm - 1]} ${yy}` }; }
  // The latest summer that has ended: June-August of this year from September on, else last year's.
  if (/\b(gecen yaz|last summer)\b/.test(f)) { const yy = m >= 9 ? y : y - 1; return { start: `${yy}-06-01`, end: `${yy}-08-31`, label: `summer ${yy}` }; }
  return null;
}

// "What did we talk about", "ne konuştuk", "messages from": asks for what was said in a period.
const WHAT_SAID = /\b(what did (we|you|i|\p{L}+) (talk|chat|say|write|discuss|text)\p{L}*|what was said|what happened|ne(ler)?(i)? (konus|yaz|de|soyle|oldu)\p{L}*|(messages?|mesajlar\p{L}*) (from|sent))\b/u;
// Words that only name the period ("last week", "geçen hafta", "dün", "March 2024").
const PERIOD_WORDS = new RegExp(`\\b(yesterday|today|last|this|week|month|year|summer|dun(ku)?|bugun(ku)?|gecen|bu|hafta(ki|da)?|ay(ki|da)?|yil(ki|da)?|sene|yaz(in)?|ta|te|da|de|ki|(${Object.keys(MONTHS).join("|")})\\p{L}*|\\d+\\p{L}*)\\b`, "gu");

/** Every relative period the question names, in the order written ("geçen ay ile bu ayı karşılaştır"). */
export function relativePeriods(f: string, now: number): Period[] {
  const found: { at: number; p: Period }[] = [];
  for (const re of [/\b(bu ay\p{L}*|this month)\b/u, /\b(gecen ay\p{L}*|last month)\b/u, /\b(bu (yil|sene)\p{L}*|this year)\b/u, /\b(gecen (yil|sene)\p{L}*|last year)\b/u]) {
    const m = re.exec(f);
    // Each phrase alone, normalised to the form relativePeriod reads ("bu ayı" -> "bu ay").
    const p = m && relativePeriod(m[0].replace(/^(bu|gecen) (ay|yil|sene)\p{L}*$/u, "$1 $2"), now);
    if (m && p) found.push({ at: m.index, p });
  }
  return found.sort((a, b) => a.at - b.at).map((x) => x.p);
}

/** "yesterday", "today", "last week" (dün, bugün, geçen hafta): only for asking what was said then, never to narrow
    a search, where the words are as likely to be part of the message looked for ("bugün geliyorum"). */
function recentPeriod(f: string, now: number): Period | null {
  const d = new Date(now), iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const today = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const days = (a: number, b: number): Period => ({ start: iso(a), end: iso(b), label: a === b ? iso(a) : `${iso(a)} – ${iso(b)}` });
  if (/\b(yesterday|dun)\b/.test(f)) return days(today - DAY, today - DAY);
  if (/\b(today|bugun)\b/.test(f)) return days(today, today);
  // The last whole Monday-to-Sunday week.
  if (/\b(gecen hafta|last week)\b/.test(f)) { const monday = today - (((d.getUTCDay() + 6) % 7) + 7) * DAY; return days(monday, monday + 6 * DAY); }
  return null;
}
const DAY = 86_400_000;

// Recall: asking to find a past exchange, by what was said rather than exact words.
const REPLY = /\b(ne (cevap|yanit) ver\p{L}*|ne (dedi|demisti|demis|soyledi|soylemisti)|nasil (cevap|yanit|tepki) ver\p{L}*|ne tepki|what did (?!we\b)\p{L}+ (say|reply|answer|respond)|how did \p{L}+ (react|respond|reply))\b/u;
const RECALL_NOUN = /\b(konusma\p{L}*|sohbet\p{L}*|mesaj\p{L}*|zaman(lar\p{L}*|i|da)?|an(lar\p{L}*|i)?)\b/u;
// Turkish relative clauses: söylediğim, konuştuğumuz, dediğimiz, bahsettiğimiz, özlediğimi.
const CLAUSE = /\b\p{L}{2,}[dt][iu]g(i|u)?\p{L}*\b/u;
const PAST_WHEN = /\bne zaman\b.*\b\p{L}+(tik|dik|tuk|duk|din|tin|dim|tim|mistik|mistim)\b/u;
const EN_RECALL = /\b((conversations?|messages?|chats?) (where|when|in which)|(when|where) (did|do) (we|i|you|she|he|they)\b|remember when|the time (when )?(i|we|you|she|he)|when (i|we|you|she|he) (said|told|talked|discussed|bought|asked|mentioned))/;
// First/last mentions keep their deterministic path; a plain keyword request
// ("messages about X", "X hakkındaki mesajlar") keeps exact search unless the
// question is clearly about a past exchange ("when did we talk about X").
const FIRST_LAST = /\b(ilk|en son|first|last time|last message|earliest|latest|(first|last) (mention|talk|spoke|speak|discuss|said|brought up)\p{L}*)\b/u;
const KEYWORD = /\b(hakkinda\p{L}*|ile ilgili|iceren|about|containing|mentioning)\b|^\S+ gecen\b/u;

export function isRecall(f: string): boolean {
  if (FIRST_LAST.test(f)) return false;
  if (/\b(find|show) (where|when)\b/u.test(f)) return true;
  if (/\b(find|show|bul|goster)\b/u.test(f) && /\b(conversations?|exchanges?|konusma\p{L}*|sohbet\p{L}*)\b/u.test(f)) return true;
  if (KEYWORD.test(f) && !(REPLY.test(f) || EN_RECALL.test(f) || PAST_WHEN.test(f))) return false;
  if (/\b(kac|how many|toplam|total)\b/.test(f)) return false;
  return REPLY.test(f) || EN_RECALL.test(f) || PAST_WHEN.test(f) || (RECALL_NOUN.test(f) && (CLAUSE.test(f) || /\b(bul|goster|hangi|hatirl\p{L}*|find|show)\b/u.test(f)));
}

/** A media category or placeholder kind named in the question ("photos", "fotoğraf", "silinen"). */
function countKind(f: string): CountKind | null {
  if (/\b(voice (notes?|messages?)|sesli( mesaj\p{L}*| not\p{L}*)?|ses kayd\p{L}*)\b/u.test(f)) return "Voice notes";
  if (/\b(photos?|pictures?|pics?|images?|fotograf\p{L}*|foto|resim\p{L}*)\b/u.test(f)) return "Photos";
  if (/\b(videos?|video\p{L}*)\b/u.test(f)) return "Videos";
  if (/\b(stickers?|cikartma\p{L}*)\b/u.test(f)) return "Stickers";
  if (/\b(gifs?|gif\p{L}*)\b/u.test(f)) return "GIFs";
  if (/\b(media|medya\p{L}*)\b/u.test(f)) return "media";
  if (/\b(documents?|files?|belge\p{L}*|dosya\p{L}*)\b/u.test(f)) return "Documents";
  if (/\b(deleted|silin\p{L}*)\b/u.test(f)) return "deleted";
  return null;
}

/** A change over time ("did we talk less lately", "cevap sürelerimiz değişti mi"): recent weeks against the weeks before,
    for the aspect asked about. A question about something said ("when did we talk about changing jobs") is not this. */
function trend(f: string, person: number | null, period: Period | null): Plan | null {
  if (!/\b(chang\p{L}*|degis\p{L}*|evolv\p{L}*|trend\p{L}*|increas\p{L}*|decreas\p{L}*|declin\p{L}*|dropp?\p{L}*|art(ti|mis|iyor)\p{L}*|azal\p{L}*|lately|recently|son zamanlarda|son aylarda|eskisi gibi|eskiye gore|than before|oncekine gore|used to)\b/u.test(f)) return null;
  if (/\b(about|hakkinda\p{L}*|ile ilgili|bahs\p{L}*|mention\p{L}*)\b/u.test(f) || REPLY.test(f) || EN_RECALL.test(f) || PAST_WHEN.test(f)) return null;
  const plan = (aspect: TrendAspect): Plan => ({ type: "statistic", metric: "trend", person, period, aspect });
  if (/\b(repl(y|ies|ied)|respon\p{L}*|answer\p{L}*|cevap\p{L}*|yanit\p{L}*|geri don\p{L}*)\b/u.test(f)) return plan("response_time");
  if (/\b(start\p{L}*|initiat\p{L}*|baslat\p{L}*|ilk yaz\p{L}*)\b/u.test(f)) return plan("starter");
  if (/\b(share|balance|pay\p{L}*|denge\p{L}*|oran\p{L}*)\b/u.test(f) || (/\b(who|kim|hangimiz)\b/.test(f) && /\b(messages?|mesaj\p{L}*|writ\p{L}*|yaz\p{L}*|talk\p{L}*|konus\p{L}*)\b/u.test(f))) return plan("share");
  if (/\b(messag\p{L}*|mesaj\p{L}*|text\p{L}*|habit\p{L}*|aliskanlik\p{L}*|talk\p{L}*|chat\p{L}*|konus\p{L}*|frequen\p{L}*|sikli\p{L}*|often|activ\p{L}*|aktif\p{L}*|yogun\p{L}*|yazis\p{L}*|mesajlas\p{L}*)\b/u.test(f)) return plan("activity");
  return null;
}

/** The dashboard's figures, asked in words. Comparisons of behaviour are not here: they need validated rules. */
function statistic(f: string, person: number | null, period: Period | null, now: number): Plan | null {
  const plan = (metric: StatisticMetric, kind: CountKind | null = null, slowest = false): Plan => ({ type: "statistic", metric, person, period, kind, ...(slowest ? { slowest } : {}) });
  const who = /\b(who|kim|hangimiz|which of us)\b/.test(f);
  const often = /\b(more|most|often|usually|generally|always|mostly|daha|genelde|genellikle|hep|cogu|cok|sik\p{L}*|fazla)\b/u.test(f);
  if (/\b(repl(y|ies|ied)|respond\p{L}*|answer\p{L}*|cevap\p{L}*|yanit\p{L}*|geri don\p{L}*)\b/u.test(f)
    && /\b(fast\p{L}*|quick\p{L}*|slow\p{L}*|how long|how soon|longest|late|ne kadar|ne kadar surede|hizli|yavas|en uzun|en gec|gec|sure\p{L}*|response time)\b/u.test(f))
    return plan("response_time", null, /\b(slow\p{L}*|longest|late|yavas|en uzun|en gec|gec)\b/u.test(f));
  // Average length per person; one longest message is not a figure the statistics keep.
  if (/\b(longer|shorter|lengthier|length|uzun|kisa|uzunlug\p{L}*|words per|kelime sayi\p{L}*)\b/u.test(f) && /\b(messages?|msgs?|mesaj\p{L}*|texts?|yaz\p{L}*|writ\p{L}*)\b/u.test(f)
    && !/\b(longest|shortest|en uzun|en kisa)\s+(message|mesaj\p{L}*|text)\b/u.test(f)) return plan("message_length");
  if (who && /\b(start\p{L}*|initiat\p{L}*|begin\p{L}*|baslat\p{L}*|once yaz\p{L}*|ilk yaz\p{L}*)\b/u.test(f)) return plan("conversation_starter");
  if (who && often && /\b(first|ilk)\b/.test(f)) return plan("conversation_starter");
  if (/\b(how long have we|since when|ne zamandir|ne zamandan beri|first message|ilk mesaj\p{L}*|when did (we|this chat|our chat) (start|begin)|ne zaman basla\p{L}*)\b/u.test(f)) return plan("chat_span");
  if (/\b(streak|in a row|consecutive|ust uste|art arda|araliksiz)\b/.test(f)) return plan("longest_streak");
  if (/\bemoji\p{L}*/u.test(f)) return plan(/\b(how many|kac|toplam|total|number of)\b/.test(f) ? "emoji_count" : "top_emoji");
  if (/\b(words?|kelime\p{L}*|sozcu\p{L}*)\b/u.test(f) && /\b(most|top|common|frequent|used|en cok|en fazla|sik\p{L}*|hangi|which|kullan\p{L}*)\b/u.test(f)) return plan("top_words");
  if (/\b(what time|which hour|what hour|time of day|hangi saat\p{L}*|saat kac\p{L}*|kacta)\b/u.test(f)
    || /\bwhen (are|do) we\b.*\b(most active|talk (the )?most|usually (talk|chat))\b/.test(f) || /\b(en cok|en fazla|genelde) ne zaman\b|\bne zaman (en cok|daha cok|en fazla)\b/.test(f)) return plan("peak_hour");
  if (who && /\b(night|nights|late at night|night owl|gece|geceleri|gecenin|gece yarisi)\b/u.test(f)) return plan("night_owl");
  if (/\b(which|hangi|what)\b.*\b(month|ay|ayda|ayi)\b/u.test(f) && /\b(most|more|daha cok|en cok|en fazla|busiest)\b/.test(f)) return plan("busiest_month");
  // Two named periods compared: "did we talk more in 2024 than in 2023", "2023'te mi 2024'te mi daha çok konuştuk",
  // "geçen ay ile bu ayı karşılaştır".
  const periods = [...findPeriods(f), ...relativePeriods(f, now)];
  if (periods.length >= 2 && /\b(more|less|than|vs|versus|compare\p{L}*|daha|mi|mu|yoksa|karsilastir\p{L}*|fark\p{L}*)\b/u.test(f))
    return { type: "statistic", metric: "compare_periods", person, period: null, periods };
  if (/\b(weekdays?|day of the week|days of the week|haftanin hangi gun\p{L}*|hangi haftanin gun\p{L}*)\b/u.test(f)) return plan("busiest_weekday");
  if (/\b(how many days|kac gun|active days|aktif gun\p{L}*|per day|a day|daily average|gunde|gunluk|gun basina)\b/u.test(f)) return plan("active_days");
  const kind = countKind(f);
  if (kind && /\b(how many|kac|toplam|total|number of|count)\b/.test(f)) return plan("message_count", kind);
  if (kind && who && often) return plan("kind_by_person", kind);
  return null;
}

/** "14 Şubat'ta ne konuştuk", "what did we talk about on 3 March 2024", "messages from 12/04/2024": the day messages were sent.
    The date must be the place in time (Turkish locative, English "on"/"from"), and mentioning it ("12 Nisan geçen mesajlar") is not this. */
function sentOn(question: string, f: string): Plan | null {
  const dates = extractDates(question).filter((d) => d.kind === "date");
  if (dates.length !== 1 || has(f, /\b(mention\p{L}*|gecen|bahsed\p{L}*|bahset\p{L}*|hakkinda\p{L}*|refer\p{L}*)\b/u)) return null;
  const d = dates[0]!;
  // The suffix may be inside the recognised date ("14 Şubat'ta") or follow it ("3 Mart 2024'te").
  const locative = /['’]?\s*(t|d)(a|e)(ki)?$/iu.test(d.text) || /^\s*['’]?\s*(t|d)(a|e)(ki)?\b/iu.test(question.slice(d.end));
  const preposition = /\b(on|from|sent on|of)\s+(the\s+)?$/iu.test(question.slice(0, d.start));
  const said = has(f, /\b(ne|neler|neyi|kim|what|who|which|messages?|mesaj\p{L}*|konus\p{L}*|yaz\p{L}*|soyle\p{L}*|talk\p{L}*|say|said|chat\p{L}*|discuss\p{L}*|happen\p{L}*|olmus|oldu|show|goster)\b/u);
  if (!(locative || preposition) || !said) return null;
  return { type: "temporal", which: "on_date", day: d.day!, month: d.month!, year: d.year ?? null, period: null };
}

export function route(question: string, people: readonly Participant[], now = Date.now()): Plan {
  const f = foldAligned(question).replace(/\s+/g, " ").trim();
  // "Last month" scopes a count exactly as "March 2024" does, not only a recall question.
  let period = findPeriod(question) ?? relativePeriod(f, now);
  const person = findPerson(question, people);

  // Explicit literal search is a chat action, not a guess about an unknown question.
  const literal = question.trim().match(/^(?:search|ara)\s*:\s*(.+)$/isu);
  if (literal?.[1]?.trim()) return { type: "fact", search: literal[1].trim(), person: null, period: null, exact: true };

  // What was said on a calendar day: messages sent that day ("14 Şubat'ta", "on 3 March"), not mentions of it.
  const onDay = sentOn(question, f);
  const countRequest = /\b(how many|kac|toplam|total|count|number of)\b/.test(f) && /\b(messages?|msgs?|mesaj\p{L}*)\b/u.test(f);
  if (onDay && onDay.type === "temporal" && onDay.which === "on_date" && countRequest && onDay.year !== null) {
    const iso = `${onDay.year}-${pad(onDay.month)}-${pad(onDay.day)}`;
    period = { start: iso, end: iso, label: iso };
  } else if (onDay) return onDay;
  if (countRequest && /\b(on|from|tarihinde)\b/u.test(f) && extractDates(question).some(d => d.kind === "ambiguous" && d.reason === "day_month_order"))
    return { type: "unsupported", reason: "not_understood", suggestion: null };

  // "What did we talk about yesterday / last week", "dün ne konuştuk": the messages of that period, not messages with those words.
  const said = period ?? recentPeriod(f, now);
  if (said && WHAT_SAID.test(f)) {
    const named = person === null ? null : foldAligned(people.find((p) => p.id === person)?.name ?? "").split(/\s+/);
    const rest = f.replace(WHAT_SAID, " ").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(PERIOD_WORDS, " ")
      .replace(/\b(about|hakkinda|we|you|i|the|our|me|biz|siz|in|on|during|from|ile|with)\b/g, " ").split(/\s+/)
      .filter((w) => w && !named?.some((n) => w.startsWith(n)));
    if (!rest.length) return { type: "temporal", which: "in_period", period: said, person };
  }

  // Judgements and syntheses this engine cannot make; finding a message that says something is still recall.
  const mentions = extractDates(question).filter(d => d.kind === "date");
  if (mentions.length === 1 && /\b(mention\p{L}*|gecen|bahsed\p{L}*|bahset\p{L}*)\b/u.test(f)) {
    const d = mentions[0]!;
    return { type: "temporal", which: "mentions_date", day: d.day!, month: d.month!, year: d.year ?? null, period: null };
  }
  const recallShaped = isRecall(f);
  // Feelings, intentions and the relationship are never inferred, with or without a model.
  if (!recallShaped && has(f, /\b(feel|feels|felt|hissed\w*|duygu\w*|relationship|iliski\w*|sevi|love|loves (me|her|him)|in love|seviyor mu|asik|important|onemli|angry|upset|mad at|jealous|annoyed|kizgin|kizdi|sinirli|kiskan\w*|kirgin|kustu|kusmus|alindi)\b/)) {
    return { type: "unsupported", reason: "needs_understanding", suggestion: topicOf(question) };
  }
  // A change in how often, how fast or who: the figures of recent weeks against the weeks before ("why" stays a reason question).
  const change = has(f, /\b(why|neden|niye|nicin)\b/) ? null : trend(f, person, period);
  if (change) return change;
  // A reason or a decision cannot be stated, but the messages about it can be found.
  // Summaries, disagreements and changes of mind are found as messages; the engine cannot summarise them.
  const limitation = recallShaped ? null : has(f, /\b(why|neden|niye|nicin)\b/) ? "reason" as const
    : has(f, /\b(what did we (decide|agree|settle)|did we (decide|agree)|karar\w*|kararlastir\w*|anlastik|anlasmis\w*|decide[ds]?|decision)\b/) ? "decision" as const
    : has(f, /\b(summari[sz]e|summary|ozet\w*|disagree\w*|anlasmazlik\w*|tartis\w*|kavga\w*|argue\w*|arguments?|change(d)? (our|his|her|their) mind|fikr\w* degis\w*|never confirm\w*|vazgectigimiz)\b/) ? "summary" as const : null;
  const recall = (fallback: boolean): Plan => ({ type: "recall", topic: question.trim(), period, reply: REPLY.test(f), speakerWords: /\b(ben|bana|benim|ona|onu|onun|o|i|me|my|she|he|her|him)\b/.test(f), limitation, fallback });
  if (limitation) return recall(false);

  // Finding a past conversation, or the reply to something said: hybrid retrieval.
  if (recallShaped) return recall(false);

  // Conversation topics: frequent words are not topics, so this is said rather than guessed.
  if (/\b(topics?|subjects?|konular\p{L}*|konusu(nu)?|konulari\p{L}*)\b/u.test(f) && /\b(what|which|most|main|common|frequent|ne|neler|hangi|en cok|en fazla|genelde|sik)\b/u.test(f))
    return { type: "unsupported", reason: "topics", suggestion: null };

  // Explicit plan-message requests use the existing timeline; no plan states are inferred.
  const planNoun = /\b(plans?|appointments?|planlar\p{L}*|randevular\p{L}*|bulusmalar\p{L}*)\b/u;
  if (planNoun.test(f) && (/^(?:show|find|list|plans?|planlar\p{L}*|what|which|hangi)\b/u.test(f) || /\b(goster|listele|neler|nelerdi)\b/u.test(f))) {
    if (/\b(confirmed|cancelled|completed|final|agreed|kesinles|gercekles|iptal|tamamlan)/u.test(f))
      return { type: "unsupported", reason: "needs_understanding", suggestion: topicOf(question) };
    const residual = f.replace(/\b(plans?|appointments?|planlar\p{L}*|randevular\p{L}*|bulusmalar\p{L}*|show|find|list|goster|listele|our|my|the|all|time|tum|butun|hepsi|what|which|did|do|we|make|made|have|had|discuss\p{L}*|talk\p{L}*|hangi|neler|nelerdi|yaptik|yapmistik|yaptigimiz|konus\p{L}*)\b/gu, " ")
      .replace(/\b(?:19|20)\d{2}(?:'?(?:te|ta|de|da))?\b/gu, " ").replace(/[?.,!]/g, " ").trim();
    const timeWords = /^(in|from|during|between|since|before|after|last|next|this|summer|winter|spring|autumn|fall|yesterday|today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|gecen\p{L}*|gelecek\p{L}*|bu|yaz\p{L}*|kis\p{L}*|bahar\p{L}*|sonbahar\p{L}*|hafta\p{L}*|bugun\p{L}*|dun\p{L}*|yarin\p{L}*|tarih\p{L}*|aras\p{L}*|donem\p{L}*|once|sonra|ve|and|pazartesi|sali|carsamba|persembe|cuma|cumartesi|pazar)$/u;
    if (residual.split(/\s+/).some((word) => word && !(word in MONTHS) && !timeWords.test(word)))
      return { type: "unsupported", reason: "not_understood", suggestion: topicOf(question) };
    const ambiguous = /\b(last|next|this|summer|winter|spring|autumn|fall|from|since|before|after|between|gecen|gelecek|bu|yaz|kis|bahar|sonbahar|once|sonra)/u.test(f);
    return { type: "timeline", period, needsRange: ambiguous || (!period && !!residual) || extractDates(question).length > 0 };
  }

  // "Who says 'haha' more", "kim daha çok 'canım' yazıyor": messages with those words, per person.
  const phrase = question.match(/["“”«»'‘’]([^"“”«»'‘’]{2,})["“”«»'‘’]/)?.[1]?.trim()
    ?? f.match(/\bwho (?:says|uses|writes|types) (.+?) (?:more|most|often)\b/)?.[1];
  if (phrase && has(f, /\b(who|kim|hangimiz|which of us)\b/) && has(f, /\b(more|most|often|daha|en cok|fazla)\b/))
    return { type: "fact", search: /\s/.test(phrase) ? `"${phrase}"` : phrase, person: null, period, exact: true, byPerson: true };

  const metric = statistic(f, person, period, now);
  if (metric) return metric;
  // The single longest message is not kept by the statistics: "the longest message" must not read as "who writes more".
  if (has(f, /\b(longest|shortest|en uzun|en kisa)\b/) && has(f, /\b(messages?|mesaj\w*|texts?|yaz\w*|write\w*)\b/))
    return { type: "unsupported", reason: "not_measured", suggestion: null };

  // Behaviour comparisons ("who … more", "kim daha çok …").
  const who = has(f, /\b(who|kim|hangimiz|which of us)\b/);
  const howOften = has(f, /\b(kac kez|kac defa|kac kere|how many times|how often|ne siklikla)\b/);
  const behaviourWord = has(f, /\b(apologi[sz]|sorry|ozur|kusura|cancel|iptal|vazgec|accept|kabul|suggest|propos|invit|oner|davet|bulus|postpon|ertele)/);
  if ((who && has(f, /\b(more|most|often|usually|generally|daha|en cok|cok|sik|fazla|genelde|genellikle)\b/)) || (howOften && behaviourWord)) {
    // Not validated: checked first, so "postpones plans" is not read as "plans".
    if (has(f, /\b(postpon|reschedul|ertele|delay)/)) return { type: "unsupported", reason: "behaviour_not_validated", suggestion: null };
    // "How many times did Can apologise" is Can's count; "who apologises more" compares everyone.
    const one = who ? null : person;
    if (has(f, /\b(apologi[sz]|sorry|ozur|kusura)/)) return { type: "behaviour", behaviour: "apology", period, person: one };
    if (has(f, /\b(cancel|call(s|ing)? off|bail|iptal|vazgec|gelemi)/)) return { type: "behaviour", behaviour: "cancellation", period, person: one };
    if (has(f, /\b(accept|agree|says? yes|kabul|onayl|evet de)/)) return { type: "behaviour", behaviour: "acceptance", period, person: one };
    if (has(f, /\b(suggest|propos|invit|meet|plan|activit|bulus|gorus|oner|davet|teklif|disari cik)/)) return { type: "behaviour", behaviour: "proposal", period, person: one };
    if (has(f, /\b(start|initiat|begin|first message|baslat|ilk yazan|ilk mesaj)/)) return { type: "statistic", metric: "conversation_starter", person: null, period };
    if (has(f, /\b(messages?|msgs?|mesaj|yaz|write|writes|text|chat|talk|konus)/) && !has(f, /\b(about|hakkinda)\b/)) return { type: "statistic", metric: "messages_by_person", person: null, period };
    if (who) return { type: "unsupported", reason: "behaviour_not_validated", suggestion: null };
  }

  // Counts.
  if (has(f, /\b(how many|kac|toplam|total|number of)\b/) && has(f, /\b(messages?|msgs?|texts|mesaj)/) && !has(f, /\b(about|hakkinda|ile ilgili)\b/)) {
    return { type: "statistic", metric: "message_count", person, period };
  }
  if (has(f, /\b(busiest|most active|en yogun|en aktif|en cok konustugumuz|en hareketli)\b/) && has(f, /\b(month|ay|ayi)\b/)) {
    return { type: "statistic", metric: "busiest_month", person: null, period };
  }
  // "En çok hangi gün konuşmuşuz?": the dashboard's busiest calendar day.
  if (has(f, /\b(busiest|most active|most messages|the most|en yogun|en aktif|en cok|en fazla|en hareketli)\b/) && has(f, /\b(days?|date|gun\p{L}*|tarih\p{L}*)\b/u) && !has(f, /\b(about|hakkinda|ile ilgili)\b/)) {
    return { type: "statistic", metric: "busiest_day", person: null, period };
  }

  // A specific calendar day ("12 April", "12 Nisan").
  const dates = extractDates(question).filter((d) => d.kind === "date");
  if (dates.length === 1 && has(f, /\b(mention|mentions|mentioning|gecen|bahsed|bahset|about|hakkinda|show|goster|messages?|mesaj|discussions?|konusma)/)) {
    const d = dates[0]!;
    return { type: "temporal", which: "mentions_date", day: d.day!, month: d.month!, year: d.year ?? null, period: null };
  }

  // First / last mention of a topic.
  const topic = topicOf(question);
  if (topic && has(f, /\b(first|ilk|earliest)\b/)) return { type: "temporal", which: "first", search: topic, person, period };
  if (topic && has(f, /\b(last|latest|en son|son|most recent)\b/)) return { type: "temporal", which: "last", search: topic, person, period };

  // Finding messages.
  if (topic) return { type: "fact", search: topic, person, period, exact: false };
  if (has(f, /^(find|search|show|bul|ara|goster)\b/)) {
    const rest = clean(f.replace(/^(find|search|show|bul|ara|goster)\s+/, ""));
    if (rest) return { type: "fact", search: rest, person, period, exact: false };
  }
  // A count or comparison no statistic covers ("who sends longer messages?") is not answered with whatever messages
  // share its words: related messages are not a figure.
  if (has(f, /\b(how many|how much|kac|average|ortalama|longer|shorter|longest|shortest|daha uzun|daha kisa|en uzun|en kisa|kim daha|hangimiz daha|en cok|en fazla|most used|percentage|yuzde)\b/)
    || has(f, /\b(who|which of us)\b(\s+\S+){0,4}\s+(more|most|less|least|faster|slower)\b/))
    return { type: "unsupported", reason: "not_measured", suggestion: null };
  // Trends need two periods to compare; asked loosely they are not answered with related messages.
  if (has(f, /\b(chang\w*|degis\w*|evolv\w*|trend\w*)\b/) && has(f, /\b(messag\w*|mesaj\w*|habit\w*|aliskanlik\w*|talk\w*|konus\w*|frequen\w*|sikli\w*)\b/))
    return { type: "unsupported", reason: "not_measured", suggestion: null };
  // Anything else that says something: find the related messages.
  if (contentTerms(question).length) return recall(true);
  return { type: "unsupported", reason: "not_understood", suggestion: null };
}
