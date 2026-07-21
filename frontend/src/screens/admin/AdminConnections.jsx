import { useEffect, useState } from "react";
import { api } from "../../lib/api.js";

const PROVIDER_LABEL = {
  google_analytics: "Google Analytics",
  search_console: "Search Console",
  google_ads: "Google Ads",
  meta_ads: "META",
  woocommerce: "WooCommerce",
};

const STATUS = {
  connected: { label: "Gekoppeld", cls: "pos" },
  revoked: { label: "Actie vereist", cls: "neg" },
  not_connected: { label: "Niet gekoppeld", cls: "muted" },
};

function ago(iso) {
  if (!iso) return "—";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "zojuist";
  if (mins < 60) return `${mins} min geleden`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} uur geleden`;
  return `${Math.floor(h / 24)} dagen geleden`;
}

// Koppelingen: alle kanalen van alle klanten in één overzicht, zodat de admin
// in één oogopslag ziet welke koppeling aandacht nodig heeft.
export default function AdminConnections() {
  const [orgs, setOrgs] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("alle");
  const [testing, setTesting] = useState(null);
  const [results, setResults] = useState({});

  useEffect(() => {
    api("/api/admin/organizations").then((d) => setOrgs(d.organizations || [])).catch(setError);
  }, []);

  const runTest = async (r, key) => {
    setTesting(key);
    try {
      const d = await api(`/api/admin/diagnose/google?org_id=${encodeURIComponent(r.orgId)}&provider=${encodeURIComponent(r.provider)}`);
      setResults((res) => ({ ...res, [key]: d }));
    } catch (e) {
      setResults((res) => ({ ...res, [key]: { ok: false, step: "request", error: String(e?.message || e) } }));
    } finally {
      setTesting(null);
    }
  };

  if (error) return <div className="card" style={{ padding: 20, color: "var(--c-neg)" }}>Fout: {String(error.message || error)}</div>;
  if (orgs === null) return <div style={{ display: "grid", placeItems: "center", padding: 60 }}><div className="spin" /></div>;

  const rows = orgs.flatMap((o) =>
    Object.entries(o.providers || {}).map(([provider, p]) => ({
      orgId: o.id, org: o.name, provider, status: p.status || "not_connected",
      email: p.google_email, updated: p.updated_at,
      google: ["google_analytics", "search_console", "google_ads"].includes(provider),
    })));
  const shown = filter === "alle" ? rows : rows.filter((r) => r.status === filter);
  const needAction = rows.filter((r) => r.status === "revoked").length;

  return (
    <div>
      <div className="display" style={{ fontSize: 30 }}>koppelingen</div>
      <div style={{ fontSize: 13.5, color: "var(--c-muted)", margin: "4px 0 20px" }}>
        Alle kanaalkoppelingen van alle klanten. {needAction > 0 ? `${needAction} koppeling${needAction === 1 ? " vraagt" : "en vragen"} om actie.` : "Alles werkt."}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {[["alle", "Alle"], ["connected", "Gekoppeld"], ["revoked", "Actie vereist"]].map(([k, lbl]) => (
          <button key={k} className="pill-btn" onClick={() => setFilter(k)} style={{
            padding: "7px 14px", borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: "pointer",
            border: "1px solid " + (filter === k ? "var(--c-accent)" : "var(--c-border)"),
            background: filter === k ? "var(--c-accent)" : "var(--c-surface)",
            color: filter === k ? "#fff" : "var(--c-ink)",
          }}>{lbl}</button>
        ))}
      </div>

      <div className="card" style={{ overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
        <div style={head}>
          <span>Klant</span><span>Kanaal</span><span>Account</span><span>Status</span><span>Laatste sync</span><span />
        </div>
        {shown.map((r, i) => {
          const st = STATUS[r.status] || STATUS.not_connected;
          const key = `${r.orgId}:${r.provider}`;
          return (
            <div key={key}>
              <div style={row}>
                <span style={{ fontWeight: 700 }}>{r.org}</span>
                <span>{PROVIDER_LABEL[r.provider] || r.provider}</span>
                <span style={{ color: "var(--c-muted)", fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.email || "—"}</span>
                <span><span className={`pill ${st.cls}`}>{st.label}</span></span>
                <span style={{ color: "var(--c-muted)", fontSize: 12.5 }}>{ago(r.updated)}</span>
                <span>
                  {r.google && (
                    <button className="btn-ghost" disabled={testing === key} style={{ height: 28, padding: "0 12px", fontSize: 12 }}
                      onClick={() => runTest(r, key)} title="Ververs het token en doe een testaanroep; toont de exacte foutreden">
                      {testing === key ? "Testen…" : "Test"}
                    </button>
                  )}
                </span>
              </div>
              {results[key] && (
                <div style={{ padding: "0 20px 12px", fontSize: 12.5 }}>
                  {results[key].ok ? (
                    <span className="pill pos">Koppeling werkt (verversen en API-call geslaagd)</span>
                  ) : (
                    <div className="card" style={{ padding: 12, background: "var(--c-surface-2)", fontFamily: "monospace", fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                      Stap: {results[key].step}{"\n"}{results[key].error}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {shown.length === 0 && <div style={{ padding: 24, color: "var(--c-muted)" }}>Geen koppelingen in deze selectie.</div>}
        </div>
      </div>
    </div>
  );
}

const cols = "1.5fr 1.1fr 1.5fr 0.9fr 0.9fr 0.6fr";
const head = { display: "grid", gridTemplateColumns: cols, minWidth: 820, gap: 14, fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--c-muted)", padding: "14px 20px", borderBottom: "1px solid var(--c-border)", background: "var(--c-surface-2)" };
const row = { display: "grid", gridTemplateColumns: cols, minWidth: 820, gap: 14, alignItems: "center", padding: "13px 20px", borderBottom: "1px solid var(--c-border-soft)", fontSize: 13.5 };
