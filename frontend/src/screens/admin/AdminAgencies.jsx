import { useEffect, useState } from "react";
import { listAgencies, setOrgAgency } from "../../lib/api.js";

// Bureaus (alleen de platform-beheerder). Elk bureau — bijvoorbeeld TriplePro,
// met een MCC/manager-account — heeft een eigen omgeving: het zet klantaccounts
// klaar en beheert uitsluitend die accounts. Hier maak je een organisatie tot
// bureau en hang je losse organisaties onder het juiste bureau.
export default function AdminAgencies() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);

  const reload = () => listAgencies().then(setData).catch(setError);
  useEffect(() => { reload(); }, []);

  const assign = async (orgId, agencyId) => {
    setBusy(orgId); setError(null);
    try { await setOrgAgency(orgId, { agency_id: agencyId }); await reload(); }
    catch (e) { setError(e); }
    finally { setBusy(null); }
  };

  const promote = async (orgId) => {
    setBusy(orgId); setError(null);
    try { await setOrgAgency(orgId, { is_agency: true, agency_id: "" }); await reload(); }
    catch (e) { setError(e); }
    finally { setBusy(null); }
  };

  if (error) return <div className="card" style={{ padding: 20, color: "var(--c-neg)" }}>Fout: {String(error.message || error)}</div>;
  if (data === null) return <div style={{ display: "grid", placeItems: "center", padding: 60 }}><div className="spin" /></div>;

  return (
    <div>
      <div className="display" style={{ fontSize: 30 }}>bureaus</div>
      <div style={{ fontSize: 13.5, color: "var(--c-muted)", margin: "4px 0 20px", maxWidth: 660 }}>
        Elk bureau heeft een eigen omgeving en beheert alleen zijn eigen klantaccounts. Een bureau-admin ziet dus nooit de klanten van een ander bureau; jij als platformbeheerder ziet alles.
      </div>

      <div className="card" style={{ overflow: "hidden", marginBottom: 22 }}>
        <div style={{ overflowX: "auto" }}>
          <div style={head}><span>Bureau</span><span>Klantomgevingen</span><span>Bureau-admins</span></div>
          {data.agencies.map((a) => (
            <div key={a.id} style={row}>
              <div>
                <div style={{ fontWeight: 700 }}>{a.name}</div>
                <div style={{ fontSize: 11.5, color: "var(--c-muted)" }}>{a.domain}</div>
              </div>
              <span>{a.client_count}</span>
              <span>{a.admin_count}</span>
            </div>
          ))}
          {data.agencies.length === 0 && (
            <div style={{ padding: 24, color: "var(--c-muted)" }}>Nog geen bureaus. Maak hieronder een organisatie tot bureau.</div>
          )}
        </div>
      </div>

      <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 6 }}>Nog geen bureau</div>
      <div style={{ fontSize: 12.5, color: "var(--c-muted)", marginBottom: 12 }}>
        Organisaties die (nog) bij geen enkel bureau horen. Hang ze onder een bureau, of maak er zelf een bureau van.
      </div>
      <div className="card" style={{ overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <div style={head2}><span>Organisatie</span><span>Bureau</span><span /></div>
          {data.unassigned.map((o) => (
            <div key={o.id} style={row2}>
              <div>
                <div style={{ fontWeight: 700 }}>{o.name}</div>
                <div style={{ fontSize: 11.5, color: "var(--c-muted)" }}>{o.domain}</div>
              </div>
              <select
                defaultValue=""
                disabled={busy === o.id}
                onChange={(e) => e.target.value && assign(o.id, e.target.value)}
                style={select}
              >
                <option value="">— kies een bureau —</option>
                {data.agencies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <span style={{ textAlign: "right" }}>
                <button className="btn-ghost" disabled={busy === o.id} onClick={() => promote(o.id)}
                  title="Maak deze organisatie zelf een bureau" style={{ height: 32, padding: "0 12px", fontSize: 12.5 }}>
                  {busy === o.id ? "…" : "Maak bureau"}
                </button>
              </span>
            </div>
          ))}
          {data.unassigned.length === 0 && (
            <div style={{ padding: 24, color: "var(--c-muted)" }}>Elke organisatie hoort bij een bureau.</div>
          )}
        </div>
      </div>
    </div>
  );
}

const cols = "2fr 1fr 1fr";
const head = { display: "grid", gridTemplateColumns: cols, minWidth: 620, gap: 14, fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--c-muted)", padding: "14px 20px", borderBottom: "1px solid var(--c-border)", background: "var(--c-surface-2)" };
const row = { display: "grid", gridTemplateColumns: cols, minWidth: 620, gap: 14, alignItems: "center", padding: "13px 20px", borderBottom: "1px solid var(--c-border-soft)", fontSize: 13.5 };
const cols2 = "2fr 1.4fr 1fr";
const head2 = { ...head, gridTemplateColumns: cols2 };
const row2 = { ...row, gridTemplateColumns: cols2 };
const select = { height: 36, padding: "0 10px", borderRadius: 9, border: "1px solid var(--c-border)", background: "var(--c-surface)", color: "var(--c-ink)", fontSize: 13, fontFamily: "inherit" };
