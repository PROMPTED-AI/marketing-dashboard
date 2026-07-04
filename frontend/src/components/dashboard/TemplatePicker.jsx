// Keuze uit de basis-templates van het actieve kanaal bij het maken van een
// nieuw dashboard.
import Modal from "./Modal.jsx";

export default function TemplatePicker({ catalog, onPick, onClose }) {
  return (
    <Modal title="Kies een template" onClose={onClose} width={560}>
      <div style={{ fontSize: 13.5, color: "var(--c-muted)", marginBottom: 16 }}>
        Start met een kant-en-klare indeling. Daarna pas je alles naar wens aan.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {catalog.TEMPLATES.map((t) => (
          <button
            key={t.id}
            onClick={() => onPick(t)}
            className="card"
            style={{
              textAlign: "left", padding: 16, cursor: "pointer", border: "1px solid var(--c-border)",
              background: "var(--c-surface)", display: "flex", flexDirection: "column", gap: 4,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>{t.name}</span>
              <span style={{ display: "flex", gap: 6, flex: "none" }}>
                {t.audience && <span className="pill accent">{t.audience}</span>}
                <span className="pill muted">{t.widgets.length} blokken</span>
              </span>
            </div>
            <span style={{ fontSize: 13, color: "var(--c-muted)" }}>{t.description}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
