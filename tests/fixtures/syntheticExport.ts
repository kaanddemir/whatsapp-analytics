/* synthetic WhatsApp exports. No real chats.

   Formats cover the shapes the production parser accepts:
     android24  "31/12/2023, 21:05 - Alice: text"
     ios        "[31.12.23, 21:05:33] Alice: text"   (LRM placeholders, system lines)
     android12  "12/31/23, 9:05 PM - Alice: text"  (NNBSP before AM/PM, M/D order)
   Bodies include media placeholders, deleted messages, edits, multi-line
   messages, blank lines inside messages, emoji and Turkish text.

   Generated in pieces so a 5M-message export never needs to exist as one
   JS string (the browser harness turns the pieces into a Blob). */
export type Format = "android24" | "ios" | "android12";
export type Lang = "en" | "tr" | "mix";

export function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const EN = {
  filler: ["ok", "lol", "yes", "no way", "haha", "sure", "see you", "good night", "what?", "👍", "on my way", "call me", "😂😂", "really?", "thanks!"],
  topics: [
    "did you finish the project report for work", "the football match last night was insane",
    "we need to buy groceries milk eggs bread", "my mom says hi and asks about dinner sunday",
    "the new series on netflix is really good", "traffic is terrible today again",
    "i booked the dentist appointment for tuesday", "the rent is due next week remember",
    "let's go to the gym tomorrow morning", "the exam results came out finally",
    "can you pick up the kids after school", "the meeting got moved to thursday afternoon",
  ],
};
const TR = {
  filler: ["tamam", "hahaha", "evet", "yok artık", "olur", "görüşürüz", "iyi geceler", "ne?", "👍", "yoldayım", "ara beni", "😂😂", "cidden mi?", "sağ ol!"],
  topics: [
    "iş için proje raporunu bitirdin mi", "dün akşamki maç inanılmazdı",
    "market alışverişi lazım süt yumurta ekmek", "annem selam söyledi pazar akşam yemeğini soruyor",
    "netflixteki yeni dizi çok güzel", "bugün trafik yine berbat",
    "salı günü dişçi randevusu aldım", "kira haftaya ödenecek unutma",
    "yarın sabah spora gidelim", "sınav sonuçları sonunda açıklandı",
    "çocukları okuldan alabilir misin", "toplantı perşembe öğleden sonraya alındı",
  ],
};
// Long-tail vocabulary: pseudo-words with Zipf-like use.
const SYL = ["ka", "le", "mi", "ro", "su", "ta", "ne", "bo", "zi", "ve", "ça", "şe", "ğa", "kı", "dü", "pa", "ge", "ny", "lo", "ar"];

const pad = (n: number) => String(n).padStart(2, "0");
const LRM = "‎";
const NNBSP = " ";

export function header(fmt: Format, ts: number): string {
  const d = new Date(ts);
  const D = d.getUTCDate(), M = d.getUTCMonth() + 1, Y = d.getUTCFullYear(), h = d.getUTCHours(), m = d.getUTCMinutes(), s = d.getUTCSeconds();
  if (fmt === "android24") return `${pad(D)}/${pad(M)}/${Y}, ${pad(h)}:${pad(m)} - `;
  if (fmt === "ios") return `[${pad(D)}.${pad(M)}.${String(Y).slice(2)}, ${pad(h)}:${pad(m)}:${pad(s)}] `;
  const h12 = h % 12 || 12;
  return `${M}/${D}/${String(Y).slice(2)}, ${h12}:${pad(m)}${NNBSP}${h < 12 ? "AM" : "PM"} - `;
}

export interface SynthOptions {
  readonly n: number;
  readonly format: Format;
  readonly lang: Lang;
  readonly seed?: number;
  /** Span of the chat in years; ~10 by default regardless of size. */
  readonly years?: number;
  /** Multiplies the length of topic messages (long-message distribution). */
  readonly lengthFactor?: number;
  /** Append random pseudo-words to topic messages (lexical baseline tests). Off for the clean retrieval evaluation variant. */
  readonly noise?: boolean;
}

/** Yields export text in pieces of roughly `piece` messages. */
export function* synthExport(o: SynthOptions, piece = 5000): Generator<string> {
  const rnd = rng(o.seed ?? 42);
  const pick = <T,>(a: readonly T[]) => a[Math.floor(rnd() * a.length)] as T;
  const lex = Array.from({ length: 200000 }, () => Array.from({ length: 2 + Math.floor(rnd() * 4) }, () => pick(SYL)).join(""));
  const senders = ["Alice", "Bora", "Can Yılmaz", "Deniz"];
  const scale = ((o.years ?? 10) * 365 * 86_400_000) / o.n / (0.08 * 3_600_000 * 17 + 0.92 * 120_000);
  let ts = Date.UTC(2015, 0, 1, 9);
  let buf: string[] = [];
  if (o.format === "ios") buf.push(`${header("ios", ts)}Chat: ${LRM}Messages and calls are end-to-end encrypted. No one outside of this chat, not even WhatsApp, can read or listen to them.\n`);
  for (let i = 0; i < o.n; i++) {
    ts += Math.max(1000, scale * (rnd() < 0.08 ? 3_600_000 * (2 + rnd() * 30) : 60_000 * rnd() * 4));
    const tr = o.lang === "tr" || (o.lang === "mix" && rnd() < 0.5);
    const L = tr ? TR : EN;
    const r = rnd();
    let body: string;
    if (r < 0.5) body = pick(L.filler);
    else if (r < 0.9) {
      body = pick(L.topics);
      const extra = Math.floor((1 + rnd() * 6) * (o.lengthFactor ?? 1));
      if (o.noise !== false && rnd() < 0.6) body += " " + Array.from({ length: extra }, () => lex[Math.floor(lex.length * rnd() ** 4)]).join(" ");
    } else if (r < 0.95) {
      // Media placeholders in the platform's own wording.
      body = o.format === "ios" ? `${LRM}${pick(["image omitted", "video omitted", "audio omitted", "sticker omitted"])}` : "<Media omitted>";
    } else if (r < 0.96) body = o.format === "ios" ? `${LRM}This message was deleted.` : "This message was deleted";
    else if (r < 0.97) body = pick(L.topics) + (o.format === "ios" ? ` ${LRM}<This message was edited>` : " <This message was edited>");
    else if (r < 0.99) body = pick(L.topics) + "\n" + pick(L.topics) + (rnd() < 0.3 ? "\n\n" + pick(L.filler) : "");
    else body = pick(L.topics) + " " + pick(L.topics) + " " + pick(L.topics);
    buf.push(header(o.format, ts) + pick(senders) + ": " + body + "\n");
    if (buf.length >= piece) { yield buf.join(""); buf = []; }
  }
  if (buf.length) yield buf.join("");
}
