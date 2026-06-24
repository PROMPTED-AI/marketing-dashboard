import { useState } from "react";
import { useProperties } from "../../lib/useProperties.jsx";
import { useActiveOrg } from "../../lib/ActiveOrgProvider.jsx";
import { useDateRange } from "../../lib/PeriodProvider.jsx";
import { useCachedApi } from "../../lib/swr.js";
import { overviewUrl, gscReportUrl, sitesUrl } from "../../lib/urls.js";
import { exportCsv, printReport } from "../../lib/exportData.js";
import { num, pct1, duration, shortDate } from "../../lib/format.js";
import { SectionCard } from "../../components/ui.jsx";
import { IcStar, IcDownload } from "../../components/icons.jsx";

const GA_SECTIONS = [
  { id: "ga_kpi", label: "KPI-overzicht" },
  { id: "ga_channels", label: "Verkeersbronnen" },
  { id: "ga_pages", label: "Toppagina's" },
  { id: "ga_devices", label: "Apparaten" },
  { id: "ga_geo", label: "Geografie" },
  { id: "ga_daily", label: "Sessies per dag" },
];
const GSC_SECTIONS = [
  { id: "gsc_kpi", label: "Search Console — KPI" },
  { id: "gsc_queries", label: "Top zoekopdrachten" },
  { id: "gsc_pages", label: "Top pagina's (SEO)" },
];
const ALL_IDS = [...GA_SECTIONS, ...GSC_SECTIONS].map((s) => s.id);

export default function Reports() {
  const { props, selected } = useProperties();
  const { orgId, orgName } = useActiveOrg();
  const { start, end, compare, label } = useDateRange();
  const [on, setOn] = useState(() => Object.fromEntries(ALL_IDS.map((id) => [id, true])));

  const ga = useCachedApi(overviewUrl(selected, start, end, compare, orgId));
  const sitesResp = useCachedApi(sitesUrl(orgId));
  const sites = sitesResp.data?.sites || [];
  const stored = localStorage.getItem("kompas-gsc-site");
  const site = stored && sites.some((s) => s.site_url === stored) ? stored : sites[0]?.site_url || "";
  const gsc = useCachedApi(gscReportUrl(site, start, end, compare, orgId));

  const gaData = ga.data;
  const gscData = gsc.data;
  const toggle = (id) => setOn((o) => ({ ...o, [id]: !o[id] }));

  // Build the CSV sections from the enabled + available blocks.
  const buildSections = () => {
    const out = [{ title: `Rapport — ${orgName} · ${label}` }];
    if (gaData) {
      const k = gaData.kpis;
      const conv = (gaData.conversions || []).reduce((a, c) => a + c.count, 0);
      if (on.ga_kpi) out.push({ title: "Google Analytics — KPI", columns: ["Metric", "Waarde"], rows: [
        ["Gebruikers", k.users], ["Sessies", k.sessions], ["Conversies", conv],
        ["Bouncepercentage %", (k.bounceRate * 100).toFixed(1)], ["Gem. sessieduur (s)", Math.round(k.avgSessionDuration)],
      ] });
      if (on.ga_channels) out.push({ title: "Verkeersbronnen", columns: ["Kanaal", "Sessies", "%"], rows: gaData.channels.map((c) => [c.label, c.sessions, c.pct]) });
      if (on.ga_pages) out.push({ title: "Toppagina's", columns: ["Pagina", "Weergaven", "Bounce %"], rows: gaData.top_pages.map((p) => [p.path, p.views, (p.bounceRate * 100).toFixed(1)]) });
      if (on.ga_devices) out.push({ title: "Apparaten", columns: ["Apparaat", "%"], rows: gaData.devices.map((d) => [d.label, d.pct]) });
      if (on.ga_geo) out.push({ title: "Geografie", columns: ["Land", "%"], rows: gaData.geography.map((g) => [g.label, g.pct]) });
      if (on.ga_daily) out.push({ title: "Sessies per dag", columns: ["Datum", "Sessies"], rows: gaData.sessions_by_date.map((d) => [d.date, d.sessions]) });
    }
    if (gscData) {
      const t = gscData.totals;
      if (on.gsc_kpi) out.push({ title: "Search Console — KPI", columns: ["Metric", "Waarde"], rows: [
        ["Klikken", t.clicks], ["Vertoningen", t.impressions], ["Gem. CTR %", ((t.ctr || 0) * 100).toFixed(2)], ["Gem. positie", (t.position || 0).toFixed(1)],
      ] });
      if (on.gsc_queries) out.push({ title: "Top zoekopdrachten", columns: ["Zoekopdracht", "Klikken", "Vertoningen", "CTR %", "Positie"], rows: gscData.top_queries.map((r) => [r.query, r.clicks, r.impressions, ((r.ctr || 0) * 100).toFixed(2), (r.position || 0).toFixed(1)]) });
      if (on.gsc_pages) out.push({ title: "Top pagina's (SEO)", columns: ["Pagina", "Klikken", "Vertoningen", "CTR %", "Positie"], rows: gscData.top_pages.map((r) => [r.page, r.clicks, r.impressions, ((r.ctr || 0) * 100).toFixed(2), (r.position || 0).toFixed(1)]) });
    }
    return out;
  };

  const today = new Date().toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });
  const anyData = gaData || gscData;

  return (
    <div>
      {/* CONTROL PANEL — not printed */}
      <div className="no-print">
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 18 }}>
          <div>
            <div className="display" style={{ fontSize: 30 }}>rapporten</div>
            <div style={{ fontSize: 13.5, color: "var(--c-muted)", marginTop: 4 }}>stel een rapport samen voor {orgName} · {label}</div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn-ghost" style={{ height: 42, padding: "0 16px", fontSize: 13.5 }} disabled={!anyData} onClick={() => exportCsv(`rapport-${orgName}.csv`, buildSections())}>
              <IcDownload s={16} stroke="currentColor" /> CSV
            </button>
            <button className="btn-primary" style={{ height: 42, padding: "0 18px", fontSize: 13.5 }} disabled={!anyData} onClick={() => setTimeout(printReport, 60)}>
              <IcDownload s={16} /> PDF / print
            </button>
          </div>
        </div>

        <SectionCard title="secties" style={{ marginBottom: 22 }}>
          <Group title="Google Analytics" items={GA_SECTIONS} on={on} toggle={toggle} disabled={!gaData} />
          <div style={{ height: 14 }} />
          <Group title="Search Console" items={GSC_SECTIONS} on={on} toggle={toggle} disabled={!gscData} />
        </SectionCard>
      </div>

      {/* REPORT BODY — this is what prints */}
      <div className="report-body">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, paddingBottom: 16, borderBottom: "2px solid var(--c-ink)", marginBottom: 22 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: "var(--c-accent)", display: "flex", alignItems: "center", justifyContent: "center" }}><IcStar s={20} /></div>
            <div>
              <div className="display" style={{ fontSize: 22, lineHeight: 1 }}>kompas</div>
              <div style={{ fontSize: 11.5, color: "var(--c-muted)" }}>marketingrapport</div>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{orgName}</div>
            <div style={{ fontSize: 12, color: "var(--c-muted)" }}>{label} · gegenereerd {today}</div>
          </div>
        </div>

        {!anyData && <div className="card" style={{ padding: 28, color: "var(--c-muted)" }}>Nog geen data beschikbaar — koppel Google Analytics of Search Console.</div>}

        {gaData && on.ga_kpi && (
          <Block title="Overzicht">
            <KvTable rows={[
              ["Gebruikers", num(gaData.kpis.users)],
              ["Sessies", num(gaData.kpis.sessions)],
              ["Conversies", num((gaData.conversions || []).reduce((a, c) => a + c.count, 0))],
              ["Bouncepercentage", pct1(gaData.kpis.bounceRate * 100)],
              ["Gem. sessieduur", duration(gaData.kpis.avgSessionDuration)],
            ]} />
          </Block>
        )}
        {gaData && on.ga_channels && <Block title="Verkeersbronnen"><Table head={["Kanaal", "Sessies", "%"]} rows={gaData.channels.map((c) => [c.label, num(c.sessions), `${c.pct}%`])} /></Block>}
        {gaData && on.ga_pages && <Block title="Toppagina's"><Table head={["Pagina", "Weergaven", "Bounce"]} rows={gaData.top_pages.map((p) => [p.path, num(p.views), pct1(p.bounceRate * 100)])} /></Block>}
        {gaData && on.ga_devices && <Block title="Apparaten"><Table head={["Apparaat", "%"]} rows={gaData.devices.map((d) => [cap(d.label), `${d.pct}%`])} /></Block>}
        {gaData && on.ga_geo && <Block title="Geografie"><Table head={["Land", "%"]} rows={gaData.geography.map((g) => [g.label, `${g.pct}%`])} /></Block>}
        {gaData && on.ga_daily && <Block title="Sessies per dag"><Table head={["Datum", "Sessies"]} rows={gaData.sessions_by_date.map((d) => [shortDate(d.date), num(d.sessions)])} /></Block>}

        {gscData && on.gsc_kpi && (
          <Block title="Search Console — overzicht">
            <KvTable rows={[
              ["Klikken", num(gscData.totals.clicks)],
              ["Vertoningen", num(gscData.totals.impressions)],
              ["Gem. CTR", pct1((gscData.totals.ctr || 0) * 100)],
              ["Gem. positie", (gscData.totals.position || 0).toFixed(1).replace(".", ",")],
            ]} />
          </Block>
        )}
        {gscData && on.gsc_queries && <Block title="Top zoekopdrachten"><Table head={["Zoekopdracht", "Klikken", "CTR", "Positie"]} rows={gscData.top_queries.map((r) => [r.query, num(r.clicks), pct1((r.ctr || 0) * 100), (r.position || 0).toFixed(1).replace(".", ",")])} /></Block>}
        {gscData && on.gsc_pages && <Block title="Top pagina's (SEO)"><Table head={["Pagina", "Klikken", "CTR", "Positie"]} rows={gscData.top_pages.map((r) => [r.page, num(r.clicks), pct1((r.ctr || 0) * 100), (r.position || 0).toFixed(1).replace(".", ",")])} /></Block>}
      </div>
    </div>
  );
}

function Group({ title, items, on, toggle, disabled }) {
  return (
    <div style={{ opacity: disabled ? 0.5 : 1 }}>
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--c-muted)", marginBottom: 10 }}>{title}{disabled && " — niet gekoppeld"}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {items.map((s) => (
          <label key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, fontWeight: 600, padding: "8px 13px", border: "1px solid var(--c-border)", borderRadius: 999, cursor: disabled ? "default" : "pointer", background: on[s.id] && !disabled ? "var(--c-accent-soft)" : "var(--c-surface)", color: on[s.id] && !disabled ? "var(--c-accent)" : "var(--c-ink-soft)" }}>
            <input type="checkbox" checked={!!on[s.id]} disabled={disabled} onChange={() => toggle(s.id)} /> {s.label}
          </label>
        ))}
      </div>
    </div>
  );
}

function Block({ title, children }) {
  return (
    <div style={{ marginBottom: 20, breakInside: "avoid" }}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}

function Table({ head, rows }) {
  if (!rows.length) return <div style={{ color: "var(--c-muted)", fontSize: 13 }}>geen data.</div>;
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr>{head.map((h, i) => <th key={i} style={{ textAlign: i === 0 ? "left" : "right", padding: "8px 6px", borderBottom: "1px solid var(--c-border)", fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--c-muted)" }}>{h}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri}>{r.map((cell, ci) => <td key={ci} style={{ textAlign: ci === 0 ? "left" : "right", padding: "8px 6px", borderBottom: "1px solid var(--c-border-soft)", fontWeight: ci === 0 ? 600 : 400, maxWidth: ci === 0 ? 320 : "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cell}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}

function KvTable({ rows }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
      {rows.map(([k, v], i) => (
        <div key={i} className="card" style={{ flex: "1 1 150px", minWidth: 140, padding: "14px 16px" }}>
          <div style={{ fontSize: 12, color: "var(--c-muted)", fontWeight: 600 }}>{k}</div>
          <div className="display" style={{ fontSize: 24, marginTop: 4 }}>{v}</div>
        </div>
      ))}
    </div>
  );
}

const cap = (s = "") => s.charAt(0).toUpperCase() + s.slice(1);
