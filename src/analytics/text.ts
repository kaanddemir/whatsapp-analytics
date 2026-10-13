/* Emoji and keyword extraction: emoji matching, word tokens, stopwords,
   Turkish lowercasing, stretch folding and key-mash filtering, with the
   former engine's known defects fixed:

   C3  Legacy lowercased every word the Turkish way, so English "Is" became
       "ıs". Here a word with a Turkish-only letter (çğıöşü, İ) is lowercased
       with Turkish rules; a word without one is ambiguous only in its "I",
       and that is decided by the chat's dominant language (stopword counts
       over the whole chat), defaulting to English rules.
   C4  Legacy stripped every final double letter ("all" -> "al", "kiss" ->
       "kis"). Here a final double is folded only in a word that was visibly
       stretched ("çoookk" -> "çok"); "all", "will", "kiss" survive.

   Tokens are Unicode letters (legacy accepted only ASCII and Turkish
   letters, so "café" became "caf"). */

// Legacy _EMOJI_BASE, code point for code point.
const EMOJI_BASE =
  "[\\u{2194}-\\u{21AA}\\u{231A}\\u{231B}\\u{2328}\\u{23CF}\\u{23E9}-\\u{23F3}\\u{23F8}-\\u{23FA}\\u{24C2}\\u{25AA}\\u{25AB}" +
  "\\u{25B6}\\u{25C0}\\u{25FB}-\\u{25FE}\\u{2600}-\\u{2604}\\u{260E}\\u{2611}\\u{2614}\\u{2615}\\u{2618}\\u{261D}\\u{2620}" +
  "\\u{2622}\\u{2623}\\u{2626}\\u{262A}\\u{262E}\\u{262F}\\u{262D}\\u{2638}-\\u{263A}\\u{2640}\\u{2642}\\u{2648}-\\u{2653}" +
  "\\u{265F}\\u{2660}\\u{2663}\\u{2665}\\u{2666}\\u{2668}\\u{267B}\\u{267E}\\u{267F}\\u{2692}-\\u{2697}\\u{2699}\\u{269B}" +
  "\\u{269C}\\u{26A0}\\u{26A1}\\u{26A7}\\u{26AA}\\u{26AB}\\u{26B0}\\u{26B1}\\u{26BD}\\u{26BE}\\u{26C4}\\u{26C5}\\u{26C8}" +
  "\\u{26CE}\\u{26CF}\\u{26D1}\\u{26D3}\\u{26D4}\\u{26E9}\\u{26EA}\\u{26F0}-\\u{26F5}\\u{26F7}-\\u{26FA}\\u{26FD}\\u{2702}" +
  "\\u{2705}\\u{2708}-\\u{270D}\\u{270F}\\u{2712}\\u{2714}\\u{2716}\\u{271D}\\u{2721}\\u{2728}\\u{272F}\\u{2733}\\u{2734}" +
  "\\u{2744}\\u{2747}\\u{274C}\\u{274E}\\u{2753}-\\u{2755}\\u{2757}\\u{2763}\\u{2764}\\u{2795}-\\u{2797}\\u{27A1}\\u{27B0}" +
  "\\u{27BF}\\u{2934}\\u{2935}\\u{2B05}-\\u{2B07}\\u{2B1B}\\u{2B1C}\\u{2B50}\\u{2B55}\\u{203C}\\u{2049}\\u{2139}\\u{3030}" +
  "\\u{303D}\\u{3297}\\u{3299}\\u{1F000}-\\u{1F0FF}\\u{1F170}-\\u{1F19A}\\u{1F200}-\\u{1F2FF}\\u{1F300}-\\u{1F3FA}" +
  "\\u{1F400}-\\u{1FAFF}]";
const EMOJI_ATOM =
  "(?:[0-9#*]\\u{FE0F}?\\u{20E3}" + // keycap
  "|[\\u{1F1E6}-\\u{1F1FF}]{2}" + // flag
  "|\\u{1F3F4}[\\u{E0060}-\\u{E007F}]+" + // subdivision flag
  `|${EMOJI_BASE}\\u{FE0F}?[\\u{1F3FB}-\\u{1F3FF}]?)`;
const EMOJI_RE = new RegExp(`${EMOJI_ATOM}(?:\\u{200D}${EMOJI_ATOM})*`, "gu");
const SKIN_TONE_RE = /[\u{1F3FB}-\u{1F3FF}]/gu;

// Every emoji sequence contains a code point at or above U+203C (keycaps via
// U+20E3), so text without one is skipped without running the full pattern.
const MAY_HAVE_EMOJI = /[\u{203C}-\u{1FAFF}]/u;

/** Whole emoji sequences in `text`, skin tones folded (legacy behaviour). */
export function emojisIn(text: string): string[] {
  if (!MAY_HAVE_EMOJI.test(text)) return [];
  const found = text.match(EMOJI_RE);
  return found ? found.map((e) => e.replace(SKIN_TONE_RE, "")) : [];
}

const ENGLISH_STOPWORDS = new Set(`
a an and the is are was were be been being to of in on at for with without from by
this that these those it its it's i you he she we they them him her his hers our your
my me mine yours their theirs as if then than so but or nor not no yes do does did done
have has had having will would can could should shall may might must am pm
what when where who why how which while about into out up down over under
again more most some any all each every here there also very too much many one two
let lets going want need know think say said see come go back still even because before
after now well really sure thing things something anything nothing someone everyone
`.split(/\s+/).filter(Boolean));

const TURKISH_STOPWORDS = new Set(`
ben sen biz siz onlar bana sana ona bize size onlara beni seni onu bizi sizi onları
benim senin onun bizim sizin onların bende sende onda bizde sizde benden senden ondan
bizden sizden kendi kendim kendin kendine kendini bu şu bunu şunu buna şuna bunlar
şunlar bunun şunun burda burada şurada orada oraya buraya
ve veya ya da ile ama fakat ancak çünkü ki de te ta hem ise yoksa yani zaten oysa
halbuki lakin ayrıca hatta
için gibi kadar göre doğru karşı rağmen beri dolayı üzere
mi mı mu mü mış miş muş müş ne neden niye niçin nasıl nası nerde nerede nereye nereden
kim kime kimi kimin hangi kaç
çok daha az en biraz hiç hep herkes bazı bütün tüm işte şey şeyi şeyler falan filan
yine tekrar sonra önce şimdi artık bile sadece belki galiba herhalde acaba tabi tabii
tabiki
var yok değil oldu olur olsun olacak oluyor olmuş olan ol etti eder yap yapar
yaptı yapıyor dedi diyor dedim dedin diye demek desene
bir bi biri birşey bişey birşeyler bişeyler
`.split(/\s+/).filter(Boolean));

const OTHER_STOPWORDS = new Set("na la el en un une le les des du au aux et ou pour dans sur avec sans".split(" "));

const isStopword = (w: string) => ENGLISH_STOPWORDS.has(w) || TURKISH_STOPWORDS.has(w) || OTHER_STOPWORDS.has(w);

export type KeywordLocale = "tr" | "en";

const URL_RE = /(?:https?:\/\/|www\.)\S+/giu;
// Letters (with combining marks), optionally joined by apostrophes.
const TOKEN_RE = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu;
const TURKISH_LETTER = /[çğıöşüÇĞİÖŞÜ]/u;
const STRETCH_RE = /(.)\1{2,}/gu;
const TAIL_DOUBLE_RE = /(.)\1$/u;
const MASH_RE = /^(.{1,3}?)\1{2,}$/u;
const COMBINING_DOT = /̇/g;

function lower(word: string, locale: KeywordLocale): string {
  if (locale === "tr" || TURKISH_LETTER.test(word)) return word.toLocaleLowerCase("tr");
  return word.toLowerCase().replace(COMBINING_DOT, "");
}

/** "çoookk" -> "çok"; "all" stays "all" (C4). */
export function foldStretch(word: string): string {
  const folded = word.replace(STRETCH_RE, "$1");
  return folded === word ? word : folded.replace(TAIL_DOUBLE_RE, "$1");
}

/** The keyword a raw token stands for, or null when it is not one. */
function keywordOf(token: string, locale: KeywordLocale): string | null {
  // "Ali'nin" -> "ali", "don't" -> "don": the part before the apostrophe.
  const head = token.split(/['’]/u)[0]!;
  if ([...head].length < 2) return null;
  const word = foldStretch(lower(head, locale));
  return [...word].length > 1 && !isStopword(word) && !MASH_RE.test(word) ? word : null;
}

export type KeywordExtractor = (text: string) => string[];

/**
 * Keyword candidates of one message, normalised and filtered. Chats reuse a
 * small vocabulary, so each distinct token is normalised once per extractor
 * (one per chat, dropped with it).
 */
export function keywordExtractor(locale: KeywordLocale): KeywordExtractor {
  const memo = new Map<string, string | null>();
  return (text) => {
    const out: string[] = [];
    for (const token of text.normalize("NFC").replace(URL_RE, " ").match(TOKEN_RE) ?? []) {
      let word = memo.get(token);
      if (word === undefined) memo.set(token, (word = keywordOf(token, locale)));
      if (word !== null) out.push(word);
    }
    return out;
  };
}

/** One-off form of keywordExtractor, for tests. */
export const keywordsIn = (text: string, locale: KeywordLocale) => keywordExtractor(locale)(text);

const PLAIN_WORD = /[\p{L}]+/gu;

/**
 * The chat's dominant language for the ambiguous capital "I": Turkish when
 * Turkish stopwords (and Turkish-only letters) outnumber English stopwords.
 */
export function detectLocale(texts: Iterable<string>): KeywordLocale {
  let tr = 0;
  let en = 0;
  for (const text of texts) {
    for (const word of text.toLowerCase().replace(COMBINING_DOT, "").match(PLAIN_WORD) ?? []) {
      if (TURKISH_STOPWORDS.has(word) && !ENGLISH_STOPWORDS.has(word)) tr++;
      else if (ENGLISH_STOPWORDS.has(word) && !TURKISH_STOPWORDS.has(word)) en++;
    }
  }
  return tr > en ? "tr" : "en";
}
