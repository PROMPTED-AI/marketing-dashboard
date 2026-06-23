// Generic tab placeholder. Real Overview/Analytics/Search Console land in later phases.
export default function Placeholder({ title, note, comingSoon }) {
  return (
    <div>
      <div className="display" style={{ fontSize: 30, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 13.5, color: "var(--c-muted)", marginBottom: 22 }}>
        {note || "dit onderdeel wordt binnenkort gevuld."}
      </div>
      <div className="card" style={{ padding: 40, display: "grid", placeItems: "center", textAlign: "center", minHeight: 240 }}>
        <div>
          {comingSoon && <div className="pill accent" style={{ marginBottom: 12 }}>binnenkort</div>}
          <div style={{ color: "var(--c-muted)", fontSize: 14, maxWidth: 420, lineHeight: 1.6 }}>
            {comingSoon
              ? "Deze koppeling komt in een volgende iteratie beschikbaar."
              : "Inhoud voor dit tabblad volgt in de volgende ontwikkelfase."}
          </div>
        </div>
      </div>
    </div>
  );
}
