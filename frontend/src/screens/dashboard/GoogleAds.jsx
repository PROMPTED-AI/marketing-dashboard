import { useEffect, useState } from "react";
import { useActiveOrg } from "../../lib/ActiveOrgProvider.jsx";
import { useDateRange } from "../../lib/PeriodProvider.jsx";
import { useCachedApi } from "../../lib/swr.js";
import { adsAccountsUrl, adsReportUrl } from "../../lib/urls.js";
import { num, pct1, shortDate, deltaProps } from "../../lib/format.js";
import { KpiCard, SectionCard, TabState } from "../../components/ui.jsx";
import { AreaChart, Donut, Legend } from "../../components/charts.jsx";
import ExportButton from "../../components/ExportButton.jsx";
import { AdsGlyph } from "../../components/icons.jsx";

const eur = (v) => "€ " + new Intl.NumberFormat("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v || 0);
const roas = (v) => (v || 0).toFixed(2).replace(".", ",") + "×";
const cpm = (k) => (k?.impressions ? k.cost / k.impressions * 1000 : 0);
const cpa = (cost, conv) => (conv ? cost / conv : 0);

const VIEWS = [
  { id: "overview", name: "Ads-overzicht", audience: "Directie" },
  { id: "campaigns", name: "Campagnes", audience: "Marketeer" },
  { id: "efficiency", name: "Efficiëntie & budget", audience: "Marketeer" },
  { id: "conversion", name: "Conversie & ROAS", audience: "Marketeer" },
];

export default function GoogleAds() {
  const [account, setAccount] = useState(() => localStorage.getItem("kompas-ads-account") || "");
  const [view, setView] = useState(() => localStorage.getItem("kompas-ads-view") || "overview");
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
  const pickView = (id) => { setView(id); localStorage.setItem("kompas-ads-view", id); };

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
  const campaigns = data?.campaigns || [];
  const spendSegments = (() => {
    const top = campaigns.slice(0, 6);
    const total = top.reduce((a, c) => a + (c.cost || 0), 0) || 1;
    return top.map((c) => ({ label: c.name, value: c.cost || 0, pct: Math.round((c.cost || 0) / total * 100) }));
  })();

  const sections = () => {
    if (!data || !k) return [];
    return [
      { title: "Google Ads — " + label },
      { columns: ["Metric", "Waarde"], rows: [
        ["Kosten", (k.cost || 0).toFixed(2)],
        ["Klikken", k.clicks],
        ["Vertoningen", k.impressions],
        ["Conversies", (k.conversions || 0).toFixed(1)],
        ["ROAS", (k.roas || 0).toFixed(2)],
        ["CTR %", (k.ctr || 0).toFixed(2)],
        ["CPC", (k.cpc || 0).toFixed(2)],
        ["CPM", cpm(k).toFixed(2)],
      ] },
      { title: "Campagnes", columns: ["Campagne", "Kosten", "Klikken", "Conversies", "CPA", "ROAS"],
        rows: campaigns.map((c) => [c.name, (c.cost || 0).toFixed(2), c.clicks, (c.conversions || 0).toFixed(1), cpa(c.cost, c.conversions).toFixed(2), (c.roas || 0).toFixed(2)]) },
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

      {/* view-switcher */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
        {VIEWS.map((v) => {
          const on = v.id === view;
          return (
            <button key={v.id} onClick={() => pickView(v.id)} style={{
              display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: 999,
              border: "1px solid " + (on ? "var(--c-accent)" : "var(--c-border)"),
              background: on ? "var(--c-accent)" : "var(--c-surface)",
              color: on ? "#fff" : "var(--c-ink)", fontSize: 13, fontWeight: 700, cursor: "pointer",
            }}>
              {v.name}<span style={{ fontSize: 10.5, fontWeight: 600, opacity: on ? 0.85 : 0.6 }}>{v.audience}</span>
            </button>
          );
        })}
      </div>

      <TabState error={error} onConnect />
      {!error && !data && <TabState loading />}

      {data && k && view === "overview" && (
        <>
          <div style={{ display: "flex", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
            <KpiCard label="Kosten" value={eur(k.cost)} {...(data.deltas ? deltaProps(data.deltas.cost, false) : {})} />
            <KpiCard label="Klikken" value={num(k.clicks)} {...(data.deltas ? deltaProps(data.deltas.clicks, true) : {})} />
            <KpiCard label="Conversies" value={num(k.conversions)} {...(data.deltas ? deltaProps(data.deltas.conversions, true) : {})} />
            <KpiCard label="ROAS" value={roas(k.roas)} {...(data.deltas ? deltaProps(data.deltas.roas, true) : {})} />
          </div>
          <SectionCard title="kosten over tijd">
            <AreaChart
              values={(data.by_date || []).map((d) => d.cost)}
              labels={(data.by_date || []).map((d) => shortDate((d.date || "").replaceAll("-", "")))}
              unit="kosten"
              height={230}
            />
          </SectionCard>
        </>
      )}

      {data && view === "campaigns" && (
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <SectionCard title="campagnes" style={{ flex: 2, minWidth: 340 }}>
            <CampaignTable rows={campaigns} cols={["Campagne", "Kosten", "Klikken", "CTR", "Conversies", "ROAS"]}
              render={(c) => [c.name, eur(c.cost), num(c.clicks), pct1(c.ctr), num(c.conversions), roas(c.roas)]} />
          </SectionCard>
          <SectionCard title="aandeel uitgaven" style={{ flex: 1, minWidth: 260 }}>
            {spendSegments.length ? (
              <><Donut segments={spendSegments} centerTop={spendSegments.length} centerSub="campagnes" size={150} /><div style={{ marginTop: 14 }}><Legend segments={spendSegments} /></div></>
            ) : <Empty>geen campagnedata.</Empty>}
          </SectionCard>
        </div>
      )}

      {data && k && view === "efficiency" && (
        <>
          <div style={{ display: "flex", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
            <KpiCard label="CTR" value={pct1(k.ctr)} {...(data.deltas ? deltaProps(data.deltas.ctr, true) : {})} />
            <KpiCard label="CPC" value={eur(k.cpc)} {...(data.deltas ? deltaProps(data.deltas.cpc, false) : {})} />
            <KpiCard label="CPM" value={eur(cpm(k))} {...(data.deltas ? deltaProps(data.deltas.cpm, false) : {})} />
            <KpiCard label="CPA" value={eur(cpa(k.cost, k.conversions))} />
          </div>
          <SectionCard title="efficiëntie per campagne — hoge uitgaven, weinig conversie bovenaan">
            <CampaignTable rows={[...campaigns].sort((a, b) => (b.cost || 0) - (a.cost || 0))}
              cols={["Campagne", "Kosten", "Conversies", "CPA", "CTR"]}
              render={(c) => [c.name, eur(c.cost), num(c.conversions), eur(cpa(c.cost, c.conversions)), pct1(c.ctr)]} />
          </SectionCard>
        </>
      )}

      {data && k && view === "conversion" && (
        <>
          <div style={{ display: "flex", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
            <KpiCard label="Conversies" value={num(k.conversions)} {...(data.deltas ? deltaProps(data.deltas.conversions, true) : {})} />
            <KpiCard label="Conversiewaarde" value={eur(k.conversionsValue)} {...(data.deltas ? deltaProps(data.deltas.conversionsValue, true) : {})} />
            <KpiCard label="ROAS" value={roas(k.roas)} {...(data.deltas ? deltaProps(data.deltas.roas, true) : {})} />
          </div>
          <SectionCard title="ROAS per campagne">
            <CampaignTable rows={[...campaigns].sort((a, b) => (b.roas || 0) - (a.roas || 0))}
              cols={["Campagne", "Kosten", "Conversies", "ROAS"]}
              render={(c) => [c.name, eur(c.cost), num(c.conversions), roas(c.roas)]} />
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
      <div style={{ fontSize: 13, color: "var(--c-muted)", marginBottom: 16 }}>{label} · live via je Google Ads-koppeling</div>
    </div>
  );
}

function CampaignTable({ rows, cols, render }) {
  if (!rows?.length) return <Empty>geen campagnedata in deze periode.</Empty>;
  const grid = "2fr " + cols.slice(1).map(() => "1fr").join(" ");
  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ ...head, gridTemplateColumns: grid }}>
        {cols.map((c, i) => <span key={i} style={i === 0 ? {} : { textAlign: "right" }}>{c}</span>)}
      </div>
      {rows.map((r, ri) => {
        const cells = render(r);
        return (
          <div key={ri} style={{ ...row, gridTemplateColumns: grid }}>
            {cells.map((cell, ci) => (
              <span key={ci} style={{ textAlign: ci === 0 ? "left" : "right", fontWeight: ci === 0 ? 600 : 600, color: ci === 0 ? "var(--c-ink)" : "var(--c-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cell}</span>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function Empty({ children }) {
  return <div style={{ color: "var(--c-muted)", fontSize: 13 }}>{children}</div>;
}

function pickLabels(all) {
  if (all.length <= 5) return all;
  const step = (all.length - 1) / 4;
  return [0, 1, 2, 3, 4].map((i) => all[Math.round(i * step)]);
}
const selectStyle = { padding: "8px 12px", fontSize: 13, borderRadius: 999, border: "1px solid var(--c-border)", background: "var(--c-surface)", color: "var(--c-ink)", maxWidth: 360 };
const head = { display: "grid", gap: 12, fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--c-muted)", paddingBottom: 10, borderBottom: "1px solid var(--c-border)" };
const row = { display: "grid", gap: 12, fontSize: 13, padding: "11px 0", borderBottom: "1px solid var(--c-border-soft)", alignItems: "center" };
