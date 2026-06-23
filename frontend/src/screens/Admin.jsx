import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { api, LOGOUT_URL } from "../lib/api.js";
import { useMe } from "../lib/useMe.jsx";
import Topbar from "../components/Topbar.jsx";
import { IcStar, IcUsers, IcPlug, IcCog, IcDoc, IcChevDown } from "../components/icons.jsx";

const PROVIDERS = [
  { key: "google_analytics", letter: "G", bg: "#FFF3E0", on: "#E37400" },
  { key: "search_console", letter: "S", bg: "#E8F0FE", on: "#4285F4" },
  { key: "google_ads", letter: "A", bg: "#E8F0FE", on: "#1A73E8" },
  { key: "meta_ads", letter: "M", bg: "#E7F0FF", on: "#0866FF" },
];

function initials(name = "") {
  const p = name.replace(/^https?:\/\//, "").split(/[ .@]/).filter(Boolean);
  return ((p[0]?.[0] || "") + (p[1]?.[0] || "")).toUpperCase() || "—";
}
function orgStatus(o) {
  const vals = Object.values(o.providers || {});
  if (vals.some((p) => p.status === "revoked")) return { label: "Actie vereist", cls: "neg" };
  if (o.connected_count > 0) return { label: "Actief", cls: "pos" };
  return { label: "Onboarding", cls: "accent" };
}
function ago(iso) {
  if (!iso) return "nog niet gesynct";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "zojuist";
  if (mins < 60) return `${mins} min geleden`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} uur geleden`;
  return `${Math.floor(h / 24)} dagen geleden`;
}

export default function Admin() {
  const { me, loading: meLoading } = useMe();
  const nav = useNavigate();
  const [orgs, setOrgs] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api("/api/admin/organizations").then((d) => setOrgs(d.organizations || [])).catch(setError);
  }, []);

  if (meLoading) return null;
  if (!me) return <Navigate to="/login" replace />;
  if (me.role !== "agency_admin") return <Navigate to="/app" replace />;

  const totalTools = (orgs || []).reduce((a, o) => a + o.connected_count, 0);
  const needAction = (orgs || []).filter((o) => Object.values(o.providers || {}).some((p) => p.status === "revoked")).length;

  return (
    <div style={{ height: "100vh", display: "flex", background: "var(--c-page)", color: "var(--c-ink)" }}>
      {/* admin sidebar */}
      <div style={sidebar}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "22px 20px 18px" }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: "var(--c-ink)", display: "flex", alignItems: "center", justifyContent: "center" }}><IcStar /></div>
          <div className="display" style={{ fontSize: 20 }}>kompas</div>
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--c-surface)", background: "var(--c-ink)", padding: "3px 7px", borderRadius: 6 }}>admin</span>
        </div>
        <div style={menuLabel}>Platform</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: "0 12px", fontSize: 14 }}>
          <div style={navActive}><IcUsers s={18} />Klanten</div>
          {[["Gebruikers & rollen", IcUsers], ["Koppelingen", IcPlug], ["Pakketten & facturatie", IcDoc], ["Activiteitenlog", IcDoc], ["Instellingen", IcCog]].map(([label, Icon]) => (
            <div key={label} style={navItem}><Icon s={18} />{label}</div>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ padding: 12 }}>
          <div onClick={() => nav("/app")} style={{ ...navItem, justifyContent: "center", cursor: "pointer", border: "1px solid var(--c-border)" }}>← naar dashboard</div>
        </div>
        <div style={userFoot}>
          <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--c-ink)", color: "var(--c-surface)", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{initials(me.email)}</div>
          <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{me.email}</div><div style={{ fontSize: 11, color: "var(--c-muted)" }}>platform-admin</div></div>
          <a href={LOGOUT_URL} style={{ color: "var(--c-muted)" }} title="uitloggen"><IcChevDown s={16} /></a>
        </div>
      </div>

      {/* main */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <Topbar searchPlaceholder="zoek klant of domein…" showDateRange={false} />
        <div style={{ flex: 1, overflow: "auto", padding: "26px 28px" }}>
          <div className="display" style={{ fontSize: 30 }}>klanten</div>
          <div style={{ fontSize: 13.5, color: "var(--c-muted)", margin: "4px 0 20px" }}>alle organisaties op het platform — koppelingen, status &amp; activiteit</div>

          {error && <div className="card" style={{ padding: 20, color: "var(--c-neg)" }}>Fout: {String(error.message || error)}</div>}

          <div style={{ display: "flex", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
            <Stat label="Organisaties" value={orgs ? orgs.length : "…"} />
            <Stat label="Gekoppelde tools" value={orgs ? totalTools : "…"} />
            <Stat label="Koppeling vereist actie" value={orgs ? needAction : "…"} danger={needAction > 0} />
            <Stat label="MRR" value="—" />
          </div>

          <div className="card" style={{ overflow: "hidden" }}>
            <div style={{ ...headRow }}>
              <span>Klant</span><span>Gekoppelde tools</span><span>Status</span><span>Laatste sync</span>
            </div>
            {(orgs || []).map((o) => {
              const st = orgStatus(o);
              return (
                <div key={o.id} style={dataRow}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ width: 34, height: 34, borderRadius: 9, background: "var(--c-accent-soft)", color: "var(--c-accent)", fontWeight: 800, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>{initials(o.name)}</div>
                    <div><div style={{ fontWeight: 700 }}>{o.name}</div><div style={{ fontSize: 11.5, color: "var(--c-muted)" }}>{o.domain}</div></div>
                  </div>
                  <div style={{ display: "flex", gap: 5 }}>
                    {PROVIDERS.map((p) => {
                      const on = o.providers?.[p.key]?.status === "connected";
                      return <span key={p.key} title={p.key} style={{ width: 22, height: 22, borderRadius: 6, background: on ? p.bg : "var(--c-track)", color: on ? p.on : "var(--c-muted)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 11 }}>{p.letter}</span>;
                    })}
                  </div>
                  <span><span className={`pill ${st.cls}`}><span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor" }} />{st.label}</span></span>
                  <span style={{ color: "var(--c-muted)", fontSize: 13 }}>{ago(o.last_sync)}</span>
                </div>
              );
            })}
            {orgs && orgs.length === 0 && <div style={{ padding: 24, color: "var(--c-muted)" }}>Nog geen organisaties.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, danger }) {
  return (
    <div className="card" style={{ flex: 1, padding: "16px 18px", minWidth: 160 }}>
      <div style={{ fontSize: 12.5, color: "var(--c-muted)", fontWeight: 600 }}>{label}</div>
      <div className="display" style={{ fontSize: 30, marginTop: 6, color: danger ? "var(--c-neg)" : "var(--c-ink)" }}>{value}</div>
    </div>
  );
}

const sidebar = { width: 240, background: "var(--c-sidebar)", borderRight: "1px solid var(--c-border)", display: "flex", flexDirection: "column", flex: "none" };
const menuLabel = { padding: "0 12px", fontSize: 11, fontWeight: 700, letterSpacing: ".08em", color: "var(--c-muted)", textTransform: "uppercase", margin: "8px 0 6px 8px" };
const navActive = { display: "flex", alignItems: "center", gap: 11, padding: "10px 12px", borderRadius: 10, background: "var(--c-accent-soft)", color: "var(--c-accent)", fontWeight: 700 };
const navItem = { display: "flex", alignItems: "center", gap: 11, padding: "10px 12px", borderRadius: 10, color: "var(--c-muted)", fontWeight: 600, cursor: "pointer" };
const userFoot = { display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderTop: "1px solid var(--c-border)" };
const headRow = { display: "grid", gridTemplateColumns: "2.2fr 1.4fr 1.1fr 1fr", gap: 14, fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--c-muted)", padding: "14px 20px", borderBottom: "1px solid var(--c-border)", background: "var(--c-surface-2)" };
const dataRow = { display: "grid", gridTemplateColumns: "2.2fr 1.4fr 1.1fr 1fr", gap: 14, alignItems: "center", padding: "15px 20px", borderBottom: "1px solid var(--c-border-soft)", fontSize: 13.5 };
