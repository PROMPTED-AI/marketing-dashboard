import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "../lib/ThemeProvider.jsx";
import { useMe } from "../lib/useMe.jsx";
import { useActiveOrg } from "../lib/ActiveOrgProvider.jsx";
import { useDateRange } from "../lib/PeriodProvider.jsx";
import { api } from "../lib/api.js";
import DateRangePicker from "./DateRangePicker.jsx";
import { IcSearch, IcSun, IcMoon, IcBell, IcMenu } from "./icons.jsx";

const SEV_COLOR = { positive: "var(--c-pos)", negative: "var(--c-neg)", neutral: "var(--c-accent)" };

// Notificatiebel: toont de signalen van de actieve klant en periode (dezelfde
// bron als het zijpaneel van de assistent). Het badge-stipje verschijnt alleen
// als er signalen zijn; klik op een signaal en de assistent zoekt het uit.
function NotificationBell() {
  const nav = useNavigate();
  const { orgId } = useActiveOrg();
  const { start, end } = useDateRange();
  const [open, setOpen] = useState(false);
  const [insights, setInsights] = useState(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    let alive = true;
    setInsights(null);
    const q = new URLSearchParams({ start, end });
    if (orgId) q.set("org_id", orgId);
    const prop = localStorage.getItem("kompas-property");
    if (prop) q.set("property_id", prop);
    const site = localStorage.getItem("kompas-gsc-site");
    if (site) q.set("site", site);
    api("/api/insights?" + q.toString())
      .then((d) => { if (alive) setInsights(d.insights || []); })
      .catch(() => { if (alive) setInsights([]); });
    return () => { alive = false; };
  }, [orgId, start, end]);

  // Sluit de dropdown bij een klik buiten het bel-gebied.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const ask = (question) => {
    setOpen(false);
    sessionStorage.setItem("kompas-ask", question);
    nav("/app/assistant");
  };

  return (
    <div ref={wrapRef} style={{ position: "relative" }} className="hide-mobile">
      <button
        className="icon-btn"
        style={{ ...iconBtn, position: "relative" }}
        onClick={() => setOpen((o) => !o)}
        title="Signalen"
        aria-label="Signalen"
      >
        <IcBell s={17} />
        {insights?.length > 0 && <span style={dot} />}
      </button>
      {open && (
        <div style={bellMenu} className="bubble-in">
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "12px 14px 8px" }}>
            <span style={{ fontSize: 13, fontWeight: 800 }}>Signalen</span>
            <span style={{ fontSize: 11, color: "var(--c-muted)" }}>deze periode</span>
          </div>
          {insights === null && <div style={bellEmpty}>Signalen laden…</div>}
          {insights?.length === 0 && <div style={bellEmpty}>Geen opvallende veranderingen deze periode.</div>}
          {insights?.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "0 8px 8px" }}>
              {insights.slice(0, 6).map((it, i) => (
                <button key={i} className="icon-btn" onClick={() => ask(it.question)} title={it.detail} style={bellRow}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: SEV_COLOR[it.severity] || "var(--c-accent)", marginTop: 5, flex: "none" }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontWeight: 700, fontSize: 12.5, color: "var(--c-ink)" }}>{it.title}</span>
                    <span style={{ display: "block", fontSize: 11, color: "var(--c-muted)", marginTop: 1 }}>{it.channel_label}</span>
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--c-accent)", alignSelf: "center" }}>→</span>
                </button>
              ))}
            </div>
          )}
          <div style={{ padding: "8px 14px 12px", borderTop: "1px solid var(--c-border-soft)", fontSize: 11, color: "var(--c-muted)" }}>
            Klik op een signaal en de assistent zoekt het uit.
          </div>
        </div>
      )}
    </div>
  );
}

// Generic dashboard topbar. Pass `left` to replace the default search pill.
// `onMenu` opens the mobile navigation drawer (button only shows on mobile).
export default function Topbar({ left, searchPlaceholder = "zoek campagne, pagina of metric…", showDateRange = true, onMenu }) {
  const { theme, toggle } = useTheme();
  const { me } = useMe();
  const nav = useNavigate();
  const sub = me?.subscription;
  return (
    <div style={bar} className="no-print dash-topbar">
      {onMenu && (
        // Geen inline `display`: de CSS-klasse bepaalt zichtbaarheid
        // (verborgen op desktop, zichtbaar als drawer-knop op mobiel).
        <button className="hamburger" style={hamburgerBtn} onClick={onMenu} title="menu" aria-label="menu">
          <IcMenu s={18} />
        </button>
      )}
      {left || (
        <div style={searchPill} className="hide-mobile">
          <IcSearch s={16} />
          <span style={{ fontSize: 13, color: "var(--c-muted)" }}>{searchPlaceholder}</span>
        </div>
      )}
      <div style={{ flex: 1 }} />
      {sub?.plan === "trial" && !sub.expired && (
        <span
          className="pill accent hide-mobile pill-btn"
          title="Bekijk of beheer je proefperiode in Instellingen"
          style={{ fontSize: 12, cursor: "pointer" }}
          onClick={() => nav("/app/settings")}
        >
          Proefperiode · nog {sub.days_left} {sub.days_left === 1 ? "dag" : "dagen"}
        </span>
      )}
      {showDateRange && <DateRangePicker />}
      <button className="icon-btn" style={iconBtn} onClick={toggle} title="thema wisselen">
        {theme === "dark" ? <IcSun s={17} /> : <IcMoon s={17} />}
      </button>
      <NotificationBell />
    </div>
  );
}

const bar = { display: "flex", alignItems: "center", gap: 14, padding: "16px 28px", borderBottom: "1px solid var(--c-border)", background: "var(--c-surface)" };
const searchPill = { display: "flex", alignItems: "center", gap: 9, padding: "0 14px", height: 40, border: "1px solid var(--c-border)", borderRadius: 999, background: "var(--c-surface-2)", width: 320, color: "var(--c-muted)" };
const iconBtn = { width: 40, height: 40, border: "1px solid var(--c-border)", borderRadius: "50%", background: "var(--c-surface)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--c-ink-soft)" };
// Als iconBtn, maar zonder `display`: dat regelt de .hamburger-CSS.
const { display: _drop, ...hamburgerBtn } = iconBtn;
const dot = { position: "absolute", top: 7, right: 8, width: 7, height: 7, borderRadius: "50%", background: "var(--c-neg)", border: "1.5px solid var(--c-surface)" };
const bellMenu = { position: "absolute", top: "calc(100% + 8px)", right: 0, width: 320, background: "var(--c-surface)", border: "1px solid var(--c-border)", borderRadius: 14, boxShadow: "var(--sh-md)", zIndex: 80, overflow: "hidden" };
const bellEmpty = { padding: "6px 14px 12px", fontSize: 12.5, color: "var(--c-muted)" };
const bellRow = { display: "flex", gap: 9, alignItems: "flex-start", padding: "8px 9px", textAlign: "left", cursor: "pointer", width: "100%", borderRadius: 9, border: "none", background: "transparent", fontFamily: "inherit" };
