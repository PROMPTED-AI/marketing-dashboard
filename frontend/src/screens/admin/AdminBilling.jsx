import { useEffect, useState } from "react";
import { api } from "../../lib/api.js";
import { IcCheck } from "../../components/icons.jsx";

// Conceptpakketten: drie niveaus tussen 100 en 300 euro per maand, elk met
// eenmalig 500 euro onboarding.
const PACKAGES = [
  {
    key: "start", name: "Start", price: 100,
    tagline: "Voor wie wil beginnen met inzicht",
    features: ["2 kanaalkoppelingen", "Standaard dashboards", "Maandelijkse e-mailrapportage", "Support via e-mail"],
  },
  {
    key: "groei", name: "Groei", price: 200, popular: true,
    tagline: "Voor bedrijven die willen groeien op data",
    features: ["Alle kanaalkoppelingen", "Eigen dashboards samenstellen", "AI-assistent en signalen", "Support via e-mail en telefoon"],
  },
  {
    key: "pro", name: "Pro", price: 300,
    tagline: "Voor teams die er alles uit willen halen",
    features: ["Alles uit Groei", "Kwartaalsessie met een specialist", "Prioriteit bij nieuwe features", "Persoonlijke ondersteuning"],
  },
];

const FIELDS = [
  ["company_name", "Bedrijfsnaam", "Bedrijf B.V."],
  ["billing_email", "E-mailadres facturatie", "administratie@bedrijf.nl"],
  ["address", "Adres", "Straatnaam 1"],
  ["postal_city", "Postcode en plaats", "1234 AB Amsterdam"],
  ["kvk", "KvK-nummer", "12345678"],
  ["btw", "Btw-nummer", "NL123456789B01"],
  ["reference", "Referentie of PO-nummer", "Optioneel"],
];

// Pakketten & facturatie: conceptprijzen, pakketkeuze per klant en de
// facturatiegegevens van die klant.
export default function AdminBilling() {
  const [orgs, setOrgs] = useState(null);
  const [error, setError] = useState(null);
  const [orgId, setOrgId] = useState("");
  const [billing, setBilling] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pkgBusy, setPkgBusy] = useState(false);

  const reloadOrgs = () => api("/api/admin/organizations").then((d) => {
    const list = (d.organizations || []).filter((o) => !o.providers || true);
    setOrgs(list);
    setOrgId((cur) => cur || list[0]?.id || "");
  }).catch(setError);

  useEffect(() => { reloadOrgs(); }, []);

  useEffect(() => {
    if (!orgId) return;
    setBilling(null);
    setSaved(false);
    api(`/api/admin/organizations/${orgId}/billing`).then((d) => setBilling(d.billing)).catch(setError);
  }, [orgId]);

  const org = (orgs || []).find((o) => o.id === orgId);

  const pickPackage = async (key) => {
    if (!orgId) return;
    setPkgBusy(true);
    try {
      await api(`/api/admin/organizations/${orgId}/package`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ package: org?.package === key ? null : key }),
      });
      await reloadOrgs();
    } catch (e) { setError(e); } finally { setPkgBusy(false); }
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    try {
      const d = await api(`/api/admin/organizations/${orgId}/billing`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(billing),
      });
      setBilling(d.billing);
      setSaved(true);
    } catch (e2) { setError(e2); } finally { setSaving(false); }
  };

  if (error) return <div className="card" style={{ padding: 20, color: "var(--c-neg)" }}>Fout: {String(error.message || error)}</div>;
  if (orgs === null) return <div style={{ display: "grid", placeItems: "center", padding: 60 }}><div className="spin" /></div>;

  return (
    <div>
      <div className="display" style={{ fontSize: 30 }}>pakketten &amp; facturatie</div>
      <div style={{ fontSize: 13.5, color: "var(--c-muted)", margin: "4px 0 20px" }}>
        Drie pakketten, elk met eenmalig € 500 onboarding. Kies per klant een pakket en vul de facturatiegegevens in.
      </div>

      {/* klantkeuze */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
        <label style={{ fontSize: 13, fontWeight: 700 }}>Klant:</label>
        <select value={orgId} onChange={(e) => setOrgId(e.target.value)} style={orgSelect}>
          {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        {org?.package && <span className="pill accent">Huidig pakket: {PACKAGES.find((p) => p.key === org.package)?.name || org.package}</span>}
      </div>

      {/* pakketten */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, marginBottom: 26 }}>
        {PACKAGES.map((p) => {
          const current = org?.package === p.key;
          return (
            <div key={p.key} className="card" style={{ padding: 22, position: "relative", border: current ? "2px solid var(--c-accent)" : p.popular ? "1px solid var(--c-accent)" : "1px solid var(--c-border)" }}>
              {p.popular && !current && <span className="pill accent" style={{ position: "absolute", top: -11, right: 14 }}>Populair</span>}
              {current && <span className="pill pos" style={{ position: "absolute", top: -11, right: 14 }}>Huidig pakket</span>}
              <div style={{ fontSize: 16, fontWeight: 800 }}>{p.name}</div>
              <div style={{ fontSize: 12.5, color: "var(--c-muted)", margin: "3px 0 12px" }}>{p.tagline}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <span className="display" style={{ fontSize: 34 }}>€ {p.price}</span>
                <span style={{ fontSize: 12.5, color: "var(--c-muted)" }}>per maand</span>
              </div>
              <div style={{ fontSize: 12, color: "var(--c-muted)", marginBottom: 14 }}>+ € 500 eenmalige onboarding</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 18 }}>
                {p.features.map((f) => (
                  <div key={f} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                    <span style={{ width: 17, height: 17, borderRadius: "50%", background: "var(--c-accent-soft)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                      <IcCheck s={10} stroke="var(--c-accent)" />
                    </span>
                    {f}
                  </div>
                ))}
              </div>
              <button
                className={current ? "btn-ghost" : "btn-primary"}
                disabled={pkgBusy || !orgId}
                onClick={() => pickPackage(p.key)}
                style={{ height: 40, width: "100%", fontSize: 13 }}
              >
                {current ? "Pakket loskoppelen" : `Kies ${p.name} voor ${org?.name || "deze klant"}`}
              </button>
            </div>
          );
        })}
      </div>

      {/* facturatiegegevens */}
      <div className="card" style={{ padding: 24, maxWidth: 640 }}>
        <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 4 }}>Facturatiegegevens</div>
        <div style={{ fontSize: 12.5, color: "var(--c-muted)", marginBottom: 16 }}>
          Voor {org?.name || "deze klant"}. Deze gegevens komen op de factuur.
        </div>
        {billing === null ? (
          <div style={{ display: "grid", placeItems: "center", padding: 30 }}><div className="spin" /></div>
        ) : (
          <form onSubmit={save}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {FIELDS.map(([key, label, ph]) => (
                <label key={key} style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12.5, fontWeight: 700, gridColumn: key === "address" || key === "company_name" ? "1 / -1" : "auto" }}>
                  {label}
                  <input
                    value={billing[key] || ""}
                    placeholder={ph}
                    onChange={(e) => { setBilling((b) => ({ ...b, [key]: e.target.value })); setSaved(false); }}
                    style={input}
                  />
                </label>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 18 }}>
              <button type="submit" className="btn-primary" disabled={saving} style={{ height: 42, padding: "0 20px", fontSize: 13.5 }}>
                {saving ? "Opslaan…" : "Gegevens opslaan"}
              </button>
              {saved && <span className="pill pos">Opgeslagen</span>}
              {billing.updated_at && !saved && (
                <span style={{ fontSize: 12, color: "var(--c-muted)" }}>
                  Laatst bijgewerkt {new Date(billing.updated_at).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" })}
                </span>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

const orgSelect = { height: 40, padding: "0 12px", borderRadius: 10, border: "1px solid var(--c-border)", background: "var(--c-surface)", color: "var(--c-ink)", fontSize: 13.5, fontWeight: 700, fontFamily: "inherit", minWidth: 220 };
const input = { height: 40, padding: "0 12px", borderRadius: 10, border: "1px solid var(--c-border)", background: "var(--c-surface)", color: "var(--c-ink)", fontSize: 13.5, fontFamily: "inherit", fontWeight: 500 };
