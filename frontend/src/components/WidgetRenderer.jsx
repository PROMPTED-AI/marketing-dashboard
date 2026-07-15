// Tekent één widget tegen de payload van het actieve kanaal. Presentatie-only:
// bewerk-knoppen zitten in de grid eromheen (WidgetFrame). De juiste catalogus
// (welke bron -> welke accessor) komt als prop mee, plus een optionele
// render-context `ctx` (bijv. de valuta van een Meta-advertentieaccount).

import { num, pct1, duration, deltaProps, shortDate } from "../lib/format.js";
import { KpiCard, SectionCard, ProgressRow } from "./ui.jsx";
import { AreaChart, Donut, Legend, palette } from "./charts.jsx";

function fmtScalar(value, fmt) {
  if (fmt === "percent") return pct1(value);
  if (fmt === "duration") return duration(value);
  return num(value);
}

export default function WidgetRenderer({ widget, data, catalog, ctx }) {
  const src = catalog?.SOURCES?.[widget.source];
  if (!src) return <SectionCard title={widget.title}>Onbekende bron.</SectionCard>;

  const seriesDates = catalog.seriesDates ? catalog.seriesDates(data) : [];

  if (widget.kind === "kpi") {
    const s = src.scalar(data, widget.config, ctx);
    const delta = s.delta != null ? deltaProps(s.delta, s.higherBetter) : {};
    const rawSpark = src.spark ? src.spark(data) : null;
    const spark = rawSpark && rawSpark.length ? rawSpark : null;
    // Toon de metricnaam in de tooltip bij telbare metrics (bv. "4 bezoekers").
    const sparkUnit = s.fmt === "int" ? (widget.title || "").toLowerCase() : "";
    return (
      <KpiCard
        label={widget.title}
        value={s.display ?? fmtScalar(s.value, s.fmt)}
        sparkValues={spark}
        sparkLabels={seriesDates}
        sparkUnit={sparkUnit}
        sparkColor="var(--c-accent)"
        {...delta}
      />
    );
  }

  if (widget.kind === "area") {
    const s = src.series(data, widget.config, ctx);
    const labels = (s.labels ?? seriesDates).map((x) => (x?.length === 8 ? shortDate(x) : x));
    return (
      <SectionCard title={widget.title} style={{ height: "100%" }}>
        <AreaChart
          values={s.values}
          compareValues={s.compareValues}
          labels={labels}
          unit={s.unit ?? src.unit ?? ""}
          height={232}
        />
      </SectionCard>
    );
  }

  if (widget.kind === "donut") {
    const segs = src.breakdown(data, widget.config, ctx);
    const total = segs.reduce((a, x) => a + (x.value ?? x.sessions ?? 0), 0);
    return (
      <SectionCard title={widget.title} style={{ height: "100%" }}>
        {segs.length === 0 ? (
          <Empty />
        ) : (
          <>
            <Donut segments={segs} centerTop={num(total)} centerSub={src.unit ?? ""} />
            <div style={{ marginTop: 14 }}>
              <Legend segments={segs} />
            </div>
          </>
        )}
      </SectionCard>
    );
  }

  if (widget.kind === "bars") {
    const rows = src.breakdown(data, widget.config, ctx);
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
    // Sommige bronnen (verdelingen via `dist`) staan "table" wél toe als kind,
    // maar leveren alleen een `breakdown`-accessor. Val daar netjes op terug i.p.v.
    // te crashen op een ontbrekende `table`-functie (blank scherm).
    let columns, rows;
    if (typeof src.table === "function") {
      ({ columns, rows } = src.table(data, widget.config, ctx));
    } else if (typeof src.breakdown === "function") {
      const segs = src.breakdown(data, widget.config, ctx);
      columns = [src.label ?? "Categorie", src.unit ? src.unit : "Aantal"];
      rows = segs.map((s) => [s.label, num(s.value ?? s.sessions ?? 0)]);
    } else {
      columns = [];
      rows = [];
    }
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
