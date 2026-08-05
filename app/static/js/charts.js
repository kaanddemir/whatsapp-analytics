/* Chart.js sparklines, the messages-over-time line, and the heatmap. */
import { state } from "./state.js";
import { onEscape } from "./popover.js";
import { hourLabel } from "./util.js";

const GREEN = "#25d366";
const GREEN_700 = "#128c7e";
const HEAT = ["#f1f5f3", "#d6f0e0", "#a7e3c0", "#6fd39c", "#34bd74", "#12924f"];
// Dense series use an unsmoothed line without markers.
const DENSE_POINTS = 60;

// Live Chart.js instances, kept so a re-render can destroy the old canvas.
const charts = {};

// Chart.js is a plain <script> global. Reading it at import time would make a
// missing library an uncaught ReferenceError inside a module, which aborts
// main.js and takes upload, the ranked lists and Recap down with the charts.
// Everything that needs it goes through this instead.
const hasChart = () => typeof Chart !== "undefined";
const UNAVAILABLE = "Charts are unavailable.";

const grainBtn = document.getElementById("grainBtn");
const grainPop = document.getElementById("grainPop");

function openGrainMenu(open) {
  grainPop.hidden = !open;
  grainBtn.setAttribute("aria-expanded", open);
}

function setGrain(grain) {
  state.lineGrain = grain;
  document.querySelectorAll(".grain-opt").forEach((b) =>
    b.classList.toggle("active", b.dataset.range === grain));
}

// Each option carries its point count for the current range, so a grain that
// will read poorly says so before it is picked rather than after.
function labelGrains(stats) {
  const series = stats.messages_over_time;
  document.querySelectorAll(".grain-opt").forEach((b) => {
    const n = (series[b.dataset.range].values || []).length;
    b.querySelector(".meta").textContent = n.toLocaleString() + " pts";
    b.classList.toggle("dense", n > DENSE_POINTS);
  });
}

export function initCharts() {
  if (hasChart()) {
    Chart.defaults.font.family =
      'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    Chart.defaults.color = "#8a938d";
    Chart.defaults.font.size = 11;
  }

  grainBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openGrainMenu(grainPop.hidden);
  });

  grainPop.addEventListener("click", (e) => {
    const opt = e.target.closest(".grain-opt");
    if (!opt) return;
    state.grainPinned = true;
    setGrain(opt.dataset.range);
    openGrainMenu(false);
    if (state.stats) renderLine(state.stats.messages_over_time);
  });

  document.addEventListener("click", (e) => {
    if (!grainPop.hidden && !e.target.closest("#grainMenu")) openGrainMenu(false);
  });
  // Does not consume Escape: closing the menu and the popovers beneath it in
  // one press is the behaviour this has always had.
  onEscape(() => {
    if (grainPop.hidden) return;
    openGrainMenu(false);
    grainBtn.focus();
  });
}

/**
 * Picks the grain for a fresh payload. A new date range drops a pinned grain;
 * re-rendering the same range (participant filter, reload) keeps whatever the
 * user picked.
 */
export function syncGrain(stats) {
  const rangeKey = stats.meta.range_iso.start + "|" + stats.meta.range_iso.end;
  if (rangeKey !== state.lastRangeKey) {
    state.lastRangeKey = rangeKey;
    state.grainPinned = false;
  }
  setGrain(state.grainPinned ? state.lineGrain : stats.messages_over_time.grain);
  labelGrains(stats);
}

// Charts must be destroyed or Chart.js throws when the canvas is reused.
export function destroyCharts() {
  Object.keys(charts).forEach((id) => { charts[id].destroy(); delete charts[id]; });
}

// ---- Sparklines ----
function spark(id, data, color) {
  const el = document.getElementById(id);
  if (!el) return;
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(el, {
    type: "line",
    data: { labels: data.map((_, i) => i), datasets: [{
      data, borderColor: color, borderWidth: 2, tension: 0.4,
      pointRadius: 0, fill: false,
      // Keep the smoothing curve inside the plot area; without this the
      // bezier overshoots past a peak and gets clipped into a flat edge.
      capBezierPoints: true,
    }]},
    options: {
      responsive: true, maintainAspectRatio: false,
      // The line is drawn centred on the data point, so a min or max sitting
      // on the boundary loses half its stroke width. Pad the plot area.
      layout: { padding: { top: 3, bottom: 3, left: 2, right: 2 } },
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        x: { display: false },
        // Extra headroom above the peak and below the trough.
        y: { display: false, grace: "6%" },
      },
    },
  });
}

export function renderSparks(stats) {
  const ids = ["sparkTotal", "sparkDays", "sparkPerDay", "sparkPeak"];
  const insufficientData = !hasChart() || stats.kpis.total_messages < 2;
  ids.forEach((id) => {
    document.getElementById(id).hidden = insufficientData;
    const empty = document.getElementById(`${id}Empty`);
    empty.hidden = !insufficientData;
    if (!hasChart()) empty.textContent = UNAVAILABLE;
    if (insufficientData && charts[id]) {
      charts[id].destroy();
      delete charts[id];
    }
  });
  if (insufficientData) return;

  // Peak-hour spark uses the hourly profile; the others use monthly series.
  const fallback = [1, 2, 2, 3];
  const mv = stats.messages_over_time.monthly.values;
  const days = stats.kpis.active_days_series;
  const perDay = stats.kpis.msgs_per_day_series;
  spark("sparkTotal", mv.length ? mv : fallback, GREEN);
  spark("sparkDays", days.length ? days : fallback, GREEN);
  spark("sparkPerDay", perDay.length ? perDay : fallback, "#f6a609");
  spark("sparkPeak", stats.hours, "#8b5cf6");
}

// ---- Line chart (messages over time; grain chosen by the server) ----
export function renderLine(series, messageCount = Infinity) {
  const grain = state.lineGrain;
  const active = series[grain];
  // Density determines markers and smoothing.
  const dense = active.values.length > DENSE_POINTS;
  const partial = active.partial || [];
  const el = document.getElementById("lineChart");
  const empty = document.getElementById("lineChartEmpty");
  const grainMenu = document.getElementById("grainMenu");
  if (charts.line) charts.line.destroy();
  if (!hasChart() || messageCount < 1) {
    el.hidden = true;
    empty.textContent = hasChart() ? "Nothing to show yet." : UNAVAILABLE;
    empty.hidden = false;
    grainMenu.hidden = true;
    return;
  }
  el.hidden = false;
  empty.hidden = true;
  grainMenu.hidden = false;
  const ctx = el.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, 0, 230);
  grad.addColorStop(0, "rgba(37,211,102,0.22)");
  grad.addColorStop(1, "rgba(37,211,102,0.0)");
  charts.line = new Chart(el, {
    type: "line",
    data: { labels: active.labels, datasets: [{
      label: "Messages", data: active.values,
      borderColor: GREEN_700,
      // Markers and smoothing read well across ~30 points and turn a crowded
      // series into noise, so a dense line drops both and thins its stroke.
      borderWidth: dense ? 1.25 : 2.5,
      tension: dense ? 0 : 0.4,
      fill: true,
      backgroundColor: grad,
      pointRadius: dense ? 0 : 3, pointBackgroundColor: "#fff", pointBorderColor: GREEN_700,
      pointBorderWidth: 2,
      segment: {
        // Dash segments touching a partially covered bucket.
        borderDash: (c) =>
          partial[c.p0DataIndex] || partial[c.p1DataIndex] ? [5, 4] : undefined,
      },
    }]},
    options: {
      responsive: true, maintainAspectRatio: false,
      // A very long daily series is drawn in full. Chart.js's decimation plugin
      // would need {x,y} data on a linear axis, and these are category labels;
      // the dense settings above (no markers, no smoothing, a thin stroke) are
      // what actually keep a thousand-point line both cheap and legible.
      plugins: { legend: { display: false }, tooltip: {
        backgroundColor: "#0f1a14", padding: 10, cornerRadius: 8, displayColors: false,
        callbacks: {
          afterBody: (items) =>
            partial[items[0].dataIndex]
              ? `partial ${grain === "weekly" ? "week" : "month"}` : [],
        },
      }},
      scales: {
        x: { grid: { display: false }, border: { display: false },
             ticks: { maxTicksLimit: dense ? 8 : 12, autoSkip: true } },
        y: { beginAtZero: true, grid: { color: "#eceeed" }, border: { display: false }, ticks: { maxTicksLimit: 5 } },
      },
    },
  });
}

// ---- Heatmap (7 days x 24 hours) ----
export function renderHeatmap(matrix, messageCount = Infinity) {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const wrap = document.getElementById("heatmap");
  const legend = document.getElementById("heatLegend");
  wrap.innerHTML = "";
  if (messageCount < 1) {
    wrap.innerHTML = '<p class="chart-empty">Nothing to show yet.</p>';
    legend.hidden = true;
    return;
  }
  legend.hidden = false;

  // Rank bins keep spiky activity from flattening the heatmap.
  const sorted = matrix.flat().filter((v) => v > 0).sort((a, b) => a - b);
  const cut = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  const stops = sorted.length ? [cut(0.2), cut(0.4), cut(0.6), cut(0.8)] : [];
  const levelOf = (v) =>
    v === 0 ? 0 : 1 + stops.filter((s) => v > s).length;

  // Hour axis (every 4 hours, or every 6 on a phone where the columns are
  // narrower than a two-digit label and every 4th one would collide).
  const step = window.innerWidth < 560 ? 6 : 4;
  const axis = document.createElement("div");
  axis.className = "heat-hours";
  axis.innerHTML = "<span></span>" +
    Array.from({ length: 24 }, (_, h) => `<span>${h % step === 0 ? String(h).padStart(2, "0") : ""}</span>`).join("");
  wrap.appendChild(axis);

  matrix.forEach((row, di) => {
    const r = document.createElement("div");
    r.className = "heat-row";
    r.innerHTML = `<span class="day-label">${days[di]}</span>`;
    row.forEach((v, h) => {
      const cell = document.createElement("div");
      cell.className = "heat-cell";
      cell.style.background = HEAT[levelOf(v)];
      cell.title = `${days[di]} ${hourLabel(h)} · `
        + `${v.toLocaleString()} message${v === 1 ? "" : "s"}`;
      r.appendChild(cell);
    });
    wrap.appendChild(r);
  });
}
