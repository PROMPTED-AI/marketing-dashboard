import { useEffect, useState } from "react";
import { api, createInvitation, createResetLink } from "../../lib/api.js";
import { IcPlus } from "../../components/icons.jsx";

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" }) : "—");

// Gebruikers & rollen: alle accounts op het platform met hun organisatie en
// rol. De rol is per gebruiker te wisselen; de eigen beheerdersrol afnemen
// blokkeert de server. Nieuwe gebruikers nodig je uit via een e-maillink; voor
// bestaande gebruikers genereer je een wachtwoord-resetlink.
export default function AdminUsers({ meEmail }) {
  const [users, setUsers] = useState(null);
  const [orgs, setOrgs] = useState([]);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [inviting, setInviting] = useState(false);
  const [linkModal, setLinkModal] = useState(null); // {title, url, emailed}

  const reload = () => api("/api/admin/users").then((d) => { setUsers(d.users || []); setError(null); }).catch(setError);
  useEffect(() => { reload(); }, []);
  useEffect(() => { api("/api/admin/organizations").then((d) => setOrgs(d.organizations || [])).catch(() => {}); }, []);

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

  const resetLink = async (u) => {
    setBusyId(u.id);
    try {
      const d = await createResetLink(u.id);
      setLinkModal({ title: `Resetlink voor ${u.email}`, url: d.reset_url, emailed: d.emailed });
    } catch (e) {
      setError(e);
    } finally {
      setBusyId(null);
    }
  };

  if (error) return <div className="card" style={{ padding: 20, color: "var(--c-neg)" }}>Fout: {String(error.message || error)}</div>;
  if (users === null) return <div style={{ display: "grid", placeItems: "center", padding: 60 }}><div className="spin" /></div>;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
        <div>
          <div className="display" style={{ fontSize: 30 }}>gebruikers &amp; rollen</div>
          <div style={{ fontSize: 13.5, color: "var(--c-muted)", margin: "4px 0 20px" }}>
            Alle accounts op het platform. Bureau-admins beheren alle klanten; klanten zien alleen hun eigen organisatie.
          </div>
        </div>
        <button className="btn-primary" style={{ height: 42, padding: "0 18px", fontSize: 13.5 }} onClick={() => setInviting(true)}>
          <IcPlus s={16} /> gebruiker uitnodigen
        </button>
      </div>

      <div className="card" style={{ overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
        <div style={head}>
          <span>Gebruiker</span><span>Organisatie</span><span>Aangemaakt</span><span>Login</span><span>Rol</span><span>Actie</span>
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
            <span>
              <button className="btn-ghost" disabled={busyId === u.id} onClick={() => resetLink(u)}
                title="Genereer een link waarmee deze gebruiker een nieuw wachtwoord kan instellen"
                style={{ height: 32, padding: "0 11px", fontSize: 12 }}>
                resetlink
              </button>
            </span>
          </div>
        ))}
        {users.length === 0 && <div style={{ padding: 24, color: "var(--c-muted)" }}>Nog geen gebruikers.</div>}
        </div>
      </div>

      {inviting && <InviteModal orgs={orgs} onClose={() => setInviting(false)} onLink={(m) => { setInviting(false); setLinkModal(m); }} />}
      {linkModal && <LinkModal {...linkModal} onClose={() => setLinkModal(null)} />}
    </div>
  );
}

// Uitnodiging aanmaken: e-mailadres, organisatie en rol. Toont daarna de link
// (en of hij per e-mail is verstuurd).
function InviteModal({ orgs, onClose, onLink }) {
  const [email, setEmail] = useState("");
  const [orgId, setOrgId] = useState(orgs[0]?.id || "");
  const [role, setRole] = useState("client");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const d = await createInvitation(email.trim(), orgId, role);
      onLink({ title: `Uitnodiging voor ${d.email}`, url: d.invite_url, emailed: d.emailed });
    } catch (e2) {
      setErr(e2);
      setBusy(false);
    }
  };

  return (
    <div style={overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="card" style={{ width: 460, maxWidth: "calc(100vw - 32px)", padding: 26 }}>
        <form onSubmit={submit}>
          <div className="display" style={{ fontSize: 22, marginBottom: 4 }}>gebruiker uitnodigen</div>
          <div style={{ fontSize: 13, color: "var(--c-muted)", marginBottom: 18 }}>De gebruiker stelt via de link zelf een wachtwoord in en krijgt toegang tot de gekozen organisatie.</div>
          <label style={lbl}>E-mailadres</label>
          <input autoFocus type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="klant@bedrijf.nl" style={inp} />
          <label style={lbl}>Organisatie</label>
          <select value={orgId} onChange={(e) => setOrgId(e.target.value)} style={inp}>
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <label style={lbl}>Rol</label>
          <select value={role} onChange={(e) => setRole(e.target.value)} style={inp}>
            <option value="client">Klant</option>
            <option value="agency_admin">Bureau-admin</option>
          </select>
          {err && <div style={{ color: "var(--c-neg)", fontSize: 13, marginTop: 12 }}>{String(err.message || err)}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 22 }}>
            <button type="button" className="pill-btn" onClick={onClose} style={btnGhost}>annuleren</button>
            <button type="submit" disabled={busy || !email.trim() || !orgId} className="btn-primary" style={{ height: 42, padding: "0 20px", opacity: busy ? 0.7 : 1 }}>
              {busy ? "bezig…" : "uitnodiging maken"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Toont een gegenereerde link (uitnodiging of reset) met een kopieerknop, plus
// of hij ook per e-mail is verstuurd.
function LinkModal({ title, url, emailed, onClose }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard geblokkeerd */ }
  };
  return (
    <div style={overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="card" style={{ width: 500, maxWidth: "calc(100vw - 32px)", padding: 26 }}>
        <div className="display" style={{ fontSize: 21, marginBottom: 6 }}>{title}</div>
        <div style={{ fontSize: 13, color: "var(--c-muted)", marginBottom: 16 }}>
          {emailed
            ? "De link is per e-mail verstuurd. Je kunt hem hieronder ook zelf delen."
            : "E-mail is niet geconfigureerd, dus deel deze link zelf met de gebruiker. Hij is eenmalig te gebruiken."}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input readOnly value={url} onFocus={(e) => e.target.select()} style={{ ...inp, marginBottom: 0, fontSize: 12.5, color: "var(--c-ink-soft)" }} />
          <button className="btn-primary" onClick={copy} style={{ height: 44, padding: "0 16px", whiteSpace: "nowrap" }}>{copied ? "gekopieerd" : "kopieer"}</button>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
          <button className="pill-btn" onClick={onClose} style={btnGhost}>sluiten</button>
        </div>
      </div>
    </div>
  );
}

const cols = "1.9fr 1.5fr 0.9fr 0.8fr 1fr 0.8fr";
const head = { display: "grid", gridTemplateColumns: cols, minWidth: 860, gap: 14, fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--c-muted)", padding: "14px 20px", borderBottom: "1px solid var(--c-border)", background: "var(--c-surface-2)" };
const row = { display: "grid", gridTemplateColumns: cols, minWidth: 860, gap: 14, alignItems: "center", padding: "13px 20px", borderBottom: "1px solid var(--c-border-soft)", fontSize: 13.5 };
const roleSelect = { height: 34, padding: "0 10px", borderRadius: 9, border: "1px solid var(--c-border)", background: "var(--c-surface)", color: "var(--c-ink)", fontSize: 12.5, fontWeight: 600, fontFamily: "inherit" };
const overlay = { position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 16 };
const lbl = { display: "block", fontSize: 12.5, fontWeight: 700, color: "var(--c-ink-soft)", margin: "12px 0 6px" };
const inp = { width: "100%", height: 44, padding: "0 14px", fontSize: 14, borderRadius: 11, border: "1px solid var(--c-border)", background: "var(--c-surface)", color: "var(--c-ink)", boxSizing: "border-box", fontFamily: "inherit", marginBottom: 2 };
const btnGhost = { height: 42, padding: "0 18px", fontSize: 13.5, borderRadius: 11, border: "1px solid var(--c-border)", background: "var(--c-surface)", color: "var(--c-ink-soft)", cursor: "pointer", fontWeight: 600 };
