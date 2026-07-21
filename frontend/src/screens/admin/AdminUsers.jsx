import { useEffect, useState } from "react";
import { api } from "../../lib/api.js";

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" }) : "—");

// Gebruikers & rollen: alle accounts op het platform met hun organisatie en
// rol. De rol is per gebruiker te wisselen tussen klant en bureau-admin; de
// eigen beheerdersrol afnemen blokkeert de server.
export default function AdminUsers({ meEmail }) {
  const [users, setUsers] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const reload = () => api("/api/admin/users").then((d) => { setUsers(d.users || []); setError(null); }).catch(setError);
  useEffect(() => { reload(); }, []);

  const setRole = async (u, role) => {
    setBusyId(u.id);
    try {
      await api(`/api/admin/users/${u.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role }) });
    } catch (e) {
      setError(e);
    } finally {
      setBusyId(null);
      reload();
    }
  };

  if (error) return <div className="card" style={{ padding: 20, color: "var(--c-neg)" }}>Fout: {String(error.message || error)}</div>;
  if (users === null) return <div style={{ display: "grid", placeItems: "center", padding: 60 }}><div className="spin" /></div>;

  return (
    <div>
      <div className="display" style={{ fontSize: 30 }}>gebruikers &amp; rollen</div>
      <div style={{ fontSize: 13.5, color: "var(--c-muted)", margin: "4px 0 20px" }}>
        Alle accounts op het platform. Bureau-admins beheren alle klanten; klanten zien alleen hun eigen organisatie.
      </div>

      <div className="card" style={{ overflow: "hidden" }}>
        <div style={head}>
          <span>Gebruiker</span><span>Organisatie</span><span>Aangemaakt</span><span>Login</span><span>Rol</span>
        </div>
        {users.map((u) => (
          <div key={u.id} style={row}>
            <span style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.email}</span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {u.organization_name}
              {u.is_demo && <span className="pill muted" style={{ fontSize: 10.5, marginLeft: 6 }}>demo</span>}
            </span>
            <span style={{ color: "var(--c-muted)", fontSize: 12.5 }}>{fmtDate(u.created_at)}</span>
            <span style={{ color: "var(--c-muted)", fontSize: 12.5 }}>{u.has_password ? "wachtwoord" : "Google"}</span>
            <span>
              <select
                value={u.role}
                disabled={busyId === u.id || u.email === meEmail}
                title={u.email === meEmail ? "Je kunt je eigen rol niet wijzigen" : "Wijzig de rol"}
                onChange={(e) => setRole(u, e.target.value)}
                style={roleSelect}
              >
                <option value="client">Klant</option>
                <option value="agency_admin">Bureau-admin</option>
              </select>
            </span>
          </div>
        ))}
        {users.length === 0 && <div style={{ padding: 24, color: "var(--c-muted)" }}>Nog geen gebruikers.</div>}
      </div>
    </div>
  );
}

const cols = "2fr 1.6fr 0.9fr 0.8fr 1fr";
const head = { display: "grid", gridTemplateColumns: cols, gap: 14, fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--c-muted)", padding: "14px 20px", borderBottom: "1px solid var(--c-border)", background: "var(--c-surface-2)" };
const row = { display: "grid", gridTemplateColumns: cols, gap: 14, alignItems: "center", padding: "13px 20px", borderBottom: "1px solid var(--c-border-soft)", fontSize: 13.5 };
const roleSelect = { height: 34, padding: "0 10px", borderRadius: 9, border: "1px solid var(--c-border)", background: "var(--c-surface)", color: "var(--c-ink)", fontSize: 12.5, fontWeight: 600, fontFamily: "inherit" };
