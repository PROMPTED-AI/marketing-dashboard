import { createContext, useContext, useMemo, useState } from "react";

const DAY = 86400000;
const iso = (d) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};
const parse = (s) => new Date(s + "T00:00:00");
const addDays = (d, n) => new Date(d.getTime() + n * DAY);

export const PRESETS = [
  { id: "7d", label: "Laatste 7 dagen" },
  { id: "30d", label: "Laatste 30 dagen" },
  { id: "90d", label: "Laatste 90 dagen" },
  { id: "month", label: "Deze maand" },
  { id: "prevmonth", label: "Vorige maand" },
];
export const COMPARE_OPTIONS = [
  { id: "none", label: "Geen vergelijking" },
  { id: "previous", label: "Vorige periode" },
  { id: "previous_year", label: "Vorig jaar" },
  { id: "custom", label: "Aangepaste periode" },
];

export function presetRange(id) {
  const end = new Date();
  if (id === "7d") return { start: addDays(end, -6), end };
  if (id === "90d") return { start: addDays(end, -89), end };
  if (id === "month") return { start: new Date(end.getFullYear(), end.getMonth(), 1), end };
  if (id === "prevmonth") {
    return {
      start: new Date(end.getFullYear(), end.getMonth() - 1, 1),
      end: new Date(end.getFullYear(), end.getMonth(), 0),
    };
  }
  return { start: addDays(end, -29), end }; // 30d default
}

function computeCompare(mode, start, end, cStart, cEnd) {
  if (mode === "custom") return cStart && cEnd ? { start: cStart, end: cEnd } : null;
  if (mode === "previous" || mode === "previous_year") {
    const s = parse(start), e = parse(end);
    if (mode === "previous") {
      const len = Math.round((e - s) / DAY);
      const pe = addDays(s, -1);
      return { start: iso(addDays(pe, -len)), end: iso(pe) };
    }
    const ps = new Date(s), pe = new Date(e);
    ps.setFullYear(ps.getFullYear() - 1);
    pe.setFullYear(pe.getFullYear() - 1);
    return { start: iso(ps), end: iso(pe) };
  }
  return null;
}

const def = () => {
  const r = presetRange("30d");
  return { preset: "30d", start: iso(r.start), end: iso(r.end), compareMode: "none", compareStart: "", compareEnd: "" };
};

function load() {
  try {
    const s = JSON.parse(localStorage.getItem("kompas-range"));
    if (s && s.start && s.end) return { ...def(), ...s };
  } catch {}
  return def();
}

const Ctx = createContext(null);

export function DateRangeProvider({ children }) {
  const [state, setState] = useState(load);

  const value = useMemo(() => {
    const apply = (draft) => {
      const next = { ...state, ...draft };
      setState(next);
      localStorage.setItem("kompas-range", JSON.stringify(next));
    };
    const presetLabel = PRESETS.find((p) => p.id === state.preset)?.label;
    const fmt = (d) => parse(d).toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
    const label = presetLabel || `${fmt(state.start)} t/m ${fmt(state.end)}`;
    const compare = computeCompare(state.compareMode, state.start, state.end, state.compareStart, state.compareEnd);
    const compareLabel = COMPARE_OPTIONS.find((c) => c.id === state.compareMode)?.label || "Geen vergelijking";
    return { ...state, label, compare, compareLabel, apply, isoToday: iso(new Date()) };
  }, [state]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useDateRange = () => useContext(Ctx);
