// Feedbackknop aan de rechterrand van het scherm. Klik klapt een paneel uit
// waarin de gebruiker een categorie kiest, een toelichting schrijft en bij een
// bug ook de impact aangeeft. De actieve pagina gaat automatisch mee, zodat de
// beheerder ziet waar de feedback over gaat. Items landen in de kanban-kolom
// Requests van de beheeromgeving.
import { useState } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../lib/api.js";
import { useActiveOrg } from "../lib/ActiveOrgProvider.jsx";

const CATEGORIES = [
  { key: "bug", label: "Bug of fout" },
  { key: "idee", label: "Idee of verzoek" },
  { key: "vraag", label: "Vraag" },
  { key: "compliment", label: "Compliment" },
  { key: "anders", label: "Anders" },
];

const SEVERITIES = ["Blokkerend", "Hinderlijk", "Cosmetisch"];

export default function FeedbackButton() {
  const { orgId } = useActiveOrg();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState(null);
  const [severity, setSeverity] = useState(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);

  const reset = () => {
    setCategory(null); setSeverity(null); setMessage(""); setSent(false); setError(null);
  };

  const close = () => { setOpen(false); reset(); };

  const submit = async () => {
    if (!category || !message.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          message: message.trim(),
          page: pathname,
          severity: category === "bug" ? severity : null,
          org_id: orgId || undefined,
        }),
      });
      setSent(true);
    } catch (e) {
      let msg = e?.message || "Versturen is niet gelukt.";
      try { msg = JSON.parse(msg).detail || msg; } catch { /* platte tekst */ }
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* de uitklapknop zelf, verticaal tegen de rechterrand */}
      <button className="no-print" onClick={() => setOpen(true)} style={tabBtn} aria-label="Feedback geven">
        Feedback
      </button>

      {open && (
        <div className="no-print" onClick={close} style={scrim}>
          <div className="bubble-in" onClick={(e) => e.stopPropagation()} style={panel}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <div className="display" style={{ fontSize: 22 }}>feedback</div>
              <button className="btn-ghost" onClick={close} style={{ height: 32, width: 32, padding: 0, fontSize: 16 }}>×</button>
            </div>

            {sent ? (
              <div style={{ padding: "26px 0", textAlign: "center" }}>
                <div style={{ fontSize: 34, marginBottom: 10 }}>🙌</div>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Bedankt voor je feedback!</div>
                <div style={{ fontSize: 13, color: "var(--c-muted)", marginBottom: 18 }}>
                  We hebben je bericht ontvangen en pakken het op.
                </div>
                <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                  <button className="btn-ghost" onClick={reset} style={{ height: 38, padding: "0 16px" }}>Nog iets doorgeven</button>
                  <button className="btn-primary" onClick={close} style={{ height: 38, padding: "0 18px" }}>Sluiten</button>
                </div>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 13, color: "var(--c-muted)", marginBottom: 14 }}>
                  Laat weten wat er beter kan of wat je mist. We lezen alles.
                </div>

                <div style={fieldLabel}>Waar gaat het over?</div>
                <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 14 }}>
                  {CATEGORIES.map((c) => (
                    <button
                      key={c.key}
                      className="pill-btn"
                      onClick={() => setCategory(c.key)}
                      style={{ ...catChip, ...(category === c.key ? catChipOn : {}) }}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>

                {category === "bug" && (
                  <>
                    <div style={fieldLabel}>Hoe vervelend is het?</div>
                    <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 14 }}>
                      {SEVERITIES.map((s) => (
                        <button key={s} className="pill-btn" onClick={() => setSeverity(s)} style={{ ...catChip, ...(severity === s ? catChipOn : {}) }}>
                          {s}
                        </button>
                      ))}
                    </div>
                  </>
                )}

                <div style={fieldLabel}>Toelichting</div>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={5}
                  placeholder={category === "bug"
                    ? "Wat ging er mis, en wat had je verwacht? Welke stappen gingen eraan vooraf?"
                    : "Vertel zoveel mogelijk. Hoe concreter, hoe sneller we er iets mee kunnen."}
                  style={textarea}
                />

                <div style={{ fontSize: 11.5, color: "var(--c-muted)", margin: "8px 0 16px" }}>
                  Wordt meegestuurd: je e-mailadres en de huidige pagina ({pathname}).
                </div>

                {error && <div style={{ fontSize: 13, color: "var(--c-neg)", fontWeight: 600, marginBottom: 10 }}>{error}</div>}

                <button
                  className="btn-primary"
                  onClick={submit}
                  disabled={busy || !category || !message.trim()}
                  style={{ height: 44, width: "100%", opacity: busy || !category || !message.trim() ? 0.5 : 1 }}
                >
                  {busy ? "Versturen…" : "Feedback versturen"}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

const tabBtn = {
  position: "fixed", right: 0, top: "50%",
  transform: "rotate(-90deg) translateY(-100%)", transformOrigin: "100% 0",
  zIndex: 90, padding: "9px 18px 7px", border: "1px solid var(--c-border)", borderBottom: "none",
  borderRadius: "10px 10px 0 0", background: "var(--c-accent)", color: "var(--c-accent-ink)",
  fontFamily: "Montserrat, sans-serif", fontSize: 12.5, fontWeight: 800, letterSpacing: ".04em",
  cursor: "pointer", boxShadow: "var(--sh-md)",
};
const scrim = { position: "fixed", inset: 0, background: "rgba(10, 10, 42, .42)", zIndex: 95, display: "flex", justifyContent: "flex-end" };
const panel = {
  width: "min(400px, 100vw)", height: "100%", overflowY: "auto", background: "var(--c-surface)",
  borderLeft: "1px solid var(--c-border)", boxShadow: "var(--sh-lg)", padding: "22px 24px",
};
const fieldLabel = { fontSize: 12.5, fontWeight: 700, marginBottom: 7 };
const catChip = {
  padding: "8px 13px", borderRadius: 999, border: "1px solid var(--c-border)",
  background: "var(--c-surface)", color: "var(--c-ink)", fontSize: 13, fontWeight: 600, cursor: "pointer",
};
const catChipOn = { border: "1px solid var(--c-accent)", background: "var(--c-accent)", color: "var(--c-accent-ink)" };
const textarea = {
  width: "100%", resize: "vertical", padding: "12px 14px", borderRadius: 12,
  border: "1px solid var(--c-border)", background: "var(--c-surface)", color: "var(--c-ink)",
  fontSize: 13.5, fontFamily: "Montserrat, sans-serif", lineHeight: 1.5, minHeight: 110,
};
