import { Sparkline } from "./charts.jsx";
import { connectUrl } from "../lib/api.js";
import { Mark, Illustration } from "./Brand.jsx";

// Delta hoort altijd bij een absolute waarde: pill met richting en percentage.
export function DeltaPill({ delta, positive = true, style }) {
  if (delta == null) return null;
  return (
    <span className={`pill ${positive ? "pos" : "neg"}`} style={{ fontVariantNumeric: "tabular-nums", ...style }}>
      {positive ? "↑" : "↓"} {delta}
    </span>
  );
}

// KPI-tegel: eyebrow, metric in Fredoka met tabular-nums, delta en sparkline.
export function KpiCard({ label, value, delta, positive = true, deltaLabel, sparkValues, sparkColor }) {
  return (
    <div className="card" style={{ flex: 1, padding: 20, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
      <span className="mm-eyebrow">{label}</span>
      <span className="mm-metric" style={{ fontSize: "var(--fs-metric-md)" }}>{value}</span>
      {(delta != null || deltaLabel) && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <DeltaPill delta={delta} positive={positive} />
          {deltaLabel && <span style={{ fontSize: "var(--fs-caption)", color: "var(--text-muted)" }}>{deltaLabel}</span>}
        </div>
      )}
      {sparkValues && <Sparkline values={sparkValues} color={sparkColor} />}
    </div>
  );
}

export function ProgressRow({ label, value, pct, color = "var(--action-primary)", labelWidth }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ fontSize: 13, width: labelWidth, flex: labelWidth ? "none" : 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      <div style={{ flex: 1, height: 7, borderRadius: "var(--radius-pill)", background: "var(--c-track)", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: "var(--radius-pill)" }} />
      </div>
      <span style={{ fontWeight: 600, fontSize: 13, width: 42, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{value ?? `${pct}%`}</span>
    </div>
  );
}

export function SectionCard({ title, subtitle, action, children, style }) {
  return (
    <div className="card" style={{ padding: 20, ...style }}>
      {(title || action) && (
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: subtitle ? 4 : 14 }}>
          <div>
            {title && <div className="display" style={{ fontSize: "var(--fs-h3)", fontWeight: 500 }}>{title}</div>}
            {subtitle && <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-muted)", margin: "2px 0 10px" }}>{subtitle}</div>}
          </div>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

// Lege staat: beeldmerk of één spot-illustratie, kop, uitleg, actie.
export function EmptyState({ title, description, action, illustration, style }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 10, padding: "48px 24px", ...style }}>
      {illustration ? <Illustration name={illustration} size={130} /> : <Mark size={72} />}
      <div className="display" style={{ fontSize: "var(--fs-h3)", fontWeight: 500, marginTop: 4 }}>{title}</div>
      {description && <p style={{ fontSize: "var(--fs-body)", color: "var(--text-muted)", maxWidth: 340, margin: 0 }}>{description}</p>}
      {action && <div style={{ marginTop: 6 }}>{action}</div>}
    </div>
  );
}

// Loading / empty / error block for a tab.
export function TabState({ loading, error, empty, onConnect }) {
  if (loading) return <div style={{ display: "grid", placeItems: "center", padding: 80 }}><div className="spin" /></div>;
  if (error?.status === 409)
    return (
      <div className="card">
        <EmptyState
          illustration="spot-database-sync"
          title="Nog geen bron gekoppeld"
          description="Deze organisatie heeft nog geen actieve koppeling. Koppel Google Analytics of Search Console om data te zien."
          action={onConnect && (
            <a className="btn-primary" href={connectUrl(["google_analytics", "search_console"], typeof window !== "undefined" ? window.location.pathname : "/app")} style={{ height: 46, padding: "0 26px", textDecoration: "none" }}>
              Google koppelen
            </a>
          )}
        />
      </div>
    );
  if (error) return <div className="card" style={{ padding: 28, color: "var(--c-neg)" }}>Fout: {String(error.message || error)}</div>;
  if (empty)
    return (
      <div className="card">
        <EmptyState
          illustration="spot-vergrootglas"
          title="Geen data in deze periode"
          description="Kies een andere periode of controleer of de bron data aanlevert."
        />
      </div>
    );
  return null;
}
