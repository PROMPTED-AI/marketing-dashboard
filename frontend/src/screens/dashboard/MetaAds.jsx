import { useEffect, useState } from "react";
import { useActiveOrg } from "../../lib/ActiveOrgProvider.jsx";
import { useDateRange } from "../../lib/PeriodProvider.jsx";
import { useCachedApi } from "../../lib/swr.js";
import { metaAccountsUrl, metaAdsReportUrl, metaOrganicReportUrl } from "../../lib/urls.js";
import { num, pct1, deltaProps } from "../../lib/format.js";
import { KpiCard, SectionCard, TabState } from "../../components/ui.jsx";
import ExportButton from "../../components/ExportButton.jsx";
import { MetaGlyph } from "../../components/icons.jsx";

const money = (v, cur) =>
  new Intl.NumberFormat("nl-NL", cur ? { style: "currency", currency: cur } : { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v || 0);
const roas = (v) => (v || 0).toFixed(2).replace(".", ",") + "×";
const statusLabel = (s) => {
  if (!s) return "—";
  const map = { ACTIVE: "actief", PAUSED: "gepauzeerd", ARCHIVED: "gearchiveerd", DELETED: "verwijderd" };
  return map[s] || s.toLowerCase();
};

const VIEWS = [
  { id: "overview", name: "Betaald-overzicht" },
  { id: "campaigns", name: "Campagnes" },
  { id: "conversions", name: "Conversie & ROAS" },
  { id: "vs", name: "Betaald vs. organisch" },
];

export default function MetaAds() {
  const { orgId } = useActiveOrg();
  const { start, end, compare, label } = useDateRange();
  const [view, setView] = useState(() => localStorage.getItem("kompas-meta-ads-view") || "overview");
  const pickView = (id) => { setView(id); localStorage.setItem("kompas-meta-ads-view", id); };

  const { data: assets, loading, error: assetsErr } = useCachedApi(metaAccountsUrl(orgId));
  const adAccounts = assets?.ad_accounts || null;
  const pages = assets?.pages || null;

  const [adAccount, setAdAccount] = useState("");
  useEffect(() => { if (adAccounts) setAdAccount((c) => (c && adAccounts.some((a) => a.id === c) ? c : adAccounts[0]?.id || "")); }, [adAccounts]);
  const currency = adAccounts?.find((a) => a.id === adAccount)?.currency;

  const { data: ads, error: adsErr } = useCachedApi(adAccount ? metaAdsReportUrl(adAccount, start, end, compare, orgId) : null);

  // Organic totals are only needed for the paid-vs-organic comparison; fetch the
  // first page/IG lazily so the Ads dashboard stays lean the rest of the time.
  const firstPage = pages?.[0] || null;
  const firstIg = firstPage?.instagram || null;
  const { data: organic } = useCachedApi(view === "vs" && firstPage ? metaOrganicReportUrl(firstPage.id, firstIg?.id, start, end, orgId) : null);

  const sections = () => {
    const out = [];
    if (ads?.kpis) {
      out.push({ title: "META Ads — " + label });
      out.push({ columns: ["Metric", "Waarde"], rows: [
        ["Uitgaven", (ads.kpis.spend || 0).toFixed(2)], ["Vertoningen", ads.kpis.impressions],
        ["Bereik", ads.kpis.reach], ["Frequentie", (ads.kpis.frequency || 0).toFixed(2)],
        ["Klikken", ads.kpis.clicks], ["CTR %", (ads.kpis.ctr || 0).toFixed(2)],
        ["CPC", (ads.kpis.cpc || 0).toFixed(2)], ["CPM", (ads.kpis.cpm || 0).toFixed(2)],
      ] });
      if (ads.results?.length)
        out.push({ title: "Resultaten per conversiedoel", columns: ["Doel", "Aantal", "Waarde", "ROAS", "CPA"],
          rows: ads.results.map((r) => [r.goal, r.count, (r.value || 0).toFixed(2), (r.roas || 0).toFixed(2), (r.cpa || 0).toFixed(2)]) });
      if (ads.campaigns?.length)
        out.push({ title: "Campagnes", columns: ["Campagne", "Doelstelling", "Status", "Uitgaven", "Klikken", "CTR %", "Resultaten"],
          rows: ads.campaigns.map((c) => [c.name, c.objective || "", c.status || "", (c.spend || 0).toFixed(2), c.clicks, (c.ctr || 0).toFixed(2), c.results]) });
    }
    return out;
  };

  if (loading) return <TabState loading />;
  if (assetsErr) return <TabState error={assetsErr} onConnect />;
  if (!adAccounts?.length)
    return (
      <div>
        <Header label={label} />
        <div className="card" style={{ padding: 28, color: "var(--c-muted)" }}>Geen Meta-advertentieaccounts gevonden voor deze koppeling.</div>
      </div>
    );

  const k = ads?.kpis;
  // Blended totals across all conversion goals, for the Conversie & ROAS view.
  const results = ads?.results || [];
  const totResults = results.reduce((a, r) => a + (r.count || 0), 0);
  const totValue = results.reduce((a, r) => a + (r.value || 0), 0);
  const blendedRoas = k?.spend ? totValue / k.spend : 0;
  const avgCpa = totResults ? (k?.spend || 0) / totResults : 0;

  return (
    <div>
      <Header
        label={label}
        right={
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {adAccounts?.length > 1 && (
              <select value={adAccount} onChange={(e) => setAdAccount(e.target.value)} style={selectStyle} title="Advertentieaccount">
                {adAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            )}
            {ads && <ExportButton filename="meta-ads" sections={sections} />}
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
              {v.name}
            </button>
          );
        })}
      </div>

      {!adAccount ? <Empty>Geen advertentieaccount gekoppeld.</Empty> : (
        <>
          <TabState error={adsErr} />
          {!adsErr && !ads && <TabState loading />}

          {/* ---- Betaald-overzicht ---- */}
          {view === "overview" && k && (
            <>
              <div style={{ display: "flex", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
                <KpiCard label="Uitgaven" value={money(k.spend, currency)} {...(ads.deltas ? deltaProps(ads.deltas.spend, false) : {})} />
                <KpiCard label="Bereik" value={num(k.reach)} {...(ads.deltas ? deltaProps(ads.deltas.reach, true) : {})} />
                <KpiCard label="Klikken" value={num(k.clicks)} {...(ads.deltas ? deltaProps(ads.deltas.clicks, true) : {})} />
                <KpiCard label="CTR" value={pct1(k.ctr)} {...(ads.deltas ? deltaProps(ads.deltas.ctr, true) : {})} />
                <KpiCard label="CPC" value={money(k.cpc, currency)} {...(ads.deltas ? deltaProps(ads.deltas.cpc, false) : {})} />
                <KpiCard label="CPM" value={money(k.cpm, currency)} {...(ads.deltas ? deltaProps(ads.deltas.cpm, false) : {})} />
              </div>
              <SectionCard title="resultaten per conversiedoel">
                {results.length ? (
                  <Table head={["Doel", "Aantal", "Waarde", "ROAS", "CPA"]} cols="2fr 1fr 1fr 0.8fr 1fr"
                    rows={results.map((r) => [r.goal, num(r.count), money(r.value, currency), roas(r.roas), money(r.cpa, currency)])} />
                ) : <Empty>geen conversieresultaten in deze periode.</Empty>}
              </SectionCard>
            </>
          )}

          {/* ---- Campagnes ---- */}
          {view === "campaigns" && (
            <SectionCard title="campagnes">
              {ads?.campaigns?.length ? (
                <Table head={["Campagne", "Doelstelling", "Status", "Uitgaven", "Klikken", "CTR", "Resultaten"]}
                  cols="1.8fr 1.1fr 0.9fr 1fr 0.8fr 0.7fr 0.9fr"
                  rows={ads.campaigns.map((c) => [c.name, c.objective || "—", statusLabel(c.status), money(c.spend, currency), num(c.clicks), pct1(c.ctr), num(c.results)])} />
              ) : <Empty>geen campagnedata in deze periode.</Empty>}
            </SectionCard>
          )}

          {/* ---- Conversie & ROAS ---- */}
          {view === "conversions" && k && (
            <>
              <div style={{ display: "flex", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
                <KpiCard label="Resultaten" value={num(totResults)} />
                <KpiCard label="Conversiewaarde" value={money(totValue, currency)} />
                <KpiCard label="ROAS (totaal)" value={roas(blendedRoas)} />
                <KpiCard label="Gem. CPA" value={money(avgCpa, currency)} />
              </div>
              <SectionCard title="per conversiedoel">
                {results.length ? (
                  <Table head={["Doel", "Aantal", "Waarde", "ROAS", "CPA"]} cols="2fr 1fr 1fr 0.8fr 1fr"
                    rows={results.map((r) => [r.goal, num(r.count), money(r.value, currency), roas(r.roas), money(r.cpa, currency)])} />
                ) : <Empty>geen conversieresultaten in deze periode.</Empty>}
              </SectionCard>
            </>
          )}

          {/* ---- Betaald vs organisch ---- */}
          {view === "vs" && (
            <SectionCard title="betaald vs. organisch">
              <div style={{ fontSize: 12.5, color: "var(--c-muted)", marginBottom: 14 }}>
                Wat advertenties toevoegen bovenop je organische bereik en betrokkenheid{firstPage ? " — " + firstPage.name : ""}.
              </div>
              <KpiRow items={[
                ["Betaald bereik", num(k?.reach)],
                ["Organisch bereik", num((organic?.facebook?.reach || 0) + (organic?.instagram?.reach || 0))],
                ["Betaalde resultaten", num(totResults)],
                ["Organische betrokkenheid", num(organic?.facebook?.engagement || 0)],
              ]} />
              {!organic && <div style={{ fontSize: 12, color: "var(--c-muted)", marginTop: 8 }}>Organische cijfers laden…</div>}
            </SectionCard>
          )}
        </>
      )}
    </div>
  );
}

function Header({ right, label }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ width: 34, height: 34, borderRadius: 9, background: "#E7F0FF", display: "flex", alignItems: "center", justifyContent: "center" }}><MetaGlyph s={20} /></div>
        <div><div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.1 }}>META Ads</div><div style={{ fontSize: 11.5, color: "var(--c-muted)" }}>Facebook & Instagram — betaalde advertenties</div></div>
        <div style={{ flex: 1 }} />
        {right}
      </div>
      <div className="display" style={{ fontSize: 28, marginBottom: 4 }}>meta ads</div>
      <div style={{ fontSize: 13, color: "var(--c-muted)", marginBottom: 16 }}>{label} · live via je Meta-koppeling</div>
    </div>
  );
}

function KpiRow({ items }) {
  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
      {items.map(([kk, v], i) => (
        <div key={i} style={{ flex: 1, minWidth: 110 }}>
          <div style={{ fontSize: 11.5, color: "var(--c-muted)", fontWeight: 600 }}>{kk}</div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{v}</div>
        </div>
      ))}
    </div>
  );
}

function Table({ head: cols, cols: grid, rows }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ ...headStyle, gridTemplateColumns: grid }}>
        {cols.map((h, i) => <span key={i} style={i === 0 ? {} : { textAlign: "right" }}>{h}</span>)}
      </div>
      {rows.map((r, ri) => (
        <div key={ri} style={{ ...rowStyle, gridTemplateColumns: grid }}>
          {r.map((cell, ci) => (
            <span key={ci} style={{ textAlign: ci === 0 ? "left" : "right", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: ci === 0 ? "var(--c-ink)" : "var(--c-muted)" }}>{cell}</span>
          ))}
        </div>
      ))}
    </div>
  );
}

function Empty({ children }) {
  return <div style={{ color: "var(--c-muted)", fontSize: 13, padding: "8px 0" }}>{children}</div>;
}

const selectStyle = { padding: "8px 12px", fontSize: 13, borderRadius: 999, border: "1px solid var(--c-border)", background: "var(--c-surface)", color: "var(--c-ink)", maxWidth: 260 };
const headStyle = { display: "grid", gap: 12, fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--c-muted)", paddingBottom: 10, borderBottom: "1px solid var(--c-border)" };
const rowStyle = { display: "grid", gap: 12, fontSize: 13, padding: "11px 0", borderBottom: "1px solid var(--c-border-soft)", alignItems: "center" };
