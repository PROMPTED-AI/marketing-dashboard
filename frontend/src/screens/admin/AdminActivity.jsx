import { useEffect, useState } from "react";
import { api } from "../../lib/api.js";

const PROVIDER_LABEL = {
  google_analytics: "Google Analytics", search_console: "Search Console",
  google_ads: "Google Ads", meta_ads: "META", woocommerce: "WooCommerce",
};

// Omschrijving + kleurpunt per soort gebeurtenis.
function describe(ev) {
  switch (ev.kind) {
    case "org":
      return { dot: "var(--c-accent)", text: <><b>{ev.org}</b> is toegevoegd als organisatie</> };
    case "user":
      return { dot: "var(--c-purple)", text: <><b>{ev.a}</b> heeft een account ({ev.b === "agency_admin" ? "bureau-admin" : "klant"}) bij {ev.org}</> };
    case "connection": {
      const ch = PROVIDER_LABEL[ev.a] || ev.a;
      const what = ev.b === "connected" ? "gekoppeld of ververst" : ev.b === "revoked" ? "verlopen, opnieuw koppelen nodig" : ev.b;
      return { dot: ev.b === "revoked" ? "var(--c-neg)" : "var(--c-pos)", text: <><b>{ev.org}</b>: {ch} {what}</> };
    }
    case "dashboard":
      return { dot: "var(--c-accent)", text: <><b>{ev.org}</b> heeft dashboard "{ev.a}" opgeslagen</> };
    case "feedback":
      return { dot: "var(--c-purple)", text: <><b>{ev.org}</b> stuurde feedback ({ev.a})</> };
    default:
      return { dot: "var(--c-muted)", text: <>{ev.kind}</> };
  }
}

function when(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "zojuist";
  if (mins < 60) return `${mins} min geleden`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} uur geleden`;
  return d.toLocaleDateString("nl-NL", { day: "numeric", month: "short" }) + " " + d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
}

// Activiteitenlog: recente gebeurtenissen op het platform, afgeleid uit de
// bestaande gegevens (organisaties, accounts, koppelingen, dashboards en
// feedback), gesorteerd van nieuw naar oud.
export default function AdminActivity() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api("/api/admin/activity").then((d) => setItems(d.activity || [])).catch(setError);
  }, []);

  if (error) return <div className="card" style={{ padding: 20, color: "var(--c-neg)" }}>Fout: {String(error.message || error)}</div>;
  if (items === null) return <div style={{ display: "grid", placeItems: "center", padding: 60 }}><div className="spin" /></div>;

  return (
    <div>
      <div className="display" style={{ fontSize: 30 }}>activiteitenlog</div>
      <div style={{ fontSize: 13.5, color: "var(--c-muted)", margin: "4px 0 20px" }}>
        De meest recente gebeurtenissen op het platform, van nieuw naar oud.
      </div>

      <div className="card" style={{ padding: "6px 0" }}>
        {items.map((ev, i) => {
          const d = describe(ev);
          return (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "11px 20px", borderBottom: i < items.length - 1 ? "1px solid var(--c-border-soft)" : "none" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: d.dot, marginTop: 6, flex: "none" }} />
              <span style={{ flex: 1, fontSize: 13.5, lineHeight: 1.5 }}>{d.text}</span>
              <span style={{ color: "var(--c-muted)", fontSize: 12, whiteSpace: "nowrap" }}>{when(ev.ts)}</span>
            </div>
          );
        })}
        {items.length === 0 && <div style={{ padding: 24, color: "var(--c-muted)" }}>Nog geen activiteit.</div>}
      </div>
    </div>
  );
}
