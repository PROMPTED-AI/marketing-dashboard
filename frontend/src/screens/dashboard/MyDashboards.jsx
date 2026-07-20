// "Mijn dashboards": per kanaal stelt de gebruiker zelf een indeling samen
// (KPI's, grafieken, tabellen) met drag-and-drop, opgeslagen als privé of
// gedeeld dashboard. Eén dashboard hoort bij één kanaal (= één payload).
//
// Omdat React-hooks niet voorwaardelijk aangeroepen mogen worden, heeft elk
// kanaal een eigen wrapper-component die zijn data-hooks onvoorwaardelijk
// aanroept en vervolgens de generieke DashboardEditor rendert.

import { useState } from "react";
import { useProperties } from "../../lib/useProperties.jsx";
import { useActiveOrg } from "../../lib/ActiveOrgProvider.jsx";
import { useDateRange } from "../../lib/PeriodProvider.jsx";
import { useCachedApi } from "../../lib/swr.js";
import {
  overviewUrl, gscReportUrl, sitesUrl, adsAccountsUrl, adsReportUrl,
  metaAccountsUrl, metaAdsReportUrl, metaOrganicReportUrl, wcReportUrl,
} from "../../lib/urls.js";
import { TabState } from "../../components/ui.jsx";
import DashboardEditor from "../../components/dashboard/DashboardEditor.jsx";
import { CHANNELS, CATALOGS } from "../../lib/widgets/index.js";

const selectStyle = {
  height: 40, padding: "0 12px", fontSize: 13, borderRadius: 999, border: "1px solid var(--c-border)",
  background: "var(--c-surface)", color: "var(--c-ink)", fontWeight: 600, fontFamily: "inherit", maxWidth: 260,
};

function Empty({ children }) {
  return <div className="card" style={{ padding: 28, color: "var(--c-muted)" }}>{children}</div>;
}

export default function MyDashboards() {
  const [channel, setChannel] = useState(() => localStorage.getItem("kompas-mydash-channel") || "analytics");
  const pick = (k) => { setChannel(k); localStorage.setItem("kompas-mydash-channel", k); };
  const active = CHANNELS.find((c) => c.key === channel) || CHANNELS[0];
  const Wrapper = WRAPPERS[active.key];

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <div className="display" style={{ fontSize: 30 }}>mijn dashboards</div>
        <div style={{ fontSize: 13.5, color: "var(--c-muted)", marginTop: 4 }}>
          Stel per kanaal je eigen indeling samen. Kies de cijfers, grafieken en tabellen die jij wilt zien.
        </div>
      </div>

      {/* kanaalkeuze */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
        {CHANNELS.map((c) => {
          const on = c.key === active.key;
          return (
            <button
              key={c.key}
              onClick={() => pick(c.key)}
              style={{
                padding: "8px 14px", borderRadius: 999,
                border: "1px solid " + (on ? "var(--c-accent)" : "var(--c-border)"),
                background: on ? "var(--c-accent)" : "var(--c-surface)",
                color: on ? "#fff" : "var(--c-ink)", fontSize: 13, fontWeight: 700, cursor: "pointer",
              }}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      <Wrapper key={active.key} catalog={active.catalog} />
    </div>
  );
}

// ------------------------------------------------------------- kanaalwrappers

function AnalyticsData({ catalog }) {
  const { props, selected, choose, loading, error } = useProperties();
  const { orgId } = useActiveOrg();
  const { start, end, compare, label } = useDateRange();
  const { data, loading: dl, error: de } = useCachedApi(overviewUrl(selected, start, end, compare, orgId));

  if (loading) return <TabState loading />;
  if (error) return <TabState error={error} onConnect />;
  if (!props?.length) return <Empty>Geen GA4-property gevonden voor dit account.</Empty>;

  const controls = props.length > 1 && (
    <select value={selected} onChange={(e) => choose(e.target.value)} style={selectStyle} title="Property">
      {props.map((p) => <option key={p.property_id} value={p.property_id}>{p.display_name}</option>)}
    </select>
  );
  const sections = () => data ? [
    { title: "Analytics · " + label },
    { columns: ["Metric", "Waarde"], rows: [["Bezoekers", data.kpis.users], ["Sessies", data.kpis.sessions], ["Conversies", (data.conversions || []).reduce((a, c) => a + c.count, 0)]] },
  ] : [];

  return (
    <DashboardEditor
      catalog={catalog} page="analytics" data={data} loading={dl} error={de}
      title="analytics" subtitle={"eigen indeling · " + label}
      assetControls={controls} exportFilename="analytics-dashboard" exportSections={sections}
    />
  );
}

function SearchConsoleData({ catalog }) {
  const { orgId } = useActiveOrg();
  const { start, end, compare, label } = useDateRange();
  const { data: sitesResp, loading, error: sErr } = useCachedApi(sitesUrl(orgId));
  const sites = sitesResp?.sites || null;
  const [site, setSite] = useState(() => localStorage.getItem("kompas-gsc-site") || "");
  const activeSite = site && sites?.some((s) => s.site_url === site) ? site : sites?.[0]?.site_url || "";
  const { data, loading: dl, error: de } = useCachedApi(gscReportUrl(activeSite, start, end, compare, orgId));

  if (loading) return <TabState loading />;
  if (sErr) return <TabState error={sErr} onConnect />;
  if (!sites?.length) return <Empty>Geen geverifieerde Search Console-sites gevonden.</Empty>;

  const choose = (s) => { setSite(s); localStorage.setItem("kompas-gsc-site", s); };
  const controls = sites.length > 1 && (
    <select value={activeSite} onChange={(e) => choose(e.target.value)} style={selectStyle} title="Site">
      {sites.map((s) => <option key={s.site_url} value={s.site_url}>{s.site_url}</option>)}
    </select>
  );
  const sections = () => data?.totals ? [
    { title: "Search Console · " + label + " · " + activeSite },
    { columns: ["Metric", "Waarde"], rows: [["Klikken", data.totals.clicks], ["Vertoningen", data.totals.impressions]] },
  ] : [];

  return (
    <DashboardEditor
      catalog={catalog} page="search-console" data={data} loading={dl} error={de}
      title="search console" subtitle={"eigen indeling · " + label}
      assetControls={controls} exportFilename="search-console-dashboard" exportSections={sections}
    />
  );
}

function GoogleAdsData({ catalog }) {
  const { orgId } = useActiveOrg();
  const { start, end, compare, label } = useDateRange();
  const { data: accResp, loading, error: aErr } = useCachedApi(adsAccountsUrl(orgId));
  const accounts = accResp?.accounts || null;
  const [account, setAccount] = useState(() => localStorage.getItem("kompas-ads-account") || "");
  const activeAcc = account && accounts?.some((a) => a.customer_id === account) ? account : accounts?.[0]?.customer_id || "";
  const { data, loading: dl, error: de } = useCachedApi(adsReportUrl(activeAcc, start, end, compare, orgId));

  if (loading) return <TabState loading />;
  if (aErr) return <TabState error={aErr} onConnect />;
  if (!accounts?.length) return <Empty>Geen Google Ads-accounts gevonden voor deze koppeling.</Empty>;

  const choose = (id) => { setAccount(id); localStorage.setItem("kompas-ads-account", id); };
  const controls = accounts.length > 1 && (
    <select value={activeAcc} onChange={(e) => choose(e.target.value)} style={selectStyle} title="Account">
      {accounts.map((a) => <option key={a.customer_id} value={a.customer_id}>{a.name}</option>)}
    </select>
  );
  const sections = () => data?.kpis ? [
    { title: "Google Ads · " + label },
    { columns: ["Metric", "Waarde"], rows: [["Kosten", (data.kpis.cost || 0).toFixed(2)], ["Klikken", data.kpis.clicks], ["Conversies", (data.kpis.conversions || 0).toFixed(1)]] },
  ] : [];

  return (
    <DashboardEditor
      catalog={catalog} page="google-ads" data={data} loading={dl} error={de}
      title="google ads" subtitle={"eigen indeling · " + label}
      assetControls={controls} exportFilename="google-ads-dashboard" exportSections={sections}
    />
  );
}

function MetaAdsData({ catalog }) {
  const { orgId } = useActiveOrg();
  const { start, end, compare, label } = useDateRange();
  const { data: assets, loading, error: aErr } = useCachedApi(metaAccountsUrl(orgId));
  const adAccounts = assets?.ad_accounts || null;
  const [adAccount, setAdAccount] = useState("");
  const activeAcc = adAccount && adAccounts?.some((a) => a.id === adAccount) ? adAccount : adAccounts?.[0]?.id || "";
  const currency = adAccounts?.find((a) => a.id === activeAcc)?.currency;
  const { data, loading: dl, error: de } = useCachedApi(activeAcc ? metaAdsReportUrl(activeAcc, start, end, compare, orgId) : null);

  if (loading) return <TabState loading />;
  if (aErr) return <TabState error={aErr} onConnect />;
  if (!adAccounts?.length) return <Empty>Geen Meta-advertentieaccounts gevonden voor deze koppeling.</Empty>;

  const controls = adAccounts.length > 1 && (
    <select value={activeAcc} onChange={(e) => setAdAccount(e.target.value)} style={selectStyle} title="Advertentieaccount">
      {adAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
    </select>
  );
  const sections = () => data?.kpis ? [
    { title: "META Ads · " + label },
    { columns: ["Metric", "Waarde"], rows: [["Uitgaven", (data.kpis.spend || 0).toFixed(2)], ["Bereik", data.kpis.reach], ["Klikken", data.kpis.clicks]] },
  ] : [];

  return (
    <DashboardEditor
      catalog={catalog} page="meta-ads" data={data} loading={dl} error={de} ctx={{ currency }}
      title="meta ads" subtitle={"eigen indeling · " + label}
      assetControls={controls} exportFilename="meta-ads-dashboard" exportSections={sections}
    />
  );
}

function MetaOrganicData({ catalog }) {
  const { orgId } = useActiveOrg();
  const { start, end, label } = useDateRange();
  const { data: assets, loading, error: aErr } = useCachedApi(metaAccountsUrl(orgId));
  const pages = assets?.pages || null;
  const [pageId, setPageId] = useState("");
  const activePage = pageId && pages?.some((p) => p.id === pageId) ? pageId : pages?.[0]?.id || "";
  const page = pages?.find((p) => p.id === activePage) || null;
  const ig = page?.instagram || null;
  const { data, loading: dl, error: de } = useCachedApi(activePage ? metaOrganicReportUrl(activePage, ig?.id, start, end, orgId) : null);

  if (loading) return <TabState loading />;
  if (aErr) return <TabState error={aErr} onConnect />;
  if (!pages?.length) return <Empty>Geen Meta-pagina's gevonden voor deze koppeling.</Empty>;

  const controls = pages.length > 1 && (
    <select value={activePage} onChange={(e) => setPageId(e.target.value)} style={selectStyle} title="Pagina">
      {pages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
  );
  const sections = () => {
    const fb = data?.facebook, insta = data?.instagram;
    const out = [];
    if (fb) out.push({ title: "Facebook · " + label, columns: ["Metric", "Waarde"], rows: [["Volgers", fb.followers], ["Bereik", fb.reach]] });
    if (insta) out.push({ title: "Instagram · " + label, columns: ["Metric", "Waarde"], rows: [["Volgers", insta.followers], ["Bereik", insta.reach]] });
    return out;
  };

  return (
    <DashboardEditor
      catalog={catalog} page="meta-organic" data={data} loading={dl} error={de}
      title="meta organisch" subtitle={"eigen indeling · " + label}
      assetControls={controls} exportFilename="meta-organisch-dashboard" exportSections={sections}
    />
  );
}

function WooCommerceData({ catalog }) {
  const { orgId } = useActiveOrg();
  const { start, end, compare, label } = useDateRange();
  const { data, loading, error } = useCachedApi(wcReportUrl(start, end, compare, orgId));

  const sections = () => data?.kpis ? [
    { title: "WooCommerce · " + label },
    { columns: ["Metric", "Waarde"], rows: [["Omzet", (data.kpis.revenue || 0).toFixed(2)], ["Bestellingen", data.kpis.orders], ["Gem. orderwaarde", (data.kpis.avgOrderValue || 0).toFixed(2)]] },
    { title: "Topproducten", columns: ["Product", "Aantal", "Omzet"], rows: (data.top_products || []).map((p) => [p.name, p.qty, (p.revenue || 0).toFixed(2)]) },
  ] : [];

  return (
    <DashboardEditor
      catalog={catalog} page="woocommerce" data={data} loading={loading} error={error}
      title="woocommerce" subtitle={"eigen indeling · " + label + (data?.is_demo ? " · demowinkel" : "")}
      exportFilename="woocommerce-dashboard" exportSections={sections}
    />
  );
}

const WRAPPERS = {
  "analytics": AnalyticsData,
  "search-console": SearchConsoleData,
  "google-ads": GoogleAdsData,
  "meta-ads": MetaAdsData,
  "meta-organic": MetaOrganicData,
  "woocommerce": WooCommerceData,
};
