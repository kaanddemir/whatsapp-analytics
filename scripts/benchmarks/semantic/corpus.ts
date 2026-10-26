/* a synthetic two-person chat for the conversational benchmark.

   Background: everyday exchanges of 1-6 messages, Turkish, English and
   mixed, built from slotted templates (names, places, foods, times), with
   short replies, fillers and emoji, spread over three years. It deliberately
   shares words with the families' traps and negatives (dinner, work, phone,
   car, school...) so lexical overlap alone is misleading.

   Families (families.ts) are planted as contiguous exchanges; traps are
   single messages elsewhere, in the same language as the planted version.
   Every gold line must occur exactly once in the corpus; that is checked.
   No real chat is used. */
import type { Message } from "@/model";
import { FAMILIES, type Family } from "./families";

export function rng(seed: number) {
  let s = (seed * 2654435761) >>> 0;
  return () => ((s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 2 ** 32);
}

const NAMES = ["ayşe", "mehmet", "zeynep", "can", "elif", "burak", "selin", "emre", "derya", "kerem", "mert", "ece", "deniz", "berk"];
const PLACES = ["kadıköy", "beşiktaş", "moda", "nişantaşı", "bebek", "karaköy", "üsküdar", "cihangir", "ataşehir", "bostancı"];
const FOODS = ["pizza", "köfte", "lahmacun", "mantı", "makarna", "döner", "balık", "menemen", "börek", "salata", "burger", "sushi"];
const TIMES = ["7", "8", "9", "yedi buçuk", "sekiz gibi", "öğlen", "akşamüstü"];
const ETIMES = ["7", "8", "9", "half seven", "around 8", "noon", "after work"];
const DAYS_TR = ["pazartesi", "salı", "çarşamba", "perşembe", "cuma", "cumartesi", "pazar"];
const DAYS_EN = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const SHOWS = ["dizi", "film", "belgesel", "maç"];

type Line = (r: () => number) => string;
const p = <T,>(r: () => number, a: readonly T[]) => a[Math.floor(r() * a.length)]!;
const t = (s: string): Line => (r) => s
  .replace(/\{name\}/g, () => p(r, NAMES)).replace(/\{place\}/g, () => p(r, PLACES)).replace(/\{food\}/g, () => p(r, FOODS))
  .replace(/\{time\}/g, () => p(r, TIMES)).replace(/\{etime\}/g, () => p(r, ETIMES)).replace(/\{day\}/g, () => p(r, DAYS_TR))
  .replace(/\{eday\}/g, () => p(r, DAYS_EN)).replace(/\{show\}/g, () => p(r, SHOWS)).replace(/\{n\}/g, () => String(2 + Math.floor(r() * 40)));

// Exchanges: each is a list of line templates, alternating speakers from a random start.
const TR_EX: readonly (readonly string[])[] = [
  ["akşam ne yiyoruz", "{food} olabilir", "olur"], ["eve gelirken ekmek alır mısın", "tamam"], ["neredesin", "{place}'deyim, {time} gibi çıkarım"],
  ["bugün çok yoğundu", "benim de, toplantıdan toplantıya koştum", "akşam erken yatalım"], ["{name} aradı, seni sordu", "akşam ararım onu"],
  ["{day} ne yapıyoruz", "bilmiyorum, sen ne istersin", "evde takılalım bence"], ["yeni bölüm çıkmış", "izlemedim daha spoiler verme"],
  ["telefonun şarjı bitti, eve gelince yazarım"], ["annem pazar yemeğe çağırıyor", "olur gideriz"], ["kargo geldi mi", "kapıya bırakmışlar"],
  ["faturayı ödedin mi", "evet dün ödedim"], ["internet yine gitti", "modemi resetle", "düzeldi"], ["trafik berbat, otobüsteyim"],
  ["bu akşam {show} izleyelim mi", "olur hangisi", "sen seç"], ["kahve içtin mi bugün", "üçüncüsü elimde"], ["{place}'de yeni bir kafe açılmış", "gidelim bir ara"],
  ["yarın erken kalkacağım", "kaçta", "altıda", "of"], ["markete uğradım, süt yumurta aldım"], ["bulaşıkları ben yıkarım bu akşam", "süpersin"],
  ["işten çıktım geliyorum"], ["hava çok soğuk bugün, kalın giyin"], ["yağmur başladı şemsiye var mı yanında", "yok ya", "ıslanacaksın"],
  ["{name}'in doğum günü ne zamandı", "ayın {n}'i galiba"], ["toplantı uzadı geç kalacağım", "tamam"], ["maç kaç kaç", "2-1 bitti"],
  ["spor salonuna gidiyorum", "kolay gelsin"], ["şu videoyu gördün mü", "hahaha çok iyi"], ["kira {n} gün sonra yatacak unutma", "not aldım"],
  ["{food} siparişi verdim, yarım saate gelir"], ["çocuklar uyudu mu", "yeni uyudular"], ["bugün iş yerinde elektrik kesildi", "erken mi çıktınız", "yok jeneratör var"],
  ["araba benzini bitmek üzere", "dönüşte alırım"], ["ödevini bitirdi mi ece", "yarısını"], ["hafta sonu {place}'e mi gitsek", "kalabalık olur ama", "sabah erken gideriz"],
  ["kitabı bitirdim sonunda", "nasıldı", "sonu biraz hızlı bitti"], ["yarın {day} değil mi", "evet"], ["{name} ile kahve içtik", "nasılmış"],
  ["çamaşırları makineye attım"], ["dişçiden randevu aldım {day} {time}"], ["telefonu sessizde unuttum, şimdi gördüm"], ["ne zaman dönüyorsun", "{day} akşam"],
  ["patron yine mail atmış gece yarısı", "boşver yarın bakarsın"], ["akşam yemekte {food} vardı, çok güzeldi"], ["evdeki kahve bitmiş", "alırım"],
  ["bizim sokakta yine kazı var", "bitmedi mi o iş"], ["{name} yarın bize geliyor", "ne güzel, {food} yaparız"], ["bugün {n} bin adım attım"],
];
const EN_EX: readonly (readonly string[])[] = [
  ["what's for dinner", "{food}?", "sounds good"], ["can you grab bread on the way home", "sure"], ["where are you", "at {place}, leaving around {etime}"],
  ["today was crazy", "same, back to back meetings", "let's sleep early"], ["{name} called, asked about you", "i'll call her tonight"],
  ["what are we doing {eday}", "no idea, what do you want", "stay in?"], ["new episode is out", "haven't watched it, no spoilers"],
  ["phone's dying, text you when i'm home"], ["mom invited us for sunday lunch", "ok let's go"], ["did the package arrive", "they left it at the door"],
  ["did you pay the bill", "yep yesterday"], ["internet is down again", "restart the router", "fixed"], ["traffic is awful, on the bus"],
  ["movie tonight?", "which one", "you pick"], ["had your coffee yet", "on my third"], ["a new cafe opened in {place}", "let's try it sometime"],
  ["early start tomorrow", "what time", "six", "ugh"], ["stopped at the store, got milk and eggs"], ["i'll do the dishes tonight", "you're the best"],
  ["leaving work now"], ["it's freezing today, dress warm"], ["it's raining, do you have an umbrella", "nope", "you'll get soaked"],
  ["when was {name}'s birthday again", "the {n}th i think"], ["meeting ran over, gonna be late", "ok"], ["what's the score", "2-1 final"],
  ["heading to the gym", "have fun"], ["did you see this video", "lmao so good"], ["rent is due in {n} days don't forget", "noted"],
  ["ordered {food}, here in half an hour"], ["are the kids asleep", "just now"], ["power went out at the office", "did you leave early", "no, generator"],
  ["car's almost out of gas", "i'll fill it on the way back"], ["finished the book finally", "how was it", "ending felt rushed"],
  ["had coffee with {name}", "how's she doing"], ["dentist appointment {eday} at {etime}"], ["left my phone on silent, just saw this"],
  ["when are you back", "{eday} evening"], ["boss emailed again at midnight", "ignore it till tomorrow"], ["we're out of coffee", "i'll get some"],
  ["{name} is coming over tomorrow", "nice, let's make {food}"], ["walked {n}k steps today"],
];
const MIX_EX: readonly (readonly string[])[] = [
  ["meeting'e geç kaldım yine", "normal artık"], ["bu weekend plan var mı", "yok chill"], ["deadline yarın, stres level max"],
  ["ok o zaman {etime} gibi", "tamam see you"], ["şu podcast'i dinle bence", "link at"], ["laptop update yapıyor bekliyorum"],
  ["sorry geç gördüm mesajı", "no problem"], ["{food} order ettim, sen de ister misin", "yes please"],
];
const FILLERS = ["tamam", "ok", "olur", "evet", "hahaha", "😂", "👍", "❤️", "aynen", "yes", "lol", "peki", "tmm", "sure", "hmm", "😘", "süper", "nice"];

export interface Planted { family: Family; index: number; lang: "tr" | "en"; ids: number[]; traps: number[] }
export interface Corpus { messages: Message[]; planted: Planted[] }

/** About `n` messages; family f is planted in Turkish when (index + seed) is even, else English. */
export function buildCorpus(n: number, seed: number): Corpus {
  const r = rng(seed);
  type Ex = { lines: [number, string][]; plant?: Planted; trap?: Planted };
  const exchanges: Ex[] = [];
  let count = 0;
  while (count < n) {
    const u = r();
    const pool = u < 0.45 ? TR_EX : u < 0.85 ? EN_EX : MIX_EX;
    const ex = p(r, pool);
    const start = r() < 0.5 ? 0 : 1;
    const lines: [number, string][] = ex.map((s, i) => [(start + i) % 2, t(s)(r)]);
    if (r() < 0.35) lines.push([(start + lines.length) % 2, p(r, FILLERS)]);
    exchanges.push({ lines });
    count += lines.length;
  }
  const planted: Planted[] = [];
  FAMILIES.forEach((family, index) => {
    const lang = (index + seed) % 2 === 0 ? "tr" : "en";
    const v = family[lang];
    const pl: Planted = { family, index, lang, ids: [], traps: [] };
    planted.push(pl);
    const at = 1 + Math.floor(r() * (exchanges.length - 1));
    exchanges.splice(at, 0, { lines: v.lines.map(([s, x]) => [s, x]), plant: pl });
    for (const trap of v.traps ?? []) {
      const tat = 1 + Math.floor(r() * (exchanges.length - 1));
      exchanges.splice(tat, 0, { lines: [[r() < 0.5 ? 0 : 1, trap]], trap: pl });
    }
  });
  // Times: exchanges a few hours to a day apart, messages within an exchange a minute or two apart, over ~3 years.
  const messages: Message[] = [];
  const span = 3 * 365 * 86_400_000;
  let ts = Date.UTC(2022, 0, 1, 9);
  const gap = span / exchanges.length;
  for (const ex of exchanges) {
    ts += Math.floor(gap * (0.3 + r() * 1.4));
    let mts = ts;
    const first = messages.length;
    for (const [s, text] of ex.lines) {
      mts += 20_000 + Math.floor(r() * 150_000);
      messages.push({ ts: mts, sender: s, kind: "text", text } as Message);
    }
    if (ex.plant) ex.plant.ids = ex.lines.map((_, i) => first + i);
    if (ex.trap) ex.trap.traps.push(first);
  }
  // Every gold line occurs once.
  const counts = new Map<string, number>();
  for (const m of messages) counts.set(m.text, (counts.get(m.text) ?? 0) + 1);
  for (const pl of planted) for (const g of pl.family[pl.lang].gold) {
    const text = messages[pl.ids[g]!]!.text;
    if (counts.get(text) !== 1) throw new Error(`gold not unique: ${pl.family.id}: ${text}`);
  }
  return { messages, planted };
}
