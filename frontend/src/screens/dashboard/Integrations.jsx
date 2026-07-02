import { useConnections } from "../../lib/useConnections.jsx";
import { useActiveOrg } from "../../lib/ActiveOrgProvider.jsx";
import { connectUrl, metaLoginUrl, disconnectProvider } from "../../lib/api.js";
import { invalidateOrg } from "../../lib/swr.js";
import { GaGlyph, GscGlyph, AdsGlyph, MetaGlyph } from "../../components/icons.jsx";
import { TabState } from "../../components/ui.jsx";

const META = {
  google_analytics: { name: "Google Analytics", desc: "GA4 — bezoekers, sessies, conversies", Glyph: GaGlyph, bg: "#FFF3E0" },
  search_console: { name: "Search Console", desc: "organisch verkeer, posities & zoekwoorden", Glyph: GscGlyph, bg: "#E8F0FE" },
  google_ads: { name: "Google Ads", desc: "campagnes, kosten, klikken & ROAS", Glyph: AdsGlyph, bg: "#E8F0FE" },
  meta_ads: { name: "META Ads", desc: "Facebook & Instagram campagnes", Glyph: MetaGlyph, bg: "#E7F0FF" },
};

function StatusPill({ status }) {
  if (status === "connected") return <span className="pill pos">verbonden</span>;
  if (status === "revoked") return <span className="pill neg">opnieuw koppelen</span>;
  if (status === "coming_soon") return <span className="pill accent">binnenkort</span>;
  return <span className="pill muted">niet gekoppeld</span>;
}

export default function Integrations() {
  const { data, loading, reload } = useConnections();
  const { orgId } = useActiveOrg();
  if (loading) return <TabState loading />;
  const items = data?.connections || [];

  const onDisconnect = (provider, name) => {
    if (window.confirm(`${name} ontkoppelen? De toegang wordt ingetrokken.`)) {
      invalidateOrg(orgId); // drop cached properties/reports for this org
      disconnectProvider(provider, orgId).then(reload).catch(() => reload());
    }
  };

  return (
    <div>
      <div className="display" style={{ fontSize: 30, marginBottom: 6 }}>integraties</div>
      <div style={{ fontSize: 13.5, color: "var(--c-muted)", marginBottom: 22 }}>
        beheer je gekoppelde marketingbronnen · {data?.connected ?? 0} van {data?.total ?? 4} actief
      </div>
      <div className="split-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        {items.map((c) => {
          const m = META[c.provider] || {};
          const canConnect = c.status === "not_connected" || c.status === "revoked";
          return (
            <div key={c.provider} className="card" style={{ padding: 22 }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
                <div style={{ width: 48, height: 48, borderRadius: 12, background: m.bg, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                  {m.Glyph && <m.Glyph s={26} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>{m.name}</div>
                  <div style={{ fontSize: 13, color: "var(--c-muted)", marginTop: 2 }}>{m.desc}</div>
                  {c.google_email && <div style={{ fontSize: 12, color: "var(--c-muted)", marginTop: 6 }}>{c.google_email}</div>}
                </div>
                <StatusPill status={c.status} />
              </div>
              <div style={{ marginTop: 16, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 12 }}>
                {canConnect && <a className="btn-primary" href={c.provider === "meta_ads" ? metaLoginUrl(orgId) : connectUrl([c.provider], "/app/integrations")} style={{ height: 38, padding: "0 16px", fontSize: 13, textDecoration: "none" }}>koppelen</a>}
                {c.status === "connected" && (
                  <>
                    <span style={{ fontSize: 12.5, color: "var(--c-pos)", fontWeight: 700 }}>actief ✓</span>
                    <button className="btn-ghost" style={{ height: 38, padding: "0 16px", fontSize: 13 }} onClick={() => onDisconnect(c.provider, m.name)}>ontkoppelen</button>
                  </>
                )}
                {c.status === "coming_soon" && <span style={{ fontSize: 12.5, color: "var(--c-muted)" }}>nog niet beschikbaar</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
