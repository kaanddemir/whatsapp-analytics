/* Dashboard orchestrator: wires the modules together and owns render/reset,
   the two paths every module feeds into. */
import { state } from "./state.js";
import { closeAllPops, onEscape } from "./popover.js";
import { initPanels, bindDeleteModalEscape } from "./panels.js";
import { initFilters, syncFilterUI, resetFilters } from "./filters.js";
import { initCharts, syncGrain, renderSparks, renderLine, renderHeatmap, destroyCharts } from "./charts.js";
import { initCardInfo, renderCardInfo } from "./card-info.js";
import { initLists, renderEmojis, renderKeywords, renderMedia, renderInsights, resetListPages } from "./lists.js";
import { initUpload, loadStats } from "./upload.js";
import { initRecap, setRecapEnabled, clearRecapCache } from "./recap.js";
import { resetChat } from "./chat.js";
import { hourLabel, showDashboard } from "./util.js";

const emptyState = document.getElementById("emptyState");
const dashboard = document.getElementById("dashboard");
const uploadError = document.getElementById("uploadError");
const chatActions = document.getElementById("chatActions");
const settingsFileInput = document.getElementById("fileInput");
const clearDataBtn = document.getElementById("clearDataBtn");
const topbarExit = document.getElementById("topbarExit");
const exitModal = document.getElementById("exitModal");
const exitCancel = document.getElementById("exitCancel");
const exitConfirm = document.getElementById("exitConfirm");

function setChatActionsEnabled(enabled) {
  settingsFileInput.disabled = !enabled;
  clearDataBtn.disabled = !enabled;
  chatActions.classList.toggle("disabled", !enabled);
}

function renderKpis(k) {
  // A real zero is a result, not a missing value. Only something that is not a
  // number at all earns the dash.
  const numberOrDash = (value) =>
    Number.isFinite(Number(value)) && value !== null && value !== ""
      ? Number(value).toLocaleString()
      : "—";
  document.getElementById("kpiTotal").textContent = numberOrDash(k.total_messages);
  document.getElementById("kpiDays").textContent = numberOrDash(k.active_days);
  document.getElementById("kpiPerDay").textContent = numberOrDash(k.msgs_per_day);
  document.getElementById("kpiPeak").textContent = k.total_messages ? hourLabel(k.peak_hour) : "—";
  document.getElementById("kpiPeakSub").textContent =
    k.total_messages ? k.peak_hour_share + "% of all messages" : "Nothing to show yet.";
}

/** Draws a stats payload. Every path that gets data ends here. */
function render(stats, { resetAssistant = false } = {}) {
  if (resetAssistant) resetChat();
  state.stats = stats;
  // Also clears the skeleton an upload or a filter left running.
  showDashboard();
  setChatActionsEnabled(true);
  topbarExit.hidden = false;
  // The story always covers the whole chat, so it only needs a chat to exist.
  setRecapEnabled(true);

  renderKpis(stats.kpis);
  renderCardInfo(stats);
  syncFilterUI(stats);
  syncGrain(stats);

  renderSparks(stats);
  renderLine(stats.messages_over_time, stats.kpis.total_messages);
  renderHeatmap(stats.heatmap, stats.kpis.total_messages);

  resetListPages();
  renderEmojis(stats.top_emojis);
  renderKeywords(stats.top_keywords);
  renderMedia(stats.media);
  renderInsights(stats.insights);
}

/** Back to the empty state after the chat is deleted. */
function resetDashboard() {
  destroyCharts();
  state.stats = null;
  dashboard.classList.add("hidden");
  emptyState.classList.remove("hidden", "loading");
  uploadError.textContent = "";
  closeAllPops();
  resetFilters();
  setChatActionsEnabled(false);
  topbarExit.hidden = true;
  setRecapEnabled(false);
  clearRecapCache();
}

export function initDashboard() {
  // Render inline SVG icons in place of [data-icon] placeholders. Must run
  // before anything reads window.ICONS to build markup.
  if (window.hydrateIcons) window.hydrateIcons(document);

  // Order is the Escape layering: panels register the outermost handler first,
  // the menus next, the modal dialog last so it answers first.
  initPanels({ onDelete: () => { resetChat(); resetDashboard(); } });
  initFilters({ onStats: render });
  initCharts();
  initCardInfo();
  initLists();
  initUpload({ onStats: render });
  initRecap();
  bindDeleteModalEscape();

  function closeExitModal() {
    exitModal.hidden = true;
  }

  topbarExit.addEventListener("click", () => {
    exitModal.hidden = false;
    exitCancel.focus();
  });
  exitCancel.addEventListener("click", closeExitModal);
  exitModal.addEventListener("click", (event) => {
    if (event.target === exitModal) closeExitModal();
  });
  onEscape(() => {
    if (exitModal.hidden) return false;
    closeExitModal();
    return true;
  });

  exitConfirm.addEventListener("click", async () => {
    topbarExit.disabled = true;
    exitCancel.disabled = true;
    exitConfirm.disabled = true;
    try {
      const response = await fetch("/api/reset", { method: "POST" });
      if (!response.ok) throw new Error("Could not return to the main menu.");
      closeExitModal();
      resetChat();
      resetDashboard();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      uploadError.textContent = error.message || "Could not return to the main menu.";
    } finally {
      topbarExit.disabled = false;
      exitCancel.disabled = false;
      exitConfirm.disabled = false;
    }
  });

  // Load any existing stats on page open
  loadStats();
}
