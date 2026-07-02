import { useTheme } from "../lib/ThemeProvider.jsx";
import DateRangePicker from "./DateRangePicker.jsx";
import { IcSearch, IcSun, IcMoon, IcBell, IcMenu } from "./icons.jsx";

// Generic dashboard topbar. Pass `left` to replace the default search pill.
// `onMenu` opens the mobile navigation drawer (button only shows on mobile).
export default function Topbar({ left, searchPlaceholder = "zoek campagne, pagina of metric…", showDateRange = true, onMenu }) {
  const { theme, toggle } = useTheme();
  return (
    <div style={bar} className="no-print dash-topbar">
      {onMenu && (
        <button className="hamburger" style={iconBtn} onClick={onMenu} title="menu" aria-label="menu">
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
      {showDateRange && <DateRangePicker />}
      <button style={iconBtn} onClick={toggle} title="thema wisselen">
        {theme === "dark" ? <IcSun s={17} /> : <IcMoon s={17} />}
      </button>
      <div style={{ ...iconBtn, position: "relative", cursor: "pointer" }} className="hide-mobile">
        <IcBell s={17} />
        <span style={dot} />
      </div>
    </div>
  );
}

const bar = { display: "flex", alignItems: "center", gap: 14, padding: "16px 28px", borderBottom: "1px solid var(--c-border)", background: "var(--c-surface)" };
const searchPill = { display: "flex", alignItems: "center", gap: 9, padding: "0 14px", height: 40, border: "1px solid var(--c-border)", borderRadius: 999, background: "var(--c-surface-2)", width: 320, color: "var(--c-muted)" };
const iconBtn = { width: 40, height: 40, border: "1px solid var(--c-border)", borderRadius: "50%", background: "var(--c-surface)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--c-ink-soft)" };
const dot = { position: "absolute", top: 7, right: 8, width: 7, height: 7, borderRadius: "50%", background: "var(--c-neg)", border: "1.5px solid var(--c-surface)" };
