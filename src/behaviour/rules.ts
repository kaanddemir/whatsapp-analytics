/* Behaviour cues, Turkish and English: does the SENDER of this message
   propose meeting up, accept a proposal, apologise or cancel?

   Matching constraints:
   - Cues are first-person or hortative forms, not bare word stems. Turkish
     morphology marks the person on the verb, so "özür dilerim" (I apologise)
     counts and "özür diledi" (she apologised), "gelemiyormuş" (apparently he
     can't come) do not. English cues need an I/we subject or must open the
     sentence ("sorry, …"); a third-party subject ("the airline apologised",
     "Selin can't make it") does not count.
   - Negation of the cue ("buluşmayalım", "I'm not sorry"), reported speech
     ("dedi", "said", quotes), talk about the behaviour ("why do you always
     apologise") and questions about it ("did you apologise?") are excluded.
   - Meeting proposals need a social verb or activity ("buluşalım",
     "kahve içelim", "let's grab dinner"); other suggestions ("faturayı
     ödeyelim mi", "let's see") are not proposals to meet.
   - Acceptance only counts as a reply to a proposal by someone else.
   - Text is folded first (case, Turkish letters, stretched letters), so
     "gorusuruz", "Görüşürüz" and "görüşürüüüz" are one form.

   Sarcasm and irony are not detected; that limitation is stated wherever
   results are shown. Accuracy is measured on a blind labelled set (see
   docs/ARCHITECTURE.md); only behaviours that pass the
   gates are presented as comparisons (catalog.ts). */
import { collapseStretch, foldAligned } from "@/text/fold";

export type Behaviour = "proposal" | "acceptance" | "apology" | "cancellation";
export const BEHAVIOURS: readonly Behaviour[] = ["proposal", "acceptance", "apology", "cancellation"];

/** Folded, stretched letters collapsed, apostrophes kept, spaces normalised. */
export function normalise(text: string): string {
  return collapseStretch(foldAligned(text)).replace(/\s+/g, " ").trim();
}

const rx = (parts: readonly string[], flags = "u") => new RegExp(parts.join("|"), flags);

// Shared exclusions.
/** Reported speech: someone else's words. */
const QUOTED = /["“”«»]|(^|\s)'[^']{3,}'|\b(dedi|diyor|demis|dediler|diye|yazmis|yazdi|soyledi|said|says|told me|texted|wrote|asked if)\b/u;

// Proposal.
// Social verbs in Turkish hortative / suggestion forms (folded: ç->c, ş->s, ğ->g, ı->i, ö->o, ü->u).
const TR_SOCIAL = "(bulus|gorus|cik|gid|git|gel|otur|ic|ye|yiy|toplan|in|yuru|bin|ugra|takil|izle|kahvalt|piknik|gez|dolas|bak|yuz|kos|calis)";
const PROPOSAL_TR = rx([
  // Hortative 1st plural ("buluşalım", "gidelim mi", "çıkak"), "-sak / -sek" suggestions ("buluşsak", "gitsek mi")
  `\\b${TR_SOCIAL}(?![aeiu]?r(sak|sek)\\b)\\p{L}{0,4}?(alim|elim|yalim|yelim|ak|ek)\\b`,
  // ...but not the aorist conditional ("gidersek", "gelirsek", "yersek": "if we go / come / eat").
  `\\b${TR_SOCIAL}(?![aeiu]?r(sak|sek)\\b)\\p{L}{0,3}?(sak|sek)\\b`,
  // "yapalım / yapsak" only with an activity or meal
  "\\b(kahve|cay|yemek|yemege|kahvalti|piknik|sinema|sinemaya|yuruyus|yuruyuse|mac|maca|konser|alisveris|bira|spor|spora|muze|muzeye|plan)\\b.{0,25}\\b(yapal|yapsak|icel|iceriz|gidel|cikal|edel)",
  // invitations
  "\\b(gelsene|gelsenize|ugrasana|bize gel|bana gel|gelir misin|gelmek ister misin|ugrar misin|ugrayayim mi|katilir misin)\\b",
  "\\bmusait(sen| misin| misiniz| oldugunda)\\b",
  "\\b(ne dersin|ne dersiniz|nasil olur)\\b",
  "\\b(bulusmaya|gorusmeye|cikmaya)\\b.{0,15}\\b(ne dersin|var misin)\\b",
  "\\bhadi\\b.{0,30}\\b\\p{L}+(alim|elim)\\b",
  "\\b(let'?s|lets) meet\\b", "\\bmeet up\\?",
]);
// English: "let's" + social verb; invitations; availability questions with a plan.
const PROPOSAL_EN = rx([
  "\\b(let'?s|lets) (meet|grab|go|get|have|do|hang|catch|take|plan|head|try|play|watch|eat|walk|ride)\\b",
  "\\b(wanna|want to|wana) (meet|grab|go|get|have|hang|come|catch|join|see|do|eat|watch|walk|ride)\\b",
  "\\b(shall we|should we) (meet|go|grab|get|do|hang|have|catch)\\b",
  "\\b(how about|what about) (we\\b|i\\b|meeting|grabbing|going|getting|having|dinner|lunch|coffee|brunch|drinks|a |the |some )",
  "\\b(are you|r u|u|you) (free|around|up for|down for)\\b",
  "\\b(up for|down for|free for|fancy) (a |an |some |the )?\\p{L}+",
  "\\bwe (should|could) (hang|meet|go|get|grab|catch|do|see|have|try)\\b",
  "\\b(come over|come with us|come with me|come thru|come through|drop by|swing by|join me|join us|meet me)\\b",
  "\\bcan we (meet|hang|get together|grab|catch up)\\b",
  "\\b(let'?s|lets) get together\\b",
]);
// Generic suggestions need an actual social activity; availability alone is retained as a wording cue.
const SOCIAL_ACTIVITY = /\b(meet\p{L}*|hang|catch up|grab (smth|something|a bite)|come over|come (with|thru|through)|drop by|swing by|join (me|us)|coffee|tea|drinks?|dinner|lunch|brunch|breakfast|movies?|cinema|concert|walk|park|beach|pub|bar|restaurant|tennis|football|kahve\p{L}*|cay|bulus\p{L}*|gorus\p{L}*|sahil\p{L}*|yemek|yemege|sinema\p{L}*|takil\p{L}*|gez\p{L}*|yuruyus\p{L}*)\b/u;
const GENERIC_SUGGESTION = /\b(let'?s|lets|how about|what about|we (should|could)|ne dersin|nasil olur)\b/u;
const PROPOSAL_NOT = rx([
  // negated hortatives / refusals of going out
  "\\b\\p{L}+(mayal|meyel|mayay|meyey|mayalim|meyelim)\\p{L}*",
  "\\b(let'?s|lets) (not|see|hope|just|pay|wait|forget|be honest|face it)\\b",
  "\\b(don'?t|do not) want to (go|meet|hang)\\b", "\\bshouldn'?t (hang|meet|go)\\b", "\\bno plans\\b",
  "\\bhow about that\\b", "\\bcome on\\b",
  // talk about proposing
  "\\b(neden|niye) (hep|surekli)?.{0,10}(oner|bulus|plan)", "\\bsurekli plan yapan\\b", "\\bonermekten\\b",
  "\\b(always|never) (the one )?(suggest|plan)", "\\bnever suggest\\b", "\\btired of planning\\b", "\\bwhy do you always\\b",
]);
// Questions that ask about a plan rather than propose one ("geliyor musun?", "are you coming?").
const PROPOSAL_QUESTION_ONLY = /^(?!.*(\p{L}(alim|elim|ak|ek|sak|sek)\b|\b(ister misin|ne dersin|let'?s|wanna|want to|how about|what about|shall we|free|up for|fancy|meet up)\b)).*\?$/u;
// A bare activity with a time, asked as a question ("yarın kahve?", "drinks tn?", "brunch next week??").
const ACTIVITY_QUESTION = /^(\p{L}+ ){0,2}(kahve|cay|yemek|yemege|kahvalti|sinema|bira|mac|brunch|coffee|drinks?|dinner|lunch|movies?|the game|the movies|the park|meet up)\b[^?]{0,30}\?+$/u;
const ASKS_ABOUT_PAST = /\b(nasildi|nasil gecti|ne zaman|kacta|nerede|how was|was it|did you|when is|what time)\b|\p{L}(din|tin|dun|tun|diniz|tiniz) mi\b/u;

// Acceptance (a reply).
const ACCEPT_START = rx([
  "^(olur|olurr|tamam|tamamdir|tmm|tm|ok|okk|okey|okay|k|kk|anlastik|uyar|bana (da )?uyar|super|harika|tabii|tabi|tabiki|tabii ki|kesin|kesinlikle|evet|evt|varim|ben varim|geliyorum|gelirim|ugrarim|olsun|uygunum|gidelim|cikalim|bence de|cok iyi olur|harika fikir|olur olur)(?=$|[\\s,.!🙂😊🙏👍]|\\s*$)",
  "^(sure|sure thing|ok|okay|k|kk|deal|yes|yep|yeah|yup|yess|perfect|absolutely|definitely|of course|great idea|love to|happy to|bet|done|cool|ok cool|i'?m in|count me in|i'?m down|sounds good|sounds great|sounds like a plan|works for me|that works|see you then|see you there|i'?ll be there|yes let'?s|yes please|totally|ok sure|ok \\d+ it is)(?=$|[\\s,.!🙂😊🙏👍])",
]);
const ACCEPT_NOT = rx([
  "\\b(maybe|perhaps|possibly|probably|i guess|if i can|not sure|not certain|belki|kesin degil|emin degilim|bilmiyorum|belli degil)\\b",
  "^(olur|tamam) (da|de|mi|mu)\\b", "^(yes|evet)[,.]? (why|neden|ne icin)\\b",
  "\\b(olmaz|maalesef|hayir|gelemem|gelemiyorum|istemiyorum|musait degilim|yok ya|kesmez|keske)\\b", "\\bama\\b", "\\bbut\\b",
  "\\b(can'?t|cannot|no|not|nah|busy|rather not|wish i could)\\b",
  // "tamam mı?", "olur mu?": a question back, not a yes
  "^(tamam|olur|ok|okay|sure)\\s*(mi|mu|mı)?\\s*\\?", "^\\p{L}+ (mi|mu)\\b.*\\?$",
]);

// Apology.
const APOLOGY_TR = rx([
  "\\bozur dile(rim|riz|yorum|riyorum|iyorum|yoruz)\\b", "\\bozrumu\\b", "\\bozur diliyo(m|rum)\\b", "\\bozur dilemem (lazim|gerekiyor)\\b",
  "\\bkusura bakma(yin|yiniz)?\\b", "\\bkusra bakma\\b", "\\bkusura bakmaa?\\b", "^kb\\b",
  "\\baf+edersin(iz)?\\b", "\\bbeni af+et\\b", "\\baf+et beni\\b", "\\bbagisla( beni)?\\b",
  "\\bpardon+\\b(?!\\s*\\?)", "\\b(benim hatam|hata bende|kusur bende|suc bende|hata benim|benim sucum)\\b",
  "\\b(cok )?ayip ettim\\b", "\\bhakkini (helal et|yedim)\\b", "\\bkirdiysam\\b",
  "\\buzgunum\\b.{0,40}\\b\\p{L}+(emedim|amadim|madim|medim|tum|tim|dum|dim|tim)\\b",
  "\\b(sori|sory|sorry|sry|srry|ozr)\\b",
]);
const APOLOGY_EN = rx([
  "\\b(i'?m|i am|im|so|really|very|terribly|truly) (so |really |very |terribly )?sorry\\b",
  "(^|[,.!;:]\\s*|^\\p{L}+[,!]?\\s+)(sorry|sory|sry|srry|soz|sowy|sowwy|sori)\\b",
  "\\bmy (bad|fault|mistake|apologies)\\b", "\\bthat'?s my fault\\b",
  "\\b(i )?apologi[sz]e\\b", "\\bapologies\\b", "\\bi owe you an apology\\b", "\\bforgive me\\b", "\\bi was wrong\\b", "\\bi feel bad\\b",
]);
const APOLOGY_NOT = rx([
  // Turkish
  "\\bozur dile(me|mi|meye|mene|meni|yecek degil)", "\\bozur bekl", "\\bkusura bakmasin", "\\b(neden|niye|nicin).{0,15}ozur", "\\bozur dileyip dur", "\\bozur dilemek\\b", "\\bozur dilemen\\b",
  "\\bbasin sag", "\\bgecmis olsun\\b",
  // English
  "\\bnot sorry\\b", "\\bno need to (apolog|be sorry)", "\\b(won'?t|never|not) (be )?apologi", "\\bdon'?t (be sorry|apologi)", "\\bstop (apologi|saying sorry)",
  "\\bsorry to hear\\b", "\\bsorry for your loss\\b", "\\b(a|what a) sorry\\b", "\\bfeel sorry for\\b", "\\bsafe than sorry\\b", "\\bsorry\\s*\\?", "\\bpardon (the|my)\\b",
  "\\b(why|you) (do you )?(always )?apologi[sz]e", "\\bapologi[sz]ing is\\b", "\\bapologi[sz]e too much\\b",
  "\\b(should|did|do|will) (i|you|he|she|they) (say sorry|apologi)",
]);

// Cancellation.
const CANCEL_TR = rx([
  "\\b(gel|yetis|katil|ugra)(emi|ami)(cem|cam|cegim|cagim)\\b",
  "\\b(gel|katil|yap|gid|git|yetis|cik|ugra)(e|a)(mi(yorum|yom|yoruz)|meyecegim|mayacagim|meyecem|mayacam|mem|mam|meyiz|mayiz|miycam|miycem)\\b",
  "\\bgelemiyo(m|rum)\\b", "\\bgelmi(yorum|yom)\\b", "\\bgelmeyecegim\\b", "\\bgitmiyorum\\b",
  "\\bvazgec(tim|elim|iyorum|tik)\\b", "\\biptal (ediyorum|ettim|edelim|ettik|ettirdim|etmemiz|etmek zorunday)", "\\biptal+\\s*$", "\\b(yokum|beni saymayin|cekiliyorum)\\b",
  "\\b(olmayacak|olmuyor|olmuyo)\\b.{0,25}\\b(iptal|hastayim|kusura)\\b", "\\b\\p{L}+ olmayacak, (hastayim|isim cikti)", "\\bmumkun degil\\b",
]);
const CANCEL_EN = rx([
  "\\b(i|we|i'?ll|ill) (can'?t|cant|cannot|won'?t|wont) (make it|come|join|do it|do)\\b", "(^|[,.!;]\\s*|^\\p{L}+ )(can'?t|cant|cannot|won'?t|wont) (make it|come|join|do)\\b",
  "\\b(i|we) (won'?t|will not) be able to (come|make|join)", "\\b(have to|gotta|got to|need to|must) (bail|cancel)\\b", "\\bimma (skip|bail)\\b",
  "\\bcount me out\\b", "\\bcall(ing)? it off\\b", "\\b(let'?s|lets) cancel\\b", "\\b(i|we) (cancel+ed|cancel|am cancel+ing|'?m cancel+ing)\\b", "\\bi'?m cancel+ing\\b",
  "\\b(i'?m|im|i am) (out|not coming)\\b", "\\bnot gonna happen\\b", "\\bplans are off\\b", "\\bis off for me\\b", "\\bsit this one out\\b", "\\b(i'?ll|ill) have to skip\\b",
  "\\bcan'?t do \\p{L}+ anymore\\b", "\\bcancel ediyorum\\b", "\\bchange of plans\\b",
]);
const CANCEL_NOT = rx([
  "\\b(might|may|maybe|perhaps|possibly|belki)\\b",
  // Turkish
  "\\biptal (etme|etmeyelim|yok)\\b", "\\bvazgecme\\b", "\\b(sanmistim|dusunmustum)\\b",
  "\\b(neden|niye).{0,15}iptal", "\\biptallerden\\b",
  "\\b(abonelig|aboneli|siparis|uyelig|uyeli|kart|bilet)\\p{L}* (iptal|\\p{L}+ iptal)",
  // English
  "\\b(don'?t|not|never) cancel", "\\bwe'?re not cancel", "\\bstill make it\\b", "\\bdefinitely coming\\b",
  "\\bcan'?t (wait|believe|stop|sleep|find)\\b", "\\b(membership|subscription|order)\\b", "\\bnoise cancel",
  "\\b(was|were|got|been|is|are) (cancel|called off)", "\\b(they|he|she|it) cancel", "\\bcancel+ed on (us|me)\\b", "\\bapparently\\b",
  "\\bwhy do you always cancel\\b", "\\blast-minute cancellations\\b",
]);
// Turkish third-person evidential/reportative ("gelemiyormuş", "katılamayacakmış", "iptal etmişler").
const TR_THIRD = /\p{L}+(yormus|acakmis|ecekmis|mamis|memis|mislar|misler|diler|dilar)\b/u;
// English third-party subject right before the cue ("Selin can't make it", "the airline apologized").
const EN_THIRD = /(^|[,.!;]\s*)(?!(i|we|i'm|im|i'll)\b)(he|she|they|it|someone|everyone|the \p{L}+|[A-ZÇĞİÖŞÜ]\p{L}+(?: and [A-ZÇĞİÖŞÜ]?\p{L}+)?) (can'?t|won'?t|cancel|apologi|said|is in|said yes|finally)/u;

/** The previous message by another participant, for acceptance. */
export interface CueContext {
  readonly prevOther?: string | undefined;
}

export function isProposal(text: string): boolean {
  const n = normalise(text);
  if (QUOTED.test(n) || QUOTED.test(text)) return false;
  const activityQuestion = ACTIVITY_QUESTION.test(n) && !ASKS_ABOUT_PAST.test(n);
  if (!(PROPOSAL_TR.test(n) || PROPOSAL_EN.test(n) || activityQuestion)) return false;
  if (PROPOSAL_NOT.test(n)) return false;
  if (GENERIC_SUGGESTION.test(n) && !SOCIAL_ACTIVITY.test(n)) return false;
  if (activityQuestion) return true;
  if (PROPOSAL_QUESTION_ONLY.test(n) && !/\b(musait|gelir misin|ugrar misin|are you free|you free|u free|fancy|up for|free for|you around)\b/u.test(n)) return false;
  return true;
}

export function isAcceptance(text: string, ctx: CueContext = {}): boolean {
  if (!ctx.prevOther || !isProposal(ctx.prevOther)) return false;
  const n = normalise(text);
  if (QUOTED.test(n)) return false;
  if (!ACCEPT_START.test(n)) return false;
  // A trailing question after a clear yes ("olur, bende mi sende mi?") still accepts;
  // a bare question back ("tamam mı?", "ok?") does not.
  if (ACCEPT_NOT.test(n)) return false;
  // Ending in a question is a yes only when the yes stands on its own first ("olur, bende mi sende mi?").
  if (/\?\s*$/u.test(n) && !/^\p{L}+( \p{L}+)?[,.!]/u.test(n)) return false;
  return true;
}

export function isApology(text: string): boolean {
  const n = normalise(text);
  if (QUOTED.test(n) || QUOTED.test(text)) return false;
  if (!(APOLOGY_TR.test(n) || APOLOGY_EN.test(n))) return false;
  if (APOLOGY_NOT.test(n)) return false;
  if (EN_THIRD.test(text)) return false;
  return true;
}

export function isCancellation(text: string): boolean {
  const n = normalise(text);
  if (QUOTED.test(n) || QUOTED.test(text)) return false;
  if (!(CANCEL_TR.test(n) || CANCEL_EN.test(n))) return false;
  if (CANCEL_NOT.test(n) || TR_THIRD.test(n)) return false;
  if (EN_THIRD.test(text)) return false;
  // A question about cancelling ("iptal mi oldu?", "can't you come?") is not cancelling.
  if (/\?\s*$/u.test(n) && !/\b(iptal edelim mi|cancel\?|ok\?)/u.test(n) && !/(gelemeyecegim|can'?t make it|can'?t come)/u.test(n)) return false;
  return true;
}

export function detect(behaviour: Behaviour, text: string, ctx: CueContext = {}): boolean {
  switch (behaviour) {
    case "proposal": return isProposal(text);
    case "acceptance": return isAcceptance(text, ctx);
    case "apology": return isApology(text);
    case "cancellation": return isCancellation(text);
  }
}
