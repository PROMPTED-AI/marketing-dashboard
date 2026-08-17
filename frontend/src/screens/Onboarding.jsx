import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { connectUrl } from "../lib/api.js";
import { IcArrow, IcCheck, GaGlyph, GscGlyph, AdsGlyph, MetaGlyph } from "../components/icons.jsx";
import { Logo } from "../components/Brand.jsx";

const TOOLS = [
  { key: "ga", name: "Google Analytics", desc: "Bezoekers, sessies, conversies en gedrag (GA4).", note: "OAuth via Google · veilig en alleen-lezen", Glyph: GaGlyph, bg: "#FFF3E0", live: true },
  { key: "gsc", name: "Search Console", desc: "Organisch verkeer, posities en zoekwoorden (SEO).", note: "OAuth via Google · veilig en alleen-lezen", Glyph: GscGlyph, bg: "#E8F0FE", live: true },
  { key: "ads", name: "Google Ads", desc: "Campagnes, kosten, klikken en ROAS.", note: "Binnenkort beschikbaar", Glyph: AdsGlyph, bg: "#E8F0FE", live: false },
  { key: "meta", name: "META Ads", desc: "Facebook- en Instagram-campagnes en social bereik.", note: "Binnenkort beschikbaar", Glyph: MetaGlyph, bg: "#E7F0FF", live: false },
];

export default function Onboarding() {
  const nav = useNavigate();
  const [sel, setSel] = useState({ ga: true, gsc: true, ads: false, meta: false });
  const count = Object.values(sel).filter(Boolean).length;
  const allSel = TOOLS.every((t) => sel[t.key]);

  const toggle = (k) => setSel((s) => ({ ...s, [k]: !s[k] }));
  const toggleAll = () => {
    const v = !allSel;
    setSel({ ga: v, gsc: v, ads: v, meta: v });
  };

  // Connect only the selected Google tools (incremental authorization).
  const cont = () => {
    const googleSel = [sel.ga && "google_analytics", sel.gsc && "search_console"].filter(Boolean);
    localStorage.setItem("mm-onboarded", "1");
    if (googleSel.length) window.location.href = connectUrl(googleSel, "/app/overview");
    else nav("/app/overview");
  };
  const skip = () => {
    localStorage.setItem("mm-onboarded", "1");
    nav("/app/overview");
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--c-page)", display: "flex", justifyContent: "center", padding: 24 }}>
      <div className="card" style={{ width: "min(1100px, 100%)", borderRadius: 16, overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "var(--sh-md)" }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "20px 36px", borderBottom: "1px solid var(--c-border)" }}>
          <Logo size={28} />
          <div style={{ flex: 1 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--c-muted)" }}>
            <span style={{ color: "var(--c-accent-strong)", fontWeight: 600 }}>✓ Account</span><span style={{ opacity: 0.4 }}>···</span>
            <span style={{ color: "var(--c-accent-strong)", fontWeight: 600 }}>Koppelen</span><span style={{ opacity: 0.4 }}>···</span>
            <span>Klaar</span>
          </div>
          <div onClick={skip} style={{ marginLeft: 14, fontSize: 13, color: "var(--c-muted)", fontWeight: 600, cursor: "pointer" }}>Overslaan</div>
        </div>

        {/* body */}
        <div style={{ padding: "36px 48px" }}>
          <div className="mm-eyebrow" style={{ color: "var(--c-accent-strong)", marginBottom: 10 }}>Stap 2 van 3</div>
          <div className="display" style={{ fontSize: 32, letterSpacing: "var(--ls-display)", marginBottom: 10 }}>Koppel je marketingbronnen</div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, gap: 16 }}>
            <div style={{ fontSize: 15, color: "var(--c-muted)", maxWidth: 560 }}>
              Kies welke bronnen je wilt koppelen. Eén is genoeg om te starten, later koppelen kan altijd via Integraties.
            </div>
            <div onClick={toggleAll} style={selectAll}>
              <div style={{ ...box, ...(allSel ? boxOn : {}) }}>{allSel && <IcCheck />}</div>
              Selecteer alles
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
            {TOOLS.map((t) => (
              <div key={t.key} onClick={() => toggle(t.key)} style={{ ...toolCard, ...(sel[t.key] ? toolCardOn : {}) }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
                  <div style={{ width: 52, height: 52, borderRadius: 13, background: t.bg, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><t.Glyph /></div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 17, fontWeight: 700 }}>{t.name}</span>
                      {!t.live && <span className="pill accent" style={{ fontSize: 10, padding: "2px 8px" }}>binnenkort</span>}
                    </div>
                    <div style={{ fontSize: 13, color: "var(--c-muted)", lineHeight: 1.5, marginTop: 3 }}>{t.desc}</div>
                  </div>
                  <div style={{ ...check, ...(sel[t.key] ? checkOn : {}) }}>{sel[t.key] && <IcCheck s={14} />}</div>
                </div>
                <div style={{ marginTop: 18, display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--c-muted)" }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: t.live ? "var(--c-pos)" : "var(--c-muted)" }} />{t.note}
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 28 }}>
            <div style={{ fontSize: 14, color: "var(--c-muted)" }}>{count} van 4 bronnen geselecteerd</div>
            <button className="btn-primary" style={{ height: 52, padding: "0 32px", fontSize: 15 }} disabled={!count} onClick={cont}>
              {count ? `Koppel ${count} bron${count === 1 ? "" : "nen"}` : "Kies minstens één bron"} <IcArrow />
            </button>
          </div>
          <div style={{ fontSize: 12, color: "var(--c-muted)", marginTop: 14 }}>
            Google Analytics en Search Console worden samen in één Google-toestemming gekoppeld. Google Ads en META volgen later.
          </div>
        </div>
      </div>
    </div>
  );
}

const selectAll = { display: "inline-flex", alignItems: "center", gap: 9, padding: "9px 15px", borderRadius: "var(--radius-pill)", border: "1px solid var(--c-border)", background: "var(--c-surface)", fontFamily: "var(--font-display)", fontSize: 13, fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap" };
const box = { width: 18, height: 18, borderRadius: "var(--radius-xs)", border: "2px solid var(--c-border-strong)", display: "flex", alignItems: "center", justifyContent: "center" };
const boxOn = { background: "var(--c-accent)", border: "2px solid var(--c-accent)" };
const toolCard = { position: "relative", padding: 24, borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)", background: "var(--c-surface)", cursor: "pointer", boxShadow: "var(--sh-sm)", transition: "box-shadow var(--dur-base) var(--ease-standard)" };
const toolCardOn = { boxShadow: "0 0 0 2px var(--c-accent) inset, var(--sh-md)" };
const check = { width: 24, height: 24, borderRadius: "50%", border: "2px solid var(--c-border)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" };
const checkOn = { background: "var(--c-accent)", border: "2px solid var(--c-accent)" };
