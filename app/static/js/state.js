/* Dashboard state shared across modules.
   One mutable object rather than exported `let`s: an imported binding cannot
   be reassigned by the importing module, and every field here is written in
   one place and read in several. */
export const state = {
  // Last stats payload the server returned. Null means no chat is loaded.
  stats: null,

  // ---- Filters ----
  // The date range and the participant filter are applied together on every
  // call, so changing one never silently drops the other.
  activeSender: "",
  // `activePreset` is applied; `pendingPreset` is only staged in the picker.
  activePreset: "all",
  pendingPreset: "all",

  // ---- Line chart ----
  lineGrain: "monthly",
  // A user-selected grain survives a re-render but resets when the range moves.
  grainPinned: false,
  lastRangeKey: null,

  // ---- Ranked list pages ----
  emojiPage: 0,
  kwPage: 0,
  mediaPage: 0,
};
