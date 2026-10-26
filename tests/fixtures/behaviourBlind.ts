/* Held-out bilingual behaviour cases, written independently of the development set
   and never used to tune the rules. */

export type BlindKind = "plain" | "neg" | "quote" | "meta" | "third" | "question" | "lexical" | "sarcasm";
export interface BlindItem {
  readonly behaviour: "proposal" | "acceptance" | "apology" | "cancellation";
  readonly lang: "tr" | "en";
  readonly label: boolean;
  readonly kind: BlindKind;
  readonly style: "formal" | "informal";
  readonly core: number;
  readonly text: string;
  /** For acceptance: the previous message, written by the other person. */
  readonly prev?: string;
}

type Neg = [Exclude<BlindKind, "plain">, string];
type PairNeg = [Exclude<BlindKind, "plain">, string, string];
interface Cell { pos: string[]; neg: Neg[] }
interface PairCell { pos: [string, string][]; neg: PairNeg[] }

const T = { tr: ["yarın", "cumartesi", "akşam", "pazar günü", "cuma akşamı", "hafta sonu", "bugün", "perşembe"], en: ["tomorrow", "saturday", "tonight", "on sunday", "friday night", "this weekend", "today", "thursday"] };
const A = { tr: ["kahve", "sinema", "yemek", "kahvaltı", "yürüyüş", "maç", "konser", "alışveriş"], en: ["coffee", "a movie", "dinner", "brunch", "a walk", "the game", "the concert", "lunch"] };
const N = ["Elif", "Burak", "Selin", "Emre", "Derya", "Kerem", "Sena", "Onur"];

const PROPOSAL_TR: Cell = {
  pos: [
    "{T} buluşalım mı?", "{T} {A} için buluşsak", "{T} görüşelim mi, çok özledim", "{T} bir {A} yapalım", "hadi {T} çıkalım", "{T} bize gel, birlikte yemek yaparız",
    "{T} müsaitsen bir {A} içelim", "{T} sinemaya gidelim mi", "{T} dışarıda yiyelim mi", "{T} bende toplanalım", "akşam bir yerde oturalım mı", "{T} {A} için Moda'ya inelim",
    "{T} buluşmaya ne dersin", "{T} uğrasana, konuşuruz", "{T} sahilde yürüyelim mi", "bu aralar hiç görüşemedik, {T} buluşalım", "{T} için plan yapalım mı, {A} olabilir",
    "{T} benimle {A} gelir misin", "{T} çay içmeye gidelim", "{T} saat 7'de kafede buluşalım", "{T} {N} da gelsin, hep beraber çıkalım", "{T} piknik yapalım mı",
    "{T} müzeye gitsek mi", "{T} erkenden kahvaltıya çıkalım", "bir ara oturup konuşalım, {T} olur mu", "{T} spora beraber gidelim mi", "{T} için masa ayırtalım mı, beraber gideriz",
    "{T} bisiklete binelim mi", "{T} {A} sonrası bir şeyler içelim", "{T} sana uğrayayım mı",
  ],
  neg: [
    ["neg", "{T} buluşmayalım, çok yorgunum"], ["neg", "{T} çıkmak istemiyorum"], ["neg", "bu hafta görüşmeyelim bence"], ["neg", "{T} gelmeyeyim, hastayım"],
    ["quote", "{N} '{T} buluşalım' dedi"], ["quote", "annem \"bize gelin\" diye yazmış"], ["quote", "{N} bana {T} buluşalım mı diye sordu"],
    ["meta", "neden hep ben buluşmayı öneriyorum"], ["meta", "sürekli plan yapan benim"], ["meta", "buluşma önermekten yoruldum"],
    ["third", "{N} ile {T} buluşuyorlar"], ["third", "{N} {T} {A} yapacakmış"], ["third", "onlar dün sinemaya gitmiş"], ["third", "{N} bizi {T} yemeğe çağırdı"],
    ["question", "{T} geliyor musun?"], ["question", "buluşma kaçtaydı?"], ["question", "dün nereye gittiniz?"], ["question", "{A} nasıldı?"], ["question", "{T} evde misin?"], ["question", "{N} geldi mi?"],
    ["lexical", "dün {N} ile buluştum"], ["lexical", "faturayı ödeyelim mi bu ay?"], ["lexical", "bu konuyu kapatalım mı artık"], ["lexical", "tamam o zaman bekleyelim mi"],
    ["lexical", "çamaşırları asalım mı sence?"], ["lexical", "{A} çok güzeldi"], ["lexical", "görüşürüz o zaman"], ["lexical", "kahve bitmiş, alalım mı?"],
    ["lexical", "bu hafta çok yoğunum"], ["lexical", "toplantı {T} saat 3'te"], ["lexical", "ödevi bitirelim mi önce"], ["lexical", "arabayı yıkatalım mı"],
    ["sarcasm", "tabii {T} buluşalım, sanki gelecekmişsin gibi"],
  ],
};
const PROPOSAL_EN: Cell = {
  pos: [
    "let's meet {T}", "wanna grab {A} {T}?", "how about {A} {T}?", "are you free {T}? we could get {A}", "shall we meet up {T}", "come over {T}, I'll cook",
    "want to go for {A} {T}?", "we should hang out {T}", "up for {A} {T}?", "fancy {A} {T}?", "let's do {A} {T}", "you around {T}? let's catch up",
    "let's go to the beach {T}", "what about meeting {T} after work", "let's get together {T}", "free for {A} {T}?", "let's have {A} together {T}",
    "drop by {T} if you can, we'll talk", "how about we meet at 7 {T}", "let's take a walk {T}", "can we meet {T}? I miss you", "join me for {A} {T}?",
    "we could go see {A} {T}", "{N} and I are going {T}, come with us", "let's plan something for {T}", "meet me at the cafe {T}?", "let's grab a drink {T}",
    "want to come to the market with me {T}?", "let's go cycling {T}", "how about I pick you up {T}",
  ],
  neg: [
    ["neg", "let's not meet {T}, I'm wiped"], ["neg", "I don't want to go out {T}"], ["neg", "maybe we shouldn't hang out this week"], ["neg", "no plans {T} please, I need rest"],
    ["quote", "{N} said 'let's meet {T}'"], ["quote", "she texted me \"wanna grab {A}?\""], ["quote", "{N} asked if we want to meet {T}"],
    ["meta", "why am I always the one suggesting plans"], ["meta", "you never suggest meeting"], ["meta", "I'm tired of planning everything"],
    ["third", "{N} and Ali are meeting {T}"], ["third", "they went for {A} {T}"], ["third", "{N} invited us to dinner {T}"], ["third", "{N} is going to {A} {T}"],
    ["question", "are you coming {T}?"], ["question", "what time was the meeting?"], ["question", "how was {A}?"], ["question", "did you meet {N}?"], ["question", "where are you?"], ["question", "is {N} there?"],
    ["lexical", "I met {N} yesterday"], ["lexical", "let's see what happens"], ["lexical", "let me check my calendar"], ["lexical", "let's hope it doesn't rain"],
    ["lexical", "the meeting is at 3 {T}"], ["lexical", "{A} was great"], ["lexical", "see you then"], ["lexical", "let's pay the bills first"],
    ["lexical", "come on, that's not fair"], ["lexical", "how about that game last night"], ["lexical", "I'm free now, call me"], ["lexical", "let's just forget it"],
    ["sarcasm", "sure let's meet {T}, like you'd actually show up"],
  ],
};

const ACCEPT_TR: PairCell = {
  pos: [
    ["{T} buluşalım mı?", "olur, görüşürüz"], ["{T} {A} yapalım mı", "tamam"], ["{T} görüşelim mi", "anlaştık"], ["{T} sinemaya gidelim mi", "bana uyar"],
    ["{T} bize gel", "süper, geliyorum"], ["{T} kahvaltıya çıkalım", "tabii ki"], ["hadi {T} çıkalım", "ben varım"], ["{T} buluşsak", "olur olur"],
    ["{T} yemeğe gidelim mi", "harika fikir, gidelim"], ["{T} saat 7'de buluşalım mı", "tamam 7'de oradayım"], ["{T} {A} için buluşalım mı", "kesin geliyorum"], ["{T} uğrar mısın", "uğrarım"],
    ["{T} yürüyüşe çıkalım mı", "evet, çıkalım"], ["{T} maça gidelim mi", "olur, biletleri ben alırım"], ["{T} dışarıda yiyelim mi", "anlaştık o zaman"], ["{T} toplanalım mı", "bence de, toplanalım"],
    ["{T} {A} yapalım mı", "çok iyi olur"], ["{T} görüşelim", "tamamdır"], ["{T} sahile inelim mi", "olur, ben de çok istiyordum"], ["{T} buluşmaya ne dersin", "uygunum"],
    ["{T} konsere gidelim mi", "gidelim tabii"], ["{T} kahve içelim mi", "olsun"], ["{T} beraber çalışalım mı", "olur, bende mi sende mi?"], ["{T} piknik yapalım mı", "harika, ben de geliyorum"],
    ["{T} gelir misin", "gelirim"], ["{T} bisiklete binelim mi", "evet!"],
  ],
  neg: [
    ["neg", "{T} buluşalım mı?", "olmaz, işim var"], ["neg", "{T} {A} yapalım mı", "maalesef gelemem"], ["neg", "{T} görüşelim mi", "tamam ama {T} olmaz"], ["neg", "{T} sinemaya gidelim mi", "hayır, istemiyorum"],
    ["neg", "{T} bize gel", "bu sefer gelemeyeceğim"], ["neg", "{T} çıkalım mı", "yok ya, canım istemiyor"],
    ["question", "{T} buluşalım mı?", "tamam mı?"], ["question", "{T} {A} yapalım mı", "olur mu sence?"], ["question", "{T} görüşelim mi", "kaçta?"], ["question", "{T} sinemaya gidelim mi", "hangi film?"],
    ["question", "{T} bize gel", "kimler olacak?"], ["question", "{T} çıkalım mı", "nereye?"],
    ["lexical", "fatura geldi, 450 lira", "tamam anladım"], ["lexical", "toplantı 3'te bitti", "ok"], ["lexical", "sınavı geçtim!", "süper"], ["lexical", "eve vardın mı?", "evet"],
    ["lexical", "ilaçlarını aldın mı?", "aldım tamam"], ["lexical", "kargo geldi", "tamamdır"], ["lexical", "annem aradı", "olur, sonra ararım onu"], ["lexical", "yağmur yağıyor", "evet çok"],
    ["third", "{T} buluşalım mı?", "{N} kabul etti"], ["third", "{T} sinemaya gidelim mi", "{N} gelirmiş"],
    ["neg", "{T} maça gidelim mi", "keşke ama olmaz"], ["neg", "{T} kahve içelim mi", "bu hafta hiç müsait değilim"],
    ["question", "{T} yemeğe gidelim mi", "nereye gideceğiz?"], ["lexical", "doktor randevun ne zaman?", "tamam bakarım"],
    ["sarcasm", "{T} buluşalım mı?", "tabii canım, kesin gelirim 🙄"],
  ],
};
const ACCEPT_EN: PairCell = {
  pos: [
    ["let's meet {T}", "sure, see you then"], ["wanna grab {A} {T}?", "sounds good"], ["how about {A} {T}?", "deal"], ["shall we meet up {T}", "works for me"],
    ["come over {T}", "I'm in"], ["want to go for {A} {T}?", "yes let's do it"], ["we should hang out {T}", "absolutely"], ["up for {A} {T}?", "count me in"],
    ["let's do {A} {T}", "perfect"], ["are you free {T}?", "yes, totally free"], ["let's meet at 7 {T}", "ok 7 it is"], ["fancy {A} {T}?", "love to"],
    ["let's go to the beach {T}", "great idea"], ["let's get together {T}", "yes please"], ["can we meet {T}?", "of course"], ["join me for {A} {T}?", "happy to"],
    ["let's grab a drink {T}", "sure thing"], ["let's take a walk {T}", "ok sure"], ["how about I pick you up {T}", "that works"], ["drop by {T}?", "I'll be there"],
    ["let's plan {A} {T}", "sounds like a plan"], ["want to come {T}?", "definitely"], ["let's have {A} {T}", "yep"], ["meet me at the cafe {T}?", "see you there"],
    ["let's go cycling {T}", "I'm down"], ["wanna hang {T}", "ok!"],
  ],
  neg: [
    ["neg", "let's meet {T}", "can't, sorry"], ["neg", "wanna grab {A} {T}?", "no, I'm busy"], ["neg", "how about {A} {T}?", "ok but not {T}"], ["neg", "shall we meet up {T}", "I'd rather not"],
    ["neg", "come over {T}", "not this time"], ["neg", "want to go for {A} {T}?", "nah, I'm not feeling it"],
    ["question", "let's meet {T}", "ok?"], ["question", "wanna grab {A} {T}?", "where?"], ["question", "how about {A} {T}?", "what time?"], ["question", "shall we meet up {T}", "who else is coming?"],
    ["question", "come over {T}", "sure you want me to?"], ["question", "up for {A} {T}?", "how much is it?"],
    ["lexical", "the bill is 450", "ok noted"], ["lexical", "I passed the exam!", "great"], ["lexical", "are you home?", "yes"], ["lexical", "the package arrived", "perfect"],
    ["lexical", "did you take your meds?", "yes ok"], ["lexical", "mom called", "ok I'll call her later"], ["lexical", "it's raining", "yeah a lot"], ["lexical", "the meeting ended", "good"],
    ["third", "let's meet {T}", "{N} said yes"], ["third", "wanna grab {A} {T}?", "{N} is in"],
    ["neg", "let's go cycling {T}", "wish I could, but no"], ["neg", "fancy {A} {T}?", "I'm not free at all this week"],
    ["question", "let's have dinner {T}", "where would we go?"], ["lexical", "when is your doctor appointment?", "ok I'll check"],
    ["sarcasm", "let's meet {T}", "oh sure, can't wait 🙄"],
  ],
};

const APOLOGY_TR: Cell = {
  pos: [
    "özür dilerim, geç kaldım", "kusura bakma, {T} arayamadım", "çok özür dilerim {N}, unuttum", "affedersin, öyle demek istemedim", "pardon, yanlış kişiye attım",
    "kusura bakmayın, toplantıdaydım", "haklısın, benim hatam", "hata bende, düzelteceğim", "{T} gelemediğim için özür dilerim", "telefon sessizdeydi, kusura bakma",
    "lütfen özrümü kabul et", "beni affet, saçma davrandım", "çok ayıp ettim, kusura bakma", "geç cevap verdim, kusura bakma", "özür dilerim, sinirliydim",
    "kusura bakma, {A} planını unuttum", "affet beni, söz bir daha olmayacak", "pardon, mesajı şimdi gördüm", "özür dilerim, seni beklettim", "kusura bakma, dalmışım",
    "bağışla beni, hakkını yedim", "kırdıysam özür dilerim", "suç bende, kusura bakma", "üzgünüm, {T} yetişemedim", "affedersiniz, rahatsız ettim",
    "özür dilerim, sözümü tutamadım", "kusura bakma, ödemeyi unuttum", "çok pardon, yanlış anladım", "senden özür dilemem lazım, haksızlık ettim", "yanlışlıkla sildim, özür dilerim",
  ],
  neg: [
    ["neg", "özür dilemeyeceğim, haklıyım"], ["neg", "özür dilemene gerek yok"], ["neg", "bence özür dilemem gereken bir şey yok"], ["neg", "ondan özür bekliyorum"], ["neg", "asla özür dilemem"],
    ["quote", "{N} bana 'özür dilerim' dedi"], ["quote", "annem \"kusura bakma\" diye yazmış"], ["quote", "öğretmen 'pardon' deyip geçti"],
    ["meta", "neden sürekli özür diliyorsun"], ["meta", "özür dileyip durma artık"], ["meta", "özür dilemek bu kadar zor mu"], ["meta", "her şey için özür dilemen beni üzüyor"],
    ["third", "{N} sonunda özür diledi"], ["third", "şirket gecikme için özür dilemiş"], ["third", "{N} senden özür dilemek istiyormuş"], ["third", "{N} bana kusura bakma dedi"],
    ["question", "özür diledin mi ona?"], ["question", "sence özür dilemeli miyim?"], ["question", "{N}'den özür diledin mi?"], ["question", "neden özür diliyorsun ki?"],
    ["lexical", "kusursuz bir gündü"], ["lexical", "pardösümü unuttum"], ["lexical", "sorumluluk bende değil"], ["lexical", "{A} çok güzeldi"],
    ["lexical", "başın sağ olsun, çok üzüldüm"], ["lexical", "geçmiş olsun, üzüldüm"], ["lexical", "maç için çok üzgünüm, kaybettik"], ["lexical", "affedilmez bir hata yaptı hakem"],
    ["sarcasm", "aa çok özür dilerim, kral sensin tabii"],
  ],
};
const APOLOGY_EN: Cell = {
  pos: [
    "sorry I'm late", "I'm so sorry, I forgot", "my bad, wrong chat", "apologies for the delay", "I apologise, that was rude", "sorry I couldn't call {T}",
    "forgive me, I messed up", "that's my fault, I'll fix it", "I owe you an apology", "really sorry about {T}", "sorry {N}, my phone was dead", "my mistake, it's on friday",
    "sorry for the late reply", "I'm sorry I snapped at you", "sorry, didn't see your message", "please forgive me", "I'm sorry I missed {A}", "sorry for keeping you waiting",
    "so sorry, I fell asleep", "I apologize for what I said", "my apologies, wrong number", "sorry to bother you", "I'm sorry, you were right", "oops, sorry, deleted it by mistake",
    "sorry I didn't make it {T}", "I feel bad, sorry about yesterday", "sorry sorry sorry", "I was wrong, I'm sorry", "sorry, I forgot to pay you back", "sorry I couldn't come to {A}",
  ],
  neg: [
    ["neg", "I'm not sorry at all"], ["neg", "no need to apologise"], ["neg", "I won't apologize for that"], ["neg", "don't be sorry"], ["neg", "I'm never apologizing to him"],
    ["quote", "she said \"sorry\" and left"], ["quote", "he texted me 'I'm sorry' lol"], ["quote", "{N} told me he was sorry"],
    ["meta", "why do you always apologize"], ["meta", "stop saying sorry"], ["meta", "apologizing is not weakness"], ["meta", "you apologize too much"],
    ["third", "the airline apologized for the delay"], ["third", "{N} finally apologized"], ["third", "{N} wants to apologize to you"], ["third", "the waiter said sorry"],
    ["question", "did you apologize to her?"], ["question", "should I say sorry?"], ["question", "did {N} apologize?"], ["question", "why are you sorry?"],
    ["lexical", "I'm sorry to hear that, hope she's ok"], ["lexical", "sorry for your loss"], ["lexical", "what a sorry state"], ["lexical", "pardon the mess, come in"],
    ["lexical", "I feel sorry for him"], ["lexical", "better safe than sorry"], ["lexical", "the movie was a sorry mess"], ["lexical", "sorry? what did you say?"],
    ["sarcasm", "oh I'm SO sorry your majesty"],
  ],
};

const CANCEL_TR: Cell = {
  pos: [
    "{T} gelemiyorum, kusura bakma", "{T} gelemeyeceğim", "{A} planını iptal edelim", "vazgeçtim, {T} çıkmayalım", "ben {T} yokum, iptal", "{T} yapamayacağım maalesef",
    "işim çıktı, katılamayacağım", "rezervasyonu iptal ettim", "{T} olmayacak, hastayım", "{A} işi yattı, gelemem", "{T} buluşmayı iptal ediyorum", "bugünkü planı iptal etmemiz lazım",
    "{T} için gelemem, çok yoğunum", "kusura bakma, {T} beni saymayın", "ben {A}'a gelmiyorum", "{T} olmuyor bende, iptal edelim", "biletleri iptal ettirdim", "{A}'tan vazgeçelim",
    "{T} gelmem mümkün değil", "maalesef {T} katılamıyorum", "{T} olmayacak artık, iptal", "ben çekiliyorum, {T} gelmeyeceğim", "{N}, {T} gelemiyorum", "planı iptal ettim, {T} yokum",
    "masayı iptal ettim, {T} gidemiyoruz", "{T} ki buluşmayı iptal edelim mi, gelemeyeceğim",
  ],
  neg: [
    ["neg", "iptal etme sakın"], ["neg", "vazgeçme, gel"], ["neg", "gelemeyeceğini sanmıştım"], ["neg", "iptal etmeyelim bence"], ["neg", "ben geliyorum, iptal yok"],
    ["quote", "{N} 'gelemiyorum' dedi"], ["quote", "otel \"rezervasyon iptal\" diye mail atmış"],
    ["meta", "neden hep sen iptal ediyorsun"], ["meta", "son dakika iptallerden bıktım"],
    ["third", "konser iptal edilmiş"], ["third", "uçuşu iptal etmişler"], ["third", "{N} gelemiyormuş"], ["third", "{N} {A} planını iptal etti"], ["third", "maç yağmurdan iptal oldu"], ["third", "{N} katılamayacakmış"],
    ["question", "iptal mi oldu?"], ["question", "gelemiyor musun?"], ["question", "{A} iptal mi?"], ["question", "{N} geliyor mu?"],
    ["lexical", "aboneliği iptal ettim nihayet"], ["lexical", "siparişi iptal ettirdim"], ["lexical", "kartımı iptal ettirdim"], ["lexical", "bekleyemiyorum!"],
    ["lexical", "uyuyamıyorum bu gece"], ["lexical", "bulamıyorum anahtarı"], ["lexical", "inanamıyorum ya"], ["lexical", "üyeliğimi iptal ettim spor salonunda"], ["lexical", "çıkamıyorum bu oyundan"],
    ["sarcasm", "tabii yine iptal, şaşırdık mı"],
  ],
};
const CANCEL_EN: Cell = {
  pos: [
    "I can't make it {T}, sorry", "let's cancel {A}", "I have to bail {T}", "count me out {T}", "I won't make it {T}", "let's call it off",
    "I cancelled the booking", "something came up, I can't come", "I'm out for {T}, sick", "not gonna happen {T}, sorry", "I need to cancel {T}", "can't come to {A} after all",
    "I'll have to skip {A} {T}", "we have to cancel {T}", "I'm sorry but I can't come {T}", "plans are off for {T}", "I cancelled our reservation", "I can't join you {T}",
    "{T} is off for me", "I'm cancelling {T}, too tired", "sorry {N}, I'm not coming {T}", "I won't be able to come {T}", "I have to cancel our {A}", "change of plans, I can't come {T}",
    "I'm going to sit this one out {T}", "can't do {T} anymore, sorry",
  ],
  neg: [
    ["neg", "don't cancel please"], ["neg", "we're not cancelling"], ["neg", "I can still make it {T}"], ["neg", "no, I'm definitely coming"],
    ["quote", "{N} said \"I can't make it\""], ["quote", "the hotel emailed 'booking cancelled'"],
    ["meta", "why do you always cancel"], ["meta", "I hate last-minute cancellations"],
    ["third", "the concert was cancelled"], ["third", "they cancelled our flight"], ["third", "{N} can't make it apparently"], ["third", "{N} cancelled on us again"], ["third", "the game got called off"], ["third", "{N} won't make it {T}"],
    ["question", "did they cancel it?"], ["question", "can't you come?"], ["question", "is {A} cancelled?"], ["question", "is {N} coming?"],
    ["lexical", "I cancelled my gym membership"], ["lexical", "can't wait for {T}!"], ["lexical", "can't believe it"], ["lexical", "cancel my order pls"],
    ["lexical", "I can't sleep tonight"], ["lexical", "I can't find my keys"], ["lexical", "the noise cancelling headphones arrived"], ["lexical", "I can't stop laughing"],
    ["sarcasm", "cancelling again, what a surprise"],
  ],
};

const OPEN = { tr: ["", "ya ", "bak ", "abi ", "", "şey ", "canım ", "hmm "], en: ["", "hey ", "ok so ", "hmm ", "", "btw ", "listen ", "um "] };
const CLOSE = { tr: ["", " 🙂", "!!", " ya", "", " 🙏", " 😊", "."], en: ["", " 🙂", "!!", " lol", "", " 🙏", " 😊", "."] };

/** Informal rewrite: no diacritics, common abbreviations, a stretched letter. */
function informal(text: string, lang: "tr" | "en", k: number): string {
  let t = text.toLocaleLowerCase(lang === "tr" ? "tr" : "en");
  if (lang === "tr") {
    t = t.replace(/[çğıöşü]/g, (c) => ({ ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" })[c]!)
      .replace(/\btamam\b/g, "tmm").replace(/\bbir\b/g, "bi").replace(/yorum\b/g, "yom").replace(/yorsun\b/g, "yon").replace(/\bdeğil\b|\bdegil\b/g, "diil")
      .replace(/acağım\b|acagim\b/g, "cam").replace(/eceğim\b|ecegim\b/g, "cem").replace(/\bne zaman\b/g, "ne zmn");
  } else {
    t = t.replace(/\byou\b/g, "u").replace(/\byour\b/g, "ur").replace(/\btonight\b/g, "tn").replace(/\btomorrow\b/g, "tmrw").replace(/\bplease\b/g, "pls")
      .replace(/\bsorry\b/g, k % 2 ? "sry" : "sorryyy").replace(/\bgoing to\b/g, "gonna").replace(/\bwant to\b/g, "wanna").replace(/\bbecause\b/g, "cuz").replace(/'/g, "");
  }
  // Stretch the last vowel of the first word on some variants ("olurrr", "heyyy").
  if (k % 3 === 0) t = t.replace(/^(\S*?)([aeiou])(\S*)/, (_, a: string, v: string, b: string) => `${a}${v}${v}${v}${b}`);
  return t;
}

let seed = 20261025;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const fill = (s: string, lang: "tr" | "en") => s.replace(/\{T\}/g, () => T[lang][Math.floor(rnd() * 8)]!).replace(/\{A\}/g, () => A[lang][Math.floor(rnd() * 8)]!).replace(/\{N\}/g, () => N[Math.floor(rnd() * 8)]!);

/** Variants per core: 4 formal, 4 informal. Duplicates are dropped. */
function expand<T>(cores: T[], render: (core: T, style: "formal" | "informal", k: number) => { text: string; prev?: string }): { core: number; style: "formal" | "informal"; text: string; prev?: string }[] {
  const out: { core: number; style: "formal" | "informal"; text: string; prev?: string }[] = [];
  cores.forEach((core, i) => {
    const seen = new Set<string>();
    for (let k = 0; k < 8; k++) {
      const style = k < 4 ? "formal" : "informal";
      const r = render(core, style, k);
      const key = `${r.prev ?? ""}|${r.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ core: i, style, ...r });
    }
  });
  return out;
}

function single(behaviour: BlindItem["behaviour"], lang: "tr" | "en", cell: Cell): BlindItem[] {
  const render = (text: string) => (style: "formal" | "informal", k: number) => {
    const base = `${OPEN[lang][k % 8]}${fill(text, lang)}${CLOSE[lang][(k * 3 + 2) % 8]}`;
    return { text: style === "formal" ? base : informal(base, lang, k) };
  };
  return [
    ...expand(cell.pos, (t, st, k) => render(t)(st, k)).map((v) => ({ behaviour, lang, label: true, kind: "plain" as const, ...v })),
    ...expand(cell.neg, ([, t], st, k) => render(t)(st, k)).map((v) => ({ behaviour, lang, label: false, kind: cell.neg[v.core]![0], ...v, core: cell.pos.length + v.core })),
  ];
}

function pairs(lang: "tr" | "en", cell: PairCell): BlindItem[] {
  const render = (prev: string, reply: string, style: "formal" | "informal", k: number) => {
    const p = `${OPEN[lang][(k * 5) % 8]}${fill(prev, lang)}`, r = `${fill(reply, lang)}${CLOSE[lang][(k * 3 + 1) % 8]}`;
    return style === "formal" ? { prev: p, text: r } : { prev: informal(p, lang, k + 1), text: informal(r, lang, k) };
  };
  return [
    ...expand(cell.pos, ([p, r], st, k) => render(p, r, st, k)).map((v) => ({ behaviour: "acceptance" as const, lang, label: true, kind: "plain" as const, ...v })),
    ...expand(cell.neg, ([, p, r], st, k) => render(p, r, st, k)).map((v) => ({ behaviour: "acceptance" as const, lang, label: false, kind: cell.neg[v.core]![0], ...v, core: cell.pos.length + v.core })),
  ];
}

/** The blind set, deterministic. */
export function blindItems(): BlindItem[] {
  seed = 20261025;
  return [
    ...single("proposal", "tr", PROPOSAL_TR), ...single("proposal", "en", PROPOSAL_EN),
    ...pairs("tr", ACCEPT_TR), ...pairs("en", ACCEPT_EN),
    ...single("apology", "tr", APOLOGY_TR), ...single("apology", "en", APOLOGY_EN),
    ...single("cancellation", "tr", CANCEL_TR), ...single("cancellation", "en", CANCEL_EN),
  ];
}
