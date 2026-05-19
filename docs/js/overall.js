// Cohort-level view: configurable x-axis histogram with summary stats and
// optional slice overlays.
//
// X-axis options: yhat_pr (default), financial aid grant, test superscore,
// or distance. When x = yhat_pr, the y-axis can be % of slice / Students /
// Share of slice 1. For any other x, the y-axis is Students or mean yhat_pr.

import { applyFilterState } from "./filters.js";
import { getSlices } from "./slices.js";

let xMode = "yhat";    // "yhat" | "grant" | "superscore" | "distance"
let yMode = "percent"; // "percent" | "count" | "ratio" | "yhat_mean"
let lastRender = null; // { filtered, allRows }
let controlsBound = false;

const X_AXIS_CONFIGS = {
  yhat:       { key: "yhat_pr",                  title: "Predicted enrollment probability", fixed: { start: 0, end: 1, size: 0.05 } },
  grant:      { key: "finaidstatustotalgrant",   title: "Total grant aid (USD)",            fmt: "$,.0f" },
  superscore: { key: "testsuperscoreconcordance",title: "Test super-score (concorded)",     fmt: ".0f" },
  distance:   { key: "milesfromcampus",          title: "Distance from campus (mi)",         fmt: ".0f" },
};

// Which y-modes are valid for a given (xMode, sliceCount).
function yModesFor(xMode, sliceCount) {
  const modes = ["percent", "count"];
  if (sliceCount >= 2) modes.push("ratio");
  if (xMode !== "yhat") modes.push("yhat_mean");
  return modes;
}

function defaultYModeFor(xMode) {
  return xMode === "yhat" ? "percent" : "count";
}

function bindChartControls() {
  if (controlsBound) return;
  const wrap = document.getElementById("chart-controls");
  if (!wrap) return;
  for (const btn of wrap.querySelectorAll(".seg[data-xmode]")) {
    btn.addEventListener("click", () => {
      if (btn.disabled || btn.hidden) return;
      const mode = btn.dataset.xmode;
      if (mode === xMode) return;
      xMode = mode;
      // Validate / reset yMode for the new xMode.
      const sliceCount = getSlices().length;
      if (!yModesFor(xMode, sliceCount).includes(yMode)) yMode = defaultYModeFor(xMode);
      syncControls(sliceCount);
      if (lastRender) renderChart(lastRender.filtered, lastRender.allRows);
    });
  }
  for (const btn of wrap.querySelectorAll(".seg[data-ymode]")) {
    btn.addEventListener("click", () => {
      if (btn.disabled || btn.hidden) return;
      const mode = btn.dataset.ymode;
      if (mode === yMode) return;
      yMode = mode;
      syncControls(getSlices().length);
      if (lastRender) renderChart(lastRender.filtered, lastRender.allRows);
    });
  }
  // Static empty-state "Clear filters" button; clicking it triggers a reset.
  const emptyBtn = document.querySelector("#overall-empty .empty-state-btn");
  if (emptyBtn) {
    emptyBtn.addEventListener("click", () => document.getElementById("reset-filters").click());
  }
  controlsBound = true;
}

function syncControls(sliceCount) {
  const wrap = document.getElementById("chart-controls");
  if (!wrap) return;
  for (const btn of wrap.querySelectorAll(".seg[data-xmode]")) {
    btn.classList.toggle("active", btn.dataset.xmode === xMode);
  }
  const validY = yModesFor(xMode, sliceCount);
  for (const btn of wrap.querySelectorAll(".seg[data-ymode]")) {
    const m = btn.dataset.ymode;
    btn.hidden = !validY.includes(m);
    btn.classList.toggle("active", m === yMode);
  }
  // Hide the y-axis row entirely in the default-confirmed-toggle scenario
  // (yhat x-axis with no slices, where yMode is irrelevant).
  const yRow = document.getElementById("yaxis-row");
  if (yRow) yRow.hidden = xMode === "yhat" && sliceCount === 0;
}

// --- Helpers ---
function mean(values) {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function fmtPct(x) { return x === null ? "—" : `${(x * 100).toFixed(1)}%`; }
function fmtNum(x, digits = 3) { return x === null ? "—" : x.toFixed(digits); }
function fmtCount(x) { return x.toLocaleString(); }

// Round a candidate bin size to a "nice" 1/2/5 × 10^k value.
function niceBinSize(range, target = 25) {
  if (!Number.isFinite(range) || range <= 0) return 1;
  const raw = range / target;
  const exp = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / exp;
  if (m < 1.5) return 1 * exp;
  if (m < 3.5) return 2 * exp;
  if (m < 7.5) return 5 * exp;
  return 10 * exp;
}

function getXAxisConfig(allRows) {
  const cfg = X_AXIS_CONFIGS[xMode];
  if (cfg.fixed) return { ...cfg, ...cfg.fixed };
  const vals = allRows.map((r) => r[cfg.key]).filter((v) => Number.isFinite(v));
  if (vals.length === 0) return { ...cfg, start: 0, end: 1, size: 0.1 };
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const size = niceBinSize(max - min);
  const start = Math.floor(min / size) * size;
  const end = Math.ceil(max / size) * size;
  return { ...cfg, start, end, size };
}

function binCounts(values, start, end, size) {
  const n = Math.round((end - start) / size);
  const counts = new Array(n).fill(0);
  for (const v of values) {
    if (!Number.isFinite(v) || v < start || v > end) continue;
    let idx = Math.floor((v - start) / size);
    if (idx >= n) idx = n - 1;
    counts[idx] += 1;
  }
  return counts;
}

function binCenters(start, end, size) {
  const n = Math.round((end - start) / size);
  return Array.from({ length: n }, (_, i) => start + size * (i + 0.5));
}

// For each bin, collect yhat_pr values from rows whose xKey falls in that bin,
// then compute mean. Returns { centers, means, counts }.
function binnedYhatMeans(rows, xKey, start, end, size) {
  const n = Math.round((end - start) / size);
  const sums = new Array(n).fill(0);
  const counts = new Array(n).fill(0);
  for (const r of rows) {
    const xv = r[xKey];
    const yv = r.yhat_pr;
    if (!Number.isFinite(xv) || !Number.isFinite(yv) || xv < start || xv > end) continue;
    let idx = Math.floor((xv - start) / size);
    if (idx >= n) idx = n - 1;
    sums[idx] += yv;
    counts[idx] += 1;
  }
  const means = sums.map((s, i) => (counts[i] === 0 ? null : s / counts[i]));
  return { centers: binCenters(start, end, size), means, counts };
}

// --- Summary cards ---
function renderSummary(filtered) {
  const yhats = filtered.map((r) => r.yhat_pr).filter((v) => Number.isFinite(v));
  const confirmedCount = filtered.filter((r) => Number(r.confirmed) === 1).length;
  const withdrawnCount = filtered.filter((r) => Number(r.withdrawn) === 1).length;
  const m = mean(yhats);
  const med = median(yhats);
  const cards = [
    { label: "Students", tip: "Students included in the selected filter(s).", value: fmtCount(filtered.length) },
    { label: "Mean predicted enrollment probability", tip: "Cohort mean of yhat_pr.", value: fmtNum(m) },
    { label: "Median predicted enrollment probability", tip: "Middle yhat_pr value — robust to outliers.", value: fmtNum(med) },
    { label: "% Confirmed", tip: "Share of the filtered cohort who have deposited.", value: filtered.length ? fmtPct(confirmedCount / filtered.length) : "—" },
    { label: "% Withdrawn", tip: "Share of the filtered cohort who withdrew after admission.", value: filtered.length ? fmtPct(withdrawnCount / filtered.length) : "—" },
  ];
  const html = cards.map((c) => `
    <div class="summary-card" title="${c.tip}">
      <div class="label">${c.label}</div>
      <div class="value">${c.value}</div>
    </div>
  `).join("");
  document.getElementById("summary-row").innerHTML = html;
}

// --- Trace builders ---
function defaultYhatTraces(filtered, xCfg) {
  const xbins = { start: xCfg.start, end: xCfg.end, size: xCfg.size };
  const all = filtered.map((r) => r.yhat_pr).filter((v) => Number.isFinite(v));
  const confirmed = filtered.filter((r) => Number(r.confirmed) === 1).map((r) => r.yhat_pr).filter((v) => Number.isFinite(v));
  const notConfirmed = filtered.filter((r) => Number(r.confirmed) === 0).map((r) => r.yhat_pr).filter((v) => Number.isFinite(v));
  return [
    {
      x: all, type: "histogram", name: "All filtered", xbins,
      marker: { color: "#2f6feb", line: { color: "#1f5cd0", width: 1 } },
      opacity: 0.85,
      hovertemplate: "Predicted prob %{x}<br>%{y} students<extra>All</extra>",
    },
    {
      x: confirmed, type: "histogram", name: "Confirmed", xbins,
      marker: { color: "#2ca264" }, opacity: 0.55, visible: "legendonly",
      hovertemplate: "Predicted prob %{x}<br>%{y} confirmed<extra></extra>",
    },
    {
      x: notConfirmed, type: "histogram", name: "Not confirmed", xbins,
      marker: { color: "#9aa3b3" }, opacity: 0.55, visible: "legendonly",
      hovertemplate: "Predicted prob %{x}<br>%{y} not confirmed<extra></extra>",
    },
  ];
}

function ratioTraces(slices, allRows, xCfg) {
  const xbins = { start: xCfg.start, end: xCfg.end, size: xCfg.size };
  const denomXs = applyFilterState(allRows, slices[0].filter).map((r) => r[xCfg.key]);
  const denomCounts = binCounts(denomXs, xbins.start, xbins.end, xbins.size);
  const centers = binCenters(xbins.start, xbins.end, xbins.size);
  const traces = [];
  for (const s of slices.slice(1)) {
    const numXs = applyFilterState(allRows, s.filter).map((r) => r[xCfg.key]);
    const numCounts = binCounts(numXs, xbins.start, xbins.end, xbins.size);
    const ratios = numCounts.map((n, i) => (denomCounts[i] === 0 ? null : n / denomCounts[i]));
    const customdata = numCounts.map((n, i) => [n, denomCounts[i]]);
    traces.push({
      x: centers, y: ratios, customdata,
      type: "bar", name: `${s.name} ÷ ${slices[0].name}`,
      marker: { color: s.color }, opacity: 0.7,
      width: xbins.size * 0.9,
      hovertemplate: `%{x}<br>%{y:.3f} (%{customdata[0]} / %{customdata[1]})<extra>${s.name} ÷ ${slices[0].name}</extra>`,
    });
  }
  return traces;
}

function yhatMeanTraces(filtered, slices, allRows, xCfg) {
  const cohorts = slices.length === 0
    ? [{ name: "All filtered", color: "#2f6feb", rows: filtered }]
    : [
        { name: "Current filter", color: "#2f6feb", rows: filtered },
        ...slices.map((s) => ({ name: s.name, color: s.color, rows: applyFilterState(allRows, s.filter) })),
      ];
  return cohorts.map((c) => {
    const { centers, means, counts } = binnedYhatMeans(c.rows, xCfg.key, xCfg.start, xCfg.end, xCfg.size);
    return {
      x: centers, y: means, customdata: counts,
      type: "scatter", mode: "lines+markers",
      name: `${c.name} (n=${c.rows.length.toLocaleString()})`,
      line: { color: c.color, width: 2 },
      marker: { color: c.color, size: 6 },
      connectgaps: false,
      hovertemplate: `%{x}<br>mean yhat_pr %{y:.3f} (n=%{customdata})<extra>${c.name}</extra>`,
    };
  });
}

function histogramTraces(filtered, slices, allRows, xCfg, mode) {
  const xbins = { start: xCfg.start, end: xCfg.end, size: xCfg.size };
  const histnorm = mode === "percent" ? "percent" : "";
  const yFmt = mode === "percent" ? "%{y:.1f}%" : "%{y} students";
  const cohorts = slices.length === 0
    ? [{ name: "All filtered", color: "#2f6feb", rows: filtered, isCurrent: true }]
    : [
        { name: "Current filter", color: "#2f6feb", rows: filtered, isCurrent: true },
        ...slices.map((s) => ({ name: s.name, color: s.color, rows: applyFilterState(allRows, s.filter), isCurrent: false })),
      ];
  return cohorts.map((c) => {
    const xs = c.rows.map((r) => r[xCfg.key]).filter((v) => Number.isFinite(v));
    return {
      x: xs, type: "histogram",
      name: `${c.name} (n=${xs.length.toLocaleString()})`,
      xbins, histnorm,
      marker: { color: c.color }, opacity: 0.5,
      hovertemplate: `%{x}<br>${yFmt}<extra>${c.name}</extra>`,
    };
  });
}

// --- Layout ---
function yAxisTitle(slices) {
  if (yMode === "yhat_mean") return "Mean yhat_pr";
  if (yMode === "ratio" && slices.length >= 2) return `Share of ${slices[0].name}`;
  if (yMode === "percent") return "% of slice";
  return "Students";
}

function renderChart(filtered, allRows) {
  const slices = getSlices();
  const xCfg = getXAxisConfig(allRows);

  let traces;
  if (xMode === "yhat" && slices.length === 0 && yMode !== "yhat_mean") {
    traces = defaultYhatTraces(filtered, xCfg);
  } else if (yMode === "ratio" && slices.length >= 2) {
    traces = ratioTraces(slices, allRows, xCfg);
  } else if (yMode === "yhat_mean") {
    traces = yhatMeanTraces(filtered, slices, allRows, xCfg);
  } else {
    traces = histogramTraces(filtered, slices, allRows, xCfg, yMode);
  }

  // Mean/median dashed lines: only meaningful on the yhat_pr axis.
  const shapes = [];
  const annotations = [];
  if (xMode === "yhat") {
    const refValues = filtered.map((r) => r.yhat_pr).filter((v) => Number.isFinite(v));
    const m = mean(refValues);
    const med = median(refValues);
    if (m !== null) {
      shapes.push({ type: "line", x0: m, x1: m, yref: "paper", y0: 0, y1: 1, line: { color: "#1a2233", width: 2, dash: "dash" } });
      annotations.push({ x: m, y: 1, yref: "paper", yanchor: "bottom", showarrow: false, text: `mean ${m.toFixed(3)}`, font: { size: 11, color: "#1a2233" } });
    }
    if (med !== null) {
      shapes.push({ type: "line", x0: med, x1: med, yref: "paper", y0: 0, y1: 1, line: { color: "#5b6478", width: 1.5, dash: "dot" } });
      annotations.push({ x: med, y: 0.95, yref: "paper", yanchor: "bottom", showarrow: false, text: `median ${med.toFixed(3)}`, font: { size: 11, color: "#5b6478" } });
    }
  }

  const xRange = xMode === "yhat" ? [0, 1] : [xCfg.start, xCfg.end];
  const xaxis = { title: xCfg.title, range: xRange, gridcolor: "#eef1f7" };
  if (xCfg.fmt) xaxis.tickformat = xCfg.fmt;
  const layout = {
    barmode: "overlay",
    margin: { t: 30, r: 20, b: 50, l: 60 },
    xaxis,
    yaxis: { title: yAxisTitle(slices), gridcolor: "#eef1f7" },
    plot_bgcolor: "white",
    paper_bgcolor: "white",
    legend: { orientation: "h", x: 0, y: 1.12 },
    shapes,
    annotations,
  };

  Plotly.react("overall-chart", traces, layout, { displaylogo: false, responsive: true });
}

// --- Calibration & lift table ---
// Bins the filtered cohort into deciles by yhat_pr, compares predicted prob
// against actual confirmation rate in each bin. Points on the diagonal mean
// the model is well-calibrated within that bin.
function renderCalibration(filtered) {
  const chart = document.getElementById("calibration-chart");
  const empty = document.getElementById("calibration-empty");
  const tableWrap = document.getElementById("lift-table-wrap");
  if (!chart || !tableWrap) return;

  const valid = filtered.filter((r) => Number.isFinite(r.yhat_pr));
  if (valid.length < 20) {
    chart.hidden = true;
    if (empty) empty.hidden = false;
    tableWrap.innerHTML = "";
    return;
  }
  chart.hidden = false;
  if (empty) empty.hidden = true;

  const sorted = [...valid].sort((a, b) => a.yhat_pr - b.yhat_pr);
  const N = sorted.length;
  const bins = [];
  for (let i = 0; i < 10; i++) {
    const lo = Math.floor((i / 10) * N);
    const hi = Math.floor(((i + 1) / 10) * N);
    const slice = sorted.slice(lo, hi);
    if (slice.length === 0) continue;
    const meanPred = slice.reduce((s, r) => s + r.yhat_pr, 0) / slice.length;
    const confirmed = slice.filter((r) => Number(r.confirmed) === 1).length;
    bins.push({ decile: i + 1, n: slice.length, confirmed, rate: confirmed / slice.length, meanPred });
  }

  const traces = [
    {
      x: [0, 1], y: [0, 1], mode: "lines", type: "scatter",
      name: "Perfect calibration",
      line: { color: "#9aa3b3", dash: "dot", width: 1 },
      hoverinfo: "skip",
    },
    {
      x: bins.map((b) => b.meanPred),
      y: bins.map((b) => b.rate),
      customdata: bins.map((b) => [b.decile, b.n, b.confirmed]),
      mode: "lines+markers", type: "scatter",
      name: "Cohort",
      line: { color: "#2f6feb", width: 2 },
      marker: { color: "#2f6feb", size: 9 },
      hovertemplate: "Decile %{customdata[0]}: predicted %{x:.3f}, actual %{y:.1%} (%{customdata[2]}/%{customdata[1]})<extra></extra>",
    },
  ];
  const layout = {
    margin: { t: 30, r: 20, b: 50, l: 60 },
    xaxis: { title: "Mean predicted probability", range: [0, 1], gridcolor: "#eef1f7" },
    yaxis: { title: "Actual confirmation rate", range: [0, 1], gridcolor: "#eef1f7", tickformat: ".0%" },
    plot_bgcolor: "white", paper_bgcolor: "white",
    legend: { orientation: "h", x: 0, y: 1.12 },
  };
  Plotly.react("calibration-chart", traces, layout, { displaylogo: false, responsive: true });

  // Lift table — highest decile first (conventional for lift).
  const rows = bins.slice().reverse().map((b) => `
    <tr>
      <td>${b.decile}</td>
      <td>${b.n.toLocaleString()}</td>
      <td>${b.confirmed.toLocaleString()}</td>
      <td>${(b.rate * 100).toFixed(1)}%</td>
      <td>${b.meanPred.toFixed(3)}</td>
    </tr>
  `).join("");
  tableWrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th title="Decile of yhat_pr within the filtered cohort.">Decile</th>
          <th title="Students in this decile.">N</th>
          <th title="Students in this decile who have confirmed.">Confirmed</th>
          <th title="Confirmation rate within this decile.">% Conf.</th>
          <th title="Mean predicted probability within this decile.">Mean ŷ</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

export function renderOverall(filtered, allRows) {
  bindChartControls();
  lastRender = { filtered, allRows };
  const sliceCount = getSlices().length;
  // If the active yMode became invalid (e.g. user removed a slice), demote it.
  if (!yModesFor(xMode, sliceCount).includes(yMode)) yMode = defaultYModeFor(xMode);
  const controls = document.getElementById("chart-controls");
  if (controls) {
    // Show controls whenever a file is loaded (i.e. always once renderOverall runs).
    controls.hidden = false;
    syncControls(sliceCount);
  }
  renderSummary(filtered);
  if (filtered.length === 0) {
    renderEmptyState();
    return;
  }
  showCharts();
  renderChart(filtered, allRows);
  renderCalibration(filtered);
}

function renderEmptyState() {
  const chart = document.getElementById("overall-chart");
  const overallEmpty = document.getElementById("overall-empty");
  const calChart = document.getElementById("calibration-chart");
  const calEmpty = document.getElementById("calibration-empty");
  const liftWrap = document.getElementById("lift-table-wrap");
  if (chart) chart.hidden = true;
  if (overallEmpty) overallEmpty.hidden = false;
  if (calChart) calChart.hidden = true;
  if (calEmpty) calEmpty.hidden = true;
  if (liftWrap) liftWrap.innerHTML = "";
}

// Make sure non-empty renders show the chart divs and hide the empty overlays.
function showCharts() {
  const chart = document.getElementById("overall-chart");
  const overallEmpty = document.getElementById("overall-empty");
  if (chart) chart.hidden = false;
  if (overallEmpty) overallEmpty.hidden = true;
}
