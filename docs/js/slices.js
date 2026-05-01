// Saved filter snapshots for histogram overlay.
// Emits "sliceschange" CustomEvent on document when the slice list mutates.

import { getState as getCurrentFilter } from "./filters.js";

const COLORS = [
  "#2ca264", "#e07b00", "#9c27b0", "#d32f2f",
  "#00838f", "#5d4037", "#ad1457", "#1565c0",
];

const AEQ = { 0: "Not Aequitas", 1: "Invited", 2: "Applicant/WL", 3: "Accepted" };
const LEG = { any: "Any legacy", sib: "Sibling legacy", parent: "Parent legacy", none: "No legacy" };

const slices = [];
let nextId = 1;
let colorIdx = 0;

export function getSlices() {
  return slices.map((s) => ({ ...s }));
}

export function addSliceFromCurrent() {
  const filter = getCurrentFilter();
  slices.push({
    id: nextId++,
    name: nameFor(filter),
    color: COLORS[colorIdx % COLORS.length],
    filter,
  });
  colorIdx++;
  emit();
}

export function removeSlice(id) {
  const i = slices.findIndex((s) => s.id === id);
  if (i >= 0) {
    slices.splice(i, 1);
    emit();
  }
}

export function clearSlices() {
  if (slices.length === 0) return;
  slices.length = 0;
  colorIdx = 0;
  emit();
}

function emit() {
  document.dispatchEvent(new CustomEvent("sliceschange"));
}

function nameFor(f) {
  const parts = [];
  if (f.appTerm) parts.push(f.appTerm);
  if (f.confirmed === "1") parts.push("Confirmed");
  else if (f.confirmed === "0") parts.push("Not confirmed");
  if (f.withdrawn === "1") parts.push("Withdrawn");
  else if (f.withdrawn === "0") parts.push("Not withdrawn");
  if (f.aequitas !== "") parts.push(AEQ[f.aequitas] ?? `Aequitas=${f.aequitas}`);
  if (f.legacy) parts.push(LEG[f.legacy] ?? f.legacy);
  if (f.female === "1") parts.push("Female");
  else if (f.female === "0") parts.push("Male");
  if (f.decileMin > 1 || f.decileMax < 10) {
    parts.push(f.decileMin === f.decileMax ? `Decile ${f.decileMin}` : `Decile ${f.decileMin}–${f.decileMax}`);
  }
  return parts.length ? parts.join(" · ") : "All";
}

export function renderSliceChips() {
  const list = document.getElementById("slices-list");
  const bar = document.getElementById("slices-bar");
  if (!list || !bar) return;
  if (slices.length === 0) {
    list.innerHTML = "";
    bar.classList.remove("has-slices");
    return;
  }
  bar.classList.add("has-slices");
  list.innerHTML = slices.map((s) => `
    <span class="slice-chip" data-id="${s.id}">
      <span class="swatch" style="background:${s.color}"></span>
      <span class="chip-name">${escapeHtml(s.name)}</span>
      <button class="x" type="button" aria-label="Remove slice">&times;</button>
    </span>
  `).join("");
  for (const btn of list.querySelectorAll(".slice-chip .x")) {
    btn.addEventListener("click", (e) => {
      const id = Number(e.target.closest(".slice-chip").dataset.id);
      removeSlice(id);
    });
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
