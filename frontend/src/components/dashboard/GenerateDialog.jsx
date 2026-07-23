// Dialoog om met een prompt een dashboard te laten samenstellen door de AI.
// De gebruiker beschrijft wat hij wil zien; na "Samenstellen" sluit de dialoog
// en toont de editor een skeleton-dashboard terwijl de AI bouwt.
import { useState } from "react";
import Modal from "./Modal.jsx";

const EXAMPLES = [
  "Een overzicht van mijn advertentierendement met kosten per bestelling",
  "Mijn belangrijkste SEO-cijfers en de best presterende zoekwoorden",
  "Waar komt mijn verkeer vandaan en hoeveel omzet levert het op",
];

export default function GenerateDialog({ onGenerate, onClose, initial = "" }) {
  const [prompt, setPrompt] = useState(initial);
  const [sent, setSent] = useState(false);

  const submit = (e) => {
    e.preventDefault();
    const v = prompt.trim();
    if (!v || sent) return;
    setSent(true);
    onGenerate(v); // de ouder sluit de dialoog en toont de skeleton
  };

  return (
    <Modal title="Dashboard samenstellen met AI" onClose={onClose} width={520}>
      <form onSubmit={submit}>
        <div style={{ fontSize: 13.5, color: "var(--c-muted)", marginBottom: 12, lineHeight: 1.5 }}>
          Beschrijf wat je op dit dashboard wilt zien. De assistent kiest passende widgets uit je
          gekoppelde kanalen en maakt zo nodig een berekende widget (zoals kosten per bestelling).
        </div>
        <textarea
          autoFocus
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
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
            <button key={ex} type="button" className="btn-ghost"
              onClick={() => setPrompt(ex)}
              style={{ height: 28, padding: "0 10px", fontSize: 12, borderRadius: 999 }}>
              {ex}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
          <button type="button" className="btn-ghost" onClick={onClose} style={{ height: 40, padding: "0 16px" }}>Annuleren</button>
          <button type="submit" className="btn-primary" disabled={!prompt.trim() || sent}
            style={{ height: 40, padding: "0 18px", opacity: !prompt.trim() || sent ? 0.5 : 1 }}>
            Samenstellen
          </button>
        </div>
      </form>
    </Modal>
  );
}
