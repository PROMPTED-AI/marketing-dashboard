import { useState } from "react";
import { NavLink } from "react-router-dom";
import { LOGOUT_URL } from "../lib/api.js";
import { useActiveOrg } from "../lib/ActiveOrgProvider.jsx";
import {
  IcGrid, IcBars, IcSearch, IcAds, IcShare, IcDoc, IcPlug, IcCog, IcUsers, IcChevUpDown, IcChevDown,
} from "./icons.jsx";
import { Logo } from "./Brand.jsx";

const NAV = [
  { to: "/app/overview", label: "Overzicht", Icon: IcGrid },
  { to: "/app/analytics", label: "Analytics", Icon: IcBars },
  { to: "/app/search-console", label: "Search Console", Icon: IcSearch },
  { to: "/app/google-ads", label: "Google Ads", Icon: IcAds },
  { to: "/app/meta", label: "META / Social", Icon: IcShare },
  { to: "/app/reports", label: "Rapporten", Icon: IcDoc },
  { to: "/app/integrations", label: "Integraties", Icon: IcPlug },
  { to: "/app/settings", label: "Instellingen", Icon: IcCog },
];

function initials(name = "") {
  const parts = name.replace(/^https?:\/\//, "").split(/[ .@]/).filter(Boolean);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "—";
}

export default function Sidebar({ user, connected = 0, total = 4 }) {
  const { orgs, orgId, orgName, setOrg } = useActiveOrg();
  const pct = Math.round((connected / total) * 100);
  const [menuOpen, setMenuOpen] = useState(false);
  const [switchOpen, setSwitchOpen] = useState(false);
  const canSwitch = orgs.length > 1;
  return (
    <div style={wrap} className="no-print">
      <div style={{ padding: "20px 20px 16px" }}>
        <Logo size={28} />
      </div>

      <div style={{ position: "relative", margin: "4px 14px 14px" }}>
        {switchOpen && canSwitch && (
          <div style={switchMenu}>
            {orgs.map((o) => (
              <div key={o.id} onClick={() => { setOrg(o.id); setSwitchOpen(false); }}
                style={{ ...switchRow, ...(o.id === orgId ? switchRowActive : {}) }}>
                <div style={{ ...orgChip, width: 22, height: 22, fontSize: 11 }}>{initials(o.name)}</div>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.name}</span>
              </div>
            ))}
          </div>
        )}
        <div style={{ ...switcher, margin: 0, cursor: canSwitch ? "pointer" : "default" }} onClick={() => canSwitch && setSwitchOpen((o) => !o)}>
          <div style={orgChip}>{initials(orgName)}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{orgName}</div>
            <div style={{ fontSize: 11, color: "var(--c-muted)" }}>{canSwitch ? "Klant wisselen" : "Organisatie"}</div>
          </div>
          {canSwitch && <span style={{ color: "var(--c-muted)" }}><IcChevUpDown s={15} /></span>}
        </div>
      </div>

      <div style={menuLabel}>Menu</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: "0 12px", fontSize: 14 }}>
        {NAV.map(({ to, label, Icon }) => (
          <NavLink key={to} to={to} style={({ isActive }) => navItem(isActive)}>
            <Icon s={18} />
            {label}
          </NavLink>
        ))}
        {user?.role === "agency_admin" && (
          <NavLink to="/admin" style={() => navItem(false)}>
            <IcUsers s={18} />
            Klantenbeheer
          </NavLink>
        )}
      </div>

      <div style={{ flex: 1 }} />

      <div style={progressCard}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 13, fontWeight: 500, color: "var(--c-accent-strong)", marginBottom: 4 }}>{connected} van {total} gekoppeld</div>
        <div style={{ fontSize: 11.5, color: "var(--c-muted)", lineHeight: 1.4, marginBottom: 10 }}>
          {connected >= total ? "Alle bronnen zijn gekoppeld." : "Koppel je overige bronnen voor compleet inzicht."}
        </div>
        <div style={{ height: 6, borderRadius: 3, background: "var(--c-surface)", overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: "var(--c-accent)" }} />
        </div>
      </div>

      <div style={{ ...userFoot, position: "relative" }}>
        {menuOpen && (
          <div style={userMenu}>
            <a
              href={LOGOUT_URL}
              style={menuItem}
              onClick={() => ["mm-onboarded", "mm-property", "mm-gsc-site"].forEach((k) => localStorage.removeItem(k))}
            >
              Uitloggen
            </a>
          </div>
        )}
        <div onClick={() => setMenuOpen((o) => !o)} style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0, cursor: "pointer" }}>
          <div style={userChip}>{initials(user?.email)}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{user?.email}</div>
            <div style={{ fontSize: 11, color: "var(--c-muted)" }}>{user?.role === "agency_admin" ? "Bureau-admin" : "Klant"}</div>
          </div>
          <span style={{ color: "var(--c-muted)", transform: menuOpen ? "rotate(180deg)" : "none", transition: "transform .15s" }}><IcChevDown s={16} /></span>
        </div>
      </div>
    </div>
  );
}

const wrap = { width: "var(--sidebar-w)", background: "var(--c-sidebar)", borderRight: "1px solid var(--border-subtle)", display: "flex", flexDirection: "column", flex: "none" };
const switcher = { margin: "4px 14px 14px", padding: "10px 12px", borderRadius: "var(--radius-sm)", border: "1px solid var(--c-border)", background: "var(--c-surface)", display: "flex", alignItems: "center", gap: 10, cursor: "pointer" };
const orgChip = { width: 26, height: 26, borderRadius: 8, background: "var(--action-secondary)", color: "#fff", fontWeight: 500, fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" };
const switchMenu = { position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, maxHeight: 280, overflow: "auto", background: "var(--c-surface)", border: "1px solid var(--c-border)", borderRadius: "var(--radius-md)", boxShadow: "var(--sh-md)", zIndex: 30, padding: 6 };
const switchRow = { display: "flex", alignItems: "center", gap: 9, padding: "8px 10px", borderRadius: "var(--radius-xs)", fontSize: 13, cursor: "pointer", color: "var(--c-ink-soft)" };
const switchRowActive = { background: "var(--surface-accent)", color: "var(--c-accent-strong)", fontWeight: 500 };
const menuLabel = { padding: "0 12px", fontSize: 11, fontWeight: 500, letterSpacing: "var(--ls-caps)", color: "var(--c-muted)", textTransform: "uppercase", margin: "6px 0 6px 8px" };
const progressCard = { margin: 14, padding: 14, borderRadius: "var(--radius-md)", background: "var(--surface-accent)", border: "1px solid var(--surface-accent-border)" };
const userFoot = { display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderTop: "1px solid var(--border-subtle)" };
const userMenu = { position: "absolute", bottom: "100%", left: 14, right: 14, marginBottom: 8, background: "var(--c-surface)", border: "1px solid var(--c-border)", borderRadius: "var(--radius-md)", boxShadow: "var(--sh-md)", overflow: "hidden", zIndex: 20 };
const menuItem = { display: "block", padding: "12px 16px", fontSize: 14, fontWeight: 600, color: "var(--c-neg)", textDecoration: "none" };
const userChip = { width: 32, height: 32, borderRadius: "50%", background: "var(--action-secondary)", color: "#fff", fontSize: 12, fontWeight: 500, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" };

// Geselecteerd = groen-50 vlak met groen-700 tekst.
function navItem(isActive) {
  return {
    display: "flex", alignItems: "center", gap: 10, height: 38, padding: "0 12px", borderRadius: "var(--radius-sm)",
    textDecoration: "none",
    fontWeight: isActive ? 600 : 400,
    background: isActive ? "var(--surface-accent)" : "transparent",
    color: isActive ? "var(--c-accent-strong)" : "var(--c-ink-soft)",
    transition: "background var(--dur-fast) var(--ease-standard)",
  };
}
