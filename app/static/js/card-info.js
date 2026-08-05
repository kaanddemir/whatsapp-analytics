/* Shared, short metric guides for every dashboard card. */
import { bindPopover, closeAllPops, onEscape } from "./popover.js";
import { escapeHtml } from "./util.js";

// Card key -> popover heading. Every body is a concise definition plus one
// detail that is not already printed on the dashboard card itself.
const CARD_TITLES = {
  "total-messages": "Total Messages",
  "active-days": "Active Days",
  "messages-per-day": "Messages per Day",
  "peak-hour": "Peak Hour",
  "messages-over-time": "Messages Over Time",
  heatmap: "Message Heatmap",
  media: "Media Breakdown",
  emojis: "Top Emojis",
  keywords: "Top Keywords",
  "message-balance": "Message Balance",
  "conversation-starter": "Conversation Starter",
  "longest-streak": "Longest Streak",
  "night-owl": "Night Owl",
};

const infoButtons = [];

function infoMarkup(key, title) {
  return `
    <button class="grain-btn card-info-btn" type="button" aria-haspopup="dialog"
            aria-expanded="false" aria-label="About ${title}">
      <span class="ic" data-icon="info"></span>
    </button>
    <div class="grain-pop info-pop card-info-pop" role="dialog" aria-label="${title}" hidden>
      <div class="grain-pop-head">${title}</div>
      <div class="card-info-live" id="cardInfo-${key}"></div>
    </div>`;
}

const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const number = (value) => Number(value || 0).toLocaleString();
const percent = (value) => `${Number(value || 0).toFixed(1).replace(/\.0$/, "")}%`;
const info = (meaning, label, value) => `
  <p class="info-copy">${meaning}</p>
  <div class="info-detail"><span>${label}</span><b>${value}</b></div>`;

// A daily series runs to one point per day, so a multi-year chat would spread
// thousands of arguments into Math.max. Fold instead.
const maxIndex = (values) =>
  values.reduce((best, value, i) => (value > values[best] ? i : best), 0);

function selectedDays(range) {
  const start = new Date(`${range.start}T00:00:00`);
  const end = new Date(`${range.end}T00:00:00`);
  return Math.round((end - start) / 86400000) + 1;
}

function liveInfoMarkup(key, stats) {
  const { kpis: k, meta, insights, messages_over_time: overTime, content_summary: content } = stats;
  const rangeDays = selectedDays(meta.range_iso);
  const daily = overTime.daily;
  const busiestDayIndex = maxIndex(daily.values);
  const busiestDayCount = daily.values[busiestDayIndex] || 0;
  const nightTotal = stats.hours.slice(0, 5).reduce((sum, count) => sum + count, 0);

  switch (key) {
    case "total-messages":
      return info("This total includes messages, media placeholders, and deleted-message notices.",
        "Conversation volume", `${number(k.total_words)} words across non-media messages, averaging ${number(k.words_per_message)} words each.`);
    case "active-days":
      return info("A day counts as active when it contains at least one message.",
        "Activity coverage", `Messages appeared on ${percent(k.active_days / rangeDays * 100)} of the selected days.`);
    case "messages-per-day":
      return info("This average uses only days that had activity.", "Busiest calendar day",
        `${escapeHtml(daily.labels[busiestDayIndex])} had ${number(busiestDayCount)} messages, ${(busiestDayCount / k.msgs_per_day).toFixed(1)} times the average.`);
    case "peak-hour":
      return info("Times come from the local timestamps in the WhatsApp export.", "Busiest four-hour period",
        `${insights.most_active_time} accounted for ${percent(insights.most_active_share)} of messages.`);
    case "messages-over-time": {
      const series = overTime[overTime.grain];
      const peak = maxIndex(series.values);
      return info("Messages are grouped by the time scale selected for the chart.", "Busiest period",
        `${escapeHtml(series.labels[peak])} had ${number(series.values[peak])} messages, or ${percent(series.values[peak] / k.total_messages * 100)} of the selection.`);
    }
    case "heatmap": {
      const weekdayTotals = stats.heatmap.map((hours) => hours.reduce((sum, count) => sum + count, 0));
      const bestDay = maxIndex(weekdayTotals);
      return info("Darker cells represent more messages at a given weekday and hour.", "Busiest weekday",
        `${dayNames[bestDay]} accounted for ${percent(weekdayTotals[bestDay] / k.total_messages * 100)} of messages.`);
    }
    case "media":
      return info("Media is counted from WhatsApp media placeholders; deleted messages are excluded.", "Message mix",
        `${percent(stats.media.share)} of messages were media, while ${number(k.total_messages - stats.media.total)} were not.`);
    case "emojis":
      return content.emojis.uses
        ? info("Skin-tone variants are grouped with their base emoji.", "Emoji use",
          `There were ${number(content.emojis.uses)} emoji uses across ${number(content.emojis.message_count)} messages.`)
        : info("Skin-tone variants are grouped with their base emoji.", "Emoji density", "No emoji in this selection");
    case "keywords":
      return content.keywords.uses
        ? info("Common stopwords, links, and keyboard mash are excluded.", "Keyword vocabulary",
          `${number(content.keywords.unique)} distinct keywords appeared ${number(content.keywords.uses)} times.`)
        : info("Common stopwords, links, and keyboard mash are excluded.", "Keyword vocabulary", "No keywords in this selection");
    case "message-balance": {
      // A selection can hold no human participants at all — a range containing
      // only Meta AI messages, which volume metrics keep but this card does not.
      const [leader, runnerUp] = insights.participants;
      const detail = !leader ? "There are no participants to compare in this selection."
        : !runnerUp ? "There is only one participant in this selection."
        : `The gap is ${leader.pct - runnerUp.pct} percentage points.`;
      return info("Shares are calculated across human participants in the selected range.",
        "Lead over next participant", detail);
    }
    case "conversation-starter":
      return info("A conversation starts with the first message after a gap of six hours or more.", "Conversations started",
        insights.conversation_starter_count ? `They started ${number(insights.conversation_starter_count)} of ${number(insights.conversation_count)} conversations.` : "There are no participant messages to compare.");
    case "longest-streak":
      return info("Only consecutive calendar days count; extra messages on one day do not extend a streak.", "Coverage of selection",
        insights.longest_streak_days ? `The streak covers ${percent(insights.longest_streak_days / rangeDays * 100)} of the selected period.` : "There are no consecutive active days in this selection.");
    case "night-owl":
      return info("Night activity covers 00:00–04:59 and prioritizes people with at least 20 messages.", "Night activity in selection",
        nightTotal ? `${number(nightTotal)} messages were sent overnight, or ${percent(nightTotal / k.total_messages * 100)} of the selection.` : "There is no night activity in this selection.");
    default:
      return "";
  }
}

function infoHost(card) {
  return card.querySelector(".card-head, .kpi-head, .insight-top");
}

function mountInfo(card, key, title) {
  const host = infoHost(card);
  if (!host) return;

  const menu = document.createElement("div");
  menu.className = "grain-menu card-info-menu";
  menu.innerHTML = infoMarkup(key, title);

  if (host.classList.contains("card-head")) {
    let actions = host.querySelector(".card-head-actions");
    if (!actions) {
      actions = document.createElement("div");
      actions.className = "card-head-actions";
      const existingMenu = host.querySelector(".grain-menu");
      if (existingMenu) actions.append(existingMenu);
      host.append(actions);
    }
    actions.append(menu);
  } else {
    host.classList.add("has-card-info");
    host.append(menu);
  }

  const trigger = menu.querySelector("button");
  const pop = menu.querySelector(".card-info-pop");
  bindPopover(trigger, pop);
  infoButtons.push({ trigger, pop });
}

export function initCardInfo() {
  document.querySelectorAll("[data-info-card]").forEach((card) => {
    const key = card.dataset.infoCard;
    const title = CARD_TITLES[key];
    if (title) mountInfo(card, key, title);
  });
  if (window.hydrateIcons) window.hydrateIcons(document);

  onEscape(() => {
    const active = infoButtons.find(({ pop }) => !pop.hidden);
    if (!active) return false;
    closeAllPops();
    active.trigger.focus();
    return true;
  });
}

export function renderCardInfo(stats) {
  document.querySelectorAll("[data-info-card]").forEach((card) => {
    const key = card.dataset.infoCard;
    const target = document.getElementById(`cardInfo-${key}`);
    if (!target) return;
    // These read deep into the stats payload for a secondary detail. One card
    // tripping over an unusual selection must not take the whole render — and
    // with it the numbers the page is actually for — down with it.
    try {
      target.innerHTML = liveInfoMarkup(key, stats);
    } catch (error) {
      console.error(`Card info failed for ${key}`, error);
      target.innerHTML = '<p class="info-copy">This detail is unavailable for the current selection.</p>';
    }
  });
}
