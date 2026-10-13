/* Dashboard card identities and their titles, kept in one place so the
   titles can be localised without touching components. (The old "about this
   card" explanations were removed; a new metric explanation system is
   planned separately.) */

export type CardKey =
  | "total-messages"
  | "active-days"
  | "messages-per-day"
  | "peak-hour"
  | "messages-over-time"
  | "heatmap"
  | "hourly"
  | "weekdays"
  | "message-kinds"
  | "media"
  | "emojis"
  | "keywords"
  | "message-balance"
  | "response-time"
  | "conversation-starter"
  | "longest-streak"
  | "night-owl"
  | "active-window";

export const CARD_TITLES: Record<CardKey, string> = {
  "total-messages": "Total Messages",
  "active-days": "Active Days",
  "messages-per-day": "Messages / Day",
  "peak-hour": "Peak Hour",
  "messages-over-time": "Messages Over Time",
  heatmap: "Message Heatmap",
  hourly: "Messages by Hour",
  weekdays: "Weekday Averages",
  "message-kinds": "Message Types",
  media: "Media Breakdown",
  emojis: "Top Emojis",
  keywords: "Top Keywords",
  "message-balance": "Message Balance",
  "response-time": "Response Time",
  "conversation-starter": "Conversation Starter",
  "longest-streak": "Longest Streak",
  "night-owl": "Night Owl",
  "active-window": "Most Active Time",
};

export const CARD_TITLE_KEYS: Record<CardKey, `card.${CardKey}`> = Object.fromEntries(
  (Object.keys(CARD_TITLES) as CardKey[]).map((key) => [key, `card.${key}`]),
) as Record<CardKey, `card.${CardKey}`>;
