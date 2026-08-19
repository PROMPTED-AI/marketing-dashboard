import { useEffect, useState } from "react";
import { listAgencies, setOrgAgency } from "../../lib/api.js";

// Bureaus (alleen de platform-beheerder). Elk bureau — bijvoorbeeld TriplePro,
// met een MCC/manager-account — heeft een eigen omgeving: het zet klantaccounts
// klaar en beheert uitsluitend die accounts. Hier maak je een organisatie tot
// bureau en bepaal je onder welk bureau een organisatie valt.
//
// De tweede tabel toont álle organisaties, niet alleen de niet-toegewezen: na de
// migratie hoort elke organisatie al bij een bureau, en dan zou er niets meer te
// promoveren zijn.
export default function AdminAgencies() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);

  const reload = () => listAgencies().then(setData).catch(setError);
  useEffect(() => { reload(); }, []);

  const act = async (orgId, payload) => {
    setBusy(orgId); setError(null);
    try { await setOrgAgency(orgId, payload); await reload(); }
    catch (e) { setError(e); }
    finally { setBusy(null); }
  };

  if (data === null && !error) return <div style={{ display: "grid", placeItems: "center", padding: 60 }}><div className="spin" /></div>;

  const agencies = data?.agencies || [];
  const orgs = data?.organizations || [];

  return (
    <div>
      <div className="display" style={{ fontSize: 30 }}>bureaus</div>
      <div style={{ fontSize: 13.5, color: "var(--c-muted)", margin: "4px 0 20px", maxWidth: 680 }}>
        Elk bureau heeft een eigen omgeving en beheert alleen zijn eigen klantaccounts. Een bureau-admin ziet dus nooit de klanten van een ander bureau; jij als platformbeheerder ziet alles.
      </div>

      {error && <div className="card" style={{ padding: 16, marginBottom: 16, color: "var(--c-neg)" }}>{String(error.message || error)}</div>}

      <div className="card" style={{ overflow: "hidden", marginBottom: 24 }}>
        <div style={{ overflowX: "auto" }}>
          <div style={head}><span>Bureau</span><span>Klantomgevingen</span><span>Bureau-admins</span></div>
          {agencies.map((a) => (
            <div key={a.id} style={row}>
              <div>
                <div style={{ fontWeight: 700 }}>{a.name}</div>
                <div style={{ fontSize: 11.5, color: "var(--c-muted)" }}>{a.domain}</div>
              </div>
              <span>{a.client_count}</span>
              <span>{a.admin_count}</span>
            </div>
          ))}
          {agencies.length === 0 && (
            <div style={{ padding: 24, color: "var(--c-muted)" }}>Nog geen bureaus. Maak hieronder een organisatie tot bureau.</div>
          )}
        </div>
      </div>

      <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 6 }}>Organisaties</div>
      <div style={{ fontSize: 12.5, color: "var(--c-muted)", marginBottom: 12, maxWidth: 680 }}>
        Maak een organisatie tot bureau (dan beheert die zijn eigen klanten), of hang hem onder een ander bureau. Een bureau kan pas terug naar klant als het zelf geen klantomgevingen meer heeft.
      </div>
      <div className="card" style={{ overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <div style={head2}><span>Organisatie</span><span>Rol</span><span>Hoort bij bureau</span><span /></div>
          {orgs.map((o) => (
            <div key={o.id} style={row2}>
              <div>
                <div style={{ fontWeight: 700 }}>{o.name}</div>
                <div style={{ fontSize: 11.5, color: "var(--c-muted)" }}>{o.domain}</div>
              </div>
              <span>
                {o.is_agency
                  ? <span className="pill accent">bureau</span>
                  : <span className="pill muted">klantomgeving</span>}
              </span>
              <span>
                {o.is_agency ? (
                  <span style={{ fontSize: 12.5, color: "var(--c-muted)" }}>—</span>
                ) : (
                  <select
                    value={o.agency_id || ""}
                    disabled={busy === o.id}
                    onChange={(e) => act(o.id, { agency_id: e.target.value })}
                    style={select}
                  >
                    <option value="">— geen bureau —</option>
                    {agencies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                )}
              </span>
              <span style={{ textAlign: "right" }}>
                <button
                  className="btn-ghost"
                  disabled={busy === o.id}
                  onClick={() => act(o.id, o.is_agency ? { is_agency: false } : { is_agency: true, agency_id: "" })}
                  title={o.is_agency
                    ? "Deze organisatie is geen bureau meer en wordt weer een gewone klantomgeving"
                    : "Maak deze organisatie een bureau met een eigen klantenbeheer"}
                  style={{ height: 32, padding: "0 12px", fontSize: 12.5, whiteSpace: "nowrap" }}
                >
                  {busy === o.id ? "…" : o.is_agency ? "Geen bureau meer" : "Maak bureau"}
                </button>
              </span>
            </div>
          ))}
          {orgs.length === 0 && <div style={{ padding: 24, color: "var(--c-muted)" }}>Nog geen organisaties.</div>}
        </div>
      </div>
    </div>
  );
}

const cols = "2fr 1fr 1fr";
const head = { display: "grid", gridTemplateColumns: cols, minWidth: 620, gap: 14, fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--c-muted)", padding: "14px 20px", borderBottom: "1px solid var(--c-border)", background: "var(--c-surface-2)" };
const row = { display: "grid", gridTemplateColumns: cols, minWidth: 620, gap: 14, alignItems: "center", padding: "13px 20px", borderBottom: "1px solid var(--c-border-soft)", fontSize: 13.5 };
const cols2 = "1.8fr 0.9fr 1.4fr 1fr";
const head2 = { ...head, gridTemplateColumns: cols2, minWidth: 820 };
const row2 = { ...row, gridTemplateColumns: cols2, minWidth: 820 };
const select = { height: 36, padding: "0 10px", borderRadius: 9, border: "1px solid var(--c-border)", background: "var(--c-surface)", color: "var(--c-ink)", fontSize: 13, fontFamily: "inherit" };
