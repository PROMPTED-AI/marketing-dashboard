// Data-gedefinieerde custom widgets. Een custom widget rekent een afgeleide KPI
// uit door de scalar-waarden van bestaande catalogus-bronnen te combineren met
// een vaste, veilige rekenkundige operatie. Zo kan (de AI of) de gebruiker een
// nieuwe metric maken die nog niet als vaste bron bestaat — bijvoorbeeld
// "kosten per bestelling" = ratio(google-ads:cost, woocommerce:orders) — zonder
// dat er nieuwe code per metric nodig is. Er wordt nooit code geëvalueerd; enkel
// deze structurele spec met een whitelisted `op`.
//
// spec = { op, refs: ["<sourceId>", ...], fmt?, higherBetter? }
//   op   : "ratio" | "sum" | "diff" | "product" | "identity"
//   refs : sleutels in dezelfde catalogus (in "Overzicht" genamespaced als
//          "<kanaal>:<source>"); elke ref moet een scalar-accessor hebben.

export const CUSTOM_OPS = ["ratio", "sum", "diff", "product", "identity"];
const FMTS = ["int", "euro", "ratio", "decimal", "percent"];

const nf0 = new Intl.NumberFormat("nl-NL");
const nf2 = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 2 });
const eur = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });

function display(value, fmt) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (fmt === "percent") return `${nf2.format(value)}%`;
  if (fmt === "euro") return eur.format(value);
  if (fmt === "ratio" || fmt === "decimal") return nf2.format(value);
  return nf0.format(Math.round(value));
}

// Numerieke scalar-waarde van één ref tegen de payload; null als de bron
// ontbreekt of geen bruikbaar getal geeft.
function refValue(catalog, ref, data, ctx) {
  const src = catalog?.SOURCES?.[ref];
  if (!src || typeof src.scalar !== "function") return null;
  let s;
  try {
    s = src.scalar(data, undefined, ctx);
  } catch {
    return null;
  }
  const v = s?.value;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function applyOp(op, values) {
  const defined = values.filter((v) => typeof v === "number" && Number.isFinite(v));
  if (op === "identity") return values[0] ?? null;
  if (op === "sum") return defined.reduce((a, b) => a + b, 0);
  if (op === "product") return defined.length ? defined.reduce((a, b) => a * b, 1) : null;
  if (op === "diff") {
    if (values[0] == null) return null;
    return values.slice(1).reduce((a, b) => a - (b || 0), values[0]);
  }
  if (op === "ratio") {
    const [a, b] = values;
    if (a == null || !b) return null; // deel door nul of ontbrekend -> geen waarde
    return a / b;
  }
  return null;
}

// Houd alleen de bekende velden over (verdedigt tegen extra rommel uit AI-output).
export function normalizeSpec(spec) {
  const out = { op: spec.op, refs: spec.refs.slice(0, 4) };
  if (FMTS.includes(spec.fmt)) out.fmt = spec.fmt;
  if (typeof spec.higherBetter === "boolean") out.higherBetter = spec.higherBetter;
  return out;
}

// Is deze spec geldig tegen de gegeven catalogus? refs moeten bestaan en een
// scalar hebben; ratio/diff hebben minstens twee refs nodig.
export function isValidCustomSpec(catalog, spec) {
  if (!spec || typeof spec !== "object") return false;
  if (!CUSTOM_OPS.includes(spec.op)) return false;
  const refs = Array.isArray(spec.refs) ? spec.refs : [];
  if (!refs.length || refs.length > 4) return false;
  if ((spec.op === "ratio" || spec.op === "diff") && refs.length < 2) return false;
  return refs.every((r) => catalog?.SOURCES?.[r] && typeof catalog.SOURCES[r].scalar === "function");
}

// Bouw een synthetische bron (alleen KPI) voor een custom widget, zodat de
// bestaande WidgetRenderer-KPI-tak hem net als elke andere bron kan tekenen.
export function customSource(catalog, spec) {
  return {
    label: "Custom",
    kinds: ["kpi"],
    scalar: (data, _config, ctx) => {
      const values = (spec.refs || []).map((r) => refValue(catalog, r, data, ctx));
      const value = applyOp(spec.op, values);
      return { value: value == null ? 0 : value, display: display(value, spec.fmt), higherBetter: spec.higherBetter };
    },
  };
}
