const nf = new Intl.NumberFormat("nl-NL");

export const num = (v) => nf.format(Math.round(v || 0));

export const pct1 = (v) => `${(v || 0).toFixed(1).replace(".", ",")}%`;

// Dutch singular forms for the count-noun units shown in chart tooltips, so a
// value of exactly 1 reads "1 bezoeker" instead of "1 bezoekers".
const UNIT_SINGULARS = {
  bezoekers: "bezoeker",
  "nieuwe bezoekers": "nieuwe bezoeker",
  sessies: "sessie",
  paginaweergaven: "paginaweergave",
  gebeurtenissen: "gebeurtenis",
  conversies: "conversie",
  klikken: "klik",
  vertoningen: "vertoning",
};

// Return `unit` in singular when the (rounded) value is exactly 1, else plural.
export function unitLabel(value, unit) {
  if (!unit) return "";
  return Math.round(value || 0) === 1 ? (UNIT_SINGULARS[unit] || unit) : unit;
}

// KpiCard delta props from a % change. `higherIsBetter=false` for bounce/position.
export function deltaProps(pct, higherIsBetter = true) {
  if (pct == null) return {};
  const positive = higherIsBetter ? pct >= 0 : pct <= 0;
  return { delta: `${Math.abs(pct).toFixed(1).replace(".", ",")}%`, positive };
}

export function duration(seconds) {
  const s = Math.round(seconds || 0);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${String(r).padStart(2, "0")}s`;
}

// "20240630" -> "30 jun"
const MONTHS = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
export function shortDate(yyyymmdd) {
  if (!yyyymmdd || yyyymmdd.length !== 8) return yyyymmdd;
  const d = parseInt(yyyymmdd.slice(6, 8), 10);
  const m = parseInt(yyyymmdd.slice(4, 6), 10) - 1;
  return `${d} ${MONTHS[m] || ""}`;
}
