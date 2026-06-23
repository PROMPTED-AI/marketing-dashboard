import { useEffect, useRef, useState } from "react";
import { useDateRange, PRESETS, COMPARE_OPTIONS, presetRange } from "../lib/PeriodProvider.jsx";
import { IcCalendar, IcChevDown } from "./icons.jsx";

const localIso = (d) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};

export default function DateRangePicker() {
  const dr = useDateRange();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const openMenu = () => {
    setDraft({ preset: dr.preset, start: dr.start, end: dr.end, compareMode: dr.compareMode, compareStart: dr.compareStart, compareEnd: dr.compareEnd });
    setOpen(true);
  };
  const pickPreset = (id) => {
    const r = presetRange(id);
    setDraft((d) => ({ ...d, preset: id, start: localIso(r.start), end: localIso(r.end) }));
  };
  const setCustom = (field, val) => setDraft((d) => ({ ...d, preset: "custom", [field]: val }));
  const apply = () => { dr.apply(draft); setOpen(false); };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <div style={pill} onClick={() => (open ? setOpen(false) : openMenu())}>
        <IcCalendar s={16} />
        <span>{dr.label}{dr.compare ? ` · vs ${dr.compareLabel.toLowerCase()}` : ""}</span>
        <span style={{ display: "inline-flex", transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}><IcChevDown s={14} /></span>
      </div>
      {open && draft && (
        <div style={menu}>
          <div style={section}>Periode</div>
          {PRESETS.map((p) => (
            <div key={p.id} onClick={() => pickPreset(p.id)} style={{ ...row, ...(draft.preset === p.id ? rowActive : {}) }}>{p.label}</div>
          ))}
          <div style={dateRow}>
            <input type="date" value={draft.start} max={draft.end} onChange={(e) => setCustom("start", e.target.value)} style={dateInput} />
            <span style={{ color: "var(--c-muted)" }}>–</span>
            <input type="date" value={draft.end} min={draft.start} max={dr.isoToday} onChange={(e) => setCustom("end", e.target.value)} style={dateInput} />
          </div>

          <div style={{ ...section, marginTop: 6 }}>Vergelijken</div>
          {COMPARE_OPTIONS.map((c) => (
            <div key={c.id} onClick={() => setDraft((d) => ({ ...d, compareMode: c.id }))} style={{ ...row, ...(draft.compareMode === c.id ? rowActive : {}) }}>{c.label}</div>
          ))}
          {draft.compareMode === "custom" && (
            <div style={dateRow}>
              <input type="date" value={draft.compareStart} max={dr.isoToday} onChange={(e) => setDraft((d) => ({ ...d, compareStart: e.target.value }))} style={dateInput} />
              <span style={{ color: "var(--c-muted)" }}>–</span>
              <input type="date" value={draft.compareEnd} max={dr.isoToday} onChange={(e) => setDraft((d) => ({ ...d, compareEnd: e.target.value }))} style={dateInput} />
            </div>
          )}

          <div style={footer}>
            <button className="btn-ghost" style={{ height: 36, padding: "0 14px", fontSize: 13 }} onClick={() => setOpen(false)}>Annuleren</button>
            <button className="btn-primary" style={{ height: 36, padding: "0 16px", fontSize: 13 }} onClick={apply}>Toepassen</button>
          </div>
        </div>
      )}
    </div>
  );
}

const pill = { display: "flex", alignItems: "center", gap: 8, padding: "0 14px", height: 40, border: "1px solid var(--c-border)", borderRadius: 999, background: "var(--c-surface)", fontSize: 13, fontWeight: 600, cursor: "pointer", color: "var(--c-ink-soft)", userSelect: "none", whiteSpace: "nowrap" };
const menu = { position: "absolute", top: "calc(100% + 6px)", right: 0, minWidth: 260, background: "var(--c-surface)", border: "1px solid var(--c-border)", borderRadius: 14, boxShadow: "var(--sh-md)", overflow: "hidden", zIndex: 40, paddingTop: 6 };
const section = { padding: "6px 14px", fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--c-muted)" };
const row = { padding: "9px 14px", fontSize: 13.5, cursor: "pointer", color: "var(--c-ink-soft)" };
const rowActive = { background: "var(--c-accent-soft)", color: "var(--c-accent)", fontWeight: 700 };
const dateRow = { display: "flex", gap: 8, alignItems: "center", padding: "8px 14px" };
const dateInput = { flex: 1, minWidth: 0, padding: "7px 9px", borderRadius: 8, border: "1px solid var(--c-border)", background: "var(--c-surface-2)", color: "var(--c-ink)", fontSize: 12.5, fontFamily: "Montserrat, sans-serif" };
const footer = { display: "flex", justifyContent: "flex-end", gap: 8, padding: "12px 14px", borderTop: "1px solid var(--c-border)", marginTop: 6 };
