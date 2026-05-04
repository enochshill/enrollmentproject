// Individual student view: search bar with autocomplete + per-student card
// (heat-colored activity tiles + context fields).

import { AEQUITAS, ATHLETE, CITIZENSHIP, lookup, yesNo, legacyLabel } from "./labels.js";

const ACTIVITY_CATEGORIES = [
  { key: "emailopen_tot", label: "Email opens", format: (v) => v.toFixed(0) },
  { key: "emailclick_tot", label: "Email clicks", format: (v) => v.toFixed(0) },
  { key: "logins_tot", label: "Logins", format: (v) => v.toFixed(0) },
  { key: "ping_tot", label: "Pings", format: (v) => v.toFixed(0) },
  { key: "sms_tot", label: "SMS", format: (v) => v.toFixed(0) },
  { key: "visit_tot", label: "Visits", format: (v) => v.toFixed(0) },
  { key: "zeemeescore", label: "ZeeMee score", format: (v) => v.toFixed(2), missingFlag: "zeemeescore_missing" },
];

let cohortRef = [];          // current filtered cohort
let percentileCache = null;  // { [key]: sortedAscArray } for current cohort
let selectedId = null;

// --- Percentile ranks ---
// For each activity category, sort cohort values ascending. Percentile for a
// given value = (# of cohort values <= v) / cohort size. Cached per filter.
function buildPercentileCache(rows) {
  const cache = {};
  for (const cat of ACTIVITY_CATEGORIES) {
    const vals = rows.map((r) => r[cat.key]).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    cache[cat.key] = vals;
  }
  return cache;
}

function percentileOf(sorted, v) {
  if (!sorted || sorted.length === 0 || !Number.isFinite(v)) return null;
  // Number of cohort entries <= v, via binary search for upper bound.
  let lo = 0, hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] <= v) lo = mid + 1;
    else hi = mid;
  }
  return lo / sorted.length;
}

function heatClass(pct) {
  if (pct === null) return "heat-na";
  if (pct < 0.15) return "heat-0";
  if (pct < 0.35) return "heat-1";
  if (pct < 0.55) return "heat-2";
  if (pct < 0.75) return "heat-3";
  if (pct < 0.90) return "heat-4";
  return "heat-5";
}

function heatColor(pct) {
  // CSS variable lookup
  const cls = heatClass(pct);
  return `var(--${cls})`;
}

// --- Search ---
function matchesQuery(row, q) {
  const fn = (row.firstname || "").toLowerCase();
  const pn = (row.preferredname || "").toLowerCase();
  const ln = (row.lastname || "").toLowerCase();
  const id = String(row.applicationreferenceid ?? "");
  return fn.includes(q) || pn.includes(q) || ln.includes(q) || id.includes(q);
}

function renderSearchResults(matches) {
  const list = document.getElementById("search-results");
  if (matches.length === 0) {
    list.hidden = true;
    list.innerHTML = "";
    return;
  }
  list.innerHTML = matches.map((r) => {
    const name = formatName(r);
    const yhat = Number.isFinite(r.yhat_pr) ? r.yhat_pr.toFixed(3) : "—";
    return `<li data-id="${r.applicationreferenceid}">
      <span>${escapeHtml(name)}</span>
      <span class="meta">yhat_pr ${yhat} · ID ${r.applicationreferenceid}</span>
    </li>`;
  }).join("");
  list.hidden = false;
  for (const li of list.querySelectorAll("li")) {
    li.addEventListener("click", () => {
      const id = li.getAttribute("data-id");
      const row = cohortRef.find((r) => String(r.applicationreferenceid) === id);
      if (row) selectStudent(row);
    });
  }
}

function setupSearch() {
  const input = document.getElementById("student-search");
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    if (q.length < 1) {
      document.getElementById("search-results").hidden = true;
      return;
    }
    const matches = cohortRef.filter((r) => matchesQuery(r, q)).slice(0, 10);
    renderSearchResults(matches);
  });
  input.addEventListener("focus", () => {
    if (input.value.trim()) input.dispatchEvent(new Event("input"));
  });
  document.addEventListener("click", (e) => {
    const wrap = document.getElementById("search-wrap");
    if (!wrap.contains(e.target)) {
      document.getElementById("search-results").hidden = true;
    }
  });
}

// --- Card ---
function formatName(r) {
  const first = r.firstname || "";
  const pref = r.preferredname && r.preferredname !== r.firstname ? ` "${r.preferredname}"` : "";
  const last = r.lastname || "";
  return `${first}${pref} ${last}`.trim();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function activityTile(r, cat) {
  const v = r[cat.key];
  const missing = (cat.missingFlag && Number(r[cat.missingFlag]) === 1) || !Number.isFinite(v);
  if (missing) {
    return `<div class="activity-tile" style="background:var(--heat-na)">
      <div class="cat">${escapeHtml(cat.label)}</div>
      <div class="val">—</div>
      <div class="pct">no data</div>
    </div>`;
  }
  const pct = percentileOf(percentileCache?.[cat.key], v);
  const bg = heatColor(pct);
  // Pick a darker text color for hot tiles for readability
  const dark = pct !== null && pct >= 0.75;
  const fg = dark ? "#3a1a10" : "#1a2233";
  const pctText = pct === null ? "—" : `${Math.round(pct * 100)}th pctile`;
  return `<div class="activity-tile" style="background:${bg};color:${fg}" title="${cat.label}: ${cat.format(v)} — ${pctText}">
    <div class="cat">${escapeHtml(cat.label)}</div>
    <div class="val">${cat.format(v)}</div>
    <div class="pct">${pctText}</div>
  </div>`;
}

function fmtNum(v, digits = 3) { return Number.isFinite(v) ? v.toFixed(digits) : "—"; }
function fmtMiles(v) { return Number.isFinite(v) ? `${v.toFixed(0)} mi` : "—"; }
function fmtMoney(v) { return Number.isFinite(v) && v > 0 ? `$${Math.round(v).toLocaleString()}` : "—"; }

// Excel serial date → display string. Excel epoch is 1899-12-30 UTC; 25569 days
// from there to 1970-01-01 (the bug-compensated offset SheetJS produces).
function fmtDate(serial) {
  if (!Number.isFinite(serial)) return "—";
  const d = new Date(Math.round((serial - 25569) * 86400000));
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

function renderCard(r) {
  const wrap = document.getElementById("student-card-wrap");
  const tiles = ACTIVITY_CATEGORIES.map((c) => activityTile(r, c)).join("");

  const confirmed = Number(r.confirmed) === 1;
  const withdrawn = Number(r.withdrawn) === 1;
  const outcomeText = confirmed ? "Confirmed" : withdrawn ? "Withdrawn" : "Active";
  const outcomeClass = confirmed ? "outcome-yes" : withdrawn ? "outcome-no" : "";

  const contextRows = [
    ["App Term", r.AppTerm || "—"],
    ["Admit date", fmtDate(r.admit_dt)],
    ["First offer date", fmtDate(r.firstoffer_dt)],
    ["Latest offer date", fmtDate(r.latestoffer_dt)],
    ["Distance", fmtMiles(r.milesfromcampus)],
    ["Legacy", legacyLabel(r)],
    ["Aequitas", lookup(AEQUITAS, r.aequitas)],
    ["Citizenship", lookup(CITIZENSHIP, r.citizenshipst)],
    ["Gender", Number(r.female) === 1 ? "Female" : Number(r.female) === 0 ? "Male" : "—"],
    ["First-gen", yesNo(r.firstgen)],
    ["Athlete", lookup(ATHLETE, r.athlete)],
    ["Test super (concord.)", fmtNum(r.testsuperscoreconcordance, 0)],
    ["Goodkind avg", fmtNum(r.goodkindaveragescore, 2)],
    ["ZeeMee score", Number(r.zeemeescore_missing) === 1 ? "—" : fmtNum(r.zeemeescore, 2)],
    ["Aid: grant", fmtMoney(r.finaidstatustotalgrant)],
    ["Aid: loan", fmtMoney(r.finaidstatustotalloan)],
    ["Aid: work-study", fmtMoney(r.finaidstatustotalworkstudy)],
    ["MK", yesNo(r.mk)],
    ["TCK", yesNo(r.tck)],
    ["Holdout sample", yesNo(r.holdout)],
  ];

  wrap.innerHTML = `
    <div class="student-card">
      <div class="card-header">
        <h2 class="card-name">${escapeHtml(r.firstname || "")}${r.preferredname && r.preferredname !== r.firstname ? ` <span class="pref">"${escapeHtml(r.preferredname)}"</span>` : ""} ${escapeHtml(r.lastname || "")}</h2>
        <span class="card-id">ID ${escapeHtml(String(r.applicationreferenceid))}</span>
      </div>
      <div class="card-headline">
        <div class="headline-item">
          <div class="label">yhat_pr</div>
          <div class="value">${fmtNum(r.yhat_pr)}</div>
        </div>
        <div class="headline-item">
          <div class="label">Decile</div>
          <div class="value">${Number.isFinite(r.decile) ? r.decile : "—"}</div>
        </div>
        <div class="headline-item">
          <div class="label">Status</div>
          <div class="value ${outcomeClass}">${outcomeText}</div>
        </div>
        <div class="headline-item">
          <div class="label">Predicted class</div>
          <div class="value">${Number.isFinite(r.confirmhat_cl) ? (r.confirmhat_cl === 1 ? "Confirm" : "No") : "—"}</div>
        </div>
      </div>

      <div class="card-section-title">Activity (heat = percentile within filtered cohort)</div>
      <div class="activity-grid">${tiles}</div>

      <div class="card-section-title">Context</div>
      <div class="context-grid">
        ${contextRows.map(([k, v]) => `<div class="row"><span class="k">${escapeHtml(k)}</span><span class="v">${escapeHtml(String(v))}</span></div>`).join("")}
      </div>
    </div>
  `;
}

function selectStudent(row) {
  selectedId = row.applicationreferenceid;
  document.getElementById("student-search").value = formatName(row);
  document.getElementById("search-results").hidden = true;
  renderCard(row);
}

// --- Public API ---
export function initIndividual() {
  setupSearch();
}

export function refreshIndividual(filtered) {
  cohortRef = filtered;
  percentileCache = buildPercentileCache(filtered);

  // If a student is currently selected, re-render their card so heat tiles
  // reflect the new cohort. If they're no longer in the cohort, clear.
  if (selectedId !== null) {
    const stillIn = filtered.find((r) => r.applicationreferenceid === selectedId);
    if (stillIn) {
      renderCard(stillIn);
    } else {
      document.getElementById("student-card-wrap").innerHTML = `<p class="hint">The previously selected student is outside the current filter. Pick another above.</p>`;
    }
  }
}
