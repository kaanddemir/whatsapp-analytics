/* Date range + participant filters, and the chat chip that reports them. */
import { state } from "./state.js";
import { bindPopover, closeAllPops } from "./popover.js";
import { BAL_COLORS, escapeHtml, initials, showSkeleton, showDashboard, showErrorModal } from "./util.js";

const datePill = document.getElementById("datePill");
const datePop = document.getElementById("datePop");
const dateStart = document.getElementById("dateStart");
const dateEnd = document.getElementById("dateEnd");
const chatChip = document.getElementById("chatChip");
const chatInfoPop = document.getElementById("chatInfoPop");
const chatChipAvatar = document.getElementById("chatChipAvatar");
const chatChipName = document.getElementById("chatChipName");

// Local calendar parts, never toISOString(): the Date objects below are built
// at local midnight, which east of UTC converts back to the previous day and
// silently shifts every preset window by one.
const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Current date selection, so a participant change keeps the visible range.
const currentRange = () =>
  state.activePreset === "all" ? ["", ""] : [dateStart.value, dateEnd.value];

// Set once by initFilters: the range and sender filters both re-render through it.
let onStats = () => {};

async function applyFilters(start, end) {
  // Close on click, not on response: the skeleton reports progress from here,
  // and a popover left hanging over it reads as a frozen UI.
  closeAllPops();
  showSkeleton();
  try {
    const res = await fetch("/api/range", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        start: start || "", end: end || "", sender: state.activeSender,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not apply filter");
    onStats(data.stats, { resetAssistant: true });
  } catch (err) {
    // Put the previous selection back rather than stranding the user on a
    // skeleton, then say plainly that nothing changed.
    showDashboard();
    showErrorModal(err.message || "Could not apply filter", {
      title: "Couldn’t apply this filter",
      action: "Close",
    });
  }
}

// Windows are measured back from the LAST DAY OF DATA, not today — chat
// exports are often historical, and "last 7 days" of today would be empty.
function presetRange(preset) {
  const full = state.stats.meta.full_range;
  if (preset === "all") return ["", ""];
  const days = Number(preset);
  const end = new Date(full.end + "T00:00:00");
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));
  const min = new Date(full.start + "T00:00:00");
  return [iso(start < min ? min : start), full.end];
}

// Highlight the active preset; nothing is highlighted for a custom range.
function syncPresets(stats) {
  document.querySelectorAll("[data-preset]").forEach((btn) => {
    btn.disabled = !stats;
    btn.classList.toggle("active", !!stats && btn.dataset.preset === state.pendingPreset);
  });
}

export function initFilters(opts) {
  onStats = opts.onStats;

  bindPopover(datePill, datePop);
  bindPopover(chatChip, chatInfoPop);

  document.getElementById("dateApply").addEventListener("click", () => {
    // Whatever is staged in the fields becomes the applied range.
    state.activePreset = state.pendingPreset;
    applyFilters(...currentRange());
  });
  document.getElementById("dateReset").addEventListener("click", () => {
    const full = state.stats && state.stats.meta.full_range;
    if (full) { dateStart.value = full.start; dateEnd.value = full.end; }
    state.activePreset = state.pendingPreset = "all";
    applyFilters("", "");
  });
  // Typing a date by hand no longer matches whichever preset was staged.
  [dateStart, dateEnd].forEach((el) =>
    el.addEventListener("input", () => {
      state.pendingPreset = null;
      syncPresets(state.stats);
    })
  );

  // A preset only fills the From/To fields; nothing is re-analysed until Apply.
  document.getElementById("dpPresets").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-preset]");
    if (!btn || btn.disabled || !state.stats) return;
    state.pendingPreset = btn.dataset.preset;
    const full = state.stats.meta.full_range;
    const [start, end] = state.pendingPreset === "all"
      ? [full.start, full.end]
      : presetRange(state.pendingPreset);
    dateStart.value = start;
    dateEnd.value = end;
    syncPresets(state.stats);
  });

  // The participant picker applies the sender and current date filters together.
  document.getElementById("chatPopParts").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-sender]");
    if (!btn) return;
    const next = btn.dataset.sender;

    if (!next) {
      if (!state.activeSender && state.activePreset === "all") { closeAllPops(); return; }
      state.activeSender = "";
      state.activePreset = state.pendingPreset = "all";
      applyFilters("", "");
      return;
    }
    // Re-picking the current person changes nothing, so just close.
    if (next === state.activeSender) { closeAllPops(); return; }
    state.activeSender = next;
    const [start, end] = currentRange();
    applyFilters(start, end);
  });
}

/** Points both filter controls at a fresh payload. */
export function syncFilterUI(stats) {
  document.getElementById("dateRange").textContent =
    stats.meta.date_range.start + " – " + stats.meta.date_range.end;

  // Sync the date-range picker to the data's bounds + current selection.
  const full = stats.meta.full_range, cur = stats.meta.range_iso;
  if (full && cur) {
    [dateStart, dateEnd].forEach((el) => { el.min = full.start; el.max = full.end; });
    dateStart.value = cur.start;
    dateEnd.value = cur.end;
  }

  datePill.disabled = false;
  // Same cue as the chat chip: a narrowed range should be visible without
  // opening the picker. "all" is the unfiltered state.
  datePill.classList.toggle("filtered", state.activePreset !== "all");
  chatChip.disabled = false;
  // Fresh stats overwrite the fields, so nothing is left staged.
  state.pendingPreset = state.activePreset;
  syncPresets(stats);
  renderChatInfo(stats);
}

/** Back to "no chat loaded": both controls dead, both filters cleared. */
export function resetFilters() {
  chatChipName.textContent = "No chat loaded";
  chatChipName.removeAttribute("title");
  setChipAvatar(null);
  chatChip.disabled = true;
  document.getElementById("dateRange").textContent = "Upload a chat to begin";
  datePill.disabled = true;
  datePill.classList.remove("filtered");
  dateStart.value = dateEnd.value = "";
  state.activePreset = state.pendingPreset = "all";
  syncPresets(null);

  state.activeSender = "";
  chatChip.classList.remove("filtered");
  document.getElementById("chatPopParts").innerHTML = "";
}

function setChipAvatar(name) {
  if (name) {
    chatChipAvatar.classList.remove("empty");
    chatChipAvatar.textContent = initials(name);
  } else {
    chatChipAvatar.classList.add("empty");
    chatChipAvatar.innerHTML = window.ICONS.user;
  }
}

// ---- Chat identity chip + info popover ----
// The popover is the participant filter, so it lives with the filters rather
// than with the read-only cards.
function renderChatInfo(stats) {
  const meta = stats.meta;
  const parts = stats.insights.participants;
  const names = meta.participants;

  // The chip carries the filter state: filtered to one person, it says so.
  const label = state.activeSender || (meta.is_group
    ? names.length + " participants"
    : (names[names.length - 1] || names[0] || "Chat"));
  chatChipName.textContent = label;
  chatChipName.title = label;
  setChipAvatar(state.activeSender || (meta.is_group ? null : label));
  if (!state.activeSender && meta.is_group) chatChipAvatar.innerHTML = window.ICONS.users;
  chatChip.classList.toggle("filtered", !!state.activeSender);

  // Totals/date span are deliberately not repeated here — the KPI cards and
  // the Insights bar already carry them.

  const wrap = document.getElementById("chatPopParts");
  // Colours match the Message Balance bar so the same person reads the same
  // colour everywhere on the page.
  const color = (i) => BAL_COLORS[i % BAL_COLORS.length];
  const pick = (sender, inner) =>
    `<button type="button" class="pt-pick${sender === state.activeSender ? " active" : ""}"
             data-sender="${escapeHtml(sender)}">${inner}</button>`;

  // Clears the filter; always first so there is an obvious way back.
  const everyone = pick("", `
    <span class="pt-all">
      <span class="avatar-initials empty">${window.ICONS.users}</span>
      <span class="pt-n">Everyone</span>
      <span class="pt-c">${stats.insights.convo_total.toLocaleString()}</span>
    </span>`);

  if (meta.is_group) {
    // v2 will get the full per-participant treatment; a compact list for now.
    wrap.className = "pt-rows";
    wrap.innerHTML = everyone + parts.map((p, i) => pick(p.name, `
      <span class="pt-row">
        <span class="pt-dot" style="background:${color(i)}"></span>
        <span class="pt-n">${escapeHtml(p.name)}</span>
        <span class="pt-c">${p.count.toLocaleString()} · ${p.pct}%</span>
      </span>`)).join("");
    return;
  }

  wrap.className = "participants";
  wrap.innerHTML = everyone + parts.map((p, i) => {
    const c = color(i);
    return pick(p.name, `
      <span class="pt-card">
        <span class="avatar-initials" style="background:${c}">${escapeHtml(initials(p.name))}</span>
        <span class="pt-name" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</span>
        <span class="pt-pct" style="color:${c}">${p.pct}%</span>
        <span class="pt-sub">${p.count.toLocaleString()} messages</span>
        <span class="pt-track"><span class="pt-bar" style="width:${p.pct}%;background:${c}"></span></span>
      </span>`);
  }).join("");
}
