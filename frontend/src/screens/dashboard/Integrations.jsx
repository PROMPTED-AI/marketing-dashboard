import { useState } from "react";
import { useConnections } from "../../lib/useConnections.jsx";
import { useActiveOrg } from "../../lib/ActiveOrgProvider.jsx";
import { api, connectUrl, metaLoginUrl, disconnectProvider } from "../../lib/api.js";
import { invalidateOrg } from "../../lib/swr.js";
import { GaGlyph, GscGlyph, AdsGlyph, MetaGlyph, WooGlyph } from "../../components/icons.jsx";
import { TabState } from "../../components/ui.jsx";
import Modal from "../../components/dashboard/Modal.jsx";

const META = {
  google_analytics: { name: "Google Analytics", desc: "GA4 — bezoekers, sessies, conversies", Glyph: GaGlyph, bg: "#FFF3E0" },
  search_console: { name: "Search Console", desc: "organisch verkeer, posities & zoekwoorden", Glyph: GscGlyph, bg: "#E8F0FE" },
  google_ads: { name: "Google Ads", desc: "campagnes, kosten, klikken & ROAS", Glyph: AdsGlyph, bg: "#E8F0FE" },
  meta_ads: { name: "META Ads", desc: "Facebook & Instagram campagnes", Glyph: MetaGlyph, bg: "#E7F0FF" },
  woocommerce: { name: "WooCommerce", desc: "webshop — omzet, bestellingen & producten", Glyph: WooGlyph, bg: "#F3EDFA" },
};

function StatusPill({ status }) {
  if (status === "connected") return <span className="pill pos">verbonden</span>;
  if (status === "revoked") return <span className="pill neg">opnieuw koppelen</span>;
  if (status === "coming_soon") return <span className="pill accent">binnenkort</span>;
  return <span className="pill muted">niet gekoppeld</span>;
}

const inputStyle = {
  width: "100%", height: 42, padding: "0 12px", borderRadius: 10,
  border: "1px solid var(--c-border)", background: "var(--c-surface)",
  color: "var(--c-ink)", fontSize: 14, fontFamily: "inherit",
};

// Koppelformulier voor WooCommerce: shop-URL + read-only consumer key/secret
// (aan te maken in WooCommerce → Instellingen → Geavanceerd → REST API), of de
// ingebouwde demowinkel met voorbeelddata om het kanaal te testen.
function WooConnectDialog({ orgId, onDone, onClose }) {
  const [storeUrl, setStoreUrl] = useState("");
  const [key, setKey] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const q = orgId ? "?org_id=" + encodeURIComponent(orgId) : "";

  const post = (path, body) => {
    setBusy(true);
    setError(null);
    return api(path + q, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
      .then(() => { invalidateOrg(orgId); onDone(); })
      .catch((e) => {
        let msg = e?.message || "Er ging iets mis.";
        try { msg = JSON.parse(msg).detail || msg; } catch { /* plain text */ }
        setError(msg);
      })
      .finally(() => setBusy(false));
  };

  const submit = (e) => {
    e.preventDefault();
    post("/api/woocommerce/connect", { store_url: storeUrl, consumer_key: key, consumer_secret: secret });
  };

  return (
    <Modal title="WooCommerce koppelen" onClose={onClose} width={480}>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 13, color: "var(--c-muted)" }}>
          Maak in de webshop een <b>read-only</b> API-sleutel aan via WooCommerce → Instellingen → Geavanceerd → REST API, en vul die hier in.
        </div>
        <div>
          <label style={{ fontSize: 12.5, fontWeight: 600, color: "var(--c-muted)" }}>Winkel-URL</label>
          <input value={storeUrl} onChange={(e) => setStoreUrl(e.target.value)} placeholder="https://jouwwinkel.nl" style={{ ...inputStyle, marginTop: 6 }} />
        </div>
        <div>
          <label style={{ fontSize: 12.5, fontWeight: 600, color: "var(--c-muted)" }}>Consumer key</label>
          <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="ck_..." style={{ ...inputStyle, marginTop: 6 }} />
        </div>
        <div>
          <label style={{ fontSize: 12.5, fontWeight: 600, color: "var(--c-muted)" }}>Consumer secret</label>
          <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="cs_..." style={{ ...inputStyle, marginTop: 6 }} />
        </div>
        {error && <div style={{ fontSize: 13, color: "var(--c-neg)", fontWeight: 600 }}>{error}</div>}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn-ghost"
            disabled={busy}
            onClick={() => post("/api/woocommerce/connect-demo")}
            title="Koppel een ingebouwde demowinkel met voorbeelddata om het dashboard te testen"
            style={{ height: 40, padding: "0 14px" }}
          >
            Demowinkel gebruiken
          </button>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" className="btn-ghost" onClick={onClose} style={{ height: 40, padding: "0 14px" }}>Annuleren</button>
            <button
              type="submit"
              className="btn-primary"
              disabled={busy || !storeUrl.trim() || !key.trim() || !secret.trim()}
              style={{ height: 40, padding: "0 18px", opacity: busy || !storeUrl.trim() || !key.trim() || !secret.trim() ? 0.5 : 1 }}
            >
              {busy ? "Bezig…" : "Koppelen"}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

export default function Integrations() {
  const { data, loading, reload } = useConnections();
  const { orgId } = useActiveOrg();
  const [wooOpen, setWooOpen] = useState(false);
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
        beheer je gekoppelde marketingbronnen · {data?.connected ?? 0} van {data?.total ?? 5} actief
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
                {canConnect && (c.provider === "woocommerce" ? (
                  <button className="btn-primary" onClick={() => setWooOpen(true)} style={{ height: 38, padding: "0 16px", fontSize: 13 }}>koppelen</button>
                ) : (
                  <a className="btn-primary" href={c.provider === "meta_ads" ? metaLoginUrl(orgId) : connectUrl([c.provider], "/app/integrations")} style={{ height: 38, padding: "0 16px", fontSize: 13, textDecoration: "none" }}>koppelen</a>
                ))}
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
      {wooOpen && (
        <WooConnectDialog
          orgId={orgId}
          onDone={() => { setWooOpen(false); reload(); }}
          onClose={() => setWooOpen(false)}
        />
      )}
    </div>
  );
}
