import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { LOGOUT_URL } from "../lib/api.js";
import { invalidateAll } from "../lib/swr.js";
import { useActiveOrg } from "../lib/ActiveOrgProvider.jsx";
import { useConnections, connectedProviders } from "../lib/useConnections.jsx";
import {
  IcPlug, IcCog, IcUsers, IcChat, IcGrid, IcDoc,
  IcMegaphone, IcCart, IcChevUpDown, IcChevDown, IcBell,
  GaGlyph, GscGlyph, AdsGlyph, MetaGlyph, WooGlyph, ShopifyGlyph,
} from "./icons.jsx";
import { Logo } from "./Brand.jsx";

// De sidebar is gegroepeerd: losse items + uitklapbare groepen (Marketing met
// alle marketingkanalen, Verkoop met de webshop). Kanaal-items dragen een
// `provider`-key: alleen kanalen met een actieve koppeling verschijnen in het
// menu (extra kanalen koppel je via Integraties; META Organisch deelt de
// META-koppeling). Items zonder `provider` zijn altijd zichtbaar.
// Items met een `feature`-key verdwijnen zodra het bureau die functie voor deze
// klantomgeving heeft uitgezet (de API weigert ze dan ook).
const NAV = [
  { to: "/app/assistant", label: "Assistent", Icon: IcChat, feature: "assistant" },
  { to: "/app/signalen", label: "Signalen", Icon: IcBell, feature: "signalen" },
  {
    group: "Marketing", Icon: IcMegaphone, children: [
      { to: "/app/analytics", label: "Analytics", Icon: GaGlyph, provider: "google_analytics" },
      { to: "/app/search-console", label: "Search Console", Icon: GscGlyph, provider: "search_console" },
      { to: "/app/google-ads", label: "Google Ads", Icon: AdsGlyph, provider: "google_ads" },
      { to: "/app/meta-ads", label: "META Ads", Icon: MetaGlyph, provider: "meta_ads" },
      { to: "/app/meta-organic", label: "META Organisch", Icon: MetaGlyph, provider: "meta_ads" },
    ],
  },
  {
    group: "Verkoop", Icon: IcCart, children: [
      { to: "/app/woocommerce", label: "WooCommerce", Icon: WooGlyph, provider: "woocommerce" },
      { to: "/app/shopify", label: "Shopify", Icon: ShopifyGlyph, provider: "shopify" },
    ],
  },
  { to: "/app/dashboards", label: "Mijn dashboards", Icon: IcGrid, feature: "dashboards" },
  { to: "/app/framework", label: "Raamwerk", Icon: IcDoc, feature: "framework" },
  { to: "/app/integrations", label: "Integraties", Icon: IcPlug, feature: "integrations" },
  { to: "/app/settings", label: "Instellingen", Icon: IcCog },
];

// Filter de navigatie op actieve koppelingen. Zolang de status onbekend is
// (eerste load, geen cache) tonen we alles — daarna klapt het menu netjes
// terug naar alleen de gekoppelde kanalen. Groepen zonder kanalen verdwijnen.
// Kanaalzichtbaarheid volgt het beheer: staat Integraties uit voor deze
// omgeving, dan is geen enkel kanaal zichtbaar; staat hij aan, dan geldt de
// per-kanaal allowlist van het bureau.
function navForConnections(active, features, channels) {
  const channelsVisible = features.integrations !== false;
  return NAV.map((item) => {
    if (!item.group) return item.feature && features[item.feature] === false ? null : item;
    if (!channelsVisible) return null;
    if (!active) return item;
    const children = item.children.filter(
      (c) => !c.provider || (active.has(c.provider) && channels[c.provider] !== false),
    );
    return children.length ? { ...item, children } : null;
  }).filter(Boolean);
}

function initials(name = "") {
  const parts = name.replace(/^https?:\/\//, "").split(/[ .@]/).filter(Boolean);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "—";
}

export default function Sidebar({ user, connected = 0, total = 4, open = false, onNavigate }) {
  const { orgs, orgId, orgName, setOrg, features, channels } = useActiveOrg();
  const { data: connData } = useConnections();
  const nav = navForConnections(connectedProviders(connData), features, channels);
  const pct = Math.round((connected / total) * 100);
  const [menuOpen, setMenuOpen] = useState(false);
  const [switchOpen, setSwitchOpen] = useState(false);
  const canSwitch = orgs.length > 1;
  return (
    <div className={`app-sidebar no-print${open ? " open" : ""}`}>
      <div style={{ padding: "20px 20px 16px" }}>
        <Logo size={28} />
      </div>

      <div style={{ position: "relative", margin: "4px 14px 14px" }}>
        {switchOpen && canSwitch && (
          <div style={switchMenu}>
            {orgs.map((o) => (
              <div key={o.id} className="icon-btn" onClick={() => { setOrg(o.id); setSwitchOpen(false); }}
                style={{ ...switchRow, ...(o.id === orgId ? switchRowActive : {}) }}>
                <div style={{ ...orgChip, width: 22, height: 22, fontSize: 11 }}>{initials(o.name)}</div>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.name}</span>
              </div>
            ))}
          </div>
        )}
        <div className="pill-btn" style={{ ...switcher, margin: 0, cursor: canSwitch ? "pointer" : "default" }} onClick={() => canSwitch && setSwitchOpen((o) => !o)}>
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
        {nav.map((item) => (
          item.group ? (
            <NavGroup key={item.group} item={item} onNavigate={onNavigate} />
          ) : (
            <NavLink key={item.to} to={item.to} className="icon-btn" onClick={onNavigate} style={({ isActive }) => navItem(isActive)}>
              <item.Icon s={18} />
              {item.label}
            </NavLink>
          )
        ))}
        {user?.role === "agency_admin" && (
          <>
            {/* Scheidslijn: Klantenbeheer is beheer (alleen admins/bureaus zien
                dit), geen onderdeel van het gewone dashboardmenu. */}
            <div style={navSeparator} />
            <NavLink to="/admin" className="icon-btn" onClick={onNavigate} style={() => navItem(false)}>
              <IcUsers s={18} />
              Klantenbeheer
            </NavLink>
          </>
        )}
      </div>

      <div style={{ flex: 1 }} />

      {/* Koppel-voortgang alleen tonen als deze omgeving zelf mag koppelen. */}
      {features.integrations !== false && (
        <div style={progressCard}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 13, fontWeight: 500, color: "var(--c-accent-strong)", marginBottom: 4 }}>{connected} van {total} gekoppeld</div>
          <div style={{ fontSize: 11.5, color: "var(--c-muted)", lineHeight: 1.45, marginBottom: 10 }}>
            {connected >= total ? "Alle bronnen zijn gekoppeld." : "Koppel je overige bronnen voor compleet inzicht."}
          </div>
          <div style={{ height: 6, borderRadius: 3, background: "var(--c-surface)", overflow: "hidden" }}>
            <div style={{ width: `${pct}%`, height: "100%", background: "var(--c-accent)" }} />
          </div>
        </div>
      )}

      <div style={{ ...userFoot, position: "relative" }}>
        {menuOpen && (
          <div style={userMenu}>
            <a
              href={LOGOUT_URL}
              style={menuItem}
              onClick={() => { invalidateAll(); ["mm-onboarded", "mm-property", "mm-gsc-site"].forEach((k) => localStorage.removeItem(k)); }}
            >
              Uitloggen
            </a>
          </div>
        )}
        <div onClick={() => setMenuOpen((o) => !o)} style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0, cursor: "pointer" }}>
          <div style={userChip}>{initials(user?.email)}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{user?.email}</div>
            <div style={{ fontSize: 11, color: "var(--c-muted)" }}>{user?.role === "agency_admin" ? "Bureau-admin" : "Klant"}</div>
          </div>
          <span style={{ color: "var(--c-muted)", transform: menuOpen ? "rotate(180deg)" : "none", transition: "transform .15s" }}><IcChevDown s={16} /></span>
        </div>
      </div>
    </div>
  );
}

const switcher = { margin: "4px 14px 14px", padding: "10px 12px", borderRadius: "var(--radius-sm)", border: "1px solid var(--c-border)", background: "var(--c-surface)", display: "flex", alignItems: "center", gap: 10, cursor: "pointer" };
const orgChip = { width: 26, height: 26, borderRadius: 8, background: "var(--action-secondary)", color: "#fff", fontWeight: 500, fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" };
const switchMenu = { position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, maxHeight: 280, overflow: "auto", background: "var(--c-surface)", border: "1px solid var(--c-border)", borderRadius: "var(--radius-md)", boxShadow: "var(--sh-md)", zIndex: 30, padding: 6 };
const switchRow = { display: "flex", alignItems: "center", gap: 9, padding: "8px 10px", borderRadius: "var(--radius-xs)", fontSize: 13, cursor: "pointer", color: "var(--c-ink-soft)" };
const switchRowActive = { background: "var(--surface-accent)", color: "var(--c-accent-strong)", fontWeight: 500 };
const menuLabel = { padding: "0 12px", fontSize: 11, fontWeight: 500, letterSpacing: "var(--ls-caps)", color: "var(--c-muted)", textTransform: "uppercase", margin: "6px 0 6px 8px" };
const navSeparator = { height: 1, background: "var(--border-subtle)", margin: "8px 12px" };
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

// Uitklapbare navigatiegroep (bv. Marketing, Verkoop). Standaard open; klap in/uit
// via de kop. Bevat de groep een actieve route, dan blijft hij zichtbaar.
function NavGroup({ item, onNavigate }) {
  const { pathname } = useLocation();
  const hasActive = item.children.some((c) => pathname === c.to || pathname.startsWith(c.to + "/"));
  const [open, setOpen] = useState(true);
  const show = open || hasActive;
  return (
    <div>
      <button type="button" className="icon-btn" onClick={() => setOpen((o) => !o)} style={groupHeader(hasActive)}>
        <item.Icon s={18} />
        <span style={{ flex: 1, textAlign: "left" }}>{item.group}</span>
        <span style={{ display: "flex", color: "var(--c-muted)", transform: show ? "none" : "rotate(-90deg)", transition: "transform .15s" }}>
          <IcChevDown s={15} />
        </span>
      </button>
      {show && (
        <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 3 }}>
          {item.children.map((c) => (
            <NavLink key={c.to} to={c.to} className="icon-btn" onClick={onNavigate} style={({ isActive }) => ({ ...navItem(isActive), paddingLeft: 32 })}>
              <c.Icon s={16} />
              {c.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

function groupHeader(active) {
  return {
    display: "flex", alignItems: "center", gap: 11, padding: "10px 12px", borderRadius: 10,
    width: "100%", border: "none", background: "transparent", cursor: "pointer",
    fontFamily: "inherit", fontSize: 14, fontWeight: active ? 700 : 600,
    color: active ? "var(--c-accent)" : "var(--c-muted)",
  };
}
