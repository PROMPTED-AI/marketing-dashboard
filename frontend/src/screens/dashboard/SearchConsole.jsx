import { useEffect, useState } from "react";
import { api } from "../../lib/api.js";
import { usePeriod } from "../../lib/PeriodProvider.jsx";
import { num, pct1, shortDate } from "../../lib/format.js";
import { KpiCard, SectionCard, TabState } from "../../components/ui.jsx";
import { AreaChart } from "../../components/charts.jsx";
import { GscGlyph } from "../../components/icons.jsx";

export default function SearchConsole() {
  const [sites, setSites] = useState(null);
  const [site, setSite] = useState(() => localStorage.getItem("kompas-gsc-site") || "");
  const [data, setData] = useState(null);
  const [sitesErr, setSitesErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { days, label } = usePeriod();

  useEffect(() => {
    api("/api/search-console/sites")
      .then((d) => {
        const list = d.sites || [];
        setSites(list);
        setSite((cur) => (cur && list.some((s) => s.site_url === cur) ? cur : list[0]?.site_url || ""));
      })
      .catch(setSitesErr)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!site) return;
    setError(null);
    setData(null);
    api("/api/search-console/report?site=" + encodeURIComponent(site) + "&days=" + days)
      .then(setData)
      .catch(setError);
  }, [site, days]);

  const chooseSite = (s) => { setSite(s); localStorage.setItem("kompas-gsc-site", s); setData(null); };

  if (loading) return <TabState loading />;
  if (sitesErr) return <TabState error={sitesErr} onConnect />;
  if (!sites?.length)
    return (
      <div>
        <Header label={label} />
        <div className="card" style={{ padding: 28, color: "var(--c-muted)" }}>
          Geen geverifieerde Search Console-sites gevonden voor dit account.
        </div>
      </div>
    );

  const t = data?.totals;
  return (
    <div>
      <Header
        label={label}
        right={
          sites.length > 1 ? (
            <select value={site} onChange={(e) => chooseSite(e.target.value)} style={selectStyle}>
              {sites.map((s) => <option key={s.site_url} value={s.site_url}>{s.site_url}</option>)}
            </select>
          ) : <span style={{ fontSize: 12.5, color: "var(--c-muted)" }}>{site}</span>
        }
      />
      <TabState error={error} onConnect />
      {!error && !data && <TabState loading />}
      {data && (
        <>
          <div style={{ display: "flex", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
            <KpiCard label="Klikken" value={num(t.clicks)} />
            <KpiCard label="Vertoningen" value={num(t.impressions)} />
            <KpiCard label="Gem. CTR" value={pct1((t.ctr || 0) * 100)} />
            <KpiCard label="Gem. positie" value={(t.position || 0).toFixed(1).replace(".", ",")} />
          </div>

          <SectionCard title="klikken over tijd" style={{ marginBottom: 16 }}>
            <AreaChart
              values={data.by_date.map((d) => d.clicks)}
              labels={pickLabels(data.by_date.map((d) => shortDate(d.date.replaceAll("-", ""))))}
              height={210}
            />
          </SectionCard>

          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <SectionCard title="top zoekopdrachten" style={{ flex: 1, minWidth: 320 }}>
              <Table rows={data.top_queries} keyCol="query" />
            </SectionCard>
            <SectionCard title="top pagina's" style={{ flex: 1, minWidth: 320 }}>
              <Table rows={data.top_pages} keyCol="page" />
            </SectionCard>
          </div>
        </>
      )}
    </div>
  );
}

function Header({ right, label }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ width: 34, height: 34, borderRadius: 9, background: "#E8F0FE", display: "flex", alignItems: "center", justifyContent: "center" }}><GscGlyph s={20} /></div>
        <div><div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.1 }}>Search Console</div><div style={{ fontSize: 11.5, color: "var(--c-muted)" }}>organisch verkeer & posities</div></div>
        <div style={{ flex: 1 }} />
        {right}
      </div>
      <div className="display" style={{ fontSize: 28, marginBottom: 4 }}>search console — seo</div>
      <div style={{ fontSize: 13, color: "var(--c-muted)", marginBottom: 18 }}>{label} · live via je Search Console-koppeling</div>
    </div>
  );
}

function Table({ rows, keyCol }) {
  if (!rows?.length) return <div style={{ color: "var(--c-muted)", fontSize: 13 }}>geen data.</div>;
  return (
    <div>
      <div style={{ ...head, gridTemplateColumns: "2.4fr 1fr 1fr 1fr" }}>
        <span>{keyCol === "query" ? "Zoekopdracht" : "Pagina"}</span>
        <span style={{ textAlign: "right" }}>Klikken</span>
        <span style={{ textAlign: "right" }}>CTR</span>
        <span style={{ textAlign: "right" }}>Positie</span>
      </div>
      {rows.map((r, i) => (
        <div key={i} style={{ ...row, gridTemplateColumns: "2.4fr 1fr 1fr 1fr" }}>
          <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r[keyCol]}</span>
          <span style={{ textAlign: "right", fontWeight: 600 }}>{num(r.clicks)}</span>
          <span style={{ textAlign: "right", color: "var(--c-muted)" }}>{pct1((r.ctr || 0) * 100)}</span>
          <span style={{ textAlign: "right", color: "var(--c-muted)" }}>{(r.position || 0).toFixed(1).replace(".", ",")}</span>
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
