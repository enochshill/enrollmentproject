// Cohort-level view: yhat_pr histogram + summary stats + confirmed-vs-not overlay.
// In slice mode (>=1 saved slice) it switches to one trace per slice, plus a
// "Current filter" trace. Y-axis defaults to percent so cohorts of different
// sizes stay comparable, but the user can toggle to raw student counts.

import { applyFilterState } from "./filters.js";
import { getSlices } from "./slices.js";

let yMode = "percent"; // "percent" | "count" | "ratio" — only consulted in slice mode
let lastRender = null; // { filtered, allRows } so the toggle can re-render without app help
let controlsBound = false;

function bindChartControls() {
  if (controlsBound) return;
  const wrap = document.getElementById("chart-controls");
  if (!wrap) return;
  for (const btn of wrap.querySelectorAll(".seg")) {
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      const mode = btn.dataset.ymode;
      if (mode === yMode) return;
      yMode = mode;
      for (const b of wrap.querySelectorAll(".seg")) b.classList.toggle("active", b.dataset.ymode === yMode);
      if (lastRender) renderChart(lastRender.filtered, lastRender.allRows);
    });
  }
  controlsBound = true;
}

function binCounts(values, start, end, size) {
  const n = Math.round((end - start) / size);
  const counts = new Array(n).fill(0);
  for (const v of values) {
    if (!Number.isFinite(v) || v < start || v > end) continue;
    let idx = Math.floor((v - start) / size);
    if (idx >= n) idx = n - 1; // include right edge in last bin
    counts[idx] += 1;
  }
  return counts;
}

function binCenters(start, end, size) {
  const n = Math.round((end - start) / size);
  return Array.from({ length: n }, (_, i) => start + size * (i + 0.5));
}

function yAxisTitle(slices) {
  if (slices.length === 0) return "Students";
  if (yMode === "ratio" && slices.length >= 2) return `Share of ${slices[0].name}`;
  if (yMode === "percent") return "% of slice";
  return "Students";
}

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

function renderSummary(filtered) {
  const yhats = filtered.map((r) => r.yhat_pr).filter((v) => Number.isFinite(v));
  const confirmedCount = filtered.filter((r) => Number(r.confirmed) === 1).length;
  const withdrawnCount = filtered.filter((r) => Number(r.withdrawn) === 1).length;
  const m = mean(yhats);
  const med = median(yhats);
  const cards = [
    { label: "Students", value: fmtCount(filtered.length) },
    { label: "Mean predicted enrollment probability", value: fmtNum(m) },
    { label: "Median predicted enrollment probability", value: fmtNum(med) },
    { label: "% Confirmed", value: filtered.length ? fmtPct(confirmedCount / filtered.length) : "—" },
    { label: "% Withdrawn", value: filtered.length ? fmtPct(withdrawnCount / filtered.length) : "—" },
  ];
  const html = cards.map((c) => `
    <div class="summary-card">
      <div class="label">${c.label}</div>
      <div class="value">${c.value}</div>
    </div>
  `).join("");
  document.getElementById("summary-row").innerHTML = html;
}

function renderChart(filtered, allRows) {
  const slices = getSlices();
  const xbins = { start: 0, end: 1, size: 0.05 };
  const traces = [];

  if (slices.length === 0) {
    // Default mode: single cohort with confirmed / not-confirmed legend toggles.
    const all = filtered.map((r) => r.yhat_pr).filter((v) => Number.isFinite(v));
    const confirmed = filtered.filter((r) => Number(r.confirmed) === 1).map((r) => r.yhat_pr).filter((v) => Number.isFinite(v));
    const notConfirmed = filtered.filter((r) => Number(r.confirmed) === 0).map((r) => r.yhat_pr).filter((v) => Number.isFinite(v));
    traces.push(
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
    );
  } else if (yMode === "ratio") {
    // Per-bin share of slice 1: numerator slice count / slice-1 count, by yhat_pr bin.
    // Slice 1 itself is the denominator and isn't drawn (would be a flat 1.0).
    const denomXs = applyFilterState(allRows, slices[0].filter).map((r) => r.yhat_pr);
    const denomCounts = binCounts(denomXs, xbins.start, xbins.end, xbins.size);
    const centers = binCenters(xbins.start, xbins.end, xbins.size);
    for (const s of slices.slice(1)) {
      const numXs = applyFilterState(allRows, s.filter).map((r) => r.yhat_pr);
      const numCounts = binCounts(numXs, xbins.start, xbins.end, xbins.size);
      const ratios = numCounts.map((n, i) => (denomCounts[i] === 0 ? null : n / denomCounts[i]));
      const customdata = numCounts.map((n, i) => [n, denomCounts[i]]);
      traces.push({
        x: centers, y: ratios, customdata,
        type: "bar", name: `${s.name} ÷ ${slices[0].name}`,
        marker: { color: s.color }, opacity: 0.7,
        width: xbins.size * 0.9,
        hovertemplate: `Predicted prob %{x:.3f}<br>%{y:.3f} (%{customdata[0]} / %{customdata[1]})<extra>${s.name} ÷ ${slices[0].name}</extra>`,
      });
    }
  } else {
    // percent / count modes: one trace per slice plus a "Current" trace.
    const histnorm = yMode === "percent" ? "percent" : "";
    const yFmt = yMode === "percent" ? "%{y:.1f}%" : "%{y} students";
    const cur = filtered.map((r) => r.yhat_pr).filter((v) => Number.isFinite(v));
    traces.push({
      x: cur, type: "histogram", name: `Current filter (n=${cur.length.toLocaleString()})`,
      xbins, histnorm,
      marker: { color: "#2f6feb" }, opacity: 0.5,
      hovertemplate: `Predicted prob %{x}<br>${yFmt}<extra>Current</extra>`,
    });
    for (const s of slices) {
      const xs = applyFilterState(allRows, s.filter).map((r) => r.yhat_pr).filter((v) => Number.isFinite(v));
      traces.push({
        x: xs, type: "histogram",
        name: `${s.name} (n=${xs.length.toLocaleString()})`,
        xbins, histnorm,
        marker: { color: s.color }, opacity: 0.5,
        hovertemplate: `Predicted prob %{x}<br>${yFmt}<extra>${s.name}</extra>`,
      });
    }
  }

  const refValues = filtered.map((r) => r.yhat_pr).filter((v) => Number.isFinite(v));
  const m = mean(refValues);
  const med = median(refValues);
  const shapes = [];
  const annotations = [];
  if (m !== null) {
    shapes.push({ type: "line", x0: m, x1: m, yref: "paper", y0: 0, y1: 1, line: { color: "#1a2233", width: 2, dash: "dash" } });
    annotations.push({ x: m, y: 1, yref: "paper", yanchor: "bottom", showarrow: false, text: `mean ${m.toFixed(3)}`, font: { size: 11, color: "#1a2233" } });
  }
  if (med !== null) {
    shapes.push({ type: "line", x0: med, x1: med, yref: "paper", y0: 0, y1: 1, line: { color: "#5b6478", width: 1.5, dash: "dot" } });
    annotations.push({ x: med, y: 0.95, yref: "paper", yanchor: "bottom", showarrow: false, text: `median ${med.toFixed(3)}`, font: { size: 11, color: "#5b6478" } });
  }

  const layout = {
    barmode: "overlay",
    margin: { t: 30, r: 20, b: 50, l: 60 },
    xaxis: { title: "Predicted enrollment probability", range: [0, 1], gridcolor: "#eef1f7" },
    yaxis: { title: yAxisTitle(slices), gridcolor: "#eef1f7" },
    plot_bgcolor: "white",
    paper_bgcolor: "white",
    legend: { orientation: "h", x: 0, y: 1.12 },
    shapes,
    annotations,
  };

  Plotly.react("overall-chart", traces, layout, { displaylogo: false, responsive: true });
}

export function renderOverall(filtered, allRows) {
  bindChartControls();
  lastRender = { filtered, allRows };
  const sliceCount = getSlices().length;
  const controls = document.getElementById("chart-controls");
  if (controls) {
    controls.hidden = sliceCount === 0;
    // Ratio mode requires >=2 slices; demote to percent if a slice was removed.
    if (yMode === "ratio" && sliceCount < 2) yMode = "percent";
    for (const btn of controls.querySelectorAll(".seg")) {
      const mode = btn.dataset.ymode;
      btn.disabled = mode === "ratio" && sliceCount < 2;
      btn.classList.toggle("active", mode === yMode);
    }
  }
  renderSummary(filtered);
  renderChart(filtered, allRows);
}
