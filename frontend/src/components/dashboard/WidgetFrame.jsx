// Eén widget in de grid. In bewerkmodus verschijnt een regel met knoppen:
// sleephandvat (volgorde), titel, type, optioneel filter, grootte, verwijderen.
import { useEffect, useRef, useState } from "react";
import WidgetRenderer from "../WidgetRenderer.jsx";
import { KINDS, SIZES } from "../../lib/widgets/kit.js";

const ctrlStyle = {
  height: 30, padding: "0 8px", borderRadius: 8, border: "1px solid var(--c-border)",
  background: "var(--c-surface)", color: "var(--c-ink)", fontSize: 12.5, fontFamily: "inherit", fontWeight: 600,
};

// Uitklapmenu met aanvinkvakjes: kies één of meer waarden. Een lege selectie
// betekent "alles" (de bovenste optie).
function MultiSelect({ label, allLabel = "Alles", options, value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const selected = Array.isArray(value)
    ? value.filter((v) => v && v !== "__all__")
    : value && value !== "__all__" ? [value] : [];
  const summary = selected.length === 0
    ? allLabel
    : selected.length === 1 ? selected[0] : `${selected.length} gekozen`;

  const toggle = (name) => {
    const set = new Set(selected);
    set.has(name) ? set.delete(name) : set.add(name);
    onChange([...set]);
  };

  const rowStyle = { display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", fontSize: 12.5, cursor: "pointer", borderRadius: 6, whiteSpace: "nowrap" };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{ ...ctrlStyle, maxWidth: 180, display: "flex", alignItems: "center", gap: 6, cursor: "pointer", overflow: "hidden" }}
        title={label}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{summary}</span>
        <span style={{ color: "var(--c-muted)", flex: "none" }}>▾</span>
      </button>
      {open && (
        <div
          className="card"
          style={{ position: "absolute", zIndex: 30, top: 34, left: 0, minWidth: 220, maxHeight: 260, overflowY: "auto", padding: 6, boxShadow: "0 8px 24px rgba(0,0,0,.14)" }}
        >
          <label style={rowStyle} onClick={(e) => { e.preventDefault(); onChange([]); }}>
            <input type="checkbox" readOnly checked={selected.length === 0} />
            <span style={{ fontWeight: 600 }}>{allLabel}</span>
          </label>
          {options.map((o) => (
            <label key={o.value} style={rowStyle} onClick={(e) => { e.preventDefault(); toggle(o.value); }}>
              <input type="checkbox" readOnly checked={selected.includes(o.value)} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{o.label}</span>
            </label>
          ))}
          {options.length === 0 && (
            <div style={{ padding: 8, fontSize: 12, color: "var(--c-muted)" }}>geen opties in deze periode</div>
          )}
        </div>
      )}
    </div>
  );
}

export default function WidgetFrame({
  widget, data, catalog, ctx, editing, onChange, onRemove,
  onDragStart, onDragEnd, onDropOn, isDragging, isDropTarget,
}) {
  const src = catalog.SOURCES[widget.source];
  const kindOptions = src?.kinds || [widget.kind];
  const cfg = src?.config;
  const cfgOptions = cfg ? cfg.options(data) : [];
  const cfgValue = (cfg && widget.config?.[cfg.key]) || cfg?.default;

  return (
    <div
      style={{ gridColumn: `span ${widget.size}`, minWidth: 0, display: "flex", flexDirection: "column", gap: 8, opacity: isDragging ? 0.4 : 1 }}
      onDragOver={editing ? (e) => { e.preventDefault(); } : undefined}
      onDrop={editing ? (e) => { e.preventDefault(); onDropOn(); } : undefined}
    >
      {editing && (
        <div
          className="card"
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px", flexWrap: "wrap", background: "var(--c-surface-2)" }}
        >
          <span
            draggable
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            title="Sleep om te verplaatsen"
            style={{ cursor: "grab", padding: "0 6px", color: "var(--c-muted)", fontSize: 16, userSelect: "none", lineHeight: 1 }}
          >
            ⠿
          </span>
          <input
            value={widget.title}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder={src?.label}
            style={{ ...ctrlStyle, flex: 1, minWidth: 80, fontWeight: 700 }}
          />
          {kindOptions.length > 1 && (
            <select value={widget.kind} onChange={(e) => onChange({ kind: e.target.value })} style={ctrlStyle} title="Type">
              {kindOptions.map((k) => <option key={k} value={k}>{KINDS[k].label}</option>)}
            </select>
          )}
          {cfg && (cfg.multi ? (
            <MultiSelect
              label={cfg.label}
              allLabel={cfg.allLabel}
              options={cfgOptions}
              value={widget.config?.[cfg.key] ?? cfg.default}
              onChange={(vals) => onChange({ config: { ...(widget.config || {}), [cfg.key]: vals } })}
            />
          ) : (
            <select
              value={cfgValue}
              onChange={(e) => onChange({ config: { ...(widget.config || {}), [cfg.key]: e.target.value } })}
              style={{ ...ctrlStyle, maxWidth: 160 }}
              title={cfg.label}
            >
              {cfgOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ))}
          <select value={widget.size} onChange={(e) => onChange({ size: Number(e.target.value) })} style={ctrlStyle} title="Breedte">
            {SIZES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <button className="btn-ghost" onClick={onRemove} title="Verwijderen" style={{ height: 30, width: 30, padding: 0, color: "var(--c-neg)" }}>×</button>
        </div>
      )}
      <div
        style={{
          flex: 1, borderRadius: 14,
          outline: isDropTarget ? "2px solid var(--c-accent)" : editing ? "1px dashed var(--c-border-strong)" : "none",
          outlineOffset: 4,
        }}
      >
        <WidgetRenderer widget={widget} data={data} catalog={catalog} ctx={ctx} />
      </div>
    </div>
  );
}
