// Keuze uit de basis-templates van het actieve kanaal bij het maken van een
// nieuw dashboard. Templates die bij het bedrijfstype-profiel passen staan
// bovenaan; de andere zijn bereikbaar via "toon alle bedrijfstypes" (soft —
// niets wordt permanent verborgen).
import { useState } from "react";
import Modal from "./Modal.jsx";
import { templatesForProfile } from "../../lib/widgets/kit.js";

const PROFILE_LABEL = { leadgen: "Leadgen", ecommerce: "E-commerce" };

export default function TemplatePicker({ catalog, businessType = "leadgen", onPick, onClose }) {
  const [showAll, setShowAll] = useState(false);
  const { match, rest } = templatesForProfile(catalog, businessType);
  const shown = showAll ? [...match, ...rest] : match;
  const hasOther = rest.length > 0;

  return (
    <Modal title="Kies een template" onClose={onClose} width={560}>
      <div style={{ fontSize: 13.5, color: "var(--c-muted)", marginBottom: 16 }}>
        Start met een kant-en-klare indeling. Daarna pas je alles naar wens aan.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {shown.map((t) => (
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
                {t.profile && t.profile !== "both" && PROFILE_LABEL[t.profile] && (
                  <span className="pill muted">{PROFILE_LABEL[t.profile]}</span>
                )}
                {t.audience && <span className="pill accent">{t.audience}</span>}
                <span className="pill muted">{t.widgets.length} blokken</span>
              </span>
            </div>
            <span style={{ fontSize: 13, color: "var(--c-muted)" }}>{t.description}</span>
          </button>
        ))}
      </div>
      {hasOther && (
        <button
          onClick={() => setShowAll((v) => !v)}
          style={{
            marginTop: 14, background: "none", border: "none", cursor: "pointer",
            color: "var(--c-accent)", fontSize: 13, fontWeight: 700, padding: 0,
          }}
        >
          {showAll ? "Toon alleen passende templates" : `Toon alle bedrijfstypes (+${rest.length})`}
        </button>
      )}
    </Modal>
  );
}
