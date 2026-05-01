// Categorical label maps for the enrollment dataset.
// Source: user-provided Stata label define statements.

export const AEQUITAS = {
  0: "Not Aequitas",
  1: "Invited",
  2: "Applicant/Waitlist",
  3: "Accepted",
};

export const ATHLETE = {
  0: "Non-athlete",
  1: "Athlete (non-football)",
  2: "Football",
};

export const CITIZENSHIP = {
  1: "US",
  2: "PR",
  3: "FN",
};

export function lookup(map, code, fallback = "—") {
  if (code === null || code === undefined || code === "") return fallback;
  return map[code] ?? `Unknown (${code})`;
}

export function yesNo(v) {
  if (v === 1 || v === "1" || v === true) return "Yes";
  if (v === 0 || v === "0" || v === false) return "No";
  return "—";
}

export function legacyLabel(row) {
  const sib = Number(row.legsib) === 1;
  const par = Number(row.legparent) === 1;
  if (sib && par) return "Sibling + Parent";
  if (sib) return "Sibling";
  if (par) return "Parent";
  if (Number(row.legany) === 1) return "Other legacy";
  return "None";
}
