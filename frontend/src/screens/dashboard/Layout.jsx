import { LOGOUT_URL } from "../../lib/api.js";
import { useMe } from "../../lib/useMe.jsx";
import { useTheme } from "../../lib/ThemeProvider.jsx";

// Phase 1 placeholder shell — replaced by the full sidebar/topbar dashboard in Phase 2.
export default function Layout() {
  const { me } = useMe();
  const { theme, toggle } = useTheme();
  return (
    <div style={{ minHeight: "100vh", padding: 40 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 28 }}>
        <div className="display" style={{ fontSize: 26 }}>kompas</div>
        <div style={{ flex: 1 }} />
        <button className="btn-ghost" style={{ height: 38, padding: "0 14px" }} onClick={toggle}>
          {theme === "dark" ? "light" : "dark"} thema
        </button>
        <a className="btn-ghost" href={LOGOUT_URL} style={{ height: 38, padding: "0 14px", textDecoration: "none" }}>uitloggen</a>
      </div>
      <div className="card" style={{ padding: 28, maxWidth: 560 }}>
        <div className="display" style={{ fontSize: 24, marginBottom: 8 }}>ingelogd ✓</div>
        <div style={{ color: "var(--c-muted)", fontSize: 14, lineHeight: 1.6 }}>
          Welkom, <b style={{ color: "var(--c-ink)" }}>{me?.email}</b> — rol:{" "}
          <b style={{ color: "var(--c-ink)" }}>{me?.role}</b>.<br />
          Het volledige dashboard (sidebar, onboarding, Analytics-tab) volgt in de volgende fase.
        </div>
      </div>
    </div>
  );
}
