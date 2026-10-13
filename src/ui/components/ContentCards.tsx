/* What was sent: message types, media, emojis and keywords. */
import type { MessageKind, Stats } from "@/model";
import { Card } from "./Card";
import { RankedList } from "./RankedList";
import { useI18n } from "../i18n/context";

export function MessageKindsCard({ stats }: { stats: Stats }) {
  const { locale, t } = useI18n();
  const labels: Record<MessageKind, string> = { text: t("text"), media: t("media"), deleted: t("deleted"), unavailable: t("unavailable") };
  const { messagesByKind } = stats.kpis;
  const { media } = stats.content;
  const items = (Object.keys(labels) as MessageKind[])
    .map((kind) => ({ key: labels[kind], count: messagesByKind[kind] }))
    .filter((i) => i.count > 0);
  // A lone "Other" merely repeats the Media total. Show this secondary
  // distribution only when the export identified at least one real type.
  const hasUsefulMediaBreakdown = media.items.some((item) => item.key !== "Other");
  const mediaItems = media.items.map((item) => ({ ...item, key: locale === "tr" ? ({ Stickers: "Çıkartmalar", GIFs: "GIF’ler", "Video notes": "Video mesajları", Videos: "Videolar", Photos: "Fotoğraflar", "Voice notes": "Sesli mesajlar", Documents: "Belgeler", Contacts: "Kişiler", Other: "Diğer" } as Record<string, string>)[item.key] ?? item.key : item.key }));
  return (
    <Card cardKey="message-kinds" className="message-types-card">
      {/* The total is Total Messages, already in the KPI row. */}
      <RankedList items={items} label={t("messageTypes")} />
      {hasUsefulMediaBreakdown && (
        <div className="media-subsection">
          <h4>{t("mediaTypes")}</h4>
          <RankedList items={mediaItems} label={t("mediaTypes")} />
        </div>
      )}
    </Card>
  );
}

export function EmojiCard({ stats }: { stats: Stats }) {
  const { t } = useI18n();
  const { topEmojis } = stats.content;
  return (
    <Card cardKey="emojis" className="ranked-card">
      <RankedList
        items={topEmojis}
        label={t("topEmojis")}
        renderKey={(k) => <span className="emoji">{k}</span>}
        emptyText={t("noEmoji")}
      />
    </Card>
  );
}

export function KeywordCard({ stats }: { stats: Stats }) {
  const { t } = useI18n();
  const { topKeywords } = stats.content;
  return (
    <Card cardKey="keywords" className="ranked-card">
      <RankedList
        items={topKeywords}
        label={t("topKeywords")}
        emptyText={t("noKeywords")}
      />
    </Card>
  );
}
