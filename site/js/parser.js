// Parses an uploaded .xlsx into an array of typed records.
// Uses the global XLSX (SheetJS) loaded from CDN in index.html.

const REQUIRED_COLUMNS = [
  "applicationreferenceid", "firstname", "lastname",
  "yhat_pr", "AppTerm", "confirmed", "withdrawn",
];

// Columns we always want as numbers when present (rest stay as-is).
const NUMERIC_COLUMNS = new Set([
  "yhat_pr", "yhat_cl", "confirmhat_cl", "decile",
  "confirmed", "withdrawn", "female", "firstgen", "mk", "tck",
  "workswheaton", "athlete", "aequitas", "milesfromcampus",
  "legsib", "legparent", "legany", "holdout",
  "testsuperscoreconcordance", "goodkindaveragescore", "goodkindmaxscore",
  "zeemeescore", "undecided25", "undecided26",
  "finaidstatustotalgrant", "finaidstatustotalloan", "finaidstatustotalworkstudy",
  "citizenshipst",
  // activity totals (windowed too)
  "emailclick_tot", "emailopen_tot", "logins_tot", "ping_tot", "sms_tot", "visit_tot",
  "logins_tot_min", "ping_tot_sec",
]);

function coerce(key, val) {
  if (val === null || val === undefined || val === "") return null;
  if (NUMERIC_COLUMNS.has(key) || /_tot$|_admit\d+$|_first\d+$|_latest\d+$|_recent\d+$|_any$|_missing$/.test(key)) {
    const n = Number(val);
    return Number.isFinite(n) ? n : null;
  }
  return val;
}

export async function parseXlsx(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const firstSheet = wb.SheetNames[0];
  if (!firstSheet) throw new Error("The workbook contains no sheets.");
  const ws = wb.Sheets[firstSheet];
  const raw = XLSX.utils.sheet_to_json(ws, { defval: null });

  if (raw.length === 0) throw new Error("The first sheet is empty.");

  const columns = Object.keys(raw[0]);
  const missing = REQUIRED_COLUMNS.filter((c) => !columns.includes(c));
  if (missing.length > 0) {
    throw new Error(`Spreadsheet is missing required columns: ${missing.join(", ")}.`);
  }

  const rows = raw.map((r) => {
    const out = {};
    for (const k of columns) out[k] = coerce(k, r[k]);
    return out;
  });

  return { rows, columns, sheetName: firstSheet };
}
