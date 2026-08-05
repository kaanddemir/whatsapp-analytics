/* Card renderers: the three ranked lists, the balance bar, the insight tiles. */
import { state } from "./state.js";
import { BAL_COLORS, escapeHtml } from "./util.js";

/**
 * Renders one page of a ranked list and returns the page actually drawn, which
 * the caller stores back: a shorter list must not leave the state pointing
 * past the end.
 * `label` turns one item into the left-hand cell (an emoji or a word).
 */
function renderRanked(ids, items, page, label, empty) {
  const PAGE_SIZE = ids.size;
  const wrap = document.getElementById(ids.list);
  const pager = document.getElementById(ids.pager);
  const total = document.getElementById(ids.total);
  if (!items.length) {
    wrap.innerHTML = `<p class="rank-empty">${empty}</p>`;
    pager.hidden = true;
    total.hidden = true;
    return 0;
  }
  const pages = Math.ceil(items.length / PAGE_SIZE);
  page = Math.min(page, pages - 1);
  // Bars are scaled to the overall leader, not the page leader, so a bar
  // means the same thing on page 3 as it does on page 1.
  const max = Math.max(1, ...items.map((i) => i.count));
  const shown = items.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  wrap.innerHTML = shown.map((i) => `
      <div class="rank-item">
        ${label(i)}
        <div class="rank-bar-wrap"><div class="rank-bar" style="width:${(i.count / max) * 100}%"></div></div>
        <span class="rank-count">${i.count.toLocaleString()}</span>
      </div>`).join("")
    + '<div class="rank-item ghost"><span class="em">·</span></div>'.repeat(PAGE_SIZE - shown.length);
  pager.hidden = pages < 2;
  total.hidden = false;
  total.textContent = `Total: ${items.reduce((sum, item) => sum + item.count, 0).toLocaleString()}`;
  document.getElementById(ids.info).textContent = `${page + 1} / ${pages}`;
  document.getElementById(ids.prev).disabled = page === 0;
  document.getElementById(ids.next).disabled = page === pages - 1;
  return page;
}

// All ranked lists page five rows at a time. The server caps emoji and keyword
// data at the top 10, so those lists have at most two pages.
const EMOJI_IDS = { list: "emojiList", pager: "emojiPager", total: "emojiTotal", info: "emojiPageInfo",
                    prev: "emojiPrev", next: "emojiNext", size: 5 };
const KW_IDS = { list: "keywordList", pager: "kwPager", total: "kwTotal", info: "kwPageInfo",
                 prev: "kwPrev", next: "kwNext", size: 5 };
const MEDIA_IDS = { list: "mediaList", pager: "mediaPager", total: "mediaTotal", info: "mediaPageInfo",
                    prev: "mediaPrev", next: "mediaNext", size: 5 };

export function renderEmojis(emojis) {
  state.emojiPage = renderRanked(EMOJI_IDS, emojis, state.emojiPage,
    (e) => `<span class="em">${e.emoji}</span>`,
    "Nothing to show yet.");
}

export function renderKeywords(keywords) {
  state.kwPage = renderRanked(KW_IDS, keywords, state.kwPage,
    (k) => `<span class="word" title="${escapeHtml(k.word)}">${escapeHtml(k.word)}</span>`,
    "Nothing to show yet.");
}

export function renderMedia(media) {
  state.mediaPage = renderRanked(MEDIA_IDS, media.items, state.mediaPage,
    (i) => `<span class="word">${escapeHtml(i.label)}</span>`,
    "Nothing to show yet.");
}

// ---- Message balance bar ----
function renderBalance(participants) {
  const bar = document.getElementById("balanceBar");
  const legend = document.getElementById("balanceLegend");
  if (!participants.length) {
    bar.hidden = true;
    bar.replaceChildren();
    legend.classList.add("balance-empty");
    legend.innerHTML = '<p class="rank-empty">Nothing to show yet.</p>';
    return;
  }
  bar.hidden = false;
  legend.classList.remove("balance-empty");
  bar.innerHTML = participants.map((p, i) => {
    const c = BAL_COLORS[i % BAL_COLORS.length];
    const title = `${escapeHtml(p.name)}: ${p.count.toLocaleString()} (${p.pct_label})`;
    return `<div class="balance-seg" style="width:${p.pct}%;background:${c}" title="${title}">${p.pct >= 8 ? p.pct_label : ""}</div>`;
  }).join("");
  legend.innerHTML = participants.map((p, i) => {
    const c = BAL_COLORS[i % BAL_COLORS.length];
    return `<div class="balance-item"><span class="balance-dot" style="background:${c}"></span>
      <span class="bn">${escapeHtml(p.name)}</span>
      <span class="bc">${p.count.toLocaleString()} · ${p.pct_label}</span></div>`;
  }).join("");
}

// ---- Insights bar ----
export function renderInsights(ins) {
  renderBalance(ins.participants);
  const hasStarter = Boolean(ins.conversation_starter);
  document.getElementById("insStarter").textContent =
    hasStarter ? ins.conversation_starter : "—";
  document.getElementById("insStarterSub").textContent = hasStarter
    ? "starts " + ins.conversation_starter_pct + "% of chats"
    : "no participant messages to compare";

  const hasStreak = Boolean(ins.longest_streak_days);
  document.getElementById("insStreak").textContent = hasStreak
    ? ins.longest_streak_days + (ins.longest_streak_days === 1 ? " Day" : " Days")
    : "—";
  document.getElementById("insStreakSub").textContent = hasStreak
    ? ins.longest_streak_range
    : "no activity in selected range";

  // Night owl: share is of that person's own messages, so the sub line says
  // "of their messages" rather than implying a share of the whole chat.
  document.getElementById("insNightOwl").textContent =
    ins.night_owl_count ? ins.night_owl : "—";
  document.getElementById("insNightOwlSub").textContent = ins.night_owl_count
    ? `${ins.night_owl_share}% of their messages, 00:00 – 05:00`
    : "nobody writes after midnight";
}

// A new chat (or a participant filter) starts every list at its top.
export function resetListPages() {
  state.emojiPage = state.kwPage = state.mediaPage = 0;
}

export function initLists() {
  document.getElementById("mediaPrev").addEventListener("click", () => {
    state.mediaPage = Math.max(0, state.mediaPage - 1);
    renderMedia(state.stats.media);
  });
  document.getElementById("mediaNext").addEventListener("click", () => {
    state.mediaPage += 1;
    renderMedia(state.stats.media);
  });
  document.getElementById("emojiPrev").addEventListener("click", () => {
    state.emojiPage = Math.max(0, state.emojiPage - 1);
    renderEmojis(state.stats.top_emojis);
  });
  document.getElementById("emojiNext").addEventListener("click", () => {
    state.emojiPage += 1;
    renderEmojis(state.stats.top_emojis);
  });
  document.getElementById("kwPrev").addEventListener("click", () => {
    state.kwPage = Math.max(0, state.kwPage - 1);
    renderKeywords(state.stats.top_keywords);
  });
  document.getElementById("kwNext").addEventListener("click", () => {
    state.kwPage += 1;
    renderKeywords(state.stats.top_keywords);
  });

}
