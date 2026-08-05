/* Upload: file pickers, drag & drop, the loading skeleton, initial load. */
import { state } from "./state.js";
import { closeSettings } from "./panels.js";
import { showSkeleton, showDropZone, showErrorModal, initErrorModal } from "./util.js";
import { clearRecapCache } from "./recap.js";

const emptyState = document.getElementById("emptyState");
const uploadError = document.getElementById("uploadError");

// Set once by initUpload: a finished upload renders through it.
let onStats = () => {};

function uploadErrorMessage(error) {
  if (error?.message === "No parseable WhatsApp messages found in this file.") {
    return "No readable WhatsApp messages were found. Please make sure you selected a chat export in .txt format.";
  }
  return error?.message || "The selected file could not be read.";
}

// Mirror the dashboard layout while an upload is in progress.
// Built from the dashboard's own cards and grids rather than a set of plain
// boxes: the placeholders then inherit the real paddings, gaps and type
// metrics, so every block sits where its data is about to land.
function buildSkeleton() {
  const bar = (w, h) => `<span class="sk-b" style="width:${w};height:${h}"></span>`;
  const fill = '<span class="sk-b sk-fill"></span>';
  const kpi = `
    <div class="card kpi">
      <div class="kpi-head"><span class="kpi-ic sk-b"></span>${bar("104px", "12px")}</div>
      <div class="kpi-value">${bar("128px", "26px")}</div>
      <div class="kpi-delta">${bar("88px", "10px")}</div>
      <div class="spark-wrap">${fill}</div>
    </div>`;
  // 26px matches the emoji cell that sets a real row's height.
  const rankItem = `
    <div class="rank-item">${bar("26px", "26px")}
      <span class="rank-bar-wrap"></span>${bar("40px", "11px")}</div>`;
  const rank = `
    <div class="card rank-card">
      <div class="card-head">${bar("120px", "14px")}</div>
      <div class="rank-list">${rankItem.repeat(5)}</div>
    </div>`;
  const insight = `
    <div class="card insight">
      <div class="insight-top"><span class="insight-ic sk-b"></span>${bar("90px", "10px")}</div>
      <div class="insight-value">${bar("110px", "20px")}</div>
      <div class="insight-sub">${bar("130px", "11px")}</div>
    </div>`;

  document.getElementById("skeleton").innerHTML = `
    <section class="kpi-grid">${kpi.repeat(4)}</section>
    <section class="chart-row">
      <div class="card chart-card">
        <div class="card-head">${bar("150px", "14px")}</div>
        <div class="chart-wrap">${fill}</div>
      </div>
      <div class="card heat-card">
        <div class="card-head">${bar("140px", "14px")}</div>
        <div class="heatmap">${fill}</div>
        <div class="heat-legend">${bar("120px", "10px")}</div>
      </div>
    </section>
    <section class="insight-row">${rank.repeat(3)}</section>
    <section class="card balance-card">
      <div class="card-head">${bar("130px", "14px")}</div>
      <div class="balance-bar">${fill}</div>
      <div class="balance-legend">${bar("120px", "12px")}${bar("100px", "12px")}</div>
    </section>
    <section class="insights-grid">${insight.repeat(3)}</section>`;
}

// A 25 MB export takes seconds to parse, but a request that never returns must
// not leave the skeleton spinning with no way back to the picker.
const UPLOAD_TIMEOUT_MS = 180000;
// One upload at a time: picking a second file mid-upload abandons the first.
let uploadController = null;

async function uploadFile(file) {
  uploadError.textContent = "";
  if (uploadController) uploadController.abort();
  uploadController = new AbortController();
  const controller = uploadController;
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  // Swapping chats from Settings returns to the empty state, so the skeleton
  // and any error land where the user can actually see them.
  closeSettings();
  // The same skeleton a filter shows, so both waits look alike.
  showSkeleton();
  const fd = new FormData();
  fd.append("file", file);
  try {
    const res = await fetch("/api/upload", {
      method: "POST", body: fd, signal: controller.signal,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Upload failed");
    clearRecapCache();        // a different chat means a different recap
    state.activePreset = state.pendingPreset = "all"; // a fresh upload starts at full span
    state.activeSender = "";    // and with no participant filter
    onStats(data.stats, { resetAssistant: true });
  } catch (err) {
    // Superseded by a newer pick: that upload owns the UI now, so this one
    // must not clear its skeleton or raise a dialog over it.
    if (err.name === "AbortError" && controller !== uploadController) return;
    showErrorModal(err.name === "AbortError"
      ? "This file took too long to read. Try a smaller export."
      : uploadErrorMessage(err));
  } finally {
    clearTimeout(timer);
    // On success render() reveals the dashboard; on failure the drop zone has
    // to come back so another file can be picked.
    if (controller === uploadController) {
      uploadController = null;
      showDropZone();
    }
  }
}

/** Mirrors whatever the server already holds for this session, if anything. */
export async function loadStats() {
  try {
    const res = await fetch("/api/stats");
    const data = await res.json();
    if (!data.loaded) return;
    // The server holds the last filter it applied; mirror it on reload.
    state.activeSender = data.stats.meta.active_sender || "";
    onStats(data.stats, { resetAssistant: false });
  } catch (_) { /* silent on initial load */ }
}

export function initUpload(opts) {
  onStats = opts.onStats;
  buildSkeleton();
  initErrorModal();

  // fileInput2 is the empty state's picker; fileInput is Settings → Change chat.
  ["fileInput", "fileInput2"].forEach((id) => {
    document.getElementById(id).addEventListener("change", (e) => {
      if (e.target.files[0]) uploadFile(e.target.files[0]);
      e.target.value = ""; // re-picking the same file must fire change again
    });
  });

  // Drag & drop onto the empty state
  ["dragover", "dragenter"].forEach((evt) =>
    emptyState.addEventListener(evt, (e) => { e.preventDefault(); emptyState.classList.add("drag"); })
  );
  ["dragleave", "drop"].forEach((evt) =>
    emptyState.addEventListener(evt, (e) => { e.preventDefault(); emptyState.classList.remove("drag"); })
  );
  emptyState.addEventListener("drop", (e) => {
    const f = e.dataTransfer.files[0];
    if (f) uploadFile(f);
  });

  // Ignore label/input clicks so the drop zone opens only one picker.
  emptyState.addEventListener("click", (e) => {
    if (emptyState.classList.contains("loading")) return;
    if (e.target.closest("label, input")) return;
    document.getElementById("fileInput2").click();
  });
}
