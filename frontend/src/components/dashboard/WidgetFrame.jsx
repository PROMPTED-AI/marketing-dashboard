// Eén widget in de grid. In bewerkmodus verschijnt een regel met knoppen:
// sleephandvat (volgorde), titel, type, optioneel filter (bv. gebeurtenis),
// grootte, verwijderen.
import WidgetRenderer from "../WidgetRenderer.jsx";
import { SOURCES, KINDS, SIZES } from "../../lib/widgetCatalog.js";

const ctrlStyle = {
  height: 30, padding: "0 8px", borderRadius: 8, border: "1px solid var(--c-border)",
  background: "var(--c-surface)", color: "var(--c-ink)", fontSize: 12.5, fontFamily: "inherit", fontWeight: 600,
};

export default function WidgetFrame({
  widget, data, editing, onChange, onRemove,
  onDragStart, onDragEnd, onDropOn, isDragging, isDropTarget,
}) {
  const src = SOURCES[widget.source];
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
          {cfg && (
            <select
              value={cfgValue}
              onChange={(e) => onChange({ config: { ...(widget.config || {}), [cfg.key]: e.target.value } })}
              style={{ ...ctrlStyle, maxWidth: 160 }}
              title={cfg.label}
            >
              {cfgOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          )}
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
        <WidgetRenderer widget={widget} data={data} />
      </div>
    </div>
  );
}
