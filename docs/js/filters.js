// Filter state + application. Emits a "filterchange" CustomEvent on document
// whenever filters change so views can re-render.

const state = {
  appTerm: "",       // exact string match, "" = all
  confirmed: "",      // "1" | "0" | ""
  withdrawn: "",      // "1" | "0" | ""
  aequitas: "",       // "0" | "1" | "2" | "3" | ""
  legacy: "",         // "any" | "sib" | "parent" | "none" | ""
  female: "",         // "1" | "0" | ""
  decileMin: 1,
  decileMax: 10,
};

export function getState() { return { ...state }; }

export function setFilter(key, value) {
  if (!(key in state)) return;
  state[key] = value;
  document.dispatchEvent(new CustomEvent("filterchange"));
}

export function resetAll() {
  state.appTerm = "";
  state.confirmed = "";
  state.withdrawn = "";
  state.aequitas = "";
  state.legacy = "";
  state.female = "";
  state.decileMin = 1;
  state.decileMax = 10;
  document.dispatchEvent(new CustomEvent("filterchange"));
}

export function applyFilters(rows) {
  return applyFilterState(rows, state);
}

export function applyFilterState(rows, f) {
  // Apply the non-decile filters first. Deciles are computed dynamically below
  // against this intermediate cohort, so the slider always means "deciles of
  // what you're currently looking at" rather than the static upstream column.
  const beforeDecile = rows.filter((r) => {
    if (f.appTerm && r.AppTerm !== f.appTerm) return false;
    if (f.confirmed !== "" && Number(r.confirmed) !== Number(f.confirmed)) return false;
    if (f.withdrawn !== "" && Number(r.withdrawn) !== Number(f.withdrawn)) return false;
    if (f.aequitas !== "" && Number(r.aequitas) !== Number(f.aequitas)) return false;
    if (f.female !== "" && Number(r.female) !== Number(f.female)) return false;
    if (f.legacy) {
      const sib = Number(r.legsib) === 1;
      const par = Number(r.legparent) === 1;
      const any = Number(r.legany) === 1;
      if (f.legacy === "any" && !any) return false;
      if (f.legacy === "sib" && !sib) return false;
      if (f.legacy === "parent" && !par) return false;
      if (f.legacy === "none" && any) return false;
    }
    return true;
  });

  if (f.decileMin === 1 && f.decileMax === 10) return beforeDecile;

  const sortedYhats = beforeDecile
    .map((r) => r.yhat_pr)
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  if (sortedYhats.length === 0) return beforeDecile;

  // Decile 1 = bottom 10% of yhat_pr; decile 10 = top 10%. cutoffAt(q) returns
  // the largest yhat in the bottom q fraction of the cohort.
  const N = sortedYhats.length;
  const cutoffAt = (q) => sortedYhats[Math.max(0, Math.min(N - 1, Math.floor(q * N) - 1))];
  const loBound = f.decileMin === 1 ? -Infinity : cutoffAt(0.1 * (f.decileMin - 1));
  const hiBound = f.decileMax === 10 ? Infinity : cutoffAt(0.1 * f.decileMax);

  return beforeDecile.filter((r) => {
    if (!Number.isFinite(r.yhat_pr)) return false;
    return r.yhat_pr > loBound && r.yhat_pr <= hiBound;
  });
}

// Populate the AppTerm dropdown with unique values from the loaded rows.
export function populateAppTermOptions(rows) {
  const sel = document.getElementById("f-appterm");
  const terms = [...new Set(rows.map((r) => r.AppTerm).filter(Boolean))].sort();
  // Keep the first "All" option, drop the rest, then append.
  while (sel.options.length > 1) sel.remove(1);
  for (const t of terms) {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = t;
    sel.appendChild(opt);
  }
}

export function bindFilterUI() {
  document.getElementById("f-appterm").addEventListener("change", (e) => setFilter("appTerm", e.target.value));
  document.getElementById("f-confirmed").addEventListener("change", (e) => setFilter("confirmed", e.target.value));
  document.getElementById("f-withdrawn").addEventListener("change", (e) => setFilter("withdrawn", e.target.value));
  document.getElementById("f-aequitas").addEventListener("change", (e) => setFilter("aequitas", e.target.value));
  document.getElementById("f-legacy").addEventListener("change", (e) => setFilter("legacy", e.target.value));
  document.getElementById("f-female").addEventListener("change", (e) => setFilter("female", e.target.value));

  const dMin = document.getElementById("f-decile-min");
  const dMax = document.getElementById("f-decile-max");
  const dLabel = document.getElementById("decile-label");
  const updateDecile = () => {
    let lo = Number(dMin.value);
    let hi = Number(dMax.value);
    if (lo > hi) { [lo, hi] = [hi, lo]; }
    dLabel.textContent = lo === hi ? `${lo}` : `${lo}–${hi}`;
    state.decileMin = lo;
    state.decileMax = hi;
    document.dispatchEvent(new CustomEvent("filterchange"));
  };
  dMin.addEventListener("input", updateDecile);
  dMax.addEventListener("input", updateDecile);

  document.getElementById("reset-filters").addEventListener("click", () => {
    document.getElementById("f-appterm").value = "";
    document.getElementById("f-confirmed").value = "";
    document.getElementById("f-withdrawn").value = "";
    document.getElementById("f-aequitas").value = "";
    document.getElementById("f-legacy").value = "";
    document.getElementById("f-female").value = "";
    dMin.value = 1; dMax.value = 10;
    document.getElementById("decile-label").textContent = "1–10";
    resetAll();
  });
}
