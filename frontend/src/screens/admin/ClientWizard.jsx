import { useState } from "react";
import { api, createInvitation, linkAgency, availableAssets, setOrgAssets } from "../../lib/api.js";
import { IcPlug, IcUsers, IcGrid, IcStar } from "../../components/icons.jsx";

// Klant-wizard: één vloeiende flow die de drie losse beheerstappen samenvoegt —
// (1) een klant-organisatie aanmaken, (2) de klant uitnodigen zodat die op de
// eigen omgeving kan inloggen, en (3) meteen kanalen inrichten (de bureau-Google-
// koppeling hergebruiken + property/site/Ads toewijzen). Stap 2 en 3 zijn
// optioneel: een admin kan de klant later uitnodigen of de klant zelf laten
// koppelen. Alle endpoints bestaan al; dit bundelt ze in één scherm.

const STEPS = [
  { key: "bedrijf", label: "Bedrijf", Icon: IcStar },
  { key: "toegang", label: "Toegang", Icon: IcUsers },
  { key: "kanalen", label: "Kanalen", Icon: IcPlug },
  { key: "klaar", label: "Klaar", Icon: IcGrid },
];

export default function ClientWizard({ onClose, onDone }) {
  const [step, setStep] = useState(0);
  const [org, setOrg] = useState(null);      // aangemaakte organisatie
  const [invite, setInvite] = useState(null); // { email, invite_url, emailed }
  const [assetSummary, setAssetSummary] = useState([]); // labels van toegewezen bronnen

  const idx = STEPS.findIndex((s) => s.key === STEPS[step].key);

  return (
    <div style={overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="card" style={{ width: 560, maxWidth: "calc(100vw - 32px)", padding: 0, maxHeight: "92vh", overflow: "auto" }}>
        {/* stepper */}
        <div style={{ display: "flex", gap: 6, padding: "18px 22px 0" }}>
          {STEPS.map((s, i) => (
            <div key={s.key} style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7, alignItems: "center" }}>
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: "50%",
                background: i < idx ? "var(--c-accent)" : i === idx ? "var(--c-accent-soft)" : "var(--c-track)",
                color: i < idx ? "#fff" : i === idx ? "var(--c-accent)" : "var(--c-muted)",
                border: i === idx ? "1px solid var(--c-accent)" : "1px solid transparent", fontWeight: 800, fontSize: 12,
              }}>
                {i < idx ? "✓" : i + 1}
              </div>
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".03em", textTransform: "uppercase", color: i === idx ? "var(--c-accent)" : "var(--c-muted)" }}>{s.label}</div>
            </div>
          ))}
        </div>
        <div style={{ height: 1, background: "var(--c-border)", margin: "16px 0 0" }} />

        <div style={{ padding: 26 }}>
          {STEPS[step].key === "bedrijf" && (
            <StepBedrijf
              onCreated={(o) => { setOrg(o); setStep(1); }}
              onCancel={onClose}
            />
          )}
          {STEPS[step].key === "toegang" && (
            <StepToegang
              org={org}
              onInvited={(inv) => { setInvite(inv); setStep(2); }}
              onSkip={() => setStep(2)}
            />
          )}
          {STEPS[step].key === "kanalen" && (
            <StepKanalen
              org={org}
              onNext={(labels) => { setAssetSummary(labels || []); setStep(3); }}
            />
          )}
          {STEPS[step].key === "klaar" && (
            <StepKlaar org={org} invite={invite} assetSummary={assetSummary} onDone={onDone} />
          )}
        </div>
      </div>
    </div>
  );
}

// Stap 1 — organisatie aanmaken op bedrijfsdomein.
function StepBedrijf({ onCreated, onCancel }) {
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const d = await api("/api/admin/organizations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), domain: domain.trim() }),
      });
      onCreated(d.organization);
    } catch (e2) { setErr(e2); setBusy(false); }
  };

  return (
    <form onSubmit={submit}>
      <div className="display" style={{ fontSize: 22, marginBottom: 4 }}>nieuwe klant</div>
      <div style={{ fontSize: 13, color: "var(--c-muted)", marginBottom: 18 }}>Maak de organisatie aan. In de volgende stappen nodig je de klant uit en richt je de kanalen in.</div>
      <label style={lbl}>Naam organisatie</label>
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Voorbeeld B.V." style={inp} />
      <label style={lbl}>E-maildomein</label>
      <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="voorbeeld.nl" style={inp} />
      <div style={{ fontSize: 12, color: "var(--c-muted)", marginTop: 6 }}>Iedereen die met dit domein inlogt, hoort bij deze klant.</div>
      {err && <div style={errBox}>{String(err.message || err)}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 22 }}>
        <button type="button" className="pill-btn" onClick={onCancel} style={btnGhost}>annuleren</button>
        <button type="submit" disabled={busy || !name.trim() || !domain.trim()} className="btn-primary" style={{ height: 42, padding: "0 20px", opacity: busy ? 0.7 : 1 }}>
          {busy ? "bezig…" : "aanmaken →"}
        </button>
      </div>
    </form>
  );
}

// Stap 2 — de klant uitnodigen (optioneel). Maakt een uitnodiging voor een
// specifiek e-mailadres; de link toont de wizard in de laatste stap.
function StepToegang({ org, onInvited, onSkip }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const d = await createInvitation(email.trim(), org.id, "client");
      onInvited(d);
    } catch (e2) { setErr(e2); setBusy(false); }
  };

  return (
    <form onSubmit={submit}>
      <div className="display" style={{ fontSize: 22, marginBottom: 4 }}>klant uitnodigen</div>
      <div style={{ fontSize: 13, color: "var(--c-muted)", marginBottom: 18 }}>
        <strong style={{ color: "var(--c-ink)" }}>{org?.name}</strong> is aangemaakt. Nodig de klant uit met een e-mailadres; die stelt via de link zelf een wachtwoord in en logt in op de eigen omgeving.
      </div>
      <label style={lbl}>E-mailadres klant</label>
      <input autoFocus type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={`klant@${org?.domain || "bedrijf.nl"}`} style={inp} />
      <div style={{ fontSize: 12, color: "var(--c-muted)", marginTop: 6 }}>Geen e-mail bij de hand? Sla dit over — je kunt later uitnodigen via “Gebruikers &amp; rollen”.</div>
      {err && <div style={errBox}>{String(err.message || err)}</div>}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 22 }}>
        <button type="button" className="pill-btn" onClick={onSkip} style={btnGhost}>overslaan →</button>
        <button type="submit" disabled={busy || !email.trim()} className="btn-primary" style={{ height: 42, padding: "0 20px", opacity: busy ? 0.7 : 1 }}>
          {busy ? "bezig…" : "uitnodigen →"}
        </button>
      </div>
    </form>
  );
}

// Stap 3 — kanalen inrichten (optioneel). Hergebruikt de bureau-Google-koppeling
// en wijst per kanaal de juiste bron toe. Meta/WooCommerce/Shopify koppelt de
// klant zelf; die stap verwijzen we naar de eigen omgeving.
function StepKanalen({ org, onNext }) {
  const [managed, setManaged] = useState(false);
  const [available, setAvailable] = useState(null); // { properties, sites, ads_accounts }
  const [assets, setAssets] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const link = async () => {
    setBusy(true); setErr(null);
    try {
      await linkAgency(org.id);
      const av = await availableAssets(org.id);
      setAvailable(av); setManaged(true);
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };

  const saveAndNext = async () => {
    setBusy(true); setErr(null);
    try {
      await setOrgAssets(org.id, assets);
      const labels = [
        assets.ga_property_id && "Analytics",
        assets.gsc_site_url && "Search Console",
        assets.ads_customer_id && "Ads",
      ].filter(Boolean);
      onNext(labels);
    } catch (e) { setErr(e); setBusy(false); }
  };

  const field = (label, key, options, idKey, labelFn) => (
    <label style={{ display: "block", marginBottom: 14 }}>
      <span style={lbl}>{label}</span>
      <select value={assets[key] || ""} onChange={(e) => setAssets((a) => ({ ...a, [key]: e.target.value || null }))} style={select}>
        <option value="">— niet toegewezen —</option>
        {(options || []).map((o) => <option key={o[idKey]} value={o[idKey]}>{labelFn(o)}</option>)}
      </select>
    </label>
  );

  return (
    <div>
      <div className="display" style={{ fontSize: 22, marginBottom: 4 }}>kanalen inrichten</div>
      <div style={{ fontSize: 13, color: "var(--c-muted)", marginBottom: 18 }}>
        Hergebruik je bureau-Google-koppeling en wijs de juiste bron toe. Meta, WooCommerce en Shopify koppelt de klant zelf in de eigen omgeving.
      </div>

      {!managed ? (
        <div>
          <div style={{ fontSize: 13.5, color: "var(--c-ink-soft)", lineHeight: 1.6, marginBottom: 16 }}>
            Klik hieronder om de Google-koppeling van je bureau-account te hergebruiken voor deze klant; daarna kies je per kanaal de bron. Wil je dat de klant zelf koppelt? Sla dit over.
          </div>
          {err && <div style={errBox}>{String(err.message || err)}</div>}
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 6 }}>
            <button type="button" className="pill-btn" onClick={() => onNext([])} style={btnGhost}>overslaan →</button>
            <button className="btn-primary" disabled={busy} onClick={link} style={{ height: 42, padding: "0 18px" }}>
              {busy ? "bezig…" : "gebruik bureau-koppeling"}
            </button>
          </div>
        </div>
      ) : (
        <div>
          {field("Google Analytics-property", "ga_property_id", available.properties, "property_id", (p) => p.display_name ? `${p.display_name} (${p.property_id})` : p.property_id)}
          {field("Search Console-site", "gsc_site_url", available.sites, "site_url", (s) => s.site_url)}
          {field("Google Ads-klant", "ads_customer_id", available.ads_accounts, "customer_id", (c) => c.name ? `${c.name} (${c.customer_id})` : c.customer_id)}
          <div style={{ fontSize: 12, color: "var(--c-muted)", marginBottom: 16 }}>
            Staat er niets in een lijst? Dan geeft de koppeling voor dat kanaal (nog) geen bronnen terug.
          </div>
          {err && <div style={errBox}>{String(err.message || err)}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button className="btn-primary" disabled={busy} onClick={saveAndNext} style={{ height: 42, padding: "0 20px" }}>{busy ? "opslaan…" : "opslaan en doorgaan →"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Stap 4 — samenvatting: toont de uitnodigingslink (kopieerbaar) en welke
// bronnen zijn toegewezen.
function StepKlaar({ org, invite, assetSummary, onDone }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(invite.invite_url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard geblokkeerd */ }
  };

  return (
    <div>
      <div className="display" style={{ fontSize: 22, marginBottom: 6 }}>klant staat klaar</div>
      <div style={{ fontSize: 13.5, color: "var(--c-muted)", lineHeight: 1.6, marginBottom: 18 }}>
        <strong style={{ color: "var(--c-ink)" }}>{org?.name}</strong> ({org?.domain}) is ingericht.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 }}>
        <SummaryRow label="Organisatie" value={`${org?.name} · ${org?.domain}`} ok />
        <SummaryRow
          label="Uitnodiging"
          value={invite ? (invite.emailed ? `verstuurd naar ${invite.email}` : `link voor ${invite.email}`) : "overgeslagen — later uit te nodigen"}
          ok={!!invite}
        />
        <SummaryRow
          label="Kanalen"
          value={assetSummary.length ? assetSummary.join(" · ") : "klant koppelt zelf in de eigen omgeving"}
          ok={assetSummary.length > 0}
        />
      </div>

      {invite && (
        <div style={{ marginBottom: 18 }}>
          <label style={lbl}>{invite.emailed ? "Uitnodigingslink (ook zelf te delen)" : "Deel deze eenmalige uitnodigingslink"}</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input readOnly value={invite.invite_url} onFocus={(e) => e.target.select()} style={{ ...inp, marginBottom: 0, fontSize: 12.5, color: "var(--c-ink-soft)" }} />
            <button className="btn-primary" onClick={copy} style={{ height: 44, padding: "0 16px", whiteSpace: "nowrap" }}>{copied ? "gekopieerd" : "kopieer"}</button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button className="btn-primary" style={{ height: 42, padding: "0 22px" }} onClick={onDone}>klaar</button>
      </div>
    </div>
  );
}

function SummaryRow({ label, value, ok }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", borderRadius: 11, background: "var(--c-surface-2)", border: "1px solid var(--c-border-soft)" }}>
      <span style={{ width: 22, height: 22, borderRadius: "50%", flex: "none", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, background: ok ? "var(--c-accent-soft)" : "var(--c-track)", color: ok ? "var(--c-accent)" : "var(--c-muted)" }}>{ok ? "✓" : "–"}</span>
      <span style={{ fontSize: 12, fontWeight: 700, color: "var(--c-muted)", width: 96, flex: "none", textTransform: "uppercase", letterSpacing: ".03em" }}>{label}</span>
      <span style={{ fontSize: 13, color: "var(--c-ink-soft)", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</span>
    </div>
  );
}

const overlay = { position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 16 };
const lbl = { display: "block", fontSize: 12.5, fontWeight: 700, color: "var(--c-ink-soft)", margin: "12px 0 6px" };
const inp = { width: "100%", height: 44, padding: "0 14px", fontSize: 14, borderRadius: 11, border: "1px solid var(--c-border)", background: "var(--c-surface)", color: "var(--c-ink)", boxSizing: "border-box", fontFamily: "inherit", marginBottom: 2 };
const select = { width: "100%", height: 42, padding: "0 12px", borderRadius: 10, border: "1px solid var(--c-border)", background: "var(--c-surface)", color: "var(--c-ink)", fontSize: 13.5, fontFamily: "inherit" };
const btnGhost = { height: 42, padding: "0 18px", fontSize: 13.5, borderRadius: 11, border: "1px solid var(--c-border)", background: "var(--c-surface)", color: "var(--c-ink-soft)", cursor: "pointer", fontWeight: 600 };
const errBox = { color: "var(--c-neg)", fontSize: 13, marginTop: 12 };
