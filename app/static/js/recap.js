/* Chat Recap: a full-screen, auto-advancing recap of the whole chat.

   The markup lives in templates/recap.html — one inert <template> per slide,
   each carrying its own theme colours and hold duration. This module only
   clones a template, writes values into its [data-slot] nodes, and drives the
   deck. Nothing here builds page layout, so a slide can be restyled or
   reordered without touching JavaScript.

   The data is always the WHOLE chat: /api/recap re-analyses the raw export
   without touching the store, so opening the story never disturbs the
   dashboard's own date/participant filter or the assistant's transcript. */
import { onEscape } from "./popover.js";
import { BAL_COLORS, hourRange } from "./util.js";

const overlay = document.getElementById("recapOverlay");
const stage = document.getElementById("recapStage");
const progressEl = document.getElementById("recapProgress");
const statusEl = document.getElementById("recapStatus");
const statusText = document.getElementById("recapStatusText");
const retryBtn = document.getElementById("recapRetry");
const pipEl = document.getElementById("recapPip");
const countEl = document.getElementById("recapCount");
const pauseBtn = document.getElementById("recapPause");
const trigger = document.getElementById("recapBtn");
// Mobile bottom-bar proxy for the same story. Opens through the one open path
// and mirrors the topbar trigger's enabled state.
const railTrigger = document.getElementById("railRecapBtn");

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

// Whole-chat stats, fetched once. Only a new upload or a delete can invalidate
// them — a date or participant filter does not change the whole chat.
let cache = null;
// The slides that survived their `skip` test, in play order.
let deck = [];
let index = 0;
let paused = false;
let open = false;
let loading = false;
// Count-ups and staggered work scheduled for the visible slide, cancelled
// wholesale on every slide change so a fast tap cannot leave one running.
let pending = [];

const num = (v) => Number(v || 0).toLocaleString();
const slot = (root, name) => root.querySelector(`[data-slot="${name}"]`);

function put(root, name, value) {
  const el = slot(root, name);
  // textContent, never innerHTML: participant names and keywords are chat text.
  if (el) el.textContent = value;
}

function later(fn, ms) {
  const id = setTimeout(fn, ms);
  pending.push(() => clearTimeout(id));
}

function clearPending() {
  pending.forEach((cancel) => cancel());
  pending = [];
}

// Below this the card's type is smaller than it is worth reading. A chat with
// enough cells to need it scrolls instead of shrinking further.
const MIN_CARD_SCALE = 0.62;

/** Keep the share card entirely visible even in short recap windows. */
function fitFinalCard() {
  const card = stage.querySelector(".s-final .w-card");
  if (!card) return;
  card.classList.remove("fit-card");
  const height = card.getBoundingClientRect().height;
  // Leave space for the progress/navigation strip and a small lower margin.
  const available = stage.clientHeight - Math.max(112, stage.clientHeight * .12);
  const scale = Math.min(1, available / height);
  const applied = Math.max(MIN_CARD_SCALE, scale);
  card.style.setProperty("--card-scale", applied.toFixed(3));
  card.classList.toggle("fit-card", applied < 1);
  // Shrinking bottomed out before the card fit: give it a scrollable stage
  // rather than type nobody can read.
  stage.classList.toggle("scrolls", scale < MIN_CARD_SCALE);
}

function fitHeroNumber(root, name, value) {
  const hero = slot(root, name)?.closest(".w-hero");
  if (!hero) return;
  const digits = String(Math.trunc(Math.abs(Number(value) || 0))).length;
  const size = digits <= 3 ? "clamp(64px, 11vw, 180px)" :
    digits === 4 ? "clamp(58px, 9vw, 144px)" :
    digits === 5 ? "clamp(52px, 7.5vw, 122px)" :
    "clamp(48px, 6.2vw, 100px)";
  hero.style.setProperty("--hero-size", size);
}

/** Counts up without allowing its containing panel to resize mid-animation. */
function countUp(root, name, value) {
  const el = slot(root, name);
  if (!el) return;
  fitHeroNumber(root, name, value);
  const formatted = num(value);
  const hero = el.parentElement;
  hero.classList.add("w-counter");
  // Reserve the final number's width before starting at zero. Metric panels
  // shrink to their content, so without this their right edge visibly shifts
  // as the counter gains digits and thousands separators.
  hero.style.setProperty("--counter-chars", formatted.length);
  if (reduced.matches || value < 2) { el.textContent = formatted; return; }

  el.textContent = "0";
  const DURATION = 1150;
  let frame = 0;
  let start = 0;
  const step = (now) => {
    if (!start) start = now;
    const t = Math.min((now - start) / DURATION, 1);
    el.textContent = num(Math.round(value * (1 - Math.pow(1 - t, 3))));
    if (t < 1) frame = requestAnimationFrame(step);
  };
  later(() => { frame = requestAnimationFrame(step); }, 280);
  pending.push(() => cancelAnimationFrame(frame));
}

// ---- Derived labels shared by the cover and the final card ----
function chatTitle(meta) {
  if (meta.is_group) return `${meta.participants.length} participants`;
  const names = meta.participants;
  return names[names.length - 1] || names[0] || "This chat";
}

const spanLabel = (meta) => `${meta.date_range.start} – ${meta.date_range.end}`;

/* The card dates itself by the last year the chat ran. /api/recap is always the
   unfiltered whole chat, so `range_iso` here spans the entire conversation. */
const editionLabel = (meta) => `${meta.range_iso.end.slice(0, 4)} edition`;

// ---- Row builders ----
// These append repeated primitives into a container slot. They still build no
// page structure of their own: the container, its sizing and its animation all
// come from the template and the stylesheet.
function fillHours(root, stats) {
  const host = slot(root, "hourBars");
  if (!host) return;
  const peak = Number(stats.kpis.peak_hour.slice(0, 2));
  const max = Math.max(...stats.hours, 1);
  stats.hours.forEach((count, hour) => {
    const bar = document.createElement("i");
    // An hour nobody wrote in gets a hairline, not the 4% floor: on a small
    // chat that floor turns twenty-three silent hours into a row of stubs
    // that reads as real activity.
    bar.className = "w-hb" + (hour === peak ? " peak" : "") + (count ? "" : " empty");
    bar.style.setProperty("--h", count ? `${Math.max(4, (count / max) * 100)}%` : "2px");
    bar.style.setProperty("--i", hour);
    host.append(bar);
  });
}

function fillPodium(root, emojis) {
  const host = slot(root, "podium");
  if (!host) return;
  Array.from({ length: 5 }, (_, i) => emojis[i]).forEach((item, i) => {
    const pod = document.createElement("div");
    pod.className = `w-pod r${i + 1}` + (item ? "" : " empty");
    const glyph = document.createElement("span");
    glyph.className = "g";
    glyph.textContent = item ? item.emoji : "—";
    const count = document.createElement("span");
    count.className = "c";
    count.textContent = item ? num(item.count) : "—";
    pod.append(glyph, count);
    host.append(pod);
  });
}

function fillWords(root, words) {
  const host = slot(root, "words");
  if (!host) return;
  Array.from({ length: 5 }, (_, i) => words[i]).forEach((item, i) => {
    const row = document.createElement("div");
    row.className = "w-word" + (item ? "" : " empty");
    row.style.setProperty("--i", i);

    const rank = document.createElement("span");
    rank.className = "r";
    rank.textContent = i + 1;
    const text = document.createElement("span");
    text.className = "t";
    text.textContent = item ? item.word : "—";
    const count = document.createElement("span");
    count.className = "c";
    count.textContent = item ? num(item.count) : "—";

    row.append(rank, text, count);
    host.append(row);
  });
}

// Past this the tail of the bar is segments too thin to see, and in a large
// group there are hundreds of them. They are summed into one closing segment.
const MAX_SPLIT_SEGMENTS = 8;

function fillPeople(root, people) {
  const bar = slot(root, "splitBar");
  const list = slot(root, "people");
  // The same palette as the dashboard's balance bar, so a person keeps one
  // colour everywhere on the page.
  const colorOf = (i) => BAL_COLORS[i % BAL_COLORS.length];

  people.forEach((person, i) => {
    const c = colorOf(i);
    if (bar && i < MAX_SPLIT_SEGMENTS) {
      const seg = document.createElement("i");
      seg.style.setProperty("--w", `${person.pct}%`);
      seg.style.setProperty("--c", c);
      seg.style.setProperty("--i", i);
      bar.append(seg);
    }
    // The bar always shows everyone; the legend keeps the top six so the tail
    // of sub-1% voices does not crowd the poster.
    if (!list || i >= 6) return;

    const row = document.createElement("div");
    row.className = "w-person";
    // One colour per person drives both the swatch and the percentage.
    row.style.setProperty("--c", c);
    const dot = document.createElement("span");
    dot.className = "d";
    const name = document.createElement("span");
    name.className = "n";
    name.textContent = person.name;
    const pct = document.createElement("span");
    pct.className = "p";
    pct.textContent = person.pct_label;
    const sub = document.createElement("span");
    sub.className = "s";
    sub.textContent = `${num(person.count)} ${person.count === 1 ? "message" : "messages"}`;
    row.append(dot, name, pct, sub);
    list.append(row);
  });

  // The quiet tail closes the bar as one neutral block, so the segments that
  // are actually legible keep their real width.
  const rest = people.slice(MAX_SPLIT_SEGMENTS);
  const restPct = rest.reduce((sum, person) => sum + person.pct, 0);
  if (bar && restPct > 0) {
    const seg = document.createElement("i");
    seg.className = "rest";
    seg.style.setProperty("--w", `${restPct}%`);
    seg.style.setProperty("--c", "var(--w-fg)");
    seg.style.setProperty("--i", MAX_SPLIT_SEGMENTS);
    seg.title = `${rest.length} others · ${restPct}%`;
    bar.append(seg);
  }
}

/* The row is a fixed width, so past roughly three dozen bars each one is
   thinner than the gap beside it and the shape stops being readable. Beyond
   that, months are folded into equal buckets — a decade of chat still gets a
   silhouette rather than a grey smear. */
const MAX_MONTH_BARS = 36;

function bucketed(values, limit) {
  if (values.length <= limit) return values;
  const perBucket = Math.ceil(values.length / limit);
  const out = [];
  for (let i = 0; i < values.length; i += perBucket) {
    out.push(values.slice(i, i + perBucket).reduce((sum, v) => sum + v, 0));
  }
  return out;
}

/* One bar per month of the chat, oldest at the left. The same primitive the
   hour chart uses: a run of bars is a run of bars, whatever it counts. */
function fillMonths(root, series) {
  const host = slot(root, "monthBars");
  if (!host) return;
  const values = bucketed(series.values, MAX_MONTH_BARS);
  const max = Math.max(...values, 1);
  const peak = values.indexOf(max);
  values.forEach((count, i) => {
    const bar = document.createElement("i");
    bar.className = "w-hb" + (i === peak ? " peak" : "") + (count ? "" : " empty");
    bar.style.setProperty("--h", count ? `${Math.max(4, (count / max) * 100)}%` : "2px");
    // The stagger is spread over the run rather than per bar: a four-year chat
    // has fifty of them and a per-bar delay would outlast the slide.
    bar.style.setProperty("--i", Math.round((i / values.length) * 24));
    host.append(bar);
  });
}

/* The week as a block: seven rows of twenty-four cells, each inked by how much
   was said in it. The weekday initial leads its row. */
const DAY_INITIALS = ["M", "T", "W", "T", "F", "S", "S"];

function fillHeat(root, grid) {
  const host = slot(root, "heatGrid");
  if (!host) return;
  const max = Math.max(...grid.flat(), 1);
  grid.forEach((row, day) => {
    const label = document.createElement("span");
    label.className = "w-heat-day";
    label.textContent = DAY_INITIALS[day];
    host.append(label);
    row.forEach((count, hour) => {
      const cell = document.createElement("i");
      cell.className = "w-hc";
      // Square-rooted: a single runaway hour would otherwise flatten the rest
      // of the week to one shade.
      cell.style.setProperty("--v", Math.sqrt(count / max).toFixed(3));
      cell.style.setProperty("--i", day * 3 + Math.round(hour / 4));
      host.append(cell);
    });
  });
}

/** The busiest single weekday-hour cell, as a label and its count. */
function heatPeak(grid) {
  let best = { day: 0, hour: 0, count: -1 };
  grid.forEach((row, day) => row.forEach((count, hour) => {
    if (count > best.count) best = { day, hour, count };
  }));
  return best;
}

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday",
                   "Friday", "Saturday", "Sunday"];

function fillMediaChips(root, media) {
  const host = slot(root, "mediaChips");
  if (!host) return;
  media.items.slice(0, 3).forEach((item) => {
    const chip = document.createElement("span");
    chip.className = "w-chip";
    chip.textContent = `${item.label} · ${num(item.count)}`;
    host.append(chip);
  });
}

/* The recap card's cells. A chat that never produced the number should not
   print a zero for it, so the whole cell leaves the grid and the ones after it
   close up: a two-day chat gets a short honest card, not a padded one. */
function cardCell(root, name, value, label) {
  const cell = root.querySelector(`[data-cell="${name}"]`);
  if (!cell) return;
  if (value === null || value === undefined || value === "") {
    cell.remove();
    return;
  }
  const b = cell.querySelector("b");
  if (b) b.textContent = value;
  if (label) put(root, `${name}Label`, label);
}

// ---- The deck ----
// One entry per template, in the order the dashboard's own cards read: left to
// right, then down. `key` matches a data-slide template; `skip` drops slides a
// given export has nothing to say about, before the progress segments are
// built.
const SLIDES = [
  {
    key: "cover",
    fill: (root, s) => {
      put(root, "chatName", chatTitle(s.meta));
      put(root, "span", spanLabel(s.meta));
    },
  },
  {
    key: "total",
    fill: (root, s) => {
      countUp(root, "total", s.kpis.total_messages);
      put(root, "days", num(s.kpis.active_days));
    },
  },
  {
    // Two dashboard cards on one poster: the active-day count, and the
    // messages-a-day average as the line under it.
    key: "days",
    fill: (root, s) => {
      countUp(root, "days", s.kpis.active_days);
      put(root, "perDay", num(s.kpis.msgs_per_day));
    },
  },
  {
    key: "hour",
    fill: (root, s) => {
      put(root, "peak", hourRange(s.kpis.peak_hour));
      put(root, "peakShare", `${s.kpis.peak_hour_share}%`);
      fillHours(root, s);
    },
  },
  {
    key: "timeline",
    // A chat that never saw a second month has no shape to show.
    skip: (s) => s.messages_over_time.monthly.values.length < 2,
    fill: (root, s) => {
      const months = s.messages_over_time.monthly;
      const peak = months.values.indexOf(Math.max(...months.values));
      put(root, "peakMonth", months.labels[peak]);
      put(root, "peakMonthCount", num(months.values[peak]));
      put(root, "monthCount", months.values.length);
      put(root, "monthFirst", months.labels[0]);
      put(root, "monthLast", months.labels[months.labels.length - 1]);
      fillMonths(root, months);
    },
  },
  {
    key: "heatmap",
    // The week block is drawn from the counts themselves: with none of them
    // there is no busiest cell to name.
    skip: (s) => !heatPeak(s.heatmap).count,
    fill: (root, s) => {
      const best = heatPeak(s.heatmap);
      put(root, "heatDay", DAY_NAMES[best.day]);
      put(root, "heatTime", hourRange(best.hour));
      put(root, "heatPeakCount", num(best.count));
      fillHeat(root, s.heatmap);
    },
  },
  {
    key: "media",
    skip: (s) => !s.media.total,
    fill: (root, s) => {
      countUp(root, "mediaTotal", s.media.total);
      fillMediaChips(root, s.media);
    },
  },
  {
    key: "emojis",
    // Only an empty chat is skipped: one emoji still makes a podium, and the
    // slide is the only place the ranking is shown at all.
    skip: (s) => !s.top_emojis.length,
    fill: (root, s) => {
      fillPodium(root, s.top_emojis);
      put(root, "emojiTop", s.top_emojis[0].emoji);
      put(root, "emojiCount", num(s.top_emojis[0].count));
    },
  },
  {
    key: "words",
    skip: (s) => !s.top_keywords.length,
    fill: (root, s) => fillWords(root, s.top_keywords),
  },
  {
    key: "balance",
    skip: (s) => s.insights.participants.length < 2,
    fill: (root, s) => fillPeople(root, s.insights.participants),
  },
  {
    // The weekday the chat leans on, weighed by its own share of the total.
    // The four-hour window that used to sit here said the same thing as the
    // peak hour two slides earlier.
    key: "day",
    // With one active day the busiest weekday is that day and its share is
    // always 100%: a slide that restates the cover rather than adding to it.
    skip: (s) => !s.insights.busiest_day || s.kpis.active_days < 2,
    fill: (root, s) => {
      const day = DAY_NAMES.indexOf(s.insights.busiest_day);
      const onDay = day < 0 ? 0 : s.heatmap[day].reduce((a, b) => a + b, 0);
      put(root, "busiestDay", s.insights.busiest_day);
      countUp(root, "dayCount", onDay);
      put(root, "dayShare", `${Math.round(onDay / s.kpis.total_messages * 100)}%`);
    },
  },
  {
    key: "starter",
    skip: (s) => s.insights.participants.length < 2,
    fill: (root, s) => {
      put(root, "starter", s.insights.conversation_starter);
      put(root, "starterPct", `${s.insights.conversation_starter_pct}%`);
    },
  },
  {
    key: "streak",
    skip: (s) => s.insights.longest_streak_days < 2,
    fill: (root, s) => {
      countUp(root, "streak", s.insights.longest_streak_days);
      put(root, "streakRange", s.insights.longest_streak_range);
    },
  },
  {
    key: "owl",
    skip: (s) => !s.insights.night_owl_count,
    fill: (root, s) => {
      put(root, "owl", s.insights.night_owl);
      put(root, "owlCount", num(s.insights.night_owl_count));
      put(root, "owlShare", `${s.insights.night_owl_share}%`);
    },
  },
  {
    // The whole dashboard on one card: every tile it shows has a cell here, in
    // the same reading order. Anything the chat has no answer for is dropped
    // by cardCell rather than printed as a zero.
    key: "final",
    fill: (root, s) => {
      put(root, "edition", editionLabel(s.meta));
      put(root, "chatName", chatTitle(s.meta));
      put(root, "span", spanLabel(s.meta));
      put(root, "total", num(s.kpis.total_messages));
      cardCell(root, "perDay", num(s.kpis.msgs_per_day));

      const people = s.insights.participants;
      const word = s.top_keywords[0];

      cardCell(root, "days", num(s.kpis.active_days));
      cardCell(root, "peak", hourRange(s.kpis.peak_hour));
      cardCell(root, "word", word ? word.word : "");
      // A one-sided export has no balance to report and nobody to credit with
      // starting the chat: both cells go with it.
      cardCell(root, "talker", people.length > 1 ? people[0].name : "",
               people.length > 1 ? `most messages · ${people[0].pct_label}` : "");
      cardCell(root, "starter", people.length > 1 ? s.insights.conversation_starter : "",
               `starts the chat · ${s.insights.conversation_starter_pct}%`);
      cardCell(root, "streak", s.insights.longest_streak_days > 1
               ? s.insights.longest_streak_days : "");
      cardCell(root, "owl", s.insights.night_owl_count ? s.insights.night_owl : "",
               `night owl · ${num(s.insights.night_owl_count)} after midnight`);

      const top = s.top_emojis[0];
      cardCell(root, "emoji", top ? top.emoji : "");
      if (top) put(root, "emojiLabel", `top emoji · ${num(top.count)} uses`);
    },
  },
];

const templateFor = (key) => overlay.querySelector(`template[data-slide="${key}"]`);

// ---- Playback ----
function buildProgress() {
  progressEl.innerHTML = "";
  deck.forEach(() => {
    const seg = document.createElement("div");
    seg.className = "wp-seg";
    seg.append(Object.assign(document.createElement("i"), { className: "wp-fill" }));
    progressEl.append(seg);
  });
}

/* Colour names in the templates map to the palette custom properties the
   stylesheet already defines, so a poster pair is declared once in the markup
   and nowhere else. */
const PALETTE = {
  paper: "var(--paper)", ink: "var(--ink)", red: "var(--red)",
  blue: "var(--blue)", yellow: "var(--yellow)", green: "var(--w-green)",
  navy: "var(--navy)",
};
function applyTheme(template) {
  const { bg = "paper", fg = "ink", accent = "red" } = template.dataset;
  overlay.style.setProperty("--w-bg", PALETTE[bg]);
  overlay.style.setProperty("--w-fg", PALETTE[fg]);
  overlay.style.setProperty("--w-accent", PALETTE[accent]);
}

function show(i) {
  clearPending();
  index = i;
  const slide = deck[i];
  const template = templateFor(slide.key);
  applyTheme(template);
  countEl.textContent =
    `${String(i + 1).padStart(2, "0")} / ${String(deck.length).padStart(2, "0")}`;

  const node = template.content.cloneNode(true);
  slide.fill(node.firstElementChild, cache);
  stage.replaceChildren(node);
  if (slide.key === "final") fitFinalCard();
  if (window.hydrateIcons) window.hydrateIcons(stage);

  const segments = [...progressEl.children];
  segments.forEach((seg, n) => {
    seg.classList.toggle("done", n < i);
    seg.classList.remove("active");
  });
  const current = segments[i];
  if (!current) return;

  // A duration of 0 means the slide holds indefinitely — the final card, where
  // the story ends rather than looping. Its segment simply reads as full.
  const duration = Number(template.dataset.dur || 5000);
  if (!duration) { current.classList.add("done"); return; }

  // Segments are reused across the deck, so a finished animation has to be
  // reset with a reflow between the class coming off and going back on;
  // re-adding it alone would not replay.
  const fill = current.firstElementChild;
  void fill.offsetWidth;
  current.style.setProperty("--dur", `${duration}ms`);
  current.classList.add("active");
  // Auto-advance is driven by the bar itself, so the two can never drift apart.
  // Assigned rather than added: it replaces any handler left on a segment the
  // viewer already passed through once.
  fill.onanimationend = () => { if (index === i) next(); };
}

function next() {
  if (index < deck.length - 1) show(index + 1);
}

function prev() {
  if (index > 0) show(index - 1);
}

function setPaused(on) {
  paused = on;
  overlay.classList.toggle("paused", on);
  pipEl.hidden = !on;
  pauseBtn.setAttribute("aria-label", on ? "Play" : "Pause");
  pauseBtn.title = on ? "Play" : "Pause";
  pauseBtn.innerHTML = window.ICONS[on ? "play" : "pause"];
}

// ---- Open / close ----
// The in-flight recap request, so closing the overlay stops waiting on it.
let loadController = null;

async function loadStats() {
  if (cache) return cache;
  loadController = new AbortController();
  // A very large export still has to be parsed the first time. Bound the wait
  // so a hung request ends in a message with a retry rather than in a spinner.
  const timer = setTimeout(() => loadController.abort(), 120000);
  try {
    const res = await fetch("/api/recap", { signal: loadController.signal });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not build the recap.");
    cache = data.stats;
    return cache;
  } finally {
    clearTimeout(timer);
    loadController = null;
  }
}

async function openRecap() {
  if (open || loading) return;
  loading = true;
  overlay.hidden = false;
  // The fade only plays the first time an element is displayed, so it is
  // restarted by hand or every reopen after the first would snap in.
  overlay.style.animation = "none";
  void overlay.offsetWidth;
  overlay.style.animation = "";
  open = true;
  document.body.classList.add("sheet-open");
  trigger.setAttribute("aria-expanded", "true");
  if (railTrigger) railTrigger.setAttribute("aria-expanded", "true");
  progressEl.innerHTML = "";
  stage.replaceChildren();
  statusText.textContent = "Building your recap…";
  retryBtn.hidden = true;
  statusEl.hidden = false;
  setPaused(false);

  try {
    const stats = await loadStats();
    statusEl.hidden = true;
    deck = SLIDES.filter((slide) => !slide.skip || !slide.skip(stats));
    buildProgress();
    show(0);
    overlay.focus();
  } catch (err) {
    // Closing mid-load aborts the request; that is not a failure to report.
    if (err.name === "AbortError" && !open) return;
    statusText.textContent = err.name === "AbortError"
      ? "Building the recap took too long."
      : err.message;
    // Without this the deck is empty and the only way out is Escape.
    retryBtn.hidden = false;
    retryBtn.focus();
  } finally {
    loading = false;
  }
}

async function retryRecap() {
  if (loading) return;
  open = false;   // openRecap refuses to run while it thinks it is already open
  await openRecap();
}

/* The page behind the overlay stays in the tab order, so Tab is cycled by hand.
   The story is modal: leaving it should take an explicit Escape or close. */
function trapFocus(e) {
  const focusable = [...overlay.querySelectorAll("button:not([disabled]):not([tabindex='-1'])")];
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  if (e.shiftKey && (active === first || !overlay.contains(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

function closeRecap() {
  if (!open) return;
  clearPending();
  open = false;
  // A recap still being built has nowhere to land. Without releasing the flag
  // too, a chat deleted mid-load would leave the story permanently unopenable.
  if (loadController) loadController.abort();
  loading = false;
  overlay.hidden = true;
  stage.classList.remove("scrolls");
  stage.replaceChildren();
  progressEl.innerHTML = "";
  retryBtn.hidden = true;
  document.body.classList.remove("sheet-open");
  trigger.setAttribute("aria-expanded", "false");
  if (railTrigger) railTrigger.setAttribute("aria-expanded", "false");
  setPaused(false);
  // Focus belongs on whichever trigger opened the story. On a phone the topbar
  // one is hidden, so fall back to the bottom-bar proxy when it is the visible,
  // enabled control.
  if (!trigger.disabled && trigger.offsetParent !== null) trigger.focus();
  else if (railTrigger && !railTrigger.disabled) railTrigger.focus();
}

// ---- Save the final card as an image ----
// Hand-drawn on a canvas rather than rasterising the DOM: no external library,
// and the export is a fixed 1080x1920 regardless of the viewport it was
// opened on.
function wash(ctx, x, y, radius, color, alpha) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
  g.addColorStop(0, color);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.globalAlpha = alpha;
  ctx.fillStyle = g;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  ctx.globalAlpha = 1;
}

/* A quarter disc, corner given as the compass point the right angle sits in.
   The same primitive the slides use, so the saved image is composed from the
   same vocabulary as the screen. */
function quarter(ctx, x, y, r, color, from) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.arc(x, y, r, from, from + Math.PI / 2);
  ctx.closePath();
  ctx.fill();
}

/* The screen's ground, rebuilt for the export: solid cells, each carrying one
   quarter disc in a second colour, thrown out of focus the way the CSS ground
   is. Drawn on its own canvas first so the blur cannot bleed the card's type. */
function mosaic(ctx, W, H, tile = 260) {
  const cells = [PAPER, BLUE, YELLOW, INK];
  const discs = [INK, PAPER, RED, BLUE];
  // Compass points: the angle a wedge's arc opens from, one per supertile cell.
  const corners = [0, Math.PI / 2, Math.PI, -Math.PI / 2];

  const layer = document.createElement("canvas");
  layer.width = W;
  layer.height = H;
  const lc = layer.getContext("2d");

  let n = 0;
  for (let y = -tile; y <= H; y += tile) {
    for (let x = -tile; x <= W; x += tile, n += 1) {
      const i = (n + Math.floor(y / tile)) % 4;
      lc.fillStyle = cells[i];
      lc.fillRect(x, y, tile, tile);
      // Every fourth cell stays plain, which is what keeps the field from
      // reading as one mechanical repeat.
      if (i === 3) continue;
      const from = corners[n % 4];
      // The right angle sits in the cell corner the arc opens from, so
      // neighbouring cells always meet along a full edge.
      const cx = from === 0 || from === -Math.PI / 2 ? x : x + tile;
      const cy = from === 0 || from === Math.PI / 2 ? y : y + tile;
      quarter(lc, cx, cy, tile, discs[i], from);
    }
  }

  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.filter = "blur(7px)";
  ctx.drawImage(layer, 0, 0);
  ctx.restore();
}

/* Sets a font that makes `text` fit `maxWidth`, shrinking from `size` down to
   `floor` first. Truncating a value like "11:00–12:00" would silently change
   what the card says, so type size gives way before the text does; only a name
   long enough to defeat even the floor gets an ellipsis. */
function fitText(ctx, text, maxWidth, weight, size, floor = 22) {
  let px = size;
  ctx.font = font(weight, px);
  while (px > floor && ctx.measureText(text).width > maxWidth) {
    px -= 2;
    ctx.font = font(weight, px);
  }
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return `${cut}…`;
}

// Canvas can name Futura directly, so the export gets the same face as the
// screen rather than a generic system sans.
const font = (weight, size) =>
  `${weight} ${size}px Futura, "Avenir Next", "Century Gothic", system-ui, sans-serif`;

// The palette, in literal values: canvas cannot read the stylesheet's vars.
const INK = "#141210";
const PAPER = "#f2ede3";
const RED = "#d92b1e";
const BLUE = "#1b45b8";
const YELLOW = "#f2b705";

/* The palette in mixed form: canvas cannot run color-mix, so the three tints
   the card's CSS derives from --w-bg and --w-accent are resolved here once.
   Blue is the final slide's accent, which is what makes this card blue. */
const CARD_BG = "#d8d9de";   // paper 88% + blue
const CELL_BG = "#c3c8d9";   // paper 78% + blue
const EMOJI_BG = "#f2da98";  // paper + yellow 34%

function band(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/* Draws `value` over `label`, the arrangement every cell on the card uses. */
function cell(ctx, x, y, w, h, value, label) {
  const pad = 22;
  ctx.fillStyle = INK;
  ctx.font = font(700, 44);
  ctx.fillText(fitText(ctx, value, w - pad * 2, 700, 44, 26), x + pad, y + h - 44);
  ctx.globalAlpha = 0.72;
  ctx.letterSpacing = "1.6px";
  ctx.font = font(600, 18);
  ctx.fillText(fitText(ctx, label, w - pad * 2, 600, 18, 13), x + pad, y + h - 20);
  ctx.letterSpacing = "0px";
  ctx.globalAlpha = 1;
}

/* The card's cells, in the dashboard's reading order, built from the same
   rules the DOM card uses: a value the chat never produced yields no entry at
   all, so the saved image is as short as the recap it belongs to. */
function cardCells(stats) {
  const months = stats.messages_over_time.monthly;
  const people = stats.insights.participants;
  const ins = stats.insights;
  const word = stats.top_keywords[0];
  const out = [];
  const add = (value, label) => { if (value) out.push([String(value), label]); };

  add(num(stats.kpis.active_days), "ACTIVE DAYS");
  add(hourRange(stats.kpis.peak_hour), "PEAK HOUR");
  add(months.values.length
      ? months.labels[months.values.indexOf(Math.max(...months.values))] : "",
      "LOUDEST MONTH");
  add(ins.busiest_day, "BUSIEST DAY");
  add(stats.kpis.total_words ? num(stats.kpis.total_words) : "",
      `WORDS WRITTEN · ${stats.kpis.words_per_message} PER MESSAGE`);
  add(stats.media.total ? num(stats.media.total) : "", "MEDIA SHARED");
  add(word ? word.word : "", "TOP WORD");
  if (people.length > 1) {
    add(people[0].name, `MOST MESSAGES · ${people[0].pct_label}`);
    add(ins.conversation_starter, `STARTS THE CHAT · ${ins.conversation_starter_pct}%`);
  }
  add(ins.longest_streak_days > 1 ? ins.longest_streak_days : "", "DAY STREAK");
  add(ins.night_owl_count ? ins.night_owl : "",
      `NIGHT OWL · ${num(ins.night_owl_count)} AFTER MIDNIGHT`);
  return out;
}

/* The saved card is the on-screen card, redrawn: same header band, same title
   block over an accent rule, the headline band with the daily rate on its
   right, the cell grid, then the emoji line. Kept in step by hand: the export
   is a fixed 1080x1920 whatever viewport it was opened on. Its height follows
   the number of cells, so a short chat saves a short card. */
function drawCard(stats) {
  const W = 1080;
  const H = 1920;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  // Paper ground, the two soft washes the slides carry, then the same mosaic
  // that runs behind the story on screen.
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);
  wash(ctx, 120, 200, 760, BLUE, 0.16);
  wash(ctx, 980, 1760, 700, RED, 0.14);
  mosaic(ctx, W, H);

  // Every block's height, so the card can be centred before anything is drawn.
  const M = 80;
  const CW = W - M * 2;
  const HEADER = 100;
  const PAD = 48;
  const NAME_H = 76;
  const SPAN_H = 40;
  const TITLE_GAP = 20;
  const RULE_H = 8;
  const AFTER_RULE = 26;
  const HERO_H = 174;
  const GAP = 16;
  const CELL_H = 118;
  const EMOJI_H = 120;
  const FOOT_GAP = 30;
  const FOOT_H = 24;

  const cells = cardCells(stats);
  const best = stats.top_emojis[0];
  const rows = Math.ceil(cells.length / 2);
  const gridH = rows ? rows * CELL_H + (rows - 1) * GAP : 0;
  const cardH =
    HEADER + PAD * 2 + NAME_H + SPAN_H + TITLE_GAP + RULE_H + AFTER_RULE +
    HERO_H + (rows ? GAP + gridH : 0) + (best ? GAP + EMOJI_H : 0) +
    FOOT_GAP + FOOT_H;
  const top = (H - cardH) / 2;

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  // The offset shadow, then the card itself: a flat plate, no blur, the way the
  // panels are drawn in CSS.
  ctx.globalAlpha = 0.28;
  band(ctx, M + 26, top + 26, CW, cardH, BLUE);
  ctx.globalAlpha = 1;
  band(ctx, M, top, CW, cardH, CARD_BG);
  ctx.strokeStyle = BLUE;
  ctx.lineWidth = 6;
  ctx.strokeRect(M + 3, top + 3, CW - 6, cardH - 6);

  // Header band, edge to edge.
  band(ctx, M, top, CW, HEADER, BLUE);
  ctx.fillStyle = PAPER;
  ctx.letterSpacing = "8px";
  ctx.font = font(700, 26);
  ctx.fillText("chat recap", M + PAD, top + 68);
  ctx.letterSpacing = "3px";
  ctx.font = font(700, 20);
  const edition = editionLabel(stats.meta).toUpperCase();
  const ew = ctx.measureText(edition).width + 34;
  ctx.strokeStyle = "rgba(242,237,227,.7)";
  ctx.lineWidth = 2;
  ctx.strokeRect(M + CW - PAD - ew, top + 32, ew, 48);
  ctx.fillText(edition, M + CW - PAD - ew + 17, top + 63);
  ctx.letterSpacing = "0px";

  const x = M + PAD;
  const inner = CW - PAD * 2;
  let y = top + HEADER + PAD;

  ctx.fillStyle = INK;
  ctx.font = font(700, 66);
  ctx.fillText(fitText(ctx, chatTitle(stats.meta), inner, 700, 66, 38), x, y + 56);
  y += NAME_H;
  ctx.globalAlpha = 0.62;
  ctx.font = font(500, 26);
  ctx.fillText(spanLabel(stats.meta), x, y + 24);
  ctx.globalAlpha = 1;
  y += SPAN_H + TITLE_GAP;

  band(ctx, x, y, inner, RULE_H, BLUE);
  y += RULE_H + AFTER_RULE;

  // The headline number on the accent, its label tucked under the baseline,
  // and the daily average set small against the right edge of the same band.
  band(ctx, x, y, inner, HERO_H, BLUE);
  ctx.fillStyle = PAPER;
  ctx.font = font(700, 106);
  ctx.fillText(
    fitText(ctx, num(stats.kpis.total_messages), inner - 340, 700, 106, 56),
    x + 30, y + 118,
  );
  ctx.globalAlpha = 0.8;
  ctx.letterSpacing = "4px";
  ctx.font = font(600, 20);
  ctx.fillText("messages", x + 30, y + 150);
  ctx.letterSpacing = "0px";
  ctx.globalAlpha = 1;

  ctx.textAlign = "right";
  ctx.font = font(700, 46);
  ctx.fillText(num(stats.kpis.msgs_per_day), x + inner - 30, y + 118);
  ctx.globalAlpha = 0.8;
  ctx.letterSpacing = "4px";
  ctx.font = font(600, 20);
  ctx.fillText("a day", x + inner - 30, y + 150);
  ctx.letterSpacing = "0px";
  ctx.globalAlpha = 1;
  ctx.textAlign = "left";
  y += HERO_H;

  // The cells, two across, in the order the dashboard reads them. An odd last
  // one takes the whole width, exactly as the grid rule does on screen.
  const half = (inner - GAP) / 2;
  if (rows) y += GAP;
  cells.forEach(([value, label], i) => {
    const last = i === cells.length - 1 && cells.length % 2;
    const cx = i % 2 ? x + half + GAP : x;
    const cw = last ? inner : half;
    const cy = y + Math.floor(i / 2) * (CELL_H + GAP);
    band(ctx, cx, cy, cw, CELL_H, CELL_BG);
    cell(ctx, cx, cy, cw, CELL_H, value, label);
  });
  y += gridH;

  // The emoji reads as a signature line: glyph, then its caption beside it.
  if (best) {
    y += GAP;
    band(ctx, x, y, inner, EMOJI_H, EMOJI_BG);
    ctx.fillStyle = INK;
    ctx.font = font(400, 70);
    ctx.fillText(best.emoji, x + 30, y + 84);
    // Measured while the glyph's own font is still set: at the caption size the
    // same emoji is a third of the width and the line would sit under it.
    const captionX = x + 30 + ctx.measureText(best.emoji).width + 36;
    ctx.globalAlpha = 0.8;
    ctx.letterSpacing = "2px";
    ctx.font = font(700, 24);
    ctx.fillText(`top emoji · ${num(best.count)} uses`, captionX, y + 70);
    ctx.letterSpacing = "0px";
    ctx.globalAlpha = 1;
    y += EMOJI_H;
  }
  y += FOOT_GAP;

  ctx.globalAlpha = 0.45;
  ctx.letterSpacing = "6px";
  ctx.font = font(600, 22);
  ctx.fillText("whatsapp analytics", x, y + FOOT_H);
  ctx.letterSpacing = "0px";
  ctx.globalAlpha = 1;

  return canvas;
}

function downloadCard() {
  const msg = document.getElementById("recapDownloadMsg");
  const fail = () => {
    msg.textContent = "Could not save the image.";
    msg.hidden = false;
  };
  // The card is drawn from the cache, not from the DOM: a cleared chat leaves
  // the button reachable for as long as the slide is still on screen.
  if (!cache) { fail(); return; }
  try {
    // toBlob is asynchronous, so the callback runs long after this try block
    // has returned: everything inside it has to report its own failure.
    drawCard(cache).toBlob((blob) => {
      if (!blob) { fail(); return; }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "whatsapp-recap.png";
      // Firefox ignores click() on an anchor that is not in the document, and
      // revoking in the same tick can cut the download off before it starts.
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      msg.textContent = "Saved to your downloads.";
      msg.hidden = false;
    }, "image/png");
  } catch (_) {
    fail();
  }
}

// ---- Wiring ----
export function initRecap() {
  trigger.addEventListener("click", openRecap);
  if (railTrigger) railTrigger.addEventListener("click", openRecap);
  retryBtn.addEventListener("click", retryRecap);
  document.getElementById("recapClose").addEventListener("click", closeRecap);
  pauseBtn.addEventListener("click", () => setPaused(!paused));
  window.addEventListener("resize", () => {
    if (open && deck[index]?.key === "final") fitFinalCard();
  });

  // Holding anywhere pauses, the way a story does. The flag stops the release
  // from also registering as a tap on the navigation half underneath.
  let holdTimer = null;
  let heldOpen = false;
  overlay.addEventListener("pointerdown", (e) => {
    // Real controls are a press, not a hold; only the story surface pauses.
    if (e.target.closest(".recap-controls, .recap-stage")) return;
    holdTimer = setTimeout(() => { heldOpen = true; setPaused(true); }, 250);
  });
  const endHold = () => {
    clearTimeout(holdTimer);
    if (!heldOpen) return;
    setPaused(false);
    // Releasing a hold still fires a click. That click must not navigate, and
    // it arrives before the next macrotask — which is exactly how long the
    // flag needs to live. Clearing it here rather than in the tap handler
    // means a hold that ended somewhere without a tap target cannot leave the
    // flag set and swallow the next real tap.
    setTimeout(() => { heldOpen = false; }, 0);
  };
  overlay.addEventListener("pointerup", endHold);
  overlay.addEventListener("pointercancel", endHold);

  const tap = (fn) => (e) => {
    e.stopPropagation();
    if (!heldOpen) fn();
  };
  document.getElementById("recapPrev").addEventListener("click", tap(prev));
  document.getElementById("recapNext").addEventListener("click", tap(next));

  // The final card's controls live inside the stage, above the tap halves.
  stage.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    e.stopPropagation();
    if (btn.id === "recapDownload") downloadCard();
    if (btn.id === "recapReplay") show(0);
  });

  document.addEventListener("keydown", (e) => {
    if (!open) return;
    if (e.key === "ArrowRight") { e.preventDefault(); next(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }
    else if (e.key === " ") { e.preventDefault(); setPaused(!paused); }
    else if (e.key === "Tab") trapFocus(e);
  });

  // Registered before the card-info menus and the delete dialog, and consumes
  // the key: the story is modal, so Escape must not also close what is behind it.
  onEscape(() => {
    if (!open) return false;
    closeRecap();
    return true;
  });
}

/** Enabled only while a chat is loaded, like the other two topbar controls. */
export function setRecapEnabled(on) {
  trigger.disabled = !on;
  if (railTrigger) railTrigger.disabled = !on;
  if (!on) closeRecap();
}

/** Called when the underlying chat changes: uploaded or deleted. */
export function clearRecapCache() {
  cache = null;
}
