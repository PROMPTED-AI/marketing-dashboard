import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { connectUrl, metaLoginUrl, setBusinessType } from "../lib/api.js";
import { useMe } from "../lib/useMe.jsx";
import { IcStar, IcArrow, IcCheck, GaGlyph, GscGlyph, AdsGlyph, MetaGlyph } from "../components/icons.jsx";

const TOOLS = [
  { key: "ga", name: "Google Analytics", desc: "Bezoekers, sessies, conversies en gedrag (GA4).", note: "OAuth via Google · veilig en alleen-lezen", Glyph: GaGlyph, bg: "#FFF3E0", live: true },
  { key: "gsc", name: "Search Console", desc: "Organisch verkeer, posities en zoekwoorden (SEO).", note: "OAuth via Google · veilig en alleen-lezen", Glyph: GscGlyph, bg: "#E8F0FE", live: true },
  { key: "ads", name: "Google Ads", desc: "Campagnes, kosten, klikken en ROAS.", note: "OAuth via Google · veilig en alleen-lezen", Glyph: AdsGlyph, bg: "#E8F0FE", live: true },
  { key: "meta", name: "META / social", desc: "Campagnes, bereik en betrokkenheid op Facebook en Instagram.", note: "Facebook Login · veilig en alleen-lezen", Glyph: MetaGlyph, bg: "#E7F0FF", live: true },
];

// De twee bedrijfsprofielen. Het gekozen profiel richt de dashboards standaard in
// (welke views/KPI's vooraan staan) en wordt org-breed opgeslagen.
const PROFILES = [
  { key: "leadgen", name: "Leadgeneratie", desc: "Je stuurt op aanvragen: formulieren, offertes en telefoongesprekken. Dashboards tonen conversies, kosten per lead (CPA) en de pagina's die leads opleveren." },
  { key: "ecommerce", name: "E-commerce", desc: "Je verkoopt online. Dashboards tonen omzet, bestellingen, ROAS en je best verkochte producten." },
];

export default function Onboarding() {
  const nav = useNavigate();
  const { reload } = useMe();
  const [step, setStep] = useState("profile"); // 'profile' | 'tools'
  const [profile, setProfile] = useState(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [sel, setSel] = useState({ ga: true, gsc: true, ads: false, meta: false });
  const count = Object.values(sel).filter(Boolean).length;
  const allSel = TOOLS.every((t) => sel[t.key]);

  const toggle = (k) => setSel((s) => ({ ...s, [k]: !s[k] }));
  const toggleAll = () => {
    const v = !allSel;
    setSel({ ga: v, gsc: v, ads: v, meta: v });
  };

  // Save the chosen profile org-wide, then move on to connecting tools.
  const confirmProfile = async () => {
    if (!profile || savingProfile) return;
    setSavingProfile(true);
    try {
      await setBusinessType(profile);
      reload(); // refresh me.organization.business_type so dashboards default correctly
    } catch {
      /* niet-blokkerend: type is later in Instellingen te wijzigen */
    } finally {
      setSavingProfile(false);
      setStep("tools");
    }
  };

  // Connect only the selected Google tools (incremental authorization).
  const cont = () => {
    const googleSel = [sel.ga && "google_analytics", sel.gsc && "search_console", sel.ads && "google_ads"].filter(Boolean);
    localStorage.setItem("kompas-onboarded", "1");
    // Meta has its own (Facebook) consent. If Google tools are also selected,
    // connect those first and return to Integraties to add Meta there.
    if (googleSel.length) window.location.href = connectUrl(googleSel, sel.meta ? "/app/integrations" : "/app/analytics");
    else if (sel.meta) window.location.href = metaLoginUrl(null, "/app/analytics");
    else nav("/app/analytics");
  };
  const skip = () => {
    localStorage.setItem("kompas-onboarded", "1");
    nav("/app/analytics");
  };

  // Visuele stepper: genummerde cirkels met vinkje voor afgeronde stappen en
  // een lijn die meekleurt met de voortgang.
  const steps = [
    { label: "Account", done: true, active: false },
    { label: "Profiel", done: step === "tools", active: step === "profile" },
    { label: "Koppelen", done: false, active: step === "tools" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "var(--c-page)", display: "flex", justifyContent: "center", padding: 24 }}>
      <div className="card" style={{ width: "min(1100px, 100%)", borderRadius: 16, overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "var(--sh-md)" }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "22px 36px", borderBottom: "1px solid var(--c-border)" }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: "var(--c-accent)", display: "flex", alignItems: "center", justifyContent: "center" }}><IcStar /></div>
          <div className="display" style={{ fontSize: 20 }}>kompas</div>
          <div style={{ flex: 1 }} />
          <div className="hide-mobile" style={{ display: "flex", alignItems: "center" }}>
            {steps.map((s, i) => (
              <div key={s.label} style={{ display: "flex", alignItems: "center" }}>
                {i > 0 && <div style={{ ...stepLine, background: s.done || s.active ? "var(--c-accent)" : "var(--c-track)" }} />}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ ...stepDot, ...(s.done ? stepDotDone : s.active ? stepDotActive : {}) }}>
                    {s.done ? <IcCheck s={13} /> : i + 1}
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: s.done ? "var(--c-pos)" : s.active ? "var(--c-ink)" : "var(--c-muted)" }}>
                    {s.label}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <div onClick={skip} style={{ marginLeft: 18, fontSize: 13, color: "var(--c-muted)", fontWeight: 600, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 3 }}>Overslaan</div>
        </div>

        {/* body */}
        {step === "profile" ? (
          <div style={{ padding: "36px 48px" }}>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--c-accent)", marginBottom: 10 }}>stap 1 van 2</div>
            <div className="display" style={{ fontSize: 32, marginBottom: 10 }}>wat voor bedrijf ben je?</div>
            <div style={{ fontSize: 15, color: "var(--c-muted)", maxWidth: 620, marginBottom: 24 }}>
              Hiermee richten we je dashboards meteen goed in. Je kunt dit later altijd wijzigen in Instellingen.
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
              {PROFILES.map((p) => (
                <div key={p.key} onClick={() => setProfile(p.key)} style={{ ...toolCard, ...(profile === p.key ? toolCardOn : {}) }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
                    <div style={{ flex: 1 }}>
                      <span style={{ fontSize: 18, fontWeight: 700 }}>{p.name}</span>
                      <div style={{ fontSize: 13.5, color: "var(--c-muted)", lineHeight: 1.55, marginTop: 6 }}>{p.desc}</div>
                    </div>
                    <div style={{ ...check, ...(profile === p.key ? checkOn : {}) }}>{profile === p.key && <IcCheck s={14} />}</div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", marginTop: 28 }}>
              <button className="btn-primary" style={{ height: 52, padding: "0 32px", fontSize: 15, opacity: profile && !savingProfile ? 1 : 0.5, cursor: profile ? "pointer" : "not-allowed" }} disabled={!profile || savingProfile} onClick={confirmProfile}>
                {savingProfile ? "bezig…" : "verder"} <IcArrow />
              </button>
            </div>
          </div>
        ) : (
          <div style={{ padding: "36px 48px" }}>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--c-accent)", marginBottom: 10 }}>stap 2 van 2</div>
            <div className="display" style={{ fontSize: 32, marginBottom: 10 }}>koppel je marketingtools.</div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, gap: 16 }}>
              <div style={{ fontSize: 15, color: "var(--c-muted)", maxWidth: 560 }}>
                Kies welke bronnen je wilt verbinden. Je kunt er één kiezen of alles tegelijk. Later koppelen kan altijd via Integraties.
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
              <div onClick={() => setStep("profile")} style={{ fontSize: 14, color: "var(--c-muted)", fontWeight: 600, cursor: "pointer" }}>← terug</div>
              <button className="btn-primary" style={{ height: 52, padding: "0 32px", fontSize: 15, opacity: count ? 1 : 0.5, cursor: count ? "pointer" : "not-allowed" }} disabled={!count} onClick={cont}>
                {count ? `verbind ${count} tool${count === 1 ? "" : "s"}` : "kies minstens één tool"} <IcArrow />
              </button>
            </div>
            <div style={{ fontSize: 12, color: "var(--c-muted)", marginTop: 14 }}>
              Google Analytics, Search Console en Google Ads worden samen in één Google-toestemming gekoppeld. META loopt via een aparte Facebook-toestemming (koppel je daarna eventueel via Integraties).
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const stepDot = { width: 26, height: 26, borderRadius: "50%", border: "2px solid var(--c-border-strong)", color: "var(--c-muted)", background: "var(--c-surface)", fontSize: 12.5, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" };
const stepDotActive = { border: "2px solid var(--c-accent)", background: "var(--c-accent)", color: "var(--c-accent-ink)" };
const stepDotDone = { border: "2px solid var(--c-pos)", background: "var(--c-pos)", color: "#fff" };
const stepLine = { width: 34, height: 2, borderRadius: 1, margin: "0 10px" };
const selectAll = { display: "inline-flex", alignItems: "center", gap: 9, padding: "9px 15px", borderRadius: 999, border: "1px solid var(--c-border)", background: "var(--c-surface)", fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" };
const box = { width: 18, height: 18, borderRadius: 6, border: "2px solid var(--c-muted)", display: "flex", alignItems: "center", justifyContent: "center" };
const boxOn = { background: "var(--c-accent)", border: "2px solid var(--c-accent)" };
const toolCard = { position: "relative", padding: 26, borderRadius: 16, border: "1px solid var(--c-border)", background: "var(--c-surface)", cursor: "pointer", boxShadow: "var(--sh-sm)" };
const toolCardOn = { boxShadow: "0 0 0 2px var(--c-accent) inset, var(--sh-md)" };
const check = { width: 24, height: 24, borderRadius: "50%", border: "2px solid var(--c-border)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" };
const checkOn = { background: "var(--c-accent)", border: "2px solid var(--c-accent)" };
