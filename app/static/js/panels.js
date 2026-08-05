/* Settings panel, the API-key field, the mobile sheet lock, and the
   delete-chat dialog. */
import { closeAllPops, onEscape } from "./popover.js";

const app = document.querySelector(".app");
const railSettingsBtn = document.getElementById("railSettingsBtn");
const deleteModal = document.getElementById("deleteModal");

const keyField = document.getElementById("keyField");
const keyInput = document.getElementById("groqKeyInput");
const keySave = document.getElementById("groqKeySave");
const keyRemove = document.getElementById("groqKeyRemove");
const keyChange = document.getElementById("groqKeyChange");
const keyStatus = document.getElementById("keyStatus");
const keyError = document.getElementById("keyError");
const keyNote = document.getElementById("keyNote");

// Notified whenever Cloud mode gains or loses a usable key, so the assistant
// can show or clear its "add a key" notice without polling.
const keyListeners = [];
export function onKeyStateChange(fn) {
  keyListeners.push(fn);
}

const STATUS_COPY = {
  session: "API key saved.",
  env: "API key saved — loaded from your .env file.",
  none: "No API key yet — Cloud mode is unavailable.",
};

// The privacy note has to stay true: a key read from .env really is on disk,
// because the user put it there.
const NOTE_COPY = {
  session: "Your key stays on this computer and is never written to disk.",
  env: "This key comes from your .env file. Edit that file to change it permanently.",
  none: "Your key stays on this computer and is never written to disk.",
};

// The last state the server reported, so a failed save can restore the status
// line without collapsing the field the user is still typing into.
let lastSource = null;

function applyKeyState({ configured, source }) {
  lastSource = source;
  keyStatus.textContent = STATUS_COPY[source || "none"];
  keyNote.textContent = NOTE_COPY[source || "none"];
  // Configured is configured, whether the key was pasted here or read from
  // .env at startup: either way there is nothing to type, so the field and its
  // Save button collapse rather than sitting there empty.
  keyField.hidden = configured;
  keySave.hidden = configured;
  // Only a key this session saved can be taken back — a key in .env is the
  // file's to change, not this panel's. Overriding it is offered instead.
  keyRemove.hidden = source !== "session";
  keyChange.hidden = source !== "env";
  keyListeners.forEach((fn) => fn(Boolean(configured)));
  // A different key can serve a different set of models, so the Cloud list is
  // rebuilt whenever the key changes rather than only on the first load.
  if (configured) cloudPicker.load();
}

/* ---- Model pickers -------------------------------------------------------
   Each provider is asked what it actually serves, so the right model is
   resolved without anyone typing an id: Groq renames and retires models, and a
   local server only has whatever is loaded right now. One implementation for
   both, since the only differences are the two URLs and the summary line.
   These live in Settings rather than in the assistant menu because the
   automatic answer is right almost always; this is the override, not the
   normal path. The assistant only reports the outcome. */
const PROVIDER_NAMES = { lmstudio: "LM Studio", ollama: "Ollama" };

const modelListeners = [];
export function onModelChange(fn) {
  modelListeners.push(fn);
}

function createModelPicker({ which, listUrl, selectUrl, checking, summary }) {
  const control = document.getElementById(`${which}ModelControl`);
  const select = document.getElementById(`${which}ModelSelect`);
  const status = document.getElementById(`${which}ModelStatus`);
  const retry = document.getElementById(`${which}ModelRetry`);
  const announce = (model) => modelListeners.forEach((fn) => fn(which, model));

  async function load() {
    select.hidden = true;
    retry.hidden = true;
    control.classList.remove("no-model");
    status.textContent = checking;
    status.hidden = false;
    try {
      const res = await fetch(listUrl);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No models available.");
      select.replaceChildren(...data.models.map((id) => {
        const option = document.createElement("option");
        option.value = option.textContent = id;
        option.selected = id === data.selected;
        return option;
      }));
      select.hidden = false;
      // Cloud has nothing worth saying once the dropdown is populated: the
      // provider is always Groq and the model is right there. Local does, so
      // an empty summary collapses the line rather than leaving a gap.
      status.textContent = summary(data);
      status.hidden = !status.textContent;
      announce(data.selected);
    } catch (err) {
      // An empty dropdown beside a line of instructions is clutter. The message
      // takes the full width and the retry replaces the control.
      select.replaceChildren();
      control.classList.add("no-model");
      status.textContent = err.message;
      retry.hidden = false;
      announce(null);
    }
  }

  retry.addEventListener("click", load);
  select.addEventListener("change", async () => {
    const model = select.value;
    try {
      const res = await fetch(selectUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not select that model.");
      announce(model);
    } catch (err) {
      status.textContent = err.message || "Could not select that model.";
      load();   // the list is evidently stale, so rebuild it
    }
  });

  return { load };
}

const cloudPicker = createModelPicker({
  which: "cloud",
  listUrl: "/api/chat/cloud/models",
  selectUrl: "/api/chat/cloud/model",
  checking: "Checking with Groq…",
  summary: () => "",
});

const localPicker = createModelPicker({
  which: "local",
  listUrl: "/api/chat/local/models",
  selectUrl: "/api/chat/local/model",
  checking: "Looking for a local server…",
  summary: (data) =>
    `${PROVIDER_NAMES[data.provider] || data.provider} · ${data.models.length} loaded`,
});

/** Reveals the field so an .env key can be overridden for this session. */
function revealKeyField() {
  keyField.hidden = false;
  keySave.hidden = false;
  keyChange.hidden = true;
  keyInput.focus();
}

function showKeyError(message) {
  keyError.textContent = message;
  keyError.hidden = false;
}

async function loadKeyState() {
  try {
    const res = await fetch("/api/settings/groq-key");
    applyKeyState(await res.json());
  } catch (_) {
    keyStatus.textContent = "Could not check the API key.";
  }
}

async function saveKey() {
  const key = keyInput.value.trim();
  keyError.hidden = true;
  if (!key) { showKeyError("Enter an API key."); return; }

  keySave.disabled = keyRemove.disabled = true;
  keyStatus.textContent = "Checking the key with Groq…";
  try {
    const res = await fetch("/api/settings/groq-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not save this key.");
    // Clear the field on success only: a rejected key stays put so a small
    // typo can be corrected rather than retyped.
    keyInput.value = "";
    applyKeyState(data);
  } catch (err) {
    showKeyError(err.message || "Could not save this key.");
    // Restore the status line only. Re-running applyKeyState here would
    // collapse the field mid-correction when a key from .env is being
    // overridden, taking the rejected text with it.
    keyStatus.textContent = STATUS_COPY[lastSource || "none"];
  } finally {
    keySave.disabled = keyRemove.disabled = false;
  }
}

async function removeKey() {
  keyError.hidden = true;
  keySave.disabled = keyRemove.disabled = true;
  try {
    const res = await fetch("/api/settings/groq-key", { method: "DELETE" });
    if (!res.ok) throw new Error("Could not remove the key.");
    applyKeyState(await res.json());
    // The field is back; removing a key is almost always a prelude to
    // entering a different one.
    keyInput.focus();
  } catch (err) {
    showKeyError(err.message || "Could not remove the key.");
  } finally {
    keySave.disabled = keyRemove.disabled = false;
  }
}

// Below 1024px both panels are full-screen sheets, so an open one has to stop
// the page behind it from scrolling. The state lives on .app, which the
// assistant toggles too, so the flag is derived rather than counted.
export function syncSheetLock() {
  const open = !app.classList.contains("ai-hidden") ||
    app.classList.contains("settings-open");
  document.body.classList.toggle("sheet-open", open);
}

// Closing settings hands the right column back, and with the assistant
// collapsed that column animates shut. The assistant would otherwise be
// mounted again the instant the class drops and sit there in full view for
// the length of the animation, so it stays out until the panel is gone.
// Matches the .34s grid transition on .app, with a little slack.
const SETTINGS_CLOSE_MS = 380;
let settingsCloseTimer = null;

function endSettingsClose() {
  clearTimeout(settingsCloseTimer);
  settingsCloseTimer = null;
  app.classList.remove("settings-closing");
}

function openSettings() {
  closeAllPops();
  endSettingsClose(); // re-opened mid-animation: drop the closing state
  app.classList.add("settings-open");
  railSettingsBtn.setAttribute("aria-expanded", "true");
  syncSheetLock();
  ensureLocalModels();
}

// The local picker is built on first sight, not on page load. Once is enough:
// the Retry button beside it reloads deliberately, and a server started later
// is exactly what that button is for.
let localModelsRequested = false;
export function ensureLocalModels() {
  if (localModelsRequested) return;
  localModelsRequested = true;
  localPicker.load();
}

export function closeSettings() {
  // Only the collapsed case animates; with the assistant open the column
  // keeps its width and the two panels swap straight over.
  if (app.classList.contains("settings-open") && app.classList.contains("ai-hidden")) {
    app.classList.add("settings-closing");
    clearTimeout(settingsCloseTimer);
    settingsCloseTimer = setTimeout(endSettingsClose, SETTINGS_CLOSE_MS);
  }
  app.classList.remove("settings-open");
  railSettingsBtn.setAttribute("aria-expanded", "false");
  syncSheetLock();
}

function openDeleteModal(open) {
  deleteModal.hidden = !open;
  if (open) document.getElementById("deleteCancel").focus();
}

/**
 * Wires the settings panel and its delete dialog.
 * `onDelete` clears the dashboard once the server has dropped the chat.
 */
export function initPanels({ onDelete }) {
  railSettingsBtn.addEventListener("click", () => {
    app.classList.contains("settings-open") ? closeSettings() : openSettings();
  });
  document.getElementById("settingsClose").addEventListener("click", closeSettings);

  keySave.addEventListener("click", saveKey);
  keyRemove.addEventListener("click", removeKey);
  keyChange.addEventListener("click", revealKeyField);
  keyField.addEventListener("submit", (e) => {
    e.preventDefault();
    saveKey();
  });
  // Cloud's list waits for the key state. The local list waits for someone to
  // care: probing two loopback ports on every page load answers a question
  // nobody asked yet, and fails loudly in the console when no local server is
  // running, which is the normal case for a Cloud user.
  loadKeyState();

  // Escape order matters here, and it is registration order: handlers run
  // last-registered first. This one goes in before every menu and dialog, so
  // the panel is the last thing Escape reaches.
  onEscape(() => {
    closeAllPops();
    closeSettings();
  });

  // Deletion waits for explicit confirmation.
  document.getElementById("clearDataBtn").addEventListener("click", () => openDeleteModal(true));
  document.getElementById("deleteCancel").addEventListener("click", () => openDeleteModal(false));
  // Clicking the dimmed area outside the card dismisses it, like the popovers.
  deleteModal.addEventListener("click", (e) => {
    if (e.target === deleteModal) openDeleteModal(false);
  });

  document.getElementById("deleteConfirm").addEventListener("click", async () => {
    try {
      await fetch("/api/reset", { method: "POST" });
    } catch (_) { /* still clear the UI */ }
    openDeleteModal(false);
    onDelete();
    closeSettings();
  });
}

/* Registered by the orchestrator after every other layer, so it answers
   Escape first. It is the only handler that consumes the key: a modal dialog
   must not close the panel behind it as well. */
export function bindDeleteModalEscape() {
  onEscape(() => {
    if (deleteModal.hidden) return false;
    openDeleteModal(false);
    return true;
  });
}
