/* What the Chat info dialog says about an import, derived from the parse
   report and nothing else. Pure, so the wording rules can be unit-tested.

   Three levels, by evidence:
   - "partial": the parser left something unread (it marks the report
     partial). Only skipped *records* are counted as messages: they were
     message-shaped entries the parser dropped (skippedRecords). Uncounted
     lines are described as lines, never as lost messages.
   - "notes": nothing was lost, but something the user may want to know
     (assumed date order, sorting, undecodable bytes...).
   - "ok": no warning at all. */
import type { DateOrder, ParseWarningCode } from "@/model";
import type { LoadSummary } from "@/worker/protocol";
import { plural } from "@/i18n/format";
import type { Locale } from "@/i18n/types";

export type ImportLevel = "ok" | "notes" | "partial";

export interface ImportStatus {
  readonly level: ImportLevel;
  readonly title: string;
  /** One sentence under the title, or null. */
  readonly detail: string | null;
  /** Plain-language points, one per issue; empty for "ok". */
  readonly points: readonly string[];
  /** What the user can do about it, when there is something to do. */
  readonly advice: string | null;
}

const lines = (sample: readonly number[], locale: Locale) =>
  sample.length ? ` (${locale === "tr" ? "satır" : "line"} ${sample.slice(0, 3).join(", ")}${sample.length > 3 ? ", …" : ""})` : "";

/** Plain wording per warning. Line numbers only where they help find the spot. */
function point(code: ParseWarningCode, count: number, sample: readonly number[], locale: Locale, order: DateOrder): string {
  if (locale === "tr") {
    const line = lines(sample, locale);
    switch (code) {
      case "invalid_timestamp": return `${plural(count, "mesaj", "mesaj", locale)} geçersiz tarih içerdiği için dışarıda bırakıldı${line}.`;
      case "empty_sender": return `${plural(count, "mesaj", "mesaj", locale)} gönderen adı olmadığı için dışarıda bırakıldı${line}.`;
      case "orphan_lines": return `Dosyanın başındaki ${plural(count, "satır", "satır", locale)} herhangi bir mesaja ait değildi.`;
      case "unrecognized_system_lines": return `Göndereni olmayan ${plural(count, "satır", "satır", locale)} tanınamadı${line}.`;
      case "ambiguous_date_order": return `Tarihler gün veya ay önce okunabiliyor; ${order === "mdy" ? "ay" : "gün"} önce okundu. Yanlışsa aşağıdan değiştirin.`;
      case "conflicting_date_order": return "Bazı tarihler yalnızca gün önce, bazıları ay önce anlamlı; birkaç tarih hatalı olabilir.";
      case "out_of_order": return `${plural(count, "mesaj", "mesaj", locale)} sıralı değildi ve zamana göre sıralandı.`;
      case "mixed_platforms": return "Dosyada Android ve iPhone biçimleri karışık; dosya düzenlenmiş veya birleştirilmiş olabilir.";
      case "possible_system_event": return `${plural(count, "mesaj", "mesaj", locale)} grup bildirimi gibi görünüyor ve mesaj olarak sayıldı.`;
      case "unknown_placeholder": return `${plural(count, "mesaj", "mesaj", locale)} tanınmayan bir WhatsApp yer tutucusuna benziyor ve metin olarak sayıldı${line}.`;
    }
  }
  switch (code) {
    case "invalid_timestamp":
      return `${plural(count, "message had", "messages had")} an impossible date and ${count === 1 ? "was" : "were"} left out${lines(sample, locale)}.`;
    case "empty_sender":
      return `${plural(count, "message had", "messages had")} no sender name and ${count === 1 ? "was" : "were"} left out${lines(sample, locale)}.`;
    case "orphan_lines":
      return `${plural(count, "line", "lines")} at the start of the file ${count === 1 ? "was" : "were"} not part of any message.`;
    case "unrecognized_system_lines":
      return `${plural(count, "line", "lines")} without a sender could not be recognised${lines(sample, locale)}.`;
    case "ambiguous_date_order":
      return `Dates could be read day-first or month-first; ${order === "mdy" ? "month" : "day"}-first was used. Change it below if that's wrong.`;
    case "conflicting_date_order":
      return "Some dates only make sense day-first and others month-first, so a few dates may be wrong.";
    case "out_of_order":
      return `${plural(count, "message was", "messages were")} out of order and ${count === 1 ? "has" : "have"} been sorted by time.`;
    case "mixed_platforms":
      return "The file mixes Android and iPhone formats; it may have been edited or combined.";
    case "possible_system_event":
      return `${plural(count, "message looks", "messages look")} like a group notice and ${count === 1 ? "was" : "were"} counted as ${count === 1 ? "a message" : "messages"}.`;
    case "unknown_placeholder":
      return `${plural(count, "message looks", "messages look")} like an unrecognised WhatsApp placeholder and ${count === 1 ? "was" : "were"} counted as text${lines(sample, locale)}.`;
  }
}

/** Data the parser could not use: shown first, before the notes. */
const LOSS: ReadonlySet<ParseWarningCode> = new Set(["invalid_timestamp", "empty_sender", "orphan_lines", "unrecognized_system_lines"]);

export function importStatus(summary: LoadSummary, locale: Locale = "en"): ImportStatus {
  const { report, file } = summary;
  const ordered = [...report.warnings].sort((a, b) => Number(LOSS.has(b.code)) - Number(LOSS.has(a.code)));
  const points = ordered.map((w) => point(w.code, w.count, w.sampleLines, locale, report.format.dateOrder));
  if (file.hadReplacementChars) points.push(locale === "tr" ? "Bazı karakterler çözümlenemedi ve hatalı görünebilir." : "Some characters could not be decoded and may look wrong.");

  if (report.completeness === "partial") {
    const skipped = report.skippedRecords;
    return {
      level: "partial",
      title: skipped > 0 ? (locale === "tr" ? `${plural(skipped, "mesaj", "mesaj", locale)} okunamadı.` : `${plural(skipped, "message", "messages")} couldn't be read.`) : (locale === "tr" ? "Dosyanın bir bölümü okunamadı." : "Some of the file couldn't be read."),
      detail: locale === "tr" ? "Sonuçlarınız eksik olabilir." : "Your results may be incomplete.",
      points,
      advice: locale === "tr" ? "Sohbeti WhatsApp’tan yeniden dışa aktarmak sorunu çözebilir." : "Exporting the chat again from WhatsApp may help.",
    };
  }
  if (points.length > 0) {
    return { level: "notes", title: locale === "tr" ? "Bazı notlarla içe aktarıldı." : "Imported with some notes.", detail: null, points, advice: null };
  }
  return { level: "ok", title: locale === "tr" ? "Sohbet başarıyla içe aktarıldı." : "Chat imported successfully.", detail: null, points: [], advice: null };
}

/** For the context bar link: how many points the dialog will list. */
export function importNoteCount(summary: LoadSummary): number {
  return summary.report.warnings.length + (summary.file.hadReplacementChars ? 1 : 0);
}

