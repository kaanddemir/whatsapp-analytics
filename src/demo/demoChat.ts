/* The demo chat: a synthetic WhatsApp export of three friends, generated
   from a fixed seed, so every visit gets the same text and the same numbers.
   No real conversation is involved. It is written as an Android export and
   goes through the ordinary import (parser, worker, analytics, Ask, Recap);
   nothing here computes a statistic. It is never saved on the device.

   Enough happens in it for every view to have something to show: plans and
   replies, apologies, a trip, a move, a sick cat, media, emoji, late-night
   messages, a quieter spring and a busier summer. */
import type { Locale } from "@/i18n/types";

export const DEMO_FILE_NAME = "whatsapp-analytics-demo.txt";

interface Script {
  readonly people: readonly [string, string, string];
  /** Everyday lines anyone may send. */
  readonly chatter: readonly string[];
  /** Short exchanges, sent in order by alternating people. */
  readonly threads: readonly (readonly string[])[];
  readonly night: readonly string[];
}

const EN: Script = {
  people: ["Maya", "Leo", "Sam"],
  chatter: [
    "Good morning ☀️", "Morning!", "On my way", "Haha 😂", "That's hilarious 😂", "Ok", "Sounds good 👍", "Coffee later? ☕",
    "Long day at work", "Just got home", "Did you see the match last night?", "I'm so tired today", "Thanks ❤️",
    "Running a bit late", "Lunch?", "Same here", "Love it 😍", "Good night 🌙", "<Media omitted>", "Can you send me the address?",
  ],
  threads: [
    ["Shall we meet on Saturday for brunch?", "Sure, see you there!", "11:00 at the usual place?", "Perfect 👍"],
    ["Did anyone get the concert tickets?", "Not yet, they sell out fast", "I'll try again tonight", "Got them!! 🎉"],
    ["Sorry, I can't make it tonight 😕", "No worries, next time", "Let's do Thursday instead?", "Thursday works"],
    ["Our flat is getting too small, we should look for a bigger place", "The rent near the park is crazy", "I found a listing with a balcony", "Let's go see it this weekend"],
    ["The cat hasn't eaten all day, I'm taking her to the vet", "Oh no, keep us posted", "The vet says it's a minor infection, she'll be fine", "So glad ❤️"],
    ["How about Lisbon in July? Flights are cheap right now", "I'm in!", "I booked the hotel for the second week of July", "Can't wait 🏖️"],
    ["Sorry I missed your call", "No problem, call me when you're free", "Calling you in 5"],
    ["Movie night on Friday? 🍿", "Yes! Your place?", "Sure, I'll make pizza 🍕"],
    ["Happy birthday!! 🎂🎉", "Happy birthday 🥳", "Thank you all ❤️"],
  ],
  night: ["Can't sleep", "Still working on that presentation", "Same, it's 2 am 😅", "Go to sleep 😄"],
};

const TR: Script = {
  people: ["Elif", "Mert", "Zeynep"],
  chatter: [
    "Günaydın ☀️", "Günaydın!", "Yoldayım", "Haha 😂", "Çok komik 😂", "Tamam", "Olur 👍", "Sonra kahve? ☕",
    "İşte uzun bir gündü", "Eve yeni geldim", "Dün akşamki maçı izlediniz mi?", "Bugün çok yorgunum", "Teşekkürler ❤️",
    "Biraz gecikeceğim", "Öğle yemeği?", "Bende de öyle", "Bayıldım 😍", "İyi geceler 🌙", "<Media omitted>", "Adresi atar mısın?",
  ],
  threads: [
    ["Cumartesi kahvaltıda buluşalım mı?", "Olur, görüşürüz!", "11'de her zamanki yerde?", "Harika 👍"],
    ["Konser biletlerini alan oldu mu?", "Daha değil, hemen tükeniyor", "Bu akşam tekrar deneyeceğim", "Aldım!! 🎉"],
    ["Kusura bakma, bu akşam gelemiyorum 😕", "Sorun değil, başka zaman", "Perşembe yapalım mı?", "Perşembe olur"],
    ["Bu daire bize artık dar geliyor, daha büyük bir yer bakalım", "Parkın oradaki kiralar çok yüksek", "Balkonlu bir ilan buldum", "Hafta sonu gidip bakalım"],
    ["Kedi bütün gün hiç yemek yemedi, veterinere götürüyorum", "Eyvah, haber ver", "Veteriner hafif bir enfeksiyon dedi, iyileşecek", "Çok sevindim ❤️"],
    ["Temmuzda Lizbon'a gitmeye ne dersiniz? Uçak biletleri ucuz", "Ben varım!", "Temmuzun ikinci haftası için oteli ayırttım", "Sabırsızlanıyorum 🏖️"],
    ["Aramanı kaçırdım, kusura bakma", "Sorun değil, müsait olunca ara", "5 dakikaya arıyorum"],
    ["Cuma film gecesi? 🍿", "Evet! Sende mi?", "Olur, pizza yaparım 🍕"],
    ["İyi ki doğdun!! 🎂🎉", "Doğum günün kutlu olsun 🥳", "Hepinize teşekkürler ❤️"],
  ],
  night: ["Uyuyamıyorum", "Hâlâ şu sunum üzerinde çalışıyorum", "Bende, saat 2 olmuş 😅", "Hadi uyu artık 😄"],
};

/** The demo export's text for the interface language. Deterministic: the same seed every time. */
export function demoChat(locale: Locale): string {
  const script = locale === "tr" ? TR : EN;
  let seed = 20240107;
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const pick = <T,>(list: readonly T[]) => list[Math.floor(random() * list.length)]!;
  const pad = (n: number) => String(n).padStart(2, "0");
  const entries: { at: number; who: string; text: string }[] = [];
  const write = (at: number, who: string, text: string) => { entries.push({ at, who, text }); };
  const line = ({ at, who, text }: (typeof entries)[number]) => {
    const d = new Date(at);
    return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${String(d.getUTCFullYear()).slice(2)}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} - ${who}: ${text}`;
  };
  const MINUTE = 60_000, DAY = 86_400_000;
  const start = Date.UTC(2024, 0, 8), days = 240;
  let thread = 0;
  for (let day = 0; day < days; day++) {
    // Quieter in spring, busier in summer; some days nobody writes.
    const busy = day < 100 ? 0.65 : day > 170 ? 1.5 : 1;
    if (random() > 0.8 * Math.min(1, busy)) continue;
    let at = start + day * DAY + (8 + Math.floor(random() * 4)) * 3_600_000 + Math.floor(random() * 60) * MINUTE;
    let who = pick(script.people);
    const next = () => script.people[(script.people.indexOf(who) + 1 + Math.floor(random() * 2)) % 3]!;
    const count = Math.round((3 + random() * 12) * busy);
    for (let i = 0; i < count; i++) {
      at += (1 + Math.floor(random() * (i % 5 === 4 ? 180 : 25))) * MINUTE;
      if (random() < 0.6) who = next();
      write(at, who, pick(script.chatter));
    }
    // Every few days a conversation with a beginning and an end.
    if (day % 6 === 2) {
      for (const text of script.threads[thread++ % script.threads.length]!) {
        at += (1 + Math.floor(random() * 6)) * MINUTE;
        write(at, who, text);
        who = next();
      }
    }
    // Leo/Mert keeps late hours now and then.
    if (random() < 0.12) {
      let late = start + day * DAY + DAY + (1 + Math.floor(random() * 2)) * 3_600_000;
      for (const text of script.night) {
        write(late, script.people[1], text);
        late += (2 + Math.floor(random() * 5)) * MINUTE;
      }
    }
  }
  // In time order, as an export is; a stable sort keeps same-minute messages as written.
  return entries.sort((a, b) => a.at - b.at).map(line).join("\n") + "\n";
}
