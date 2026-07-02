import { useEffect, useState } from "react";
import { useActiveOrg } from "../../lib/ActiveOrgProvider.jsx";
import { useDateRange } from "../../lib/PeriodProvider.jsx";
import { useCachedApi } from "../../lib/swr.js";
import { gscReportUrl, sitesUrl } from "../../lib/urls.js";
import { num, pct1, shortDate, deltaProps } from "../../lib/format.js";
import { KpiCard, SectionCard, TabState } from "../../components/ui.jsx";
import { AreaChart } from "../../components/charts.jsx";
import ExportButton from "../../components/ExportButton.jsx";
import { GscGlyph } from "../../components/icons.jsx";

const VIEWS = [
  { id: "overview", name: "SEO-overzicht", audience: "Directie" },
  { id: "queries", name: "Zoekopdrachten", audience: "SEO" },
  { id: "pages", name: "Pagina's", audience: "SEO" },
  { id: "opportunities", name: "Kansen", audience: "SEO" },
];

export default function SearchConsole() {
  const [site, setSite] = useState(() => localStorage.getItem("kompas-gsc-site") || "");
  const [view, setView] = useState(() => localStorage.getItem("kompas-gsc-view") || "overview");
  const { orgId } = useActiveOrg();
  const { start, end, compare, label } = useDateRange();

  const { data: sitesResp, loading, error: sitesErr } = useCachedApi(sitesUrl(orgId));
  const sites = sitesResp?.sites || null;

  useEffect(() => {
    if (!sites) return;
    setSite((cur) => (cur && sites.some((s) => s.site_url === cur) ? cur : sites[0]?.site_url || ""));
  }, [sites]);

  const { data, error } = useCachedApi(gscReportUrl(site, start, end, compare, orgId));

  const chooseSite = (s) => { setSite(s); localStorage.setItem("kompas-gsc-site", s); };
  const pickView = (id) => { setView(id); localStorage.setItem("kompas-gsc-view", id); };

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

  const sections = () => {
    if (!data) return [];
    const out = [
      { title: "Search Console — " + label + " · " + site },
      { columns: ["Metric", "Waarde"], rows: [
        ["Klikken", t.clicks],
        ["Vertoningen", t.impressions],
        ["Gem. CTR %", ((t.ctr || 0) * 100).toFixed(2)],
        ["Gem. positie", (t.position || 0).toFixed(1)],
      ] },
      { title: "Top zoekopdrachten", columns: ["Zoekopdracht", "Klikken", "Vertoningen", "CTR %", "Positie"], rows: data.top_queries.map((r) => [r.query, r.clicks, r.impressions, ((r.ctr || 0) * 100).toFixed(2), (r.position || 0).toFixed(1)]) },
      { title: "Top pagina's", columns: ["Pagina", "Klikken", "Vertoningen", "CTR %", "Positie"], rows: data.top_pages.map((r) => [r.page, r.clicks, r.impressions, ((r.ctr || 0) * 100).toFixed(2), (r.position || 0).toFixed(1)]) },
    ];
    if (data.opportunities?.length)
      out.push({ title: "Kansen (positie 11-20)", columns: ["Zoekopdracht", "Vertoningen", "Positie", "CTR %"], rows: data.opportunities.map((r) => [r.query, r.impressions, (r.position || 0).toFixed(1), ((r.ctr || 0) * 100).toFixed(2)]) });
    return out;
  };

  return (
    <div>
      <Header
        label={label}
        right={
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            {sites.length > 1 ? (
              <select value={site} onChange={(e) => chooseSite(e.target.value)} style={selectStyle}>
                {sites.map((s) => <option key={s.site_url} value={s.site_url}>{s.site_url}</option>)}
              </select>
            ) : <span style={{ fontSize: 12.5, color: "var(--c-muted)" }}>{site}</span>}
            {data && <ExportButton filename="search-console" sections={sections} />}
          </div>
        }
      />

      {/* view-switcher */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
        {VIEWS.map((v) => {
          const on = v.id === view;
          return (
            <button
              key={v.id}
              onClick={() => pickView(v.id)}
              style={{
                display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: 999,
                border: "1px solid " + (on ? "var(--c-accent)" : "var(--c-border)"),
                background: on ? "var(--c-accent)" : "var(--c-surface)",
                color: on ? "#fff" : "var(--c-ink)", fontSize: 13, fontWeight: 700, cursor: "pointer",
              }}
            >
              {v.name}
              <span style={{ fontSize: 10.5, fontWeight: 600, opacity: on ? 0.85 : 0.6 }}>{v.audience}</span>
            </button>
          );
        })}
      </div>

      <TabState error={error} onConnect />
      {!error && !data && <TabState loading />}

      {data && view === "overview" && (
        <>
          <div style={{ display: "flex", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
            <KpiCard label="Klikken" value={num(t.clicks)} {...(data.deltas ? deltaProps(data.deltas.clicks, true) : {})} />
            <KpiCard label="Vertoningen" value={num(t.impressions)} {...(data.deltas ? deltaProps(data.deltas.impressions, true) : {})} />
            <KpiCard label="Gem. CTR" value={pct1((t.ctr || 0) * 100)} {...(data.deltas ? deltaProps(data.deltas.ctr, true) : {})} />
            <KpiCard label="Gem. positie" value={(t.position || 0).toFixed(1).replace(".", ",")} {...(data.deltas ? deltaProps(data.deltas.position, false) : {})} />
          </div>
          <SectionCard title="klikken over tijd">
            <AreaChart
              values={data.by_date.map((d) => d.clicks)}
              labels={pickLabels(data.by_date.map((d) => shortDate(d.date.replaceAll("-", ""))))}
              height={230}
            />
          </SectionCard>
        </>
      )}

      {data && view === "queries" && (
        <SectionCard title="top zoekopdrachten"><Table rows={data.top_queries} keyCol="query" /></SectionCard>
      )}

      {data && view === "pages" && (
        <SectionCard title="top pagina's"><Table rows={data.top_pages} keyCol="page" /></SectionCard>
      )}

      {data && view === "opportunities" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <SectionCard title="bijna pagina 1 — positie 11–20">
            <div style={{ fontSize: 12.5, color: "var(--c-muted)", marginBottom: 12 }}>
              Zoekopdrachten die net geen pagina 1 halen maar veel worden vertoond. Een kleine positieverbetering levert hier direct extra klikken op.
            </div>
            <OppTable rows={data.opportunities} />
          </SectionCard>
          <SectionCard title="veel vertoningen, lage CTR">
            <div style={{ fontSize: 12.5, color: "var(--c-muted)", marginBottom: 12 }}>
              Meest vertoonde zoekopdrachten. Een lage CTR wijst op een titel/omschrijving die beter kan.
            </div>
            <OppTable rows={data.by_impressions} />
          </SectionCard>
        </div>
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
      <div style={{ fontSize: 13, color: "var(--c-muted)", marginBottom: 16 }}>{label} · live via je Search Console-koppeling</div>
    </div>
  );
}

function Table({ rows, keyCol }) {
  if (!rows?.length) return <div style={{ color: "var(--c-muted)", fontSize: 13 }}>geen data.</div>;
  return (
    <div style={{ overflowX: "auto" }}>
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

function OppTable({ rows }) {
  if (!rows?.length) return <div style={{ color: "var(--c-muted)", fontSize: 13 }}>geen directe kansen in deze periode.</div>;
  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ ...head, gridTemplateColumns: "2.4fr 1fr 1fr 1fr" }}>
        <span>Zoekopdracht</span>
        <span style={{ textAlign: "right" }}>Vertoningen</span>
        <span style={{ textAlign: "right" }}>Positie</span>
        <span style={{ textAlign: "right" }}>CTR</span>
      </div>
      {rows.map((r, i) => (
        <div key={i} style={{ ...row, gridTemplateColumns: "2.4fr 1fr 1fr 1fr" }}>
          <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.query}</span>
          <span style={{ textAlign: "right", fontWeight: 600 }}>{num(r.impressions)}</span>
          <span style={{ textAlign: "right", color: "var(--c-muted)" }}>{(r.position || 0).toFixed(1).replace(".", ",")}</span>
          <span style={{ textAlign: "right", color: "var(--c-muted)" }}>{pct1((r.ctr || 0) * 100)}</span>
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
