// Dialoog om met een prompt een dashboard te laten samenstellen door de AI.
// De gebruiker beschrijft wat hij wil zien; na "Samenstellen" verschijnt het
// concept in de editor (nog niet opgeslagen) om te bekijken en bij te schaven.
import { useState } from "react";
import Modal from "./Modal.jsx";

const EXAMPLES = [
  "Een overzicht van mijn advertentierendement met kosten per bestelling",
  "Mijn belangrijkste SEO-cijfers en de best presterende zoekwoorden",
  "Waar komt mijn verkeer vandaan en hoeveel omzet levert het op",
];

export default function GenerateDialog({ onGenerate, onClose }) {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    const v = prompt.trim();
    if (!v || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await onGenerate(v); // ouder sluit de dialoog bij succes
    } catch (e2) {
      setErr(e2?.message || "Het samenstellen is niet gelukt.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Dashboard samenstellen met AI" onClose={busy ? undefined : onClose} width={520}>
      <form onSubmit={submit}>
        <div style={{ fontSize: 13.5, color: "var(--c-muted)", marginBottom: 12, lineHeight: 1.5 }}>
          Beschrijf wat je op dit dashboard wilt zien. De assistent kiest passende widgets uit je
          gekoppelde kanalen en maakt zo nodig een berekende widget (zoals kosten per bestelling).
        </div>
        <textarea
          autoFocus
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={busy}
          rows={4}
          placeholder="Bijvoorbeeld: laat mijn advertentie-uitgaven, conversies en kosten per conversie zien, plus mijn omzet."
          style={{
            width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--c-border)",
            background: "var(--c-surface)", color: "var(--c-ink)", fontSize: 14, fontFamily: "inherit",
            resize: "vertical", boxSizing: "border-box",
          }}
        />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" className="btn-ghost" disabled={busy}
              onClick={() => setPrompt(ex)}
              style={{ height: 28, padding: "0 10px", fontSize: 12, borderRadius: 999 }}>
              {ex}
            </button>
          ))}
        </div>
        {err && <div style={{ color: "var(--c-neg)", fontSize: 13, marginTop: 12 }}>{err}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy} style={{ height: 40, padding: "0 16px" }}>Annuleren</button>
          <button type="submit" className="btn-primary" disabled={!prompt.trim() || busy}
            style={{ height: 40, padding: "0 18px", opacity: !prompt.trim() || busy ? 0.5 : 1 }}>
            {busy ? "AI stelt samen…" : "Samenstellen"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
