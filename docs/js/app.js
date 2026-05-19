// App entry point: wires upload, tabs, and view re-renders to filter changes.

import { parseXlsx } from "./parser.js";
import { applyFilters, applyFiltersBeforeDecile, bindFilterUI, populateAppTermOptions } from "./filters.js";
import { renderOverall } from "./overall.js";
import { initIndividual, refreshIndividual } from "./individual.js";
import { addSliceFromCurrent, clearSlices, renderSliceChips } from "./slices.js";

let allRows = [];

function setupUpload() {
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("file-input");
  const status = document.getElementById("upload-status");

  function showError(msg) {
    status.textContent = msg;
    status.classList.add("error");
  }
  function showInfo(msg) {
    status.textContent = msg;
    status.classList.remove("error");
  }

  async function handle(file) {
    if (!file) return;
    showInfo(`Reading ${file.name}…`);
    try {
      const { rows } = await parseXlsx(file);
      allRows = rows;
      showInfo(`Loaded ${rows.length.toLocaleString()} students.`);
      enterApp();
    } catch (err) {
      console.error(err);
      showError(err.message || "Could not read the file.");
    }
  }

  fileInput.addEventListener("change", (e) => handle(e.target.files[0]));

  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    const file = e.dataTransfer?.files?.[0];
    handle(file);
  });
}

function setupTabs() {
  for (const btn of document.querySelectorAll("#tabs .tab")) {
    btn.addEventListener("click", () => {
      const target = btn.dataset.tab;
      for (const t of document.querySelectorAll("#tabs .tab")) t.classList.toggle("active", t === btn);
      for (const v of document.querySelectorAll(".view")) {
        const isActive = v.id === `view-${target}`;
        v.classList.toggle("active", isActive);
        v.hidden = !isActive;
      }
      // Force Plotly to recalc size when overall tab becomes visible.
      if (target === "overall") window.dispatchEvent(new Event("resize"));
    });
  }
}

function enterApp() {
  document.getElementById("upload-screen").hidden = true;
  document.getElementById("app-screen").hidden = false;
  document.body.classList.add("loaded");
  populateAppTermOptions(allRows);
  rerender();
}

function rerender() {
  const filtered = applyFilters(allRows);
  const decileBaseline = applyFiltersBeforeDecile(allRows);
  document.getElementById("cohort-count").textContent = `N = ${filtered.length.toLocaleString()}`;
  renderOverall(filtered, allRows);
  refreshIndividual(filtered, decileBaseline);
}

function setupReload() {
  document.getElementById("reload-file").addEventListener("click", () => {
    allRows = [];
    document.getElementById("file-input").value = "";
    document.getElementById("upload-status").textContent = "";
    document.getElementById("app-screen").hidden = true;
    document.getElementById("upload-screen").hidden = false;
    document.body.classList.remove("loaded");
    clearSlices();
  });
}

function setupSlices() {
  document.getElementById("save-slice").addEventListener("click", () => addSliceFromCurrent());
  document.getElementById("clear-slices").addEventListener("click", () => clearSlices());
  document.addEventListener("sliceschange", () => {
    renderSliceChips();
    rerender();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  setupUpload();
  setupTabs();
  bindFilterUI();
  initIndividual();
  setupReload();
  setupSlices();
  document.addEventListener("filterchange", rerender);
});
