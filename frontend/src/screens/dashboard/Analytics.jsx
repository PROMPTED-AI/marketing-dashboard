import { useEffect, useState } from "react";
import { api } from "../../lib/api.js";
import { useProperties } from "../../lib/useProperties.jsx";
import { usePeriod } from "../../lib/PeriodProvider.jsx";
import { num, pct1, duration, shortDate } from "../../lib/format.js";
import { KpiCard, ProgressRow, SectionCard, TabState } from "../../components/ui.jsx";
import { AreaChart, Donut, Legend, RealtimeBars, palette } from "../../components/charts.jsx";
import { GaGlyph } from "../../components/icons.jsx";

export default function Analytics() {
  const { props, selected, choose, loading: pLoading, error: pError } = useProperties();
  const { days, label } = usePeriod();
  const [data, setData] = useState(null);
  const [rt, setRt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!selected) return;
    setLoading(true);
    setError(null);
    const q = "?property_id=" + encodeURIComponent(selected) + "&days=" + days;
    api("/api/analytics/overview" + q)
      .then(setData)
      .catch(setError)
      .finally(() => setLoading(false));
    api("/api/analytics/realtime?property_id=" + encodeURIComponent(selected)).then(setRt).catch(() => setRt(null));
  }, [selected, days]);

  if (pLoading) return <TabState loading />;
  if (pError) return <TabState error={pError} onConnect />;
  if (!props?.length)
    return <TabState empty />;

  const prop = props.find((p) => p.property_id === selected);

  return (
    <div>
      {/* header: property chip + selector + live badge */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18, flexWrap: "wrap" }}>
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
      </div>

      <div className="display" style={{ fontSize: 28, marginBottom: 4 }}>analytics — gedrag &amp; verkeer</div>
      <div style={{ fontSize: 13, color: "var(--c-muted)", marginBottom: 18 }}>automatisch ingeladen via je GA4-koppeling · {label}</div>

      <TabState loading={loading} error={error} onConnect />
      {!loading && !error && data && (
        <>
          {/* KPI ROW */}
          <div style={{ display: "flex", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
            <KpiCard label="Gebruikers" value={num(data.kpis.users)} />
            <KpiCard label="Sessies" value={num(data.kpis.sessions)} />
            <KpiCard label="Bouncepercentage" value={pct1(data.kpis.bounceRate * 100)} />
            <KpiCard label="Gem. sessieduur" value={duration(data.kpis.avgSessionDuration)} />
          </div>

          {/* SESSIONS CHART + REALTIME */}
          <div style={{ display: "flex", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
            <SectionCard title="sessies over tijd" style={{ flex: 2, minWidth: 320 }}>
              <AreaChart
                values={data.sessions_by_date.map((d) => d.sessions)}
                labels={pickLabels(data.sessions_by_date.map((d) => shortDate(d.date)))}
                height={210}
              />
            </SectionCard>
            <SectionCard style={{ flex: 1, minWidth: 240, display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--c-pos)" }} /> realtime
              </div>
              <div className="display" style={{ fontSize: 40, lineHeight: 1, margin: "6px 0 2px" }}>{rt ? num(rt.active_users) : "—"}</div>
              <div style={{ fontSize: 12.5, color: "var(--c-muted)", marginBottom: 14 }}>actieve gebruikers nu</div>
              <div style={{ fontSize: 11, color: "var(--c-muted)", fontWeight: 600, marginBottom: 6 }}>per minuut (laatste 30 min)</div>
              <RealtimeBars values={rt?.by_minute || []} />
              {rt?.pages?.length > 0 && (
                <>
                  <div style={{ height: 1, background: "var(--c-border)", margin: "14px 0" }} />
                  <div style={{ fontSize: 11, color: "var(--c-muted)", fontWeight: 600, marginBottom: 8 }}>actieve pagina's</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12.5 }}>
                    {rt.pages.slice(0, 3).map((p, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <span style={{ color: "var(--c-ink-soft)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name || "—"}</span>
                        <span style={{ fontWeight: 700 }}>{num(p.active)}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </SectionCard>
          </div>

          {/* TOP PAGES + DONUT */}
          <div style={{ display: "flex", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
            <SectionCard title="toppagina's" style={{ flex: 1.5, minWidth: 320 }}>
              <div style={{ ...tableHead, gridTemplateColumns: "2.4fr 1fr 1fr" }}>
                <span>Pagina</span><span style={{ textAlign: "right" }}>Weergaven</span><span style={{ textAlign: "right" }}>Bounce</span>
              </div>
              {data.top_pages.map((p, i) => (
                <div key={i} style={{ ...tableRow, gridTemplateColumns: "2.4fr 1fr 1fr" }}>
                  <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.path}</span>
                  <span style={{ textAlign: "right", fontWeight: 600 }}>{num(p.views)}</span>
                  <span style={{ textAlign: "right", color: "var(--c-muted)" }}>{pct1(p.bounceRate * 100)}</span>
                </div>
              ))}
            </SectionCard>
            <SectionCard title="verkeersbronnen" style={{ flex: 1, minWidth: 240 }}>
              <Donut segments={data.channels} centerTop={data.channels.length} centerSub="kanalen" size={150} />
              <div style={{ marginTop: 14 }}><Legend segments={data.channels} /></div>
            </SectionCard>
          </div>

          {/* CONVERSIES + DEVICES + GEO */}
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <SectionCard title="conversies &amp; doelen" style={{ flex: 1, minWidth: 240 }}>
              {data.conversions.length ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {data.conversions.slice(0, 4).map((c, i) => {
                    const max = data.conversions[0].count || 1;
                    return <ProgressRow key={i} label={c.name} value={num(c.count)} pct={Math.round((c.count / max) * 100)} color={palette[i % palette.length]} />;
                  })}
                </div>
              ) : <div style={{ color: "var(--c-muted)", fontSize: 13 }}>geen conversie-events in deze periode.</div>}
            </SectionCard>
            <SectionCard title="apparaten" style={{ flex: 1, minWidth: 240 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {data.devices.map((d, i) => <ProgressRow key={i} label={cap(d.label)} value={`${d.pct}%`} pct={d.pct} color={palette[i % palette.length]} />)}
              </div>
            </SectionCard>
            <SectionCard title="geografie" style={{ flex: 1, minWidth: 240 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
                {data.geography.map((g, i) => <ProgressRow key={i} label={g.label} value={`${g.pct}%`} pct={g.pct} color={palette[i % palette.length]} labelWidth={78} />)}
              </div>
            </SectionCard>
          </div>
        </>
      )}
    </div>
  );
}

const cap = (s = "") => s.charAt(0).toUpperCase() + s.slice(1);
function pickLabels(all) {
  if (all.length <= 5) return all;
  const step = (all.length - 1) / 4;
  return [0, 1, 2, 3, 4].map((i) => all[Math.round(i * step)]);
}
const selectStyle = { padding: "8px 12px", fontSize: 13, borderRadius: 999, border: "1px solid var(--c-border)", background: "var(--c-surface)", color: "var(--c-ink)", maxWidth: 320 };
const tableHead = { display: "grid", gap: 12, fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--c-muted)", paddingBottom: 10, borderBottom: "1px solid var(--c-border)" };
const tableRow = { display: "grid", gap: 12, fontSize: 13, padding: "11px 0", borderBottom: "1px solid var(--c-border-soft)", alignItems: "center" };
