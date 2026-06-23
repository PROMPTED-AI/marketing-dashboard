import { NavLink } from "react-router-dom";
import {
  IcStar, IcGrid, IcBars, IcSearch, IcAds, IcShare, IcDoc, IcPlug, IcCog, IcUsers, IcChevUpDown, IcChevDown,
} from "./icons.jsx";

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

export default function Sidebar({ org, user, connected = 0, total = 4 }) {
  const orgName = org?.name || "—";
  const pct = Math.round((connected / total) * 100);
  return (
    <div style={wrap}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "22px 20px 18px" }}>
        <div style={logoBox}><IcStar /></div>
        <div className="display" style={{ fontSize: 20 }}>kompas</div>
      </div>

      <div style={switcher}>
        <div style={orgChip}>{initials(orgName)}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{orgName}</div>
          <div style={{ fontSize: 11, color: "var(--c-muted)" }}>klant wisselen</div>
        </div>
        <span style={{ color: "var(--c-muted)" }}><IcChevUpDown s={15} /></span>
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
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--c-accent)", marginBottom: 4 }}>{connected} van {total} gekoppeld</div>
        <div style={{ fontSize: 11.5, color: "var(--c-muted)", lineHeight: 1.45, marginBottom: 10 }}>
          {connected >= total ? "alle tools gekoppeld 🎉" : "koppel je overige tools voor compleet inzicht."}
        </div>
        <div style={{ height: 6, borderRadius: 3, background: "var(--c-surface)", overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: "var(--c-accent)" }} />
        </div>
      </div>

      <div style={userFoot}>
        <div style={userChip}>{initials(user?.email)}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{user?.email}</div>
          <div style={{ fontSize: 11, color: "var(--c-muted)" }}>{user?.role === "agency_admin" ? "bureau-admin" : "klant"}</div>
        </div>
        <span style={{ color: "var(--c-muted)" }}><IcChevDown s={16} /></span>
      </div>
    </div>
  );
}

const wrap = { width: 240, background: "var(--c-sidebar)", borderRight: "1px solid var(--c-border)", display: "flex", flexDirection: "column", flex: "none" };
const logoBox = { width: 30, height: 30, borderRadius: 8, background: "var(--c-accent)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" };
const switcher = { margin: "4px 14px 14px", padding: "11px 13px", borderRadius: 11, border: "1px solid var(--c-border)", background: "var(--c-surface-2)", display: "flex", alignItems: "center", gap: 10, cursor: "pointer" };
const orgChip = { width: 26, height: 26, borderRadius: 7, background: "var(--c-accent-soft)", color: "var(--c-accent)", fontWeight: 800, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" };
const menuLabel = { padding: "0 12px", fontSize: 11, fontWeight: 700, letterSpacing: ".08em", color: "var(--c-muted)", textTransform: "uppercase", margin: "6px 0 6px 8px" };
const progressCard = { margin: 14, padding: 14, borderRadius: 12, background: "var(--c-accent-soft)" };
const userFoot = { display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderTop: "1px solid var(--c-border)" };
const userChip = { width: 32, height: 32, borderRadius: "50%", background: "var(--c-purple)", color: "#fff", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" };

function navItem(isActive) {
  return {
    display: "flex", alignItems: "center", gap: 11, padding: "10px 12px", borderRadius: 10,
    textDecoration: "none",
    fontWeight: isActive ? 700 : 600,
    background: isActive ? "var(--c-accent-soft)" : "transparent",
    color: isActive ? "var(--c-accent)" : "var(--c-muted)",
  };
}
