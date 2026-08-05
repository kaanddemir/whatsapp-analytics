/* Small helpers shared by more than one dashboard module. */
import { onEscape } from "./popover.js";

// One palette for every per-person colour on the page, so the same participant
// reads the same colour in the balance bar, the legend and the chat info list.
export const BAL_COLORS = ["#25d366", "#128c7e", "#8b5cf6", "#f6a609", "#3b82f6", "#ec835a"];

export function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Initials from a name/label for the contact avatar.
export function initials(name) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "–";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// Every hourly metric represents the full clock bucket, including midnight
// wrapping cleanly into the next day.
export function hourRange(value) {
  const hour = typeof value === "number" ? value : Number(String(value).slice(0, 2));
  const start = String(hour).padStart(2, "0") + ":00";
  const end = String((hour + 1) % 24).padStart(2, "0") + ":00";
  return `${start}–${end}`;
}

export function hourLabel(value) {
  const hour = typeof value === "number" ? value : Number(String(value).slice(0, 2));
  return String(hour).padStart(2, "0") + ":00";
}

/* Filtering and uploading both re-parse the whole export server-side, which is
   slow on large chats. Both show the same thing while they wait: a skeleton of
   the dashboard that is about to appear. It says what is coming, and it cannot
   be mistaken for finished numbers the way a dimmed dashboard could.

   Turning it off is deliberately not one function: what belongs on screen
   afterwards depends on what happened, and only the caller knows. */
const emptyState = document.getElementById("emptyState");
const dashboard = document.getElementById("dashboard");

export function showSkeleton() {
  emptyState.classList.remove("hidden");
  emptyState.classList.add("loading");
  dashboard.classList.add("hidden");
}

/** Back to the drop zone: nothing is loaded, so there is nothing to restore. */
export function showDropZone() {
  emptyState.classList.remove("loading");
}

/** Back to the dashboard that was already there, e.g. after a failed filter. */
export function showDashboard() {
  emptyState.classList.remove("loading");
  emptyState.classList.add("hidden");
  dashboard.classList.remove("hidden");
}

/* One modal for every failure the user has to acknowledge. An inline message
   is easy to miss once the loading skeleton has pushed it below the fold, and
   a filter that silently keeps showing stale numbers is worse than one that
   says it failed. */
const errorModal = document.getElementById("uploadErrorModal");
const errorTitle = document.getElementById("uploadErrorTitle");
const errorText = document.getElementById("uploadErrorText");
const errorClose = document.getElementById("uploadErrorClose");

function closeErrorModal() {
  errorModal.hidden = true;
}

export function showErrorModal(message, { title = "Couldn’t read this chat", action = "Try another file" } = {}) {
  errorTitle.textContent = title;
  errorText.textContent = message;
  errorClose.textContent = action;
  errorModal.hidden = false;
  errorClose.focus();
}

/** Wired from initUpload so this dialog keeps its place in the Escape chain. */
export function initErrorModal() {
  errorClose.addEventListener("click", closeErrorModal);
  errorModal.addEventListener("click", (e) => {
    if (e.target === errorModal) closeErrorModal();
  });
  onEscape(() => {
    if (errorModal.hidden) return false;
    closeErrorModal();
    return true;
  });
}
