/* Error codes -> what the user reads. The worker sends codes (and, for
   input errors, a message that never quotes file content); wording lives
   here so it can be localised. */
import type { ClientErrorCode } from "@/worker/client";
import type { Locale } from "./i18n/types";

const TEXT: Partial<Record<ClientErrorCode, string>> = {
  empty_file: "The file is empty.",
  unsupported_type: "Choose a WhatsApp export: the .txt file, or the .zip WhatsApp creates.",
  not_text: "This file does not look like a text export. In WhatsApp choose Export Chat → Without Media.",
  zip_invalid: "This ZIP file is damaged or incomplete.",
  zip_without_chat: "This ZIP file has no WhatsApp chat text in it.",
  zip_ambiguous: "This ZIP file holds more than one chat text file. Unzip it and choose the chat's .txt file.",
  no_messages: "No WhatsApp messages were found in this file. Make sure it is a chat export; the details below say what was read.",
  worker_lost: "The analysis stopped unexpectedly, and the chat had to be cleared from memory. Please load it again.",
  no_chat_loaded: "The chat is no longer in memory. Please load it again.",
  invalid_filter: "These filter settings are not valid for this chat.",
  internal: "Something went wrong while reading the chat.",
};
const TR: Partial<Record<ClientErrorCode, string>> = {
  empty_file: "Dosya boş.", unsupported_type: "Bir WhatsApp dışa aktarımı seçin: .txt dosyası veya WhatsApp’ın oluşturduğu .zip dosyası.",
  not_text: "Bu dosya metin dışa aktarımına benzemiyor. WhatsApp’ta Sohbeti Dışa Aktar → Medyasız seçeneğini kullanın.",
  zip_invalid: "ZIP dosyası bozuk veya eksik.", zip_without_chat: "Bu ZIP dosyasında WhatsApp sohbet metni yok.",
  zip_ambiguous: "Bu ZIP dosyasında birden fazla sohbet metni var. Dosyayı açıp sohbetin .txt dosyasını seçin.",
  no_messages: "Bu dosyada WhatsApp mesajı bulunamadı. Bir sohbet dışa aktarımı olduğundan emin olun; aşağıdaki ayrıntılar ne okunduğunu gösterir.",
  worker_lost: "Analiz beklenmedik biçimde durdu ve sohbet bellekten temizlendi. Lütfen yeniden yükleyin.",
  no_chat_loaded: "Sohbet artık bellekte değil. Lütfen yeniden yükleyin.", invalid_filter: "Bu filtre ayarları sohbet için geçerli değil.",
  internal: "Sohbet okunurken bir sorun oluştu.",
};

/** too_large and zip_unsupported carry specifics (the limit, the ZIP feature), so their worker message is used. */
export function errorMessage(code: ClientErrorCode, fallback: string, locale: Locale = "en"): string {
  return (locale === "tr" ? TR : TEXT)[code] ?? fallback;
}
