// Keuze uit de basis-templates bij het maken van een nieuw dashboard.
import Modal from "./Modal.jsx";
import { TEMPLATES } from "../../lib/widgetCatalog.js";

export default function TemplatePicker({ onPick, onClose }) {
  return (
    <Modal title="Kies een template" onClose={onClose} width={560}>
      <div style={{ fontSize: 13.5, color: "var(--c-muted)", marginBottom: 16 }}>
        Start met een kant-en-klare indeling. Daarna pas je alles naar wens aan.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {TEMPLATES.map((t) => (
          <button
            key={t.id}
            onClick={() => onPick(t)}
            className="card"
            style={{
              textAlign: "left", padding: 16, cursor: "pointer", border: "1px solid var(--c-border)",
              background: "var(--c-surface)", display: "flex", flexDirection: "column", gap: 4,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>{t.name}</span>
              <span className="pill muted">{t.widgets.length} blokken</span>
            </div>
            <span style={{ fontSize: 13, color: "var(--c-muted)" }}>{t.description}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
