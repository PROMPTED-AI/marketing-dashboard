import { useProperties } from "../../lib/useProperties.jsx";
import { useActiveOrg } from "../../lib/ActiveOrgProvider.jsx";
import { useDateRange } from "../../lib/PeriodProvider.jsx";
import { useCachedApi } from "../../lib/swr.js";
import { overviewUrl } from "../../lib/urls.js";
import { num, shortDate, deltaProps } from "../../lib/format.js";
import { KpiCard, SectionCard, TabState } from "../../components/ui.jsx";
import { AreaChart, Donut, Legend } from "../../components/charts.jsx";
import ExportButton from "../../components/ExportButton.jsx";

export default function Overview() {
  const { props, selected, loading: pLoading, error: pError } = useProperties();
  const { orgId } = useActiveOrg();
  const { start, end, compare, label } = useDateRange();
  const { data, loading, error } = useCachedApi(overviewUrl(selected, start, end, compare, orgId));

  if (pLoading) return <TabState loading />;
  if (pError) return <TabState error={pError} onConnect />;
  if (!props?.length) return <TabState empty />;

  const series = data?.sessions_by_date?.map((d) => d.sessions) || [];
  const conversiesTotal = (data?.conversions || []).reduce((a, c) => a + c.count, 0);

  const sections = () => {
    if (!data) return [];
    return [
      { title: "Overzicht — " + label },
      { columns: ["Metric", "Waarde"], rows: [
        ["Bezoekers", data.kpis.users],
        ["Sessies", data.kpis.sessions],
        ["Conversies", conversiesTotal],
        ["Bouncepercentage %", (data.kpis.bounceRate * 100).toFixed(1)],
      ] },
      { title: "Verkeersbronnen", columns: ["Kanaal", "Sessies", "%"], rows: data.channels.map((c) => [c.label, c.sessions, c.pct]) },
      { title: "Sessies per dag", columns: ["Datum", "Sessies"], rows: data.sessions_by_date.map((d) => [d.date, d.sessions]) },
    ];
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 20, gap: 16, flexWrap: "wrap" }}>
        <div>
          <div className="display" style={{ fontSize: 30 }}>overzicht</div>
          <div style={{ fontSize: 13.5, color: "var(--c-muted)", marginTop: 4 }}>prestaties van de {label} · live uit Google Analytics</div>
        </div>
        <ExportButton filename="overzicht" sections={sections} />
      </div>

      <TabState loading={loading} error={error} onConnect />
      {!loading && !error && data && (
        <>
          <div style={{ display: "flex", gap: 16, marginBottom: 18, flexWrap: "wrap" }}>
            <KpiCard label="Bezoekers" value={num(data.kpis.users)} sparkValues={series} sparkColor="var(--c-accent)" {...(data.deltas ? deltaProps(data.deltas.users, true) : {})} />
            <KpiCard label="Conversies" value={num(conversiesTotal)} sparkValues={series} sparkColor="var(--c-mint)" />
            <KpiCard label="Advertentiekosten" value="—" />
            <KpiCard label="ROAS" value="—" />
          </div>

          <div style={{ display: "flex", gap: 16, marginBottom: 18, flexWrap: "wrap" }}>
            <SectionCard title="prestaties over tijd" style={{ flex: 2, minWidth: 320 }}>
              <AreaChart values={series} compareValues={data.compare_series} labels={pickLabels(data.sessions_by_date.map((d) => shortDate(d.date)))} height={232} />
            </SectionCard>
            <SectionCard title="verkeersbronnen" style={{ flex: 1, minWidth: 240 }}>
              <Donut segments={data.channels} centerTop={num(data.kpis.sessions)} centerSub="sessies" />
              <div style={{ marginTop: 14 }}><Legend segments={data.channels} /></div>
            </SectionCard>
          </div>

          <SectionCard title="top campagnes" action={<span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--c-muted)" }}>via Google Ads</span>}>
            <div style={{ padding: "24px 0", display: "grid", placeItems: "center", textAlign: "center" }}>
              <div>
                <div className="pill accent" style={{ marginBottom: 10 }}>binnenkort</div>
                <div style={{ color: "var(--c-muted)", fontSize: 14, maxWidth: 420, lineHeight: 1.6 }}>
                  Koppel Google Ads om kosten, conversies en ROAS per campagne te zien.
                </div>
              </div>
            </div>
          </SectionCard>
        </>
      )}
    </div>
  );
}

function pickLabels(all) {
  if (all.length <= 5) return all;
  const step = (all.length - 1) / 4;
  return [0, 1, 2, 3, 4].map((i) => all[Math.round(i * step)]);
}
