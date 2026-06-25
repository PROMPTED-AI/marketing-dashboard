import { useEffect, useState } from "react";
import { useActiveOrg } from "../../lib/ActiveOrgProvider.jsx";
import { useDateRange } from "../../lib/PeriodProvider.jsx";
import { useCachedApi } from "../../lib/swr.js";
import { adsAccountsUrl, adsReportUrl } from "../../lib/urls.js";
import { num, pct1, shortDate, deltaProps } from "../../lib/format.js";
import { KpiCard, SectionCard, TabState } from "../../components/ui.jsx";
import { AreaChart } from "../../components/charts.jsx";
import ExportButton from "../../components/ExportButton.jsx";
import { AdsGlyph } from "../../components/icons.jsx";

const eur = (v) =>
  "€ " + new Intl.NumberFormat("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v || 0);
const roas = (v) => (v || 0).toFixed(2).replace(".", ",") + "×";

export default function GoogleAds() {
  const [account, setAccount] = useState(() => localStorage.getItem("kompas-ads-account") || "");
  const { orgId } = useActiveOrg();
  const { start, end, compare, label } = useDateRange();

  const { data: accResp, loading, error: accErr } = useCachedApi(adsAccountsUrl(orgId));
  const accounts = accResp?.accounts || null;

  useEffect(() => {
    if (!accounts) return;
    setAccount((cur) => (cur && accounts.some((a) => a.customer_id === cur) ? cur : accounts[0]?.customer_id || ""));
  }, [accounts]);

  const { data, error } = useCachedApi(adsReportUrl(account, start, end, compare, orgId));

  const choose = (id) => { setAccount(id); localStorage.setItem("kompas-ads-account", id); };

  if (loading) return <TabState loading />;
  if (accErr) return <TabState error={accErr} onConnect />;
  if (!accounts?.length)
    return (
      <div>
        <Header label={label} />
        <div className="card" style={{ padding: 28, color: "var(--c-muted)" }}>
          Geen Google Ads-accounts gevonden voor deze koppeling.
        </div>
      </div>
    );

  const k = data?.kpis;

  const sections = () => {
    if (!data) return [];
    return [
      { title: "Google Ads — " + label },
      { columns: ["Metric", "Waarde"], rows: [
        ["Kosten", (k.cost || 0).toFixed(2)],
        ["Klikken", k.clicks],
        ["Vertoningen", k.impressions],
        ["Conversies", (k.conversions || 0).toFixed(1)],
        ["ROAS", (k.roas || 0).toFixed(2)],
      ] },
      { title: "Campagnes", columns: ["Campagne", "Kosten", "Klikken", "Vertoningen", "Conversies", "ROAS"],
        rows: (data.campaigns || []).map((c) => [c.name, (c.cost || 0).toFixed(2), c.clicks, c.impressions, (c.conversions || 0).toFixed(1), (c.roas || 0).toFixed(2)]) },
      { title: "Kosten per dag", columns: ["Datum", "Kosten", "Klikken"], rows: (data.by_date || []).map((d) => [d.date, (d.cost || 0).toFixed(2), d.clicks]) },
    ];
  };

  return (
    <div>
      <Header
        label={label}
        right={
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            {accounts.length > 1 ? (
              <select value={account} onChange={(e) => choose(e.target.value)} style={selectStyle}>
                {accounts.map((a) => <option key={a.customer_id} value={a.customer_id}>{a.name} · {a.customer_id}</option>)}
              </select>
            ) : <span style={{ fontSize: 12.5, color: "var(--c-muted)" }}>{accounts[0]?.name}</span>}
            {data && <ExportButton filename="google-ads" sections={sections} />}
          </div>
        }
      />
      <TabState error={error} onConnect />
      {!error && !data && <TabState loading />}
      {data && k && (
        <>
          <div style={{ display: "flex", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
            <KpiCard label="Kosten" value={eur(k.cost)} {...(data.deltas ? deltaProps(data.deltas.cost, false) : {})} />
            <KpiCard label="Klikken" value={num(k.clicks)} {...(data.deltas ? deltaProps(data.deltas.clicks, true) : {})} />
            <KpiCard label="Vertoningen" value={num(k.impressions)} {...(data.deltas ? deltaProps(data.deltas.impressions, true) : {})} />
            <KpiCard label="Conversies" value={num(k.conversions)} {...(data.deltas ? deltaProps(data.deltas.conversions, true) : {})} />
            <KpiCard label="ROAS" value={roas(k.roas)} {...(data.deltas ? deltaProps(data.deltas.roas, true) : {})} />
          </div>

          <SectionCard title="kosten over tijd" style={{ marginBottom: 16 }}>
            <AreaChart
              values={(data.by_date || []).map((d) => d.cost)}
              labels={pickLabels((data.by_date || []).map((d) => shortDate((d.date || "").replaceAll("-", ""))))}
              height={210}
            />
          </SectionCard>

          <SectionCard title="campagnes">
            <CampaignTable rows={data.campaigns || []} />
          </SectionCard>
        </>
      )}
    </div>
  );
}

function Header({ right, label }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ width: 34, height: 34, borderRadius: 9, background: "#E8F0FE", display: "flex", alignItems: "center", justifyContent: "center" }}><AdsGlyph s={20} /></div>
        <div><div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.1 }}>Google Ads</div><div style={{ fontSize: 11.5, color: "var(--c-muted)" }}>campagnes, kosten & conversies</div></div>
        <div style={{ flex: 1 }} />
        {right}
      </div>
      <div className="display" style={{ fontSize: 28, marginBottom: 4 }}>google ads — campagnes</div>
      <div style={{ fontSize: 13, color: "var(--c-muted)", marginBottom: 18 }}>{label} · live via je Google Ads-koppeling</div>
    </div>
  );
}

function CampaignTable({ rows }) {
  if (!rows?.length) return <div style={{ color: "var(--c-muted)", fontSize: 13 }}>geen campagnedata in deze periode.</div>;
  const cols = "2.2fr 1fr 1fr 1fr 0.8fr";
  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ ...head, gridTemplateColumns: cols }}>
        <span>Campagne</span>
        <span style={{ textAlign: "right" }}>Kosten</span>
        <span style={{ textAlign: "right" }}>Klikken</span>
        <span style={{ textAlign: "right" }}>Conversies</span>
        <span style={{ textAlign: "right" }}>ROAS</span>
      </div>
      {rows.map((c, i) => (
        <div key={i} style={{ ...row, gridTemplateColumns: cols }}>
          <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
          <span style={{ textAlign: "right", fontWeight: 600 }}>{eur(c.cost)}</span>
          <span style={{ textAlign: "right", color: "var(--c-muted)" }}>{num(c.clicks)}</span>
          <span style={{ textAlign: "right", color: "var(--c-muted)" }}>{num(c.conversions)}</span>
          <span style={{ textAlign: "right", color: "var(--c-muted)" }}>{roas(c.roas)}</span>
        </div>
      ))}
    </div>
  );
}

function pickLabels(all) {
  if (all.length <= 5) return all;
  const step = (all.length - 1) / 4;
  return [0, 1, 2, 3, 4].map((i) => all[Math.round(i * step)]);
}
const selectStyle = { padding: "8px 12px", fontSize: 13, borderRadius: 999, border: "1px solid var(--c-border)", background: "var(--c-surface)", color: "var(--c-ink)", maxWidth: 360 };
const head = { display: "grid", gap: 12, fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--c-muted)", paddingBottom: 10, borderBottom: "1px solid var(--c-border)" };
const row = { display: "grid", gap: 12, fontSize: 13, padding: "11px 0", borderBottom: "1px solid var(--c-border-soft)", alignItems: "center" };
