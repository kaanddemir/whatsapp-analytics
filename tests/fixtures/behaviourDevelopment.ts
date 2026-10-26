/* Bilingual synthetic behaviour development cases. Slot variations are not
   independent observations; held-out cases live in behaviourBlind.ts. */
export type Kind = "plain" | "informal" | "neg" | "quote" | "meta" | "third" | "question" | "lexical" | "sarcasm";
export interface Item { b: string; lang: "tr" | "en"; label: boolean; kind: Kind; text: string; prev?: string | undefined; tpl: number }

const T = { tr: ["yarın", "cumartesi", "akşam 8'de", "haftaya", "pazar öğlen", "cuma akşamı", "bu hafta sonu", "salı 19:30'da"], en: ["tomorrow", "on saturday", "at 8", "next week", "sunday noon", "friday night", "this weekend", "tuesday at 7:30"] };
const A = { tr: ["kahve", "yemek", "sinema", "Kadıköy", "Moda sahil", "bira", "kahvaltı", "maç"], en: ["coffee", "dinner", "the movies", "the park", "drinks", "brunch", "the game", "lunch"] };
const N = ["Ece", "Can", "Deniz", "Mert", "Zeynep", "Bora"];

type Row = [label: boolean, kind: Kind, text: string, prev?: string];
const D: Record<string, Record<"tr" | "en", Row[]>> = {
  apology: {
    tr: [
      [true, "plain", "özür dilerim, geç kaldım"], [true, "plain", "kusura bakma dün arayamadım"], [true, "plain", "çok özür dilerim {N}, unuttum"], [true, "plain", "affedersin, öyle demek istemedim"],
      [true, "plain", "pardon yanlış kişiye attım"], [true, "plain", "kusura bakmayın, toplantıdaydım"], [true, "plain", "haklısın, benim hatam"], [true, "plain", "hata bende, düzelteceğim"],
      [true, "plain", "{T} gelemediğim için özür dilerim"], [true, "plain", "kusura bakma ya, telefon sessizdeydi"], [true, "plain", "özrümü kabul et lütfen"], [true, "plain", "beni affet, çok saçma davrandım"],
      [true, "informal", "ozur dilerim yaa"], [true, "informal", "kusra bakma ya"], [true, "informal", "sori geç gördüm"], [true, "informal", "pardonn"], [true, "informal", "kusura bakmaaa 🙏"],
      [true, "informal", "sorry ya unuttum tamamen"], [true, "informal", "ozr ya cok yogundum"], [true, "informal", "affedersiiin"], [true, "informal", "kb ya geç cevap verdim"], [true, "informal", "hakkını helal et, çok ayıp ettim"],
      [false, "neg", "özür dilemeyeceğim, haklıyım"], [false, "neg", "özür dilemene gerek yok"], [false, "neg", "bence özür dilemem gereken bir şey yok"], [false, "neg", "ondan özür bekliyorum"],
      [false, "quote", "{N} bana 'özür dilerim' dedi"], [false, "quote", "annem \"kusura bakma\" diye mesaj atmış"], [false, "quote", "öğretmen özür diledi diyor"],
      [false, "meta", "neden sürekli özür diliyorsun"], [false, "meta", "özür dileyip durma artık"], [false, "meta", "özür dilemek bu kadar zor mu"],
      [false, "third", "{N} sonunda özür diledi"], [false, "third", "şirket gecikme için özür dilemiş"],
      [false, "question", "özür diledin mi ona?"], [false, "question", "sence özür dilemeli miyim?"],
      [false, "lexical", "kusursuz bir gündü"], [false, "lexical", "pardösümü unuttum"], [false, "lexical", "{A} çok güzeldi"], [false, "lexical", "sorumluluk bende değil"],
      [true, "sarcasm", "aa çok özür dilerim, kral sensin tabii"],
      [false, "plain", "başın sağ olsun, çok üzüldüm"],
    ],
    en: [
      [true, "plain", "sorry I'm late"], [true, "plain", "I'm so sorry, I forgot"], [true, "plain", "my bad, wrong chat"], [true, "plain", "apologies for the delay"], [true, "plain", "I apologise, that was rude"],
      [true, "plain", "sorry I couldn't call {T}"], [true, "plain", "forgive me, I messed up"], [true, "plain", "that's my fault, I'll fix it"], [true, "plain", "I owe you an apology"], [true, "plain", "really sorry about last night"],
      [true, "plain", "sorry {N}, phone was dead"], [true, "plain", "my mistake, it's on friday"],
      [true, "informal", "sry"], [true, "informal", "sorryyy 🙏"], [true, "informal", "soz was asleep"], [true, "informal", "srry lol"], [true, "informal", "ugh my bad"], [true, "informal", "sowwy"], [true, "informal", "pardon ya, my bad"], [true, "informal", "oops sorry!!"],
      [false, "neg", "I'm not sorry at all"], [false, "neg", "no need to apologise"], [false, "neg", "I won't apologize for that"], [false, "neg", "don't be sorry"],
      [false, "quote", "she said \"sorry\" and left"], [false, "quote", "he texted me 'I'm sorry' lol"], [false, "quote", "{N} told me he was sorry"],
      [false, "meta", "why do you always apologize"], [false, "meta", "stop saying sorry"], [false, "meta", "apologizing is not weakness"],
      [false, "third", "the airline apologized for the delay"], [false, "third", "{N} finally apologized"],
      [false, "question", "did you apologize to her?"], [false, "question", "should I say sorry?"],
      [false, "lexical", "I'm sorry to hear that, hope she's ok"], [false, "lexical", "sorry for your loss"], [false, "lexical", "what a sorry state"], [false, "lexical", "pardon the mess, come in"],
      [true, "sarcasm", "oh I'm SO sorry your majesty"],
    ],
  },
  proposal: {
    tr: [
      [true, "plain", "{T} buluşalım mı?"], [true, "plain", "{T} {A} için çıkalım mı"], [true, "plain", "{T} görüşelim"], [true, "plain", "hadi {T} {A} yapalım"], [true, "plain", "{T} müsait misin, kahve içelim"],
      [true, "plain", "{T} bize gelsene"], [true, "plain", "{A} için {T} buluşsak mı"], [true, "plain", "{T} sinemaya gidelim mi"], [true, "plain", "{T} yemeğe çıkalım"], [true, "plain", "ne dersin, {T} buluşalım mı"],
      [true, "plain", "{T} bir kahve içelim mi"], [true, "plain", "{T} uğrar mısın, konuşalım"], [true, "plain", "canım sıkıldı, {T} çıkalım mı"], [true, "plain", "{T} yürüyüşe çıkalım"],
      [true, "informal", "yarin bulusalim mi"], [true, "informal", "aksam cikak mi"], [true, "informal", "{T} kahve?"], [true, "informal", "hadi gel bi kahve icelim"], [true, "informal", "napıyosun bu akşam, buluşak mı"], [true, "informal", "let's meet ya {T}"], [true, "informal", "{T} müsaitsen görüşelim mi"], [true, "informal", "bi ara bulusalim artik"],
      [false, "neg", "bu akşam buluşmayalım, yorgunum"], [false, "neg", "{T} çıkmayalım bence"], [false, "neg", "görüşmeyelim bir süre"],
      [false, "quote", "{N} 'yarın buluşalım' dedi"], [false, "quote", "annem \"bize gelsene\" diyor"],
      [false, "meta", "neden hep buluşmak isteyen benim"],
      [false, "third", "{N} ile {T} buluşuyorlar"], [false, "third", "onlar sinemaya gitmiş"],
      [false, "question", "{T} geliyor musun?"], [false, "question", "buluşma kaçtaydı?"], [false, "question", "dün nereye gittiniz?"], [false, "question", "kahve içtin mi?"],
      [false, "lexical", "dün {N} ile buluştum"], [false, "lexical", "kahve bitmiş, alalım mı market listesine"], [false, "lexical", "toplantı {T}"], [false, "lexical", "gideli çok oldu"],
      [false, "lexical", "bunu çözelim mi önce?"], [false, "lexical", "faturayı ödeyelim mi bu ay?"],
    ],
    en: [
      [true, "plain", "let's meet {T}"], [true, "plain", "wanna grab {A} {T}?"], [true, "plain", "shall we do {A} {T}"], [true, "plain", "how about {A} {T}?"], [true, "plain", "are you free {T}? let's catch up"],
      [true, "plain", "come over {T}"], [true, "plain", "want to meet up {T}?"], [true, "plain", "let's go for {A} {T}"], [true, "plain", "up for {A} {T}?"], [true, "plain", "we should hang out {T}"],
      [true, "plain", "fancy a coffee {T}?"], [true, "plain", "let's have dinner {T}"], [true, "plain", "you around {T}? let's grab a drink"],
      [true, "informal", "wanna hang {T}"], [true, "informal", "{A} {T}??"], [true, "informal", "lets grab smth {T}"], [true, "informal", "u free {T}? coffee"], [true, "informal", "yarın meet up?"], [true, "informal", "drinks tn?"], [true, "informal", "come thru {T}"],
      [false, "neg", "let's not meet {T}, I'm wiped"], [false, "neg", "I don't want to go out {T}"],
      [false, "quote", "she said 'let's meet tomorrow'"], [false, "quote", "{N} texted \"wanna grab coffee?\""],
      [false, "meta", "why do you always want to meet so late"],
      [false, "third", "{N} and Ali are meeting {T}"], [false, "third", "they went for {A}"],
      [false, "question", "are you coming {T}?"], [false, "question", "what time was the meeting?"], [false, "question", "did you have {A}?"],
      [false, "lexical", "let's see what happens"], [false, "lexical", "let me check"], [false, "lexical", "I met {N} yesterday"], [false, "lexical", "meeting moved to {T}"], [false, "lexical", "let's pay the bills first"], [false, "lexical", "let's hope it doesn't rain"],
    ],
  },
  acceptance: {
    tr: [
      [true, "plain", "tamam, görüşürüz", "{T} buluşalım mı?"], [true, "plain", "olur", "{T} kahve içelim mi"], [true, "plain", "anlaştık", "{T} sinemaya gidelim mi"], [true, "plain", "bana uyar", "{T} buluşsak mı"],
      [true, "plain", "süper, geliyorum", "{T} bize gelsene"], [true, "plain", "tabii ki", "{T} yemeğe çıkalım mı"], [true, "plain", "evet gelirim", "{T} görüşelim mi"], [true, "plain", "kesin, ben varım", "hadi {T} {A} yapalım"],
      [true, "informal", "tmm", "yarın buluşalım mı?"], [true, "informal", "olurr", "akşam çıkalım mı"], [true, "informal", "okk", "{T} kahve içelim mi"], [true, "informal", "varımmm", "hadi {T} çıkalım"], [true, "informal", "tamamdır 👍", "{T} buluşsak mı"], [true, "informal", "olur olur", "{T} görüşelim"],
      [false, "neg", "olmaz, işim var", "{T} buluşalım mı?"], [false, "neg", "maalesef gelemem", "{T} kahve içelim mi"], [false, "neg", "tamam ama {T} olmaz", "{T} buluşalım mı?"],
      [false, "question", "tamam mı?", "{T} buluşalım mı?"], [false, "question", "olur mu sence?", "{T} buluşalım mı?"],
      [false, "lexical", "tamam anladım", "fatura geldi, 450 lira"], [false, "lexical", "ok", "toplantı 3'te bitti"], [false, "lexical", "süper", "sınavı geçtim!"], [false, "lexical", "evet", "eve vardın mı?"],
    ],
    en: [
      [true, "plain", "sure, see you then", "let's meet {T}"], [true, "plain", "sounds good", "wanna grab {A} {T}?"], [true, "plain", "deal", "how about {A} {T}?"], [true, "plain", "works for me", "shall we do {A} {T}"],
      [true, "plain", "I'm in", "let's go for {A} {T}"], [true, "plain", "yes let's do it", "want to meet up {T}?"], [true, "plain", "perfect", "come over {T}"], [true, "plain", "count me in", "up for {A} {T}?"],
      [true, "informal", "k", "wanna hang {T}"], [true, "informal", "yesss", "lets grab smth {T}"], [true, "informal", "ok cool", "let's meet {T}"], [true, "informal", "bet", "drinks tn?"], [true, "informal", "sure thing 👍", "wanna grab {A} {T}?"],
      [false, "neg", "can't, sorry", "let's meet {T}"], [false, "neg", "ok but not {T}", "let's meet {T}"], [false, "neg", "no I'm busy", "wanna grab {A} {T}?"],
      [false, "question", "ok?", "let's meet {T}"], [false, "question", "sure you want to?", "let's meet {T}"],
      [false, "lexical", "ok noted", "the bill is 450"], [false, "lexical", "great", "I passed the exam!"], [false, "lexical", "yes", "are you home?"], [false, "lexical", "perfect", "the package arrived"],
    ],
  },
  cancellation: {
    tr: [
      [true, "plain", "{T} gelemiyorum, kusura bakma"], [true, "plain", "{T} gelemeyeceğim"], [true, "plain", "{A} planını iptal edelim"], [true, "plain", "vazgeçtim, {T} çıkmayalım"], [true, "plain", "ben iptal ediyorum"],
      [true, "plain", "{T} yapamayacağım maalesef"], [true, "plain", "işim çıktı, katılamayacağım"], [true, "plain", "rezervasyonu iptal ettim"], [true, "plain", "{T} olmayacak, hastayım"], [true, "plain", "{A} işi yattı, gelemem"],
      [true, "informal", "gelemiycem ya"], [true, "informal", "iptall"], [true, "informal", "ya ben gelemiyom {T}"], [true, "informal", "vazgectim ya"], [true, "informal", "bu aksam olmuyo kusura bakma"], [true, "informal", "cancel ediyorum"],
      [false, "neg", "iptal etme sakın"], [false, "neg", "vazgeçme, gel"], [false, "neg", "gelemeyeceğini sanmıştım"],
      [false, "quote", "{N} 'gelemiyorum' dedi"],
      [false, "meta", "neden hep sen iptal ediyorsun"],
      [false, "third", "konser iptal edilmiş"], [false, "third", "uçuşu iptal etmişler"], [false, "third", "{N} gelemiyormuş"],
      [false, "question", "iptal mi oldu?"], [false, "question", "gelemiyor musun?"],
      [false, "lexical", "aboneliği iptal ettim nihayet"], [false, "lexical", "siparişi iptal ettirdim"], [false, "lexical", "kartımı iptal ettirdim"], [false, "lexical", "bekleyemiyorum!"],
    ],
    en: [
      [true, "plain", "I can't make it {T}, sorry"], [true, "plain", "let's cancel {A}"], [true, "plain", "I have to bail {T}"], [true, "plain", "count me out {T}"], [true, "plain", "I won't make it {T}"],
      [true, "plain", "let's call it off"], [true, "plain", "I cancelled the booking"], [true, "plain", "something came up, I can't come"], [true, "plain", "I'm out for {T}, sick"], [true, "plain", "not gonna happen {T}, sorry"],
      [true, "informal", "cant make it tn"], [true, "informal", "gotta bail sry"], [true, "informal", "imma skip {T}"], [true, "informal", "nah can't come {T}"], [true, "informal", "cancel ediyorum sorry"],
      [false, "neg", "don't cancel please"], [false, "neg", "we're not cancelling"],
      [false, "quote", "{N} said \"I can't make it\""],
      [false, "meta", "why do you always cancel"],
      [false, "third", "the concert was cancelled"], [false, "third", "they cancelled our flight"], [false, "third", "{N} can't make it apparently"],
      [false, "question", "did they cancel it?"], [false, "question", "can't you come?"],
      [false, "lexical", "I cancelled my gym membership"], [false, "lexical", "can't wait for {T}!"], [false, "lexical", "can't believe it"], [false, "lexical", "cancel my order pls"],
    ],
  },
  postponement: {
    tr: [
      [true, "plain", "{A} işini haftaya erteleyelim"], [true, "plain", "{T} yerine pazar yapsak"], [true, "plain", "başka bir güne alalım mı"], [true, "plain", "buluşmayı yarına alalım"], [true, "plain", "saati biraz kaydıralım, 9 olsun"],
      [true, "plain", "toplantıyı erteliyorum"], [true, "plain", "sonraya bırakalım"], [true, "plain", "haftaya kalsın"], [true, "plain", "{T} değil de cumartesi olsun"], [true, "plain", "erteleyebilir miyiz?"],
      [true, "informal", "ertelesek mi ya"], [true, "informal", "baska gune alalim"], [true, "informal", "haftaya kalsin mi"], [true, "informal", "{T} olmuyo, yarına atalım"], [true, "informal", "postpone edelim"],
      [false, "neg", "erteleme artık, yapalım"], [false, "neg", "ertelemeyelim bence"],
      [false, "quote", "{N} 'erteleyelim' dedi"],
      [false, "meta", "neden hep erteliyorsun"],
      [false, "third", "maçı ertelemişler"], [false, "third", "sınav ertelendi"],
      [false, "question", "ertelendi mi?"], [false, "question", "kaça alındı?"],
      [false, "lexical", "geç kalıyorum, 10 dk"], [false, "lexical", "yarın görüşürüz"], [false, "lexical", "başka bir şey lazım mı"],
    ],
    en: [
      [true, "plain", "can we push it to {T}?"], [true, "plain", "let's postpone {A}"], [true, "plain", "rain check?"], [true, "plain", "let's do it another day"], [true, "plain", "can we reschedule?"],
      [true, "plain", "move it to sunday?"], [true, "plain", "next week instead?"], [true, "plain", "let's push dinner back an hour"], [true, "plain", "tomorrow instead? today's crazy"], [true, "plain", "I need to postpone {T}"],
      [true, "informal", "rain check pls"], [true, "informal", "can we do tmrw instead"], [true, "informal", "push to next wk?"], [true, "informal", "reschedule? 🙏"], [true, "informal", "erteleyelim mi, today's bad"],
      [false, "neg", "don't postpone again"], [false, "neg", "let's not reschedule"],
      [false, "quote", "{N} said 'let's postpone'"],
      [false, "meta", "why do you always postpone"],
      [false, "third", "the match was postponed"], [false, "third", "they rescheduled the exam"],
      [false, "question", "was it postponed?"], [false, "question", "what time is it now?"],
      [false, "lexical", "running late, 10 min"], [false, "lexical", "see you tomorrow"], [false, "lexical", "another coffee?"], [false, "lexical", "I moved to Berlin"],
    ],
  },
};

const r = (s: number) => () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
/** Each template instantiated `reps` times with different slots. */
export function testItems(reps = 4): Item[] {
  const out: Item[] = [], rnd = r(42);
  let tpl = 0;
  for (const [b, langs] of Object.entries(D)) for (const lang of ["tr", "en"] as const) for (const [label, kind, text, prev] of langs[lang]) {
    tpl++;
    const seen = new Set<string>();
    for (let k = 0; k < reps; k++) {
      const fill = (s: string) => s.replace(/\{T\}/g, () => T[lang][Math.floor(rnd() * 8)]!).replace(/\{A\}/g, () => A[lang][Math.floor(rnd() * 8)]!).replace(/\{N\}/g, () => N[Math.floor(rnd() * N.length)]!);
      const t = fill(text), p = prev ? fill(prev) : undefined;
      if (seen.has(t + "|" + p)) continue;
      seen.add(t + "|" + p);
      out.push({ b, lang, label, kind, text: t, prev: p, tpl });
    }
  }
  return out;
}
