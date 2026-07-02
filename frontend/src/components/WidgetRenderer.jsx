// Tekent één widget tegen de overview-payload. Presentatie-only: bewerk-knoppen
// (verwijderen, grootte, herorden) zitten in de Overview-grid eromheen.

import { SOURCES } from "../lib/widgetCatalog.js";
import { num, pct1, duration, deltaProps, shortDate } from "../lib/format.js";
import { KpiCard, SectionCard, ProgressRow } from "./ui.jsx";
import { AreaChart, Donut, Legend, palette } from "./charts.jsx";

function fmtScalar(value, fmt) {
  if (fmt === "percent") return pct1(value);
  if (fmt === "duration") return duration(value);
  return num(value);
}

// Toon hooguit 5 gelijkmatig verdeelde labels onder een grafiek.
function pickLabels(all) {
  if (all.length <= 5) return all;
  const step = (all.length - 1) / 4;
  return [0, 1, 2, 3, 4].map((i) => all[Math.round(i * step)]);
}

export default function WidgetRenderer({ widget, data }) {
  const src = SOURCES[widget.source];
  if (!src) return <SectionCard title={widget.title}>Onbekende bron.</SectionCard>;

  const seriesDates = (data?.series_by_date ?? data?.sessions_by_date ?? []).map((p) => shortDate(p.date));

  if (widget.kind === "kpi") {
    const s = src.scalar(data, widget.config);
    const delta = s.delta != null ? deltaProps(s.delta, s.higherBetter) : {};
    // Each KPI shows its own metric trend; fall back to the sessions line when
    // the per-metric series is missing/empty (e.g. an older cached payload).
    let spark = src.spark ? src.spark(data) : null;
    if (!spark || !spark.length) spark = (data?.sessions_by_date ?? []).map((p) => p.sessions);
    // Show the metric name in the tooltip for count metrics (e.g. "4 bezoekers").
    const sparkUnit = s.fmt === "int" ? (widget.title || "").toLowerCase() : "";
    return (
      <KpiCard
        label={widget.title}
        value={fmtScalar(s.value, s.fmt)}
        sparkValues={spark}
        sparkLabels={seriesDates}
        sparkUnit={sparkUnit}
        sparkColor="var(--c-accent)"
        {...delta}
      />
    );
  }

  if (widget.kind === "area") {
    const s = src.series(data);
    return (
      <SectionCard title={widget.title} style={{ height: "100%" }}>
        <AreaChart
          values={s.values}
          compareValues={s.compareValues}
          labels={s.labels.map(shortDate)}
          unit="sessies"
          height={232}
        />
      </SectionCard>
    );
  }

  if (widget.kind === "donut") {
    const segs = src.breakdown(data, widget.config);
    const total = segs.reduce((a, x) => a + (x.value ?? x.sessions ?? 0), 0);
    return (
      <SectionCard title={widget.title} style={{ height: "100%" }}>
        {segs.length === 0 ? (
          <Empty />
        ) : (
          <>
            <Donut segments={segs} centerTop={num(total)} centerSub={src.unit ?? "sessies"} />
            <div style={{ marginTop: 14 }}>
              <Legend segments={segs} />
            </div>
          </>
        )}
      </SectionCard>
    );
  }

  if (widget.kind === "bars") {
    const rows = src.breakdown(data, widget.config);
    return (
      <SectionCard title={widget.title} style={{ height: "100%" }}>
        {rows.length === 0 ? (
          <Empty />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 4 }}>
            {rows.map((r, i) => (
              <ProgressRow
                key={i}
                label={r.label}
                value={num(r.value ?? r.sessions)}
                pct={r.pct}
                color={palette[i % palette.length]}
                labelWidth={120}
              />
            ))}
          </div>
        )}
      </SectionCard>
    );
  }

  if (widget.kind === "table") {
    const { columns, rows } = src.table(data, widget.config);
    return (
      <SectionCard title={widget.title} style={{ height: "100%" }}>
        {rows.length === 0 ? (
          <Empty />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  {columns.map((c, i) => (
                    <th
                      key={i}
                      style={{
                        textAlign: i === 0 ? "left" : "right",
                        color: "var(--c-muted)",
                        fontWeight: 600,
                        fontSize: 12,
                        padding: "6px 8px",
                        borderBottom: "1px solid var(--c-track)",
                      }}
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, ri) => (
                  <tr key={ri}>
                    {r.map((cell, ci) => (
                      <td
                        key={ci}
                        style={{
                          textAlign: ci === 0 ? "left" : "right",
                          padding: "7px 8px",
                          borderBottom: "1px solid var(--c-track)",
                          fontWeight: ci === 0 ? 500 : 700,
                          maxWidth: ci === 0 ? 260 : "none",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    );
  }

  return <SectionCard title={widget.title}>Onbekend widgettype.</SectionCard>;
}

function Empty() {
  return (
    <div style={{ padding: "24px 0", display: "grid", placeItems: "center", color: "var(--c-muted)", fontSize: 13 }}>
      geen data in deze periode
    </div>
  );
}
