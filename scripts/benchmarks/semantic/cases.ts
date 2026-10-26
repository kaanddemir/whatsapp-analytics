/* hand-written Turkish/English retrieval cases for the semantic
   tier, written before any ranking was tuned and not changed after seeing
   results (a held-out check next to the synthetic set's held-out seed).

   Each case: a question, the gold messages that answer it, and traps:
   messages a naive matcher would confuse with the gold (negation, a
   conditional instead of a suggestion, a completed action instead of an
   intention, a namesake, the same words with another meaning). The
   conversation is padded with ordinary chatter so ranking is not trivial. */

export interface HardCase {
  readonly id: string;
  readonly phenomenon: string;
  readonly query: string;
  readonly gold: readonly string[];
  readonly traps: readonly string[];
  /** Restrict to one year; a copy of the gold placed in another year must not be returned. */
  readonly year?: number;
}

export const HARD_CASES: readonly HardCase[] = [
  { id: "miss", phenomenon: "paraphrase", query: "Onu özlediğimi söylediğim konuşma", gold: ["seni çok özledim ya", "keşke şu an yanımda olsaydın"], traps: ["Özlem ablayla kahve içtim bugün"] },
  { id: "outing", phenomenon: "suggestion vs conditional/completed", query: "Beraber bir yerlere gidelim dediğimiz zamanlar", gold: ["hafta sonu dışarı çıksak mı?", "cumartesi bir yerlere gidelim mi seninle"], traps: ["eğer dışarı çıkarsak geç kalırız", "dün dışarı çıktık çok güzeldi"] },
  { id: "move", phenomenon: "paraphrase", query: "Taşınma fikrini konuştuğumuz mesajlar", gold: ["yeni bir eve geçsek nasıl olur?", "bu evden taşınmayı düşünüyorum artık"], traps: ["masayı taşımama yardım eder misin çok ağır", "ekmek taş gibi olmuş"] },
  { id: "move-ascii", phenomenon: "missing diacritics", query: "tasinma konusu", gold: ["bu evden taşınmayı düşünüyorum artık"], traps: ["ekmek taş gibi olmuş"] },
  { id: "gift", phenomenon: "spelling mistake", query: "doğum günü hedyesi", gold: ["doğum günün için sana hediye aldım"], traps: ["doğum günü partisi iptal oldu"] },
  { id: "thanks", phenomenon: "abbreviation", query: "teşekkür ettiğim mesaj", gold: ["tşk ederim her şey için çok sağol"], traps: [] },
  { id: "notgo", phenomenon: "negation", query: "partiye gitmek istemediğimi söylediğim zaman", gold: ["ben o partiye gitmek istemiyorum açıkçası"], traps: ["partiye gitmek istiyorum çok heyecanlıyım"] },
  { id: "interview", phenomenon: "Turkish-English mixed", query: "iş görüşmesinden bahsettiğimiz zaman", gold: ["yarın job interview var çok stresliyim"], traps: ["youtube'da bir interview izledim"] },
  { id: "doctor", phenomenon: "cross-language", query: "messages about the doctor's appointment", gold: ["doktor randevum perşembe saat 3'te"], traps: ["doktor dizisinin yeni bölümü çıkmış"] },
  { id: "marry", phenomenon: "question vs declaration", query: "ne zaman evlenmemiz gerektiğini sorduğum mesaj", gold: ["sence ne zaman evlenmeliyiz?"], traps: ["kuzenim geçen hafta evlendi"] },
  { id: "gym", phenomenon: "intention vs completed action", query: "spor salonuna yazılmayı düşündüğüm zaman", gold: ["spor salonuna yazılmayı düşünüyorum"], traps: ["bugün spor salonuna gittim çok yoruldum"] },
  { id: "sorry", phenomenon: "paraphrase", query: "özür dilediğim konuşma", gold: ["kusura bakma dün çok kaba davrandım sana"], traps: [] },
  { id: "car", phenomenon: "long descriptive question", query: "hani bir keresinde arabanın yolda bozulduğunu ve çekici çağırmak zorunda kaldığımızı konuşmuştuk ya o konuşmayı bul", gold: ["araba yolda kaldı çekici bekliyoruz"], traps: ["yeni araba almayı düşünüyor musun"] },
  { id: "cat", phenomenon: "short question", query: "kedi hastalığı", gold: ["kedimiz hastalandı veterinere götürdüm"], traps: ["kedi maması bitmiş alır mısın"] },
  { id: "wedding", phenomenon: "exact name", query: "Zeynep'in düğünü", gold: ["Zeynep'in düğünü 14 Haziran'da"], traps: ["Zeynep aradı seni sordu"] },
  { id: "exam", phenomenon: "affirmation vs negation", query: "sınavı geçtiğimi söylediğim mesaj", gold: ["sınavı geçtim!!! çok mutluyum"], traps: ["sınavdan kaldım galiba", "sınav haftası başlıyor"] },
  { id: "sick", phenomenon: "paraphrase", query: "hasta olduğum zaman", gold: ["ateşim var çok halsizim bugün"], traps: [] },
  { id: "tickets", phenomenon: "English", query: "when I bought the concert tickets", gold: ["I got us two tickets for the concert"], traps: ["the concert was cancelled"] },
  { id: "love", phenomenon: "paraphrase", query: "sevdiğimi söylediğim mesaj", gold: ["seni çok seviyorum biliyorsun"], traps: [] },
  { id: "recipe", phenomenon: "paraphrase", query: "yemek tarifi gönderdiğim mesaj", gold: ["annemin mercimek çorbası tarifini attım sana"], traps: [] },
  { id: "holiday", phenomenon: "plan vs description", query: "tatile nereye gidelim diye konuştuğumuz", gold: ["bu yaz tatile nereye gidelim? kaş mı bodrum mu"], traps: ["tatilden döndük çok yorgunum"] },
  { id: "rent", phenomenon: "paraphrase", query: "kira artışı", gold: ["ev sahibi kirayı yüzde elli artırmak istiyor"], traps: [] },
  { id: "overslept", phenomenon: "paraphrase", query: "uyuyakaldığım için geç kaldığım zaman", gold: ["pardon uyuyakalmışım alarmı duymamışım"], traps: [] },
  { id: "year", phenomenon: "date filter", query: "yeni bir eve geçmek", gold: ["yeni bir eve geçsek nasıl olur?"], traps: [], year: 2024 },
];

/** Ordinary chatter around the cases. */
export const CHATTER: readonly string[] = [
  "günaydın", "nasılsın", "iyiyim sen", "eve geldim", "yemek yedin mi", "akşam ne yapıyoruz", "film izleyelim mi bu akşam", "bugün çok yoğundu", "toplantı uzadı",
  "trafik çok kötü", "markete uğradım", "süt aldım", "telefonun şarjı bitti", "annem aradı", "yarın erken kalkacağım", "hava çok soğuk", "yağmur yağıyor", "işten çıktım",
  "otobüsteyim", "geliyorum", "biraz gecikeceğim", "maç kaç kaç", "kahve içtim", "çay demledim", "kitap okuyorum", "uyumadın mı hâlâ", "iyi geceler", "görüşürüz",
  "bunu gördün mü", "çok komik", "aynen öyle", "bilmiyorum ki", "sonra konuşalım", "şu an müsait değilim", "toplantıdayım", "ders çalışıyorum", "ödev çok fazla",
  "kardeşim geldi", "bulaşıkları yıkadım", "çamaşır makinesi bozuldu", "fatura geldi", "internet gitti", "dizi bitti", "yeni bölüm çıktı", "kargo geldi mi", "paket geldi",
  "how are you", "on my way", "see you soon", "good night", "I'm at work", "what time", "call me later", "lunch was good", "the meeting is at 5", "running late",
];
