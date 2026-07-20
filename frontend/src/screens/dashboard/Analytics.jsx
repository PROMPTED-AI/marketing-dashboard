import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api.js";
import { useProperties } from "../../lib/useProperties.jsx";
import { useActiveOrg } from "../../lib/ActiveOrgProvider.jsx";
import { useDateRange } from "../../lib/PeriodProvider.jsx";
import { useCachedApi } from "../../lib/swr.js";
import { overviewUrl } from "../../lib/urls.js";
import { num } from "../../lib/format.js";
import { SectionCard, TabState } from "../../components/ui.jsx";
import { RealtimeBars } from "../../components/charts.jsx";
import WidgetRenderer from "../../components/WidgetRenderer.jsx";
import WidgetErrorBoundary from "../../components/WidgetErrorBoundary.jsx";
import ExportButton from "../../components/ExportButton.jsx";
import { GaGlyph } from "../../components/icons.jsx";
import { analyticsCatalog } from "../../lib/widgets/index.js";
import { instantiateTemplate, templateMatchesProfile } from "../../lib/widgets/kit.js";

// De preset-views op het Analytics-tabblad = een curated set doelgroepgerichte
// templates (renderen tegen de overview-payload) + een aparte Realtime-view. De
// volgorde is profiel-afhankelijk: passende templates eerst, de andere onderaan
// (niets verdwijnt — soft), realtime altijd als laatste.
const CANDIDATE_VIEW_IDS = ["executive", "acquisition", "behavior", "conversion", "leadgen"];
function buildViews(businessType) {
  const tpls = analyticsCatalog.TEMPLATES.filter((t) => CANDIDATE_VIEW_IDS.includes(t.id));
  const match = tpls.filter((t) => templateMatchesProfile(t, businessType));
  const rest = tpls.filter((t) => !templateMatchesProfile(t, businessType));
  return [
    ...[...match, ...rest].map((t) => ({ id: t.id, name: t.name, audience: t.audience, tpl: t })),
    { id: "realtime", name: "Realtime", audience: "Live", tpl: null },
  ];
}

export default function Analytics() {
  const { props, selected, choose, loading: pLoading, error: pError } = useProperties();
  const { orgId, businessType } = useActiveOrg();
  const { start, end, compare, label } = useDateRange();
  const { data, loading, error } = useCachedApi(overviewUrl(selected, start, end, compare, orgId));
  const [rt, setRt] = useState(null);
  const [view, setView] = useState(() => localStorage.getItem("kompas-analytics-view") || "executive");

  const VIEWS = useMemo(() => buildViews(businessType), [businessType]);
  const pickView = (id) => { setView(id); localStorage.setItem("kompas-analytics-view", id); };

  // realtime: refresh on load and then poll every 30s (never cached)
  useEffect(() => {
    if (!selected) return;
    const org = orgId ? "&org_id=" + encodeURIComponent(orgId) : "";
    const tick = () =>
      api("/api/analytics/realtime?property_id=" + encodeURIComponent(selected) + org)
        .then(setRt)
        .catch(() => setRt(null));
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, [selected, orgId]);

  const activeView = VIEWS.find((v) => v.id === view) || VIEWS[0];
  const widgets = useMemo(() => (activeView.tpl ? instantiateTemplate(analyticsCatalog, activeView.tpl).widgets : []), [activeView.id]);

  if (pLoading) return <TabState loading />;
  if (pError) return <TabState error={pError} onConnect />;
  if (!props?.length) return <TabState empty />;

  const prop = props.find((p) => p.property_id === selected);

  const sections = () => {
    if (!data) return [];
    const out = [
      { title: "Analytics · " + label },
      { columns: ["Metric", "Waarde"], rows: [
        ["Gebruikers", data.kpis.users],
        ["Sessies", data.kpis.sessions],
        ["Bouncepercentage %", (data.kpis.bounceRate * 100).toFixed(1)],
        ["Gem. sessieduur (s)", Math.round(data.kpis.avgSessionDuration)],
      ] },
      { title: "Verkeersbronnen", columns: ["Kanaal", "Sessies", "%"], rows: data.channels.map((c) => [c.label, c.sessions, c.pct]) },
      { title: "Toppagina's", columns: ["Pagina", "Weergaven", "Bounce %"], rows: data.top_pages.map((p) => [p.path, p.views, (p.bounceRate * 100).toFixed(1)]) },
      { title: "Sessies per dag", columns: ["Datum", "Sessies"], rows: data.sessions_by_date.map((d) => [d.date, d.sessions]) },
    ];
    if (data.conversions?.length)
      out.push({ title: "Conversies", columns: ["Doel", "Aantal"], rows: data.conversions.map((c) => [c.name, c.count]) });
    return out;
  };

  return (
    <div>
      {/* header: property chip + selector + live badge + export */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: "#FFF3E0", display: "flex", alignItems: "center", justifyContent: "center" }}><GaGlyph s={20} /></div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.1 }}>Google Analytics 4</div>
            <div style={{ fontSize: 11.5, color: "var(--c-muted)" }}>{prop ? `${prop.display_name} · ${prop.account}` : "property"}</div>
          </div>
        </div>
        {props.length > 1 && (
          <select value={selected} onChange={(e) => choose(e.target.value)} style={selectStyle}>
            {props.map((p) => <option key={p.property_id} value={p.property_id}>{p.display_name} · {p.property_id}</option>)}
          </select>
        )}
        <div style={{ flex: 1 }} />
        <div className="pill pos" style={{ padding: "7px 13px", fontSize: 12.5 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--c-pos)" }} /> live verbonden
        </div>
        {data && <ExportButton filename="analytics" sections={sections} />}
      </div>

      <div className="display" style={{ fontSize: 28, marginBottom: 4 }}>analytics</div>
      <div style={{ fontSize: 13, color: "var(--c-muted)", marginBottom: 16 }}>Automatisch ingeladen via je GA4-koppeling · {label}</div>

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

      {/* Realtime view */}
      {view === "realtime" ? (
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <SectionCard style={{ flex: 1, minWidth: 280 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--c-pos)" }} /> realtime
            </div>
            <div className="display" style={{ fontSize: 44, lineHeight: 1, margin: "8px 0 2px" }}>{rt ? num(rt.active_users) : "—"}</div>
            <div style={{ fontSize: 12.5, color: "var(--c-muted)", marginBottom: 16 }}>Actieve gebruikers nu</div>
            <div style={{ fontSize: 11, color: "var(--c-muted)", fontWeight: 600, marginBottom: 6 }}>Per minuut (laatste 30 min)</div>
            <RealtimeBars values={rt?.by_minute || []} />
          </SectionCard>
          <SectionCard title="actieve pagina's" style={{ flex: 1, minWidth: 280 }}>
            {rt?.pages?.length ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
                {rt.pages.slice(0, 8).map((p, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8, borderBottom: "1px solid var(--c-border-soft)", paddingBottom: 8 }}>
                    <span style={{ color: "var(--c-ink-soft)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name || "—"}</span>
                    <span style={{ fontWeight: 700 }}>{num(p.active)}</span>
                  </div>
                ))}
              </div>
            ) : <div style={{ color: "var(--c-muted)", fontSize: 13 }}>Geen actieve pagina's nu.</div>}
          </SectionCard>
        </div>
      ) : (
        <>
          <TabState loading={loading} error={error} onConnect />
          {!loading && !error && data && (
            <div className="widget-grid" style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 16 }}>
              {widgets.map((w) => (
                <div key={w.id} className="widget-cell" style={{ gridColumn: `span ${w.size}`, minWidth: 0 }}>
                  <WidgetErrorBoundary title={w.title} resetKey={`${view}|${selected}|${start}|${end}`}>
                    <WidgetRenderer widget={w} data={data} catalog={analyticsCatalog} />
                  </WidgetErrorBoundary>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const selectStyle = { padding: "8px 12px", fontSize: 13, borderRadius: 999, border: "1px solid var(--c-border)", background: "var(--c-surface)", color: "var(--c-ink)", maxWidth: 320 };
