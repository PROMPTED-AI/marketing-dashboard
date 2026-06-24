// Eén widget in de grid. In bewerkmodus verschijnt een regel met knoppen:
// titel wijzigen, type (als de bron meerdere kan), grootte, verplaatsen, verwijderen.
import WidgetRenderer from "../WidgetRenderer.jsx";
import { SOURCES, KINDS, SIZES } from "../../lib/widgetCatalog.js";

const selectStyle = {
  height: 30, padding: "0 8px", borderRadius: 8, border: "1px solid var(--c-border)",
  background: "var(--c-surface)", color: "var(--c-ink)", fontSize: 12.5, fontFamily: "inherit", fontWeight: 600,
};

export default function WidgetFrame({ widget, data, editing, onChange, onRemove, onMoveLeft, onMoveRight, isFirst, isLast }) {
  const src = SOURCES[widget.source];
  const kindOptions = src?.kinds || [widget.kind];

  return (
    <div style={{ gridColumn: `span ${widget.size}`, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
      {editing && (
        <div
          className="card"
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px", flexWrap: "wrap", background: "var(--c-surface-2)" }}
        >
          <input
            value={widget.title}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder={src?.label}
            style={{ ...selectStyle, flex: 1, minWidth: 90, fontWeight: 700 }}
          />
          {kindOptions.length > 1 && (
            <select value={widget.kind} onChange={(e) => onChange({ kind: e.target.value })} style={selectStyle} title="Type">
              {kindOptions.map((k) => <option key={k} value={k}>{KINDS[k].label}</option>)}
            </select>
          )}
          <select
            value={widget.size}
            onChange={(e) => onChange({ size: Number(e.target.value) })}
            style={selectStyle}
            title="Breedte"
          >
            {SIZES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <button className="btn-ghost" onClick={onMoveLeft} disabled={isFirst} title="Naar voren"
            style={{ height: 30, width: 30, padding: 0, opacity: isFirst ? 0.4 : 1 }}>←</button>
          <button className="btn-ghost" onClick={onMoveRight} disabled={isLast} title="Naar achteren"
            style={{ height: 30, width: 30, padding: 0, opacity: isLast ? 0.4 : 1 }}>→</button>
          <button className="btn-ghost" onClick={onRemove} title="Verwijderen"
            style={{ height: 30, width: 30, padding: 0, color: "var(--c-neg)" }}>×</button>
        </div>
      )}
      <div style={{ flex: 1, outline: editing ? "1px dashed var(--c-border-strong)" : "none", outlineOffset: 4, borderRadius: 14 }}>
        <WidgetRenderer widget={widget} data={data} />
      </div>
    </div>
  );
}
