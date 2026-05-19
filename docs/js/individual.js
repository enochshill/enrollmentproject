// Individual student view: search bar with autocomplete + per-student card
// (heat-colored activity tiles + context fields).

import { AEQUITAS, ATHLETE, CITIZENSHIP, lookup, yesNo, legacyLabel } from "./labels.js";

const HEAT_TIP = "Color shows percentile vs. visible cohort, darker red is larger.";

const ACTIVITY_CATEGORIES = [
  { key: "emailopen_tot", label: "Email opens", description: "Admissions emails this student has opened.", format: (v) => v.toFixed(0) },
  { key: "emailclick_tot", label: "Email clicks", description: "Clicks on links inside admissions emails.", format: (v) => v.toFixed(0) },
  { key: "logins_tot", label: "Logins", description: "Logins to the applicant portal.", format: (v) => v.toFixed(0) },
  { key: "ping_tot", label: "Pings", description: "Engagement pings from the CRM.", format: (v) => v.toFixed(0) },
  { key: "sms_tot", label: "SMS", description: "Text messages with this applicant.", format: (v) => v.toFixed(0) },
  { key: "visit_tot", label: "Visits", description: "Campus visits — tours, events, etc.", format: (v) => v.toFixed(0) },
  { key: "zeemeescore", label: "ZeeMee score", description: "Engagement score from the ZeeMee app.", format: (v) => v.toFixed(2), missingFlag: "zeemeescore_missing" },
];

let cohortRef = [];          // current filtered cohort
let percentileCache = null;  // { [key]: sortedAscArray } for current cohort
let selectedId = null;

// --- Percentile ranks ---
// For each activity category, sort cohort values ascending. Percentile for a
// given value = (# of cohort values <= v) / cohort size. Cached per filter.
// Activity heat tiles reflect percentile within the current filtered cohort.
// The yhat_pr cache (used for the headline "Decile" display) instead uses the
// pre-decile-slider cohort so the displayed decile stays stable as the user
// scrubs the slider — otherwise "decile of decile" is confusing.
function buildPercentileCache(rows, decileBaselineRows) {
  const cache = {};
  for (const cat of ACTIVITY_CATEGORIES) {
    const vals = rows.map((r) => r[cat.key]).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    cache[cat.key] = vals;
  }
  const baseline = decileBaselineRows ?? rows;
  cache.yhat_pr = baseline.map((r) => r.yhat_pr).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  return cache;
}

function dynamicDecile(r) {
  const sorted = percentileCache?.yhat_pr;
  if (!sorted || sorted.length === 0 || !Number.isFinite(r.yhat_pr)) return null;
  const pct = percentileOf(sorted, r.yhat_pr);
  if (pct === null) return null;
  return Math.min(10, Math.max(1, Math.ceil(pct * 10)));
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
  const tip = escapeHtml(`${cat.description} ${HEAT_TIP}`);
  const v = r[cat.key];
  const missing = (cat.missingFlag && Number(r[cat.missingFlag]) === 1) || !Number.isFinite(v);
  if (missing) {
    return `<div class="activity-tile" style="background:var(--heat-na)" title="${tip}">
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
  return `<div class="activity-tile" style="background:${bg};color:${fg}" title="${tip}">
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
    ["App Term", r.AppTerm || "—", "Application term cohort."],
    ["Admit date", fmtDate(r.admit_dt), "Date the student was admitted."],
    ["First offer date", fmtDate(r.firstoffer_dt), "Date of the first financial aid offer."],
    ["Latest offer date", fmtDate(r.latestoffer_dt), "Date of the most recent financial aid offer."],
    ["Distance", fmtMiles(r.milesfromcampus), "Miles from home to campus."],
    ["Legacy", legacyLabel(r), "Family alumni connection (sibling, parent, other, or none)."],
    ["Aequitas", lookup(AEQUITAS, r.aequitas), "Aequitas program status."],
    ["Citizenship", lookup(CITIZENSHIP, r.citizenshipst), "US, Permanent Resident, or Foreign National."],
    ["Gender", Number(r.female) === 1 ? "Female" : Number(r.female) === 0 ? "Male" : "—", "Gender"],
    ["First-gen", yesNo(r.firstgen), "First-generation college student."],
    ["Athlete", lookup(ATHLETE, r.athlete), "Recruited-athlete status (non-athlete / non-football athlete / football)."],
    ["Test super (concord.)", fmtNum(r.testsuperscoreconcordance, 0), "Concorded SAT/ACT super-score."],
    ["Goodkind avg", fmtNum(r.goodkindaveragescore, 2), "Average Goodkind reader/interview rating."],
    ["ZeeMee score", Number(r.zeemeescore_missing) === 1 ? "—" : fmtNum(r.zeemeescore, 2), "Engagement score from the ZeeMee app."],
    ["Aid: grant", fmtMoney(r.finaidstatustotalgrant), "Total grant aid offered, in USD."],
    ["Aid: loan", fmtMoney(r.finaidstatustotalloan), "Total loan aid offered, in USD."],
    ["Aid: work-study", fmtMoney(r.finaidstatustotalworkstudy), "Total work-study offered, in USD."],
    ["MK", yesNo(r.mk), "Missionary kid."],
    ["TCK", yesNo(r.tck), "Third-culture kid."],
    ["Holdout sample", yesNo(r.holdout), "Held out of model training; useful for unbiased evaluation."],
  ];

  wrap.innerHTML = `
    <div class="student-card">
      <div class="card-header">
        <h2 class="card-name">${escapeHtml(r.firstname || "")}${r.preferredname && r.preferredname !== r.firstname ? ` <span class="pref">"${escapeHtml(r.preferredname)}"</span>` : ""} ${escapeHtml(r.lastname || "")}</h2>
        <span class="card-id">ID ${escapeHtml(String(r.applicationreferenceid))}</span>
      </div>
      <div class="card-headline">
        <div class="headline-item" title="Model's predicted probability that this student confirms enrollment.">
          <div class="label">yhat_pr <span class="help-icon" title="Model's predicted probability that this student confirms enrollment.">?</span></div>
          <div class="value">${fmtNum(r.yhat_pr)}</div>
        </div>
        <div class="headline-item" title="Student's yhat_pr decile within the cohort, after other filters but ignoring the Decile slider. Higher decile means more likely to confirm.">
          <div class="label">Decile <span class="help-icon" title="Student's yhat_pr decile within the cohort, after other filters but ignoring the Decile slider. Higher decile means more likely to confirm.">?</span></div>
          <div class="value">${dynamicDecile(r) ?? "—"}</div>
        </div>
        <div class="headline-item" title="Current outcome: Confirmed, Withdrawn, or Active.">
          <div class="label">Status <span class="help-icon" title="Current outcome: Confirmed, Withdrawn, or Active.">?</span></div>
          <div class="value ${outcomeClass}">${outcomeText}</div>
        </div>
        <div class="headline-item" title="The model's binary prediction (Confirm/No), thresholded from yhat_pr.">
          <div class="label">Predicted class <span class="help-icon" title="The model's binary prediction (Confirm/No), thresholded from yhat_pr.">?</span></div>
          <div class="value">${Number.isFinite(r.confirmhat_cl) ? (r.confirmhat_cl === 1 ? "Confirm" : "No") : "—"}</div>
        </div>
      </div>

      <div class="card-section-title">Activity (heat = percentile within filtered cohort)</div>
      <div class="activity-grid">${tiles}</div>

      <div class="card-section-title">Context</div>
      <div class="context-grid">
        ${contextRows.map(([k, v, t]) => `<div class="row" title="${escapeHtml(t)}"><span class="k">${escapeHtml(k)}</span><span class="v">${escapeHtml(String(v))}</span></div>`).join("")}
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

export function refreshIndividual(filtered, decileBaseline) {
  cohortRef = filtered;
  percentileCache = buildPercentileCache(filtered, decileBaseline);

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
