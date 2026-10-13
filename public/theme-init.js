(() => {
  const key = "whatsapp-analytics-theme";
  let mode = "auto";
  try {
    const stored = localStorage.getItem(key);
    if (stored === "light" || stored === "dark" || stored === "auto") mode = stored;
  } catch {
    // Storage is optional.
  }
  const dark = mode === "dark" || (mode === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  const resolved = dark ? "dark" : "light";
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themeMode = mode;
  document.documentElement.style.colorScheme = resolved;
})();
