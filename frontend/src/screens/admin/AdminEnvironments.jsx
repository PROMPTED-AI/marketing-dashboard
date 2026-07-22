import { useEffect, useState } from "react";
import { api, linkAgency, availableAssets, getOrgAssets, setOrgAssets, deleteOrganization } from "../../lib/api.js";

// Omgevingen: het bureau-model. Het bureau logt in met één manageraccount en
// richt per bedrijf een omgeving in — de bureau-koppeling wordt hergebruikt en
// per bedrijf wijs je toe welke property, site en Ads-klant erbij horen. De
// klant ziet daarna alleen zijn eigen bedrijf.
export default function AdminEnvironments() {
  const [orgs, setOrgs] = useState(null);
  const [error, setError] = useState(null);
  const [edit, setEdit] = useState(null); // org waarvan de omgeving wordt ingericht

  const [busyDel, setBusyDel] = useState(null);
  const reload = () => api("/api/admin/organizations").then((d) => setOrgs(d.organizations || [])).catch(setError);
  useEffect(() => { reload(); }, []);

  const remove = async (o) => {
    if (!window.confirm(`Organisatie "${o.name}" definitief verwijderen? Alle koppelingen, dashboards en gebruikers ervan gaan verloren.`)) return;
    setBusyDel(o.id);
    try { await deleteOrganization(o.id); reload(); }
    catch (e) { setError(e); }
    finally { setBusyDel(null); }
  };

  if (error) return <div className="card" style={{ padding: 20, color: "var(--c-neg)" }}>Fout: {String(error.message || error)}</div>;
  if (orgs === null) return <div style={{ display: "grid", placeItems: "center", padding: 60 }}><div className="spin" /></div>;

  return (
    <div>
      <div className="display" style={{ fontSize: 30 }}>omgevingen</div>
      <div style={{ fontSize: 13.5, color: "var(--c-muted)", margin: "4px 0 8px" }}>
        Richt per bedrijf een omgeving in met je bureau-koppeling. Wijs de juiste property, site en Google Ads-klant toe; de klant ziet daarna alleen zijn eigen bedrijf.
      </div>
      <div style={{ fontSize: 12.5, color: "var(--c-muted)", marginBottom: 20 }}>
        Koppel eerst Google op je eigen bureau-account (via Integraties). Daarna hergebruik je die koppeling hier per klant.
      </div>

      <div className="card" style={{ overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <div style={head}>
            <span>Bedrijf</span><span>Type omgeving</span><span>Toegewezen bron</span><span />
          </div>
          {orgs.map((o) => {
            const a = o.assets || {};
            const assigned = [a.ga_property_id && "Analytics", a.gsc_site_url && "Search Console", a.ads_customer_id && "Ads"].filter(Boolean);
            return (
              <div key={o.id} style={row}>
                <div><div style={{ fontWeight: 700 }}>{o.name}</div><div style={{ fontSize: 11.5, color: "var(--c-muted)" }}>{o.domain}</div></div>
                <span>{o.managed ? <span className="pill accent">bureau-omgeving</span> : <span className="pill muted">eigen koppeling</span>}</span>
                <span style={{ fontSize: 12.5, color: "var(--c-muted)" }}>{assigned.length ? assigned.join(" · ") : "—"}</span>
                <span style={{ textAlign: "right", display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button className="btn-ghost" style={{ height: 32, padding: "0 13px", fontSize: 12.5 }} onClick={() => setEdit(o)}>Inrichten</button>
                  <button className="btn-ghost" disabled={busyDel === o.id} onClick={() => remove(o)}
                    title="Verwijder deze organisatie definitief" style={{ height: 32, padding: "0 11px", fontSize: 12.5, color: "var(--c-neg)" }}>
                    {busyDel === o.id ? "…" : "Verwijderen"}
                  </button>
                </span>
              </div>
            );
          })}
          {orgs.length === 0 && <div style={{ padding: 24, color: "var(--c-muted)" }}>Nog geen bedrijven.</div>}
        </div>
      </div>

      {edit && <EnvModal org={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </div>
  );
}

function EnvModal({ org, onClose, onSaved }) {
  const [managed, setManaged] = useState(org.managed);
  const [assets, setAssets] = useState(null);      // huidige toewijzing
  const [available, setAvailable] = useState(null); // { properties, sites, ads_accounts }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  const loadAssets = () => Promise.all([getOrgAssets(org.id), availableAssets(org.id)])
    .then(([g, av]) => { setAssets(g.assets); setManaged(g.managed); setAvailable(av); })
    .catch(setError);

  useEffect(() => { if (managed) loadAssets(); }, []);

  const link = async () => {
    setBusy(true); setError(null);
    try { await linkAgency(org.id); setManaged(true); await loadAssets(); }
    catch (e) { setError(e); } finally { setBusy(false); }
  };

  const save = async () => {
    setBusy(true); setError(null); setSaved(false);
    try { await setOrgAssets(org.id, assets); setSaved(true); }
    catch (e) { setError(e); } finally { setBusy(false); }
  };

  const field = (label, key, options, idKey, labelFn) => (
    <label style={{ display: "block", marginBottom: 14 }}>
      <span style={lbl}>{label}</span>
      <select value={assets?.[key] || ""} onChange={(e) => { setAssets((a) => ({ ...a, [key]: e.target.value || null })); setSaved(false); }} style={select}>
        <option value="">— niet toegewezen —</option>
        {(options || []).map((o) => <option key={o[idKey]} value={o[idKey]}>{labelFn(o)}</option>)}
      </select>
    </label>
  );

  return (
    <div style={overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="card" style={{ width: 520, maxWidth: "calc(100vw - 32px)", padding: 26, maxHeight: "90vh", overflow: "auto" }}>
        <div className="display" style={{ fontSize: 22, marginBottom: 4 }}>omgeving · {org.name}</div>
        <div style={{ fontSize: 13, color: "var(--c-muted)", marginBottom: 18 }}>
          Hergebruik je bureau-koppeling en wijs de juiste bronnen toe aan dit bedrijf.
        </div>

        {!managed ? (
          <div>
            <div style={{ fontSize: 13.5, color: "var(--c-ink-soft)", lineHeight: 1.6, marginBottom: 16 }}>
              Dit bedrijf gebruikt nog geen bureau-koppeling. Klik hieronder om de Google-koppeling van je bureau-account te hergebruiken; daarna kies je per kanaal de juiste bron.
            </div>
            <button className="btn-primary" disabled={busy} onClick={link} style={{ height: 42, padding: "0 18px" }}>
              {busy ? "Bezig…" : "Gebruik bureau-koppeling"}
            </button>
          </div>
        ) : available === null ? (
          <div style={{ display: "grid", placeItems: "center", padding: 30 }}><div className="spin" /></div>
        ) : (
          <div>
            {field("Google Analytics-property", "ga_property_id", available.properties, "property_id", (p) => p.display_name ? `${p.display_name} (${p.property_id})` : p.property_id)}
            {field("Search Console-site", "gsc_site_url", available.sites, "site_url", (s) => s.site_url)}
            {field("Google Ads-klant", "ads_customer_id", available.ads_accounts, "customer_id", (c) => c.name ? `${c.name} (${c.customer_id})` : c.customer_id)}
            <div style={{ fontSize: 12, color: "var(--c-muted)", marginBottom: 16 }}>
              Staat er niets in een lijst? Dan geeft de koppeling voor dat kanaal (nog) geen bronnen terug. Meta, WooCommerce en Shopify koppel je per bedrijf apart.
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button className="btn-primary" disabled={busy} onClick={save} style={{ height: 42, padding: "0 20px" }}>{busy ? "Opslaan…" : "Toewijzing opslaan"}</button>
              {saved && <span className="pill pos">Opgeslagen</span>}
            </div>
          </div>
        )}

        {error && <div style={{ color: "var(--c-neg)", fontSize: 13, marginTop: 14 }}>{String(error.message || error)}</div>}

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
          <button className="pill-btn" onClick={onClose} style={{ height: 40, padding: "0 16px", borderRadius: 11, border: "1px solid var(--c-border)", background: "var(--c-surface)", color: "var(--c-ink-soft)", cursor: "pointer", fontWeight: 600 }}>Sluiten</button>
        </div>
      </div>
    </div>
  );
}

const cols = "1.6fr 1fr 1.4fr 0.8fr";
const head = { display: "grid", gridTemplateColumns: cols, minWidth: 720, gap: 14, fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--c-muted)", padding: "14px 20px", borderBottom: "1px solid var(--c-border)", background: "var(--c-surface-2)" };
const row = { display: "grid", gridTemplateColumns: cols, minWidth: 720, gap: 14, alignItems: "center", padding: "13px 20px", borderBottom: "1px solid var(--c-border-soft)", fontSize: 13.5 };
const overlay = { position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 16 };
const lbl = { display: "block", fontSize: 12.5, fontWeight: 700, color: "var(--c-ink-soft)", marginBottom: 6 };
const select = { width: "100%", height: 42, padding: "0 12px", borderRadius: 10, border: "1px solid var(--c-border)", background: "var(--c-surface)", color: "var(--c-ink)", fontSize: 13.5, fontFamily: "inherit" };
