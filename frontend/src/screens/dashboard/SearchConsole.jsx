import { useEffect, useState } from "react";
import { useActiveOrg } from "../../lib/ActiveOrgProvider.jsx";
import { useDateRange } from "../../lib/PeriodProvider.jsx";
import { useCachedApi } from "../../lib/swr.js";
import { gscReportUrl, sitesUrl } from "../../lib/urls.js";
import { num, pct1, shortDate, deltaProps } from "../../lib/format.js";
import { KpiCard, SectionCard, TabState, ProgressRow } from "../../components/ui.jsx";
import { AreaChart, Donut, Legend, palette } from "../../components/charts.jsx";
import ExportButton from "../../components/ExportButton.jsx";
import { GscGlyph } from "../../components/icons.jsx";

const VIEWS = [
  { id: "overview", name: "SEO-overzicht" },
  { id: "queries", name: "Zoekopdrachten" },
  { id: "pages", name: "Pagina's" },
  { id: "opportunities", name: "Kansen" },
  { id: "segments", name: "Apparaten & landen" },
];

const DEVICE_LABELS = { DESKTOP: "Desktop", MOBILE: "Mobiel", TABLET: "Tablet" };
const deviceLabel = (d) => DEVICE_LABELS[d] || (d ? d[0] + d.slice(1).toLowerCase() : "—");

const COUNTRY_LABELS = {
  nld: "Nederland", bel: "België", deu: "Duitsland", usa: "Verenigde Staten", gbr: "Verenigd Koninkrijk",
  fra: "Frankrijk", esp: "Spanje", ita: "Italië", pol: "Polen", tur: "Turkije", mar: "Marokko",
  bra: "Brazilië", ind: "India", che: "Zwitserland", aut: "Oostenrijk", swe: "Zweden", nor: "Noorwegen",
  dnk: "Denemarken", irl: "Ierland", prt: "Portugal", can: "Canada", aus: "Australië",
};
const countryLabel = (c) => COUNTRY_LABELS[c] || (c || "—").toUpperCase();

const pctOf = (v, max) => (max > 0 ? Math.round((v / max) * 100) : 0);
const posStr = (v) => (v || 0).toFixed(1).replace(".", ",");

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
  const bd = data?.by_date || [];
  const seriesDates = bd.map((d) => shortDate(d.date.replaceAll("-", "")));
  const clicksS = bd.map((d) => d.clicks);
  const imprS = bd.map((d) => d.impressions);
  const ctrS = bd.map((d) => (d.ctr || 0) * 100);
  const posS = bd.map((d) => d.position || 0);

  const devices = data?.devices || [];
  const devTotal = devices.reduce((a, d) => a + (d.clicks || 0), 0);
  const devSegments = devices.map((d) => ({ label: deviceLabel(d.device), pct: pctOf(d.clicks, devTotal) }));

  const countries = data?.countries || [];
  const maxCountryClicks = Math.max(...countries.map((c) => c.clicks || 0), 1);

  const sections = () => {
    if (!data) return [];
    const out = [
      { title: "Search Console · " + label + " · " + site },
      { columns: ["Metric", "Waarde"], rows: [
        ["Klikken", t.clicks],
        ["Vertoningen", t.impressions],
        ["Gem. CTR %", ((t.ctr || 0) * 100).toFixed(2)],
        ["Gem. positie", (t.position || 0).toFixed(1)],
      ] },
      { title: "Top zoekopdrachten", columns: ["Zoekopdracht", "Klikken", "Vertoningen", "CTR %", "Positie"], rows: data.top_queries.map((r) => [r.query, r.clicks, r.impressions, ((r.ctr || 0) * 100).toFixed(2), (r.position || 0).toFixed(1)]) },
      { title: "Top pagina's", columns: ["Pagina", "Klikken", "Vertoningen", "CTR %", "Positie"], rows: data.top_pages.map((r) => [r.page, r.clicks, r.impressions, ((r.ctr || 0) * 100).toFixed(2), (r.position || 0).toFixed(1)]) },
    ];
    if (devices.length)
      out.push({ title: "Apparaten", columns: ["Apparaat", "Klikken", "Vertoningen", "CTR %", "Positie"], rows: devices.map((d) => [deviceLabel(d.device), d.clicks, d.impressions, ((d.ctr || 0) * 100).toFixed(2), (d.position || 0).toFixed(1)]) });
    if (countries.length)
      out.push({ title: "Landen", columns: ["Land", "Klikken", "Vertoningen", "CTR %", "Positie"], rows: countries.map((c) => [countryLabel(c.country), c.clicks, c.impressions, ((c.ctr || 0) * 100).toFixed(2), (c.position || 0).toFixed(1)]) });
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
            </button>
          );
        })}
      </div>

      <TabState error={error} onConnect />
      {!error && !data && <TabState loading />}

      {/* ---- SEO-overzicht ---- */}
      {data && view === "overview" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <KpiCard label="Klikken" value={num(t.clicks)} sparkValues={clicksS} sparkLabels={seriesDates} sparkUnit="klikken" sparkColor="var(--c-accent)" {...(data.deltas ? deltaProps(data.deltas.clicks, true) : {})} />
            <KpiCard label="Vertoningen" value={num(t.impressions)} sparkValues={imprS} sparkLabels={seriesDates} sparkUnit="vertoningen" sparkColor="var(--c-accent)" {...(data.deltas ? deltaProps(data.deltas.impressions, true) : {})} />
            <KpiCard label="Gem. CTR" value={pct1((t.ctr || 0) * 100)} sparkValues={ctrS} sparkLabels={seriesDates} sparkColor="var(--c-accent)" {...(data.deltas ? deltaProps(data.deltas.ctr, true) : {})} />
            <KpiCard label="Gem. positie" value={posStr(t.position)} sparkValues={posS} sparkLabels={seriesDates} sparkColor="var(--c-accent)" {...(data.deltas ? deltaProps(data.deltas.position, false) : {})} />
          </div>
          <SectionCard title="klikken over tijd">
            <AreaChart values={clicksS} labels={seriesDates} height={230} unit="klikken" />
          </SectionCard>
          <SectionCard title="vertoningen over tijd">
            <AreaChart values={imprS} labels={seriesDates} height={230} unit="vertoningen" />
          </SectionCard>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <SectionCard title="apparaten" style={{ flex: 1, minWidth: 280 }}>
              {devSegments.length ? (
                <>
                  <Donut segments={devSegments} centerTop={num(devTotal)} centerSub="klikken" />
                  <div style={{ marginTop: 14 }}><Legend segments={devSegments} /></div>
                </>
              ) : <Empty>geen apparaatdata.</Empty>}
            </SectionCard>
            <SectionCard title="top landen" style={{ flex: 1, minWidth: 280 }}>
              {countries.length ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 4 }}>
                  {countries.slice(0, 8).map((c, i) => (
                    <ProgressRow key={i} label={countryLabel(c.country)} value={num(c.clicks)} pct={pctOf(c.clicks, maxCountryClicks)} color={palette[i % palette.length]} labelWidth={150} />
                  ))}
                </div>
              ) : <Empty>geen landendata.</Empty>}
            </SectionCard>
          </div>
        </div>
      )}

      {/* ---- Zoekopdrachten ---- */}
      {data && view === "queries" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <SectionCard title="Top zoekopdrachten: klikken">
            <BarList rows={data.top_queries} keyCol="query" />
          </SectionCard>
          <SectionCard title="alle zoekopdrachten"><Table rows={data.top_queries} keyCol="query" /></SectionCard>
        </div>
      )}

      {/* ---- Pagina's ---- */}
      {data && view === "pages" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <SectionCard title="Top pagina's: klikken">
            <BarList rows={data.top_pages} keyCol="page" />
          </SectionCard>
          <SectionCard title="alle pagina's"><Table rows={data.top_pages} keyCol="page" /></SectionCard>
        </div>
      )}

      {/* ---- Kansen ---- */}
      {data && view === "opportunities" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <SectionCard title="Bijna pagina 1: positie 11 t/m 20">
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

      {/* ---- Apparaten & landen ---- */}
      {data && view === "segments" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <SectionCard title="apparaten" style={{ flex: 1, minWidth: 280 }}>
              {devSegments.length ? (
                <>
                  <Donut segments={devSegments} centerTop={num(devTotal)} centerSub="klikken" />
                  <div style={{ marginTop: 14 }}><Legend segments={devSegments} /></div>
                </>
              ) : <Empty>geen apparaatdata.</Empty>}
            </SectionCard>
            <SectionCard title="top landen" style={{ flex: 1, minWidth: 280 }}>
              {countries.length ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 4 }}>
                  {countries.slice(0, 8).map((c, i) => (
                    <ProgressRow key={i} label={countryLabel(c.country)} value={num(c.clicks)} pct={pctOf(c.clicks, maxCountryClicks)} color={palette[i % palette.length]} labelWidth={150} />
                  ))}
                </div>
              ) : <Empty>geen landendata.</Empty>}
            </SectionCard>
          </div>
          <SectionCard title="per apparaat">
            <SegTable rows={devices} keyCol="device" labelFn={deviceLabel} />
          </SectionCard>
          <SectionCard title="per land">
            <SegTable rows={countries} keyCol="country" labelFn={countryLabel} />
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
        <div><div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.1 }}>Search Console</div><div style={{ fontSize: 11.5, color: "var(--c-muted)" }}>Organisch verkeer en posities</div></div>
        <div style={{ flex: 1 }} />
        {right}
      </div>
      <div className="display" style={{ fontSize: 28, marginBottom: 4 }}>search console · seo</div>
      <div style={{ fontSize: 13, color: "var(--c-muted)", marginBottom: 16 }}>{label} · live via je Search Console-koppeling</div>
    </div>
  );
}

// Horizontal bar list of the top rows by clicks (share of the biggest one).
function BarList({ rows, keyCol }) {
  if (!rows?.length) return <Empty>geen data.</Empty>;
  const top = rows.slice(0, 10);
  const max = Math.max(...top.map((r) => r.clicks || 0), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 4 }}>
      {top.map((r, i) => (
        <ProgressRow key={i} label={r[keyCol]} value={num(r.clicks)} pct={pctOf(r.clicks, max)} color={palette[i % palette.length]} labelWidth={220} />
      ))}
    </div>
  );
}

function Table({ rows, keyCol }) {
  if (!rows?.length) return <div style={{ color: "var(--c-muted)", fontSize: 13 }}>geen data.</div>;
  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ ...head, gridTemplateColumns: "2.4fr 1fr 1fr 1fr 1fr" }}>
        <span>{keyCol === "query" ? "Zoekopdracht" : "Pagina"}</span>
        <span style={{ textAlign: "right" }}>Klikken</span>
        <span style={{ textAlign: "right" }}>Vertoningen</span>
        <span style={{ textAlign: "right" }}>CTR</span>
        <span style={{ textAlign: "right" }}>Positie</span>
      </div>
      {rows.map((r, i) => (
        <div key={i} style={{ ...row, gridTemplateColumns: "2.4fr 1fr 1fr 1fr 1fr" }}>
          <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r[keyCol]}</span>
          <span style={{ textAlign: "right", fontWeight: 600 }}>{num(r.clicks)}</span>
          <span style={{ textAlign: "right", color: "var(--c-muted)" }}>{num(r.impressions)}</span>
          <span style={{ textAlign: "right", color: "var(--c-muted)" }}>{pct1((r.ctr || 0) * 100)}</span>
          <span style={{ textAlign: "right", color: "var(--c-muted)" }}>{posStr(r.position)}</span>
        </div>
      ))}
    </div>
  );
}

function SegTable({ rows, keyCol, labelFn }) {
  if (!rows?.length) return <div style={{ color: "var(--c-muted)", fontSize: 13 }}>geen data.</div>;
  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ ...head, gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr" }}>
        <span>{keyCol === "device" ? "Apparaat" : "Land"}</span>
        <span style={{ textAlign: "right" }}>Klikken</span>
        <span style={{ textAlign: "right" }}>Vertoningen</span>
        <span style={{ textAlign: "right" }}>CTR</span>
        <span style={{ textAlign: "right" }}>Positie</span>
      </div>
      {rows.map((r, i) => (
        <div key={i} style={{ ...row, gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr" }}>
          <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{labelFn(r[keyCol])}</span>
          <span style={{ textAlign: "right", fontWeight: 600 }}>{num(r.clicks)}</span>
          <span style={{ textAlign: "right", color: "var(--c-muted)" }}>{num(r.impressions)}</span>
          <span style={{ textAlign: "right", color: "var(--c-muted)" }}>{pct1((r.ctr || 0) * 100)}</span>
          <span style={{ textAlign: "right", color: "var(--c-muted)" }}>{posStr(r.position)}</span>
        </div>
      ))}
    </div>
  );
}

function OppTable({ rows }) {
  if (!rows?.length) return <div style={{ color: "var(--c-muted)", fontSize: 13 }}>Geen directe kansen in deze periode.</div>;
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
          <span style={{ textAlign: "right", color: "var(--c-muted)" }}>{posStr(r.position)}</span>
          <span style={{ textAlign: "right", color: "var(--c-muted)" }}>{pct1((r.ctr || 0) * 100)}</span>
        </div>
      ))}
    </div>
  );
}

function Empty({ children }) {
  return <div style={{ color: "var(--c-muted)", fontSize: 13, padding: "8px 0" }}>{children}</div>;
}

const selectStyle = { padding: "8px 12px", fontSize: 13, borderRadius: 999, border: "1px solid var(--c-border)", background: "var(--c-surface)", color: "var(--c-ink)", maxWidth: 360 };
const head = { display: "grid", gap: 12, fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--c-muted)", paddingBottom: 10, borderBottom: "1px solid var(--c-border)" };
const row = { display: "grid", gap: 12, fontSize: 13, padding: "11px 0", borderBottom: "1px solid var(--c-border-soft)", alignItems: "center" };
