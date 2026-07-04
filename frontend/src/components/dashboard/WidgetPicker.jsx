// "Widget toevoegen": kies een databron (gegroepeerd) uit de catalogus van het
// actieve kanaal. De widget krijgt het standaard-visualisatietype van die bron;
// dat is daarna per widget te wijzigen.
import Modal from "./Modal.jsx";
import { KINDS } from "../../lib/widgets/kit.js";

export default function WidgetPicker({ catalog, onPick, onClose }) {
  return (
    <Modal title="Widget toevoegen" onClose={onClose} width={560}>
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {catalog.GROUPS.map((group) => (
          <div key={group.label}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--c-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>
              {group.label}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {group.ids.map((id) => {
                const src = catalog.SOURCES[id];
                if (!src) return null;
                return (
                  <button
                    key={id}
                    onClick={() => onPick(id)}
                    className="btn-ghost"
                    style={{ height: "auto", padding: "10px 14px", flexDirection: "column", alignItems: "flex-start", gap: 2 }}
                  >
                    <span style={{ fontWeight: 700, fontSize: 13.5 }}>{src.label}</span>
                    <span style={{ fontSize: 11.5, color: "var(--c-muted)", fontWeight: 500 }}>
                      {src.kinds.map((k) => KINDS[k].label).join(" · ")}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
