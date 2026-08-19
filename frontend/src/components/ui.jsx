import { useState } from "react";
import { Sparkline } from "./charts.jsx";
import { connectUrl } from "../lib/api.js";

export function KpiCard({ label, value, delta, positive = true, sparkValues, sparkLabels, sparkUnit, sparkColor }) {
  return (
    <div className="card" style={{ flex: "1 1 160px", padding: "16px 18px", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 12.5, color: "var(--c-muted)", fontWeight: 600 }}>{label}</span>
        {delta != null && (
          <span className={`pill ${positive ? "pos" : "neg"}`} style={{ fontSize: 11.5, padding: "3px 7px" }}>
            {positive ? "▲" : "▼"} {delta}
          </span>
        )}
      </div>
      <div className="display" style={{ fontSize: 28, margin: "8px 0 6px" }}>{value}</div>
      {sparkValues
        ? <Sparkline values={sparkValues} labels={sparkLabels} unit={sparkUnit} color={sparkColor} />
        : <div style={{ height: 34 }} aria-hidden="true" />}
    </div>
  );
}

export function ProgressRow({ label, value, pct, color = "var(--c-accent)", labelWidth }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={`${label}: ${value ?? `${pct}%`}`}
      style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 6px", margin: "0 -6px", borderRadius: 8, background: hover ? "var(--c-surface-2)" : "transparent", transition: "background .12s" }}
    >
      <span style={{ fontWeight: 600, fontSize: 13, width: labelWidth, flex: labelWidth ? "none" : 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: hover ? "var(--c-ink)" : undefined }}>{label}</span>
      <div style={{ flex: 1, height: 7, borderRadius: 4, background: "var(--c-track)", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, opacity: hover ? 1 : 0.92, transition: "opacity .12s" }} />
      </div>
      <span style={{ fontWeight: 700, fontSize: 13, width: 38, textAlign: "right" }}>{value ?? `${pct}%`}</span>
    </div>
  );
}

export function SectionCard({ title, action, children, style }) {
  return (
    <div className="card" style={{ padding: 20, ...style }}>
      {(title || action) && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{title}</div>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

// Loading / empty / error block for a tab.
export function TabState({ loading, error, empty, onConnect }) {
  if (loading) return <div style={{ display: "grid", placeItems: "center", padding: 80 }}><div className="spin" /></div>;
  if (error?.status === 409)
    return (
      <div className="card" style={{ padding: 40, textAlign: "center" }}>
        <div className="pill accent" style={{ marginBottom: 12 }}>geen koppeling</div>
        <div style={{ color: "var(--c-muted)", marginBottom: 16 }}>Er is geen actieve koppeling voor deze organisatie.</div>
        {onConnect && <a className="btn-primary" href={connectUrl(["google_analytics", "search_console"], typeof window !== "undefined" ? window.location.pathname : "/app")} style={{ height: 44, padding: "0 20px", textDecoration: "none" }}>Koppel Google</a>}
      </div>
    );
  if (error?.status === 503)
    return (
      <div className="card" style={{ padding: 40, textAlign: "center" }}>
        <div className="pill muted" style={{ marginBottom: 12 }}>tijdelijke storing</div>
        <div style={{ color: "var(--c-muted)", marginBottom: 16 }}>{String(error.message || "De bron is tijdelijk niet bereikbaar.")}</div>
        <button className="btn-primary" onClick={() => window.location.reload()} style={{ height: 44, padding: "0 20px" }}>Probeer opnieuw</button>
      </div>
    );
  if (error) return <div className="card" style={{ padding: 28, color: "var(--c-neg)" }}>Fout: {String(error.message || error)}</div>;
  if (empty) return <div className="card" style={{ padding: 28, color: "var(--c-muted)" }}>Geen data beschikbaar.</div>;
  return null;
}
