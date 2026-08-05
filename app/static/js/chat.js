/* AI Assistant chat panel: suggested prompts + Groq-backed conversation + quota. */
import { syncSheetLock, onKeyStateChange, onModelChange, ensureLocalModels } from "./panels.js";
import { bindPopover, onEscape } from "./popover.js";
import { escapeHtml } from "./util.js";

// Dashboard actions call this after changing the statistics scope. It is a
// no-op until the chat panel has been initialized.
let resetChatPanel = () => {};
export function resetChat() {
  resetChatPanel();
}

export function initChat() {
  const scroll = document.getElementById("chatScroll");
  const input = document.getElementById("chatInput");
  const sendBtn = document.getElementById("sendBtn");
  const inputWrap = document.getElementById("chatInputWrap");
  const keyNotice = document.getElementById("keyNotice");
  const modeToggle = document.getElementById("modeToggle");
  const modeLabel = document.getElementById("modeLabel");
  const cloudMode = document.getElementById("cloudMode");
  const localMode = document.getElementById("localMode");
  const modeMenu = document.getElementById("modeMenu");
  const localMessageControl = document.getElementById("localMessageControl");
  const localAnalysisStatus = document.getElementById("localAnalysisStatus");
  const localAnalysisToggle = document.getElementById("localAnalysisToggle");
  const localConsentModal = document.getElementById("localConsentModal");
  const localConsentCancel = document.getElementById("localConsentCancel");
  const localConsentConfirm = document.getElementById("localConsentConfirm");
  const localConsentError = document.getElementById("localConsentError");
  let busy = false;
  // Whether Cloud mode has a key to use. Owned by the Settings panel, which
  // pushes changes here; null until the first report arrives.
  let cloudKeyReady = null;
  let activeController = null;
  let resetVersion = 0;
  let mode = "cloud";
  let localEnabled = false;

  const ICONS = window.ICONS || {};
  const MAX_INPUT_H = 120;
  // Comfortably past each side's own server timeout, so the server's specific
  // message wins whenever it manages to produce one.
  const CLOUD_TIMEOUT_MS = 45000;
  const LOCAL_TIMEOUT_MS = 120000;
  const WELCOME = "Upload a WhatsApp export to explore your chat statistics. I can help you understand activity, participants, timing, keywords, and emojis.";
  const LOCAL_WELCOME = "Explore your chat statistics privately on this computer. I can help you understand activity, participants, timing, keywords, and emojis. Turn on Message analysis from the Local menu whenever you want to include message text.";

  document.querySelectorAll(".suggest-btn").forEach((btn) =>
    btn.addEventListener("click", () => send(btn.dataset.prompt, "English"))
  );

  // The right rail reopens the assistant when it starts collapsed.
  const app = document.querySelector(".app");
  const aiCollapse = document.getElementById("aiCollapse");
  const aiReopen = document.getElementById("aiReopen");
  const chatClear = document.getElementById("chatClear");
  const clearConversationModal = document.getElementById("clearConversationModal");
  const clearConversationCancel = document.getElementById("clearConversationCancel");
  const clearConversationConfirm = document.getElementById("clearConversationConfirm");
  function setAiHidden(hidden) {
    app.classList.toggle("ai-hidden", hidden);
    // Below 1024px this panel is a full-screen sheet; the page behind it has to
    // stop scrolling. Shared with the settings panel (see dashboard.js).
    syncSheetLock();
  }
  if (aiCollapse) aiCollapse.addEventListener("click", () => setAiHidden(true));
  if (aiReopen) aiReopen.addEventListener("click", () => setAiHidden(false));

  // Collapse / expand the Suggested Prompts section to give the chat more room.
  const suggested = document.getElementById("suggested");
  const suggestToggle = document.getElementById("suggestToggle");
  if (suggestToggle) {
    suggestToggle.addEventListener("click", () => {
      const collapsed = suggested.classList.toggle("collapsed");
      suggestToggle.setAttribute("aria-expanded", String(!collapsed));
    });
  }
  sendBtn.addEventListener("click", () => send(input.value));
  input.addEventListener("keydown", (e) => {
    // Enter sends; Shift+Enter inserts a newline.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input.value);
    }
  });
  input.addEventListener("input", autoGrow);

  function autoGrow() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, MAX_INPUT_H) + "px";
  }
  function resetInputHeight() {
    input.style.height = "auto";
  }

  // ---- Minimal markdown -> HTML (CSP-safe, no external lib) ----
  // Only the subset the model emits: headings, bold/italic/code, lists, paragraphs.
  function inlineMd(s) {
    // Operates on already-escaped text.
    return s
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  }
  function renderMarkdown(raw) {
    const lines = escapeHtml(raw).replace(/\r\n?/g, "\n").split("\n");
    const html = [];
    let list = null; // "ul" | "ol" | null
    const closeList = () => { if (list) { html.push("</" + list + ">"); list = null; } };
    let para = [];
    const flushPara = () => {
      if (para.length) { html.push("<p>" + inlineMd(para.join(" ")) + "</p>"); para = []; }
    };

    for (const line of lines) {
      const t = line.trim();
      if (!t) { flushPara(); closeList(); continue; }
      let m;
      if ((m = t.match(/^(#{1,6})\s+(.*)$/))) {
        flushPara(); closeList();
        const level = Math.min(m[1].length + 2, 4); // # -> h3, ## -> h4 (capped)
        html.push("<h" + level + ">" + inlineMd(m[2]) + "</h" + level + ">");
      } else if ((m = t.match(/^[-*]\s+(.*)$/))) {
        flushPara();
        if (list !== "ul") { closeList(); html.push("<ul>"); list = "ul"; }
        html.push("<li>" + inlineMd(m[1]) + "</li>");
      } else if ((m = t.match(/^\d+[.)]\s+(.*)$/))) {
        flushPara();
        if (list !== "ol") { closeList(); html.push("<ol>"); list = "ol"; }
        html.push("<li>" + inlineMd(m[1]) + "</li>");
      } else {
        closeList();
        para.push(t);
      }
    }
    flushPara(); closeList();
    return html.join("");
  }

  /* Local mode always works; Cloud mode needs a key. A missing key is the only
     thing that stands between the user and the input. */
  function renderUsage() {
    const isLocal = mode === "local";
    renderLocalControls();
    // Only lock Cloud once the key state is actually known, so a slow status
    // check does not briefly disable a perfectly usable input.
    const blocked = !isLocal && cloudKeyReady === false;
    keyNotice.classList.toggle("hidden", !blocked);
    inputWrap.classList.toggle("disabled", blocked);
    input.disabled = blocked;
    sendBtn.disabled = blocked || busy;
    input.placeholder = blocked ? "Add a Groq API key in Settings" : "Ask anything...";
  }

  onKeyStateChange((configured) => {
    cloudKeyReady = configured;
    renderUsage();
  });

  function addMessage(role, text, isError) {
    const el = document.createElement("div");
    el.className = "msg " + (role === "user" ? "user" : "ai") + (isError ? " error" : "");
    el.innerHTML = `<div class="bubble"></div>`;
    el.querySelector(".bubble").textContent = text;
    scroll.appendChild(el);
    scroll.scrollTop = scroll.scrollHeight;
    return el;
  }

  // A successful AI reply: rendered as markdown + a copy button.
  function addAiReply(text) {
    const el = document.createElement("div");
    el.className = "msg ai";
    el.innerHTML =
      `<div class="bubble md"></div>` +
      `<button class="copy-btn" type="button" aria-label="Copy reply">${ICONS.copy || ""}</button>`;
    el.querySelector(".bubble").innerHTML = renderMarkdown(text);

    const copyBtn = el.querySelector(".copy-btn");
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(text); // raw markdown text, not HTML
        copyBtn.innerHTML = ICONS.check || "";
        copyBtn.classList.add("copied");
        setTimeout(() => {
          copyBtn.innerHTML = ICONS.copy || "";
          copyBtn.classList.remove("copied");
        }, 1500);
      } catch (_) { /* clipboard unavailable — ignore */ }
    });

    scroll.appendChild(el);
    scroll.scrollTop = scroll.scrollHeight;
    return el;
  }

  function resetConversation() {
    resetVersion += 1;
    if (activeController) activeController.abort();
    activeController = null;
    busy = false;
    input.value = "";
    resetInputHeight();
    scroll.replaceChildren();
    addMessage("assistant", mode === "local" ? LOCAL_WELCOME : WELCOME);
    // renderUsage owns the input's enabled state; it is the only thing that
    // knows whether Cloud mode currently has a key.
    renderUsage();
  }
  // A new upload or dashboard filter changes the text scope. Require fresh
  // consent before that new scope can be shared with the local model.
  resetChatPanel = () => {
    localEnabled = false;
    resetConversation();
  };

  async function clearConversation() {
    chatClear.disabled = true;
    clearConversationCancel.disabled = true;
    clearConversationConfirm.disabled = true;
    try {
      const res = await fetch("/api/chat/reset", { method: "POST" });
      if (!res.ok) throw new Error("Could not clear the conversation.");
      localEnabled = false;
      closeClearConversationModal();
      resetConversation();
    } catch (err) {
      closeClearConversationModal();
      addMessage("assistant", err.message || "Could not clear the conversation.", true);
    } finally {
      chatClear.disabled = false;
      clearConversationCancel.disabled = false;
      clearConversationConfirm.disabled = false;
    }
  }

  function openClearConversationModal() {
    clearConversationModal.hidden = false;
    clearConversationCancel.focus();
  }

  function closeClearConversationModal() {
    clearConversationModal.hidden = true;
  }

  if (chatClear) chatClear.addEventListener("click", openClearConversationModal);
  clearConversationCancel.addEventListener("click", closeClearConversationModal);
  clearConversationConfirm.addEventListener("click", clearConversation);
  clearConversationModal.addEventListener("click", (event) => {
    if (event.target === clearConversationModal) closeClearConversationModal();
  });
  onEscape(() => {
    if (clearConversationModal.hidden) return;
    closeClearConversationModal();
    return true;
  });

  function updateModeButtons() {
    const isLocal = mode === "local";
    cloudMode.classList.toggle("active", !isLocal);
    localMode.classList.toggle("active", isLocal);
    const selectedLabel = isLocal ? "Local" : "Cloud";
    modeToggle.setAttribute("aria-label", `AI processing mode: ${selectedLabel}`);
    modeToggle.title = `Current mode: ${selectedLabel}. Choose processing mode.`;
    modeToggle.querySelector("span").innerHTML = ICONS[isLocal ? "monitor" : "cloud"] || "";
    modeLabel.textContent = selectedLabel;
    renderLocalControls();
  }

  // Settings owns the pickers and resolves each provider's model on its own.
  // The menu only reports the answer, in the info popovers.
  const modelInfoNames = {
    cloud: document.getElementById("cloudModelInfoName"),
    local: document.getElementById("localModelInfoName"),
  };
  onModelChange((which, model) => {
    modelInfoNames[which].textContent = model || "—";
  });

  function renderLocalControls() {
    const isLocal = mode === "local";
    localMessageControl.hidden = !isLocal;
    localAnalysisStatus.textContent = localEnabled ? "On — includes selected message text" : "Off — statistics only";
    localAnalysisToggle.setAttribute("aria-checked", String(localEnabled));
    localAnalysisToggle.setAttribute("aria-label", `${localEnabled ? "Disable" : "Enable"} message analysis`);
  }

  function openLocalConsent() {
    localConsentError.hidden = true;
    localConsentError.textContent = "";
    localConsentModal.hidden = false;
    localConsentCancel.focus();
  }

  function closeLocalConsent() {
    localConsentModal.hidden = true;
  }

  async function selectMode(nextMode) {
    if (mode === nextMode) return;
    mode = nextMode;
    localStorage.setItem("wpa.mode", mode);
    if (mode === "local") ensureLocalModels();
    localEnabled = false;
    updateModeButtons();
    // Changing privacy modes starts a genuinely fresh conversation. The API
    // clears both isolated server transcripts and revokes local raw-text
    // consent, so an old context cannot survive a mode change.
    try {
      const res = await fetch("/api/chat/reset", { method: "POST" });
      if (!res.ok) throw new Error("Could not reset the conversation.");
    } catch (err) {
      addMessage("assistant", err.message || "Could not reset the conversation.", true);
      return;
    }
    resetConversation();
  }
  bindPopover(modeToggle, modeMenu);
  if (cloudMode) cloudMode.addEventListener("click", () => selectMode("cloud"));
  if (localMode) localMode.addEventListener("click", () => selectMode("local"));
  document.querySelectorAll(".model-info-trigger").forEach((trigger) => {
    const info = document.getElementById(trigger.getAttribute("aria-controls"));
    trigger.addEventListener("click", () => {
      const opening = info.hidden;
      document.querySelectorAll(".model-info-pop").forEach((pop) => { pop.hidden = true; });
      document.querySelectorAll(".model-info-trigger").forEach((button) => { button.setAttribute("aria-expanded", "false"); });
      info.hidden = !opening;
      trigger.setAttribute("aria-expanded", String(opening));
    });
  });
  localAnalysisToggle.addEventListener("click", async () => {
    if (!localEnabled) {
      openLocalConsent();
      return;
    }
    localAnalysisToggle.disabled = true;
    try {
      const res = await fetch("/api/chat/local/disable", { method: "POST" });
      if (!res.ok) throw new Error("Could not turn off message analysis.");
      localEnabled = false;
      resetConversation();
    } catch (err) {
      addMessage("assistant", err.message || "Could not turn off message analysis.", true);
    } finally {
      localAnalysisToggle.disabled = false;
      renderLocalControls();
    }
  });
  localConsentCancel.addEventListener("click", closeLocalConsent);
  localConsentModal.addEventListener("click", (event) => {
    if (event.target === localConsentModal) closeLocalConsent();
  });
  localConsentConfirm.addEventListener("click", async () => {
    localConsentConfirm.disabled = true;
    localConsentCancel.disabled = true;
    localConsentError.hidden = true;
    try {
      const res = await fetch("/api/chat/local/enable", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Local model is unavailable.");
      localEnabled = true;
      closeLocalConsent();
      addMessage("assistant", "Local analysis is enabled. Your messages will stay on this computer and Cloud quota will not be used.");
      renderUsage();
      input.focus();
    } catch (err) {
      localConsentError.textContent = err.message || "Local model is unavailable.";
      localConsentError.hidden = false;
    } finally {
      localConsentConfirm.disabled = false;
      localConsentCancel.disabled = false;
    }
  });

  async function send(text, responseLanguage = null) {
    text = (text || "").trim();
    if (!text || busy) return;
    if (mode === "cloud" && cloudKeyReady === false) { renderUsage(); return; }
    const requestVersion = resetVersion;
    const controller = new AbortController();
    activeController = controller;
    // A local model runs on this machine and can take a long time on a slow
    // one, but "Thinking…" must not sit there forever if it never answers.
    const timeout = mode === "local" ? LOCAL_TIMEOUT_MS : CLOUD_TIMEOUT_MS;
    const timer = setTimeout(() => controller.abort(), timeout);
    busy = true;
    sendBtn.disabled = true;
    input.value = "";
    resetInputHeight();

    addMessage("user", text);

    const typing = addMessage("ai", "");
    const typingBubble = typing.querySelector(".bubble");
    typingBubble.classList.add("typing");
    typingBubble.innerHTML = "<span class=\"typing-label\">Thinking...</span><span class=\"typing-dots\"><span></span><span></span><span></span></span>";

    try {
      const res = await fetch(mode === "local" ? "/api/chat/local" : "/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, response_language: responseLanguage }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (requestVersion !== resetVersion) return;
      typing.remove();
      if (mode === "cloud" && res.status === 429) {
        // Burst limit — temporary, so the input stays open; just ask to wait.
        addMessage("ai", data.error || "Too many requests. Please wait a moment.", true);
      } else if (!res.ok) {
        addMessage("ai", data.error || "Something went wrong.", true);
        // The server key was missing or Groq refused it. Point the user at the
        // one place they can fix that, and lock the input until they do.
        if (data.reason === "not_configured" || data.reason === "invalid_key") {
          cloudKeyReady = false;
        }
      } else {
        addAiReply(data.reply);
      }
    } catch (err) {
      if (requestVersion !== resetVersion) return;
      typing.remove();
      // A reset aborted this deliberately; only a timeout needs reporting.
      if (err.name === "AbortError" && controller !== activeController) return;
      addMessage("ai", err.name === "AbortError"
        ? `No answer after ${Math.round(timeout / 1000)} seconds. `
          + (mode === "local" ? "Try a smaller local model." : "Please try again.")
        : "Could not reach the server.", true);
    } finally {
      clearTimeout(timer);
      if (requestVersion !== resetVersion) return;
      busy = false;
      activeController = null;
      renderUsage();
      if (!input.disabled) input.focus();
    }
  }

  // Restore the last chosen mode, so a page reload does not silently drop
  // someone back into Cloud after they deliberately picked Local.
  if (localStorage.getItem("wpa.mode") === "local") mode = "local";
  // Whoever is in Local mode is the one the local model list is for, so this
  // is where looking for a local server earns its console noise.
  if (mode === "local") ensureLocalModels();
  updateModeButtons();
  addMessage("assistant", mode === "local" ? LOCAL_WELCOME : WELCOME);
  renderUsage();
}
