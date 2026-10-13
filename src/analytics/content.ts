/* Emojis, keywords and the media breakdown.

   - Emojis are counted in every message's text, which includes media
     captions; placeholders themselves contain none.
   - Keywords come from text messages only. Legacy tokenised anything that
     was not a media/deleted placeholder, so Android "<Media omitted>" (C1)
     and "Waiting for this message" fed the word list.
   - The media breakdown counts media messages by kind; deleted messages are
     not media (as in legacy). */
import type { Content, MediaKind, Message } from "@/model";
import { percent, rank } from "./numbers";
import { emojisIn, type KeywordExtractor } from "./text";

export function content(messages: readonly Message[], keywordsIn: KeywordExtractor, limit: number): Content {
  const emojis = new Map<string, number>();
  const words = new Map<string, number>();
  const media = new Map<MediaKind, number>();
  let emojiUses = 0;
  let emojiMessages = 0;
  let mediaTotal = 0;
  let keywordUses = 0;
  for (const m of messages) {
    const found = emojisIn(m.text);
    if (found.length > 0) {
      emojiMessages++;
      emojiUses += found.length;
      for (const e of found) emojis.set(e, (emojis.get(e) ?? 0) + 1);
    }
    if (m.kind === "media") {
      const kind = m.mediaKind ?? "Other";
      media.set(kind, (media.get(kind) ?? 0) + 1);
      mediaTotal++;
    } else if (m.kind === "text") {
      for (const w of keywordsIn(m.text)) {
        words.set(w, (words.get(w) ?? 0) + 1);
        keywordUses++;
      }
    }
  }
  return {
    topEmojis: rank(emojis, limit),
    topKeywords: rank(words, limit),
    emojiSummary: { uses: emojiUses, messageCount: emojiMessages },
    keywordSummary: { uses: keywordUses, unique: words.size },
    media: { total: mediaTotal, share: percent(mediaTotal, messages.length, 1), items: rank(media) },
  };
}
