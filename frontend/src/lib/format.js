const nf = new Intl.NumberFormat("nl-NL");

export const num = (v) => nf.format(Math.round(v || 0));

export const pct1 = (v) => `${(v || 0).toFixed(1).replace(".", ",")}%`;

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
