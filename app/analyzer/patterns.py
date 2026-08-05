"""Regexes, marker lists and stopwords used to read a WhatsApp export.

Kept in one module so the matching rules can be read (and tuned) side by side,
away from the statistics code that consumes them.
"""

import re

# iOS uses brackets; Android uses a timestamp followed by " - ".
AMPM = r"[APap][Mm]|Ö[ÖSös]|ö[ösÖS]"
IOS_RE = re.compile(
    r"^\[(?P<date>\d{1,2}[/.]\d{1,2}[/.]\d{2,4}),\s*"
    r"(?P<time>\d{1,2}:\d{2}(?::\d{2})?)\s*(?P<ampm>" + AMPM + r")?\s*\]\s*"
    r"(?P<sender>[^:]+?):\s(?P<msg>.*)$"
)
ANDROID_RE = re.compile(
    r"^(?P<date>\d{1,2}[/.]\d{1,2}[/.]\d{2,4}),\s*"
    r"(?P<time>\d{1,2}:\d{2}(?::\d{2})?)\s*(?P<ampm>" + AMPM + r")?\s*-\s*"
    r"(?P<sender>[^:]+?):\s(?P<msg>.*)$"
)

DATE_PARTS_RE = re.compile(r"^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$")

# Timestamped system events must not become message continuations.
SYSTEM_LINE_RE = re.compile(
    r"^\[?\d{1,2}[/.]\d{1,2}[/.]\d{2,4},\s*\d{1,2}:\d{2}(?::\d{2})?\s*"
    r"(?:" + AMPM + r")?\s*(?:\]|-)\s*"
)

# WhatsApp writes many group actions as regular-looking "sender: message"
# rows. Keep these full-line templates narrow so ordinary chat text survives.
ENGLISH_SYSTEM_EVENT_PATTERNS = (
    re.compile(r"^messages and calls are end-to-end encrypted\. only people in this chat .+$", re.I),
    re.compile(r"^only messages that mention or people share with @meta ai can be read by meta\..+$", re.I | re.S),
    re.compile(r"^you were added$", re.I),
    re.compile(r"^.+ (?:added|removed) (?!you\s+(?:from|to)\b).+$", re.I),
    re.compile(r"^.+ changed (?:the )?group (?:description|subject|icon)$", re.I),
    re.compile(r"^.+ changed this group's icon$", re.I),
    re.compile(r"^.+ changed the subject(?: from .+ to .+)?$", re.I),
    re.compile(r"^(?:you|.+) created group(?: .+)?$", re.I),
    re.compile(r"^.+ changed their phone number(?: to .+)?$", re.I),
    re.compile(r"^security code with .+ changed$", re.I),
    re.compile(r"^you updated .+$", re.I),
    re.compile(r"^.+ (?:started|missed) (?:a )?(?:voice|video) call$", re.I),
    re.compile(
        r"^(?:voice|video) call\.\s*\d+\s*"
        r"(?:sec|secs|second|seconds|min|mins|minute|minutes)\s*[•·]\s*.+$",
        re.I,
    ),
    re.compile(r"^missed (?:voice|video) call\W*$", re.I),
)

TURKISH_SYSTEM_EVENT_PATTERNS = (
    re.compile(r"^.+ (?:gruba )?ekledi$", re.I),
    re.compile(r"^.+ gruptan (?:çıkardı|kaldırdı)$", re.I),
    re.compile(r"^.+ grup(?: başlığını| açıklamasını| simgesini) .+$", re.I),
    re.compile(r"^artık (?:bu grubun katılımcısı|üye) olmadığınız için .+$", re.I),
    re.compile(r"^(?:cevapsız )?(?:sesli|görüntülü) arama\W*$", re.I),
    re.compile(r"^.+ (?:sesli|görüntülü) arama başlatt[ıı]$", re.I),
)

SYSTEM_EVENT_PATTERNS = ENGLISH_SYSTEM_EVENT_PATTERNS + TURKISH_SYSTEM_EVENT_PATTERNS
# The category definitions below are the source of truth for both placeholder
# matching and the Media Breakdown labels. Caption/file-name prefixes are
# accepted, but only known localized labels can finish the message.
MEDIA_PLACEHOLDER_KINDS = (
    ("Stickers", ("sticker",), ("çıkartma", "sticker")),
    ("GIFs", ("gif",), ("gif",)),
    ("Video notes", ("video note",), ("video notu", "ptv")),
    ("Videos", ("video",), ("video",)),
    ("Photos", ("image", "photo"), ("fotoğraf", "resim", "görüntü")),
    ("Voice notes", ("audio",), ("ses", "ses kaydı", "sesli mesaj", "ptt")),
    ("Documents", ("document",), ("belge", "doküman")),
    ("Contacts", ("contact card",), ("kişi kartı", "kartvizit")),
)

ENGLISH_MEDIA_PLACEHOLDER_TERMS = tuple(
    term for _, english, _ in MEDIA_PLACEHOLDER_KINDS for term in english
) + ("media",)
TURKISH_MEDIA_PLACEHOLDER_TERMS = tuple(
    term for _, _, turkish in MEDIA_PLACEHOLDER_KINDS for term in turkish
) + ("medya",)


def _alternation(terms):
    """Escape terms longest-first so multi-word labels win over their prefix."""
    return "|".join(re.escape(term) for term in sorted(terms, key=len, reverse=True))


_ENGLISH_MEDIA_TERMS_RE = _alternation(ENGLISH_MEDIA_PLACEHOLDER_TERMS)
_TURKISH_MEDIA_TERMS_RE = _alternation(TURKISH_MEDIA_PLACEHOLDER_TERMS)

# Export placeholders count as messages but must not affect keyword totals.
MEDIA_RE = re.compile(
    rf"^(?:.*\s)?(?:(?:{_ENGLISH_MEDIA_TERMS_RE}) omitted"
    rf"|(?:{_TURKISH_MEDIA_TERMS_RE}) dahil edilmedi)\W*$"
    r"|^\W*(?:"
    r"this message was deleted|you deleted this message"
    r"|bu mesaj silindi|bu mesajı sildiniz"
    r")\W*$",
    re.IGNORECASE,
)
URL_RE = re.compile(r"(?:https?://|www\.)\S+", re.I)
MEDIA_KINDS = (
    ("Deleted", ("deleted", "silindi", "sildiniz")),
    *((label, english + turkish)
      for label, english, turkish in MEDIA_PLACEHOLDER_KINDS),
)

# Match complete emoji sequences, not individual Unicode code points.
_EMOJI_BASE = (
    "["
    "↔-↪"                # arrows with emoji presentation
    "⌚⌛⌨⏏"     # watch, hourglass, keyboard, eject
    "⏩-⏳⏸-⏺"   # media controls, clocks
    "Ⓜ▪▫▶◀◻-◾"
    # Avoid non-emoji glyphs in broad symbol blocks.
    "☀-☄☎☑☔☕☘☝☠☢☣☦☪☮☯☭☸-☺♀♂♈-♓♟♠♣♥♦♨♻♾♿"
    "⚒-⚗⚙⚛⚜⚠⚡⚧⚪⚫⚰⚱⚽⚾⛄⛅⛈⛎⛏⛑⛓⛔⛩⛪⛰-⛵⛷-⛺⛽"
    "✂✅✈-✍✏✒✔✖✝✡✨✯✳✴❄❇❌❎❓-❕❗❣❤➕-➗➡➰➿"
    "⤴⤵⬅-⬇⬛⬜⭐⭕"
    "‼⁉ℹ〰〽㊗㊙"
    "\U0001F000-\U0001F0FF"        # mahjong, dominoes, cards
    "\U0001F170-\U0001F19A"        # enclosed letters (🅰 🆗 …)
    "\U0001F200-\U0001F2FF"
    "\U0001F300-\U0001F3FA"        # stops before the skin tones on purpose
    "\U0001F400-\U0001FAFF"
    "]"
)
# Skin-tone modifiers are valid only as emoji suffixes.
_EMOJI_ATOM = (
    "(?:"
    "[0-9#*]️?⃣"                                # keycap: 1️⃣ #️⃣
    "|[\U0001F1E6-\U0001F1FF]{2}"                         # flag: 🇹🇷
    "|\U0001F3F4[\U000E0060-\U000E007F]+"                 # subdivision flag: 🏴󠁧󠁢󠁳󠁣󠁴󠁿
    "|" + _EMOJI_BASE + "️?[\U0001F3FB-\U0001F3FF]?"
    ")"
)
EMOJI_RE = re.compile(
    _EMOJI_ATOM + "(?:‍" + _EMOJI_ATOM + ")*",
    flags=re.UNICODE,
)
SKIN_TONE_RE = re.compile("[\U0001F3FB-\U0001F3FF]")

WORD_RE = re.compile(r"[a-zA-ZçğıöşüÇĞİÖŞÜ']{2,}")
# Collapse stretched typing without changing valid medial double letters.
STRETCH_RE = re.compile(r"(.)\1{2,}")
TAIL_DOUBLE_RE = re.compile(r"(.)\1$")
# Repeated short units are keyboard mash, not keywords.
MASH_RE = re.compile(r"^(.{1,3}?)\1{2,}$")

ENGLISH_STOPWORDS = frozenset("""
a an and the is are was were be been being to of in on at for with without from by
this that these those it its it's i you he she we they them him her his hers our your
my me mine yours their theirs as if then than so but or nor not no yes do does did done
have has had having will would can could should shall may might must am pm
what when where who why how which while about into out up down over under
again more most some any all each every here there also very too much many one two
let lets going want need know think say said see come go back still even because before
after now well really sure thing things something anything nothing someone everyone
""".split())

TURKISH_STOPWORDS = frozenset("""
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
""".split())

# Common function words from other languages found in multilingual exports.
OTHER_LANGUAGE_STOPWORDS = frozenset("""
na la el en un une le les des du au aux et ou pour dans sur avec sans
""".split())

STOPWORDS = (
    ENGLISH_STOPWORDS
    | TURKISH_STOPWORDS
    | OTHER_LANGUAGE_STOPWORDS
)
