import { useActiveOrg } from "../../lib/ActiveOrgProvider.jsx";
import { useDateRange } from "../../lib/PeriodProvider.jsx";
import { useCachedApi } from "../../lib/swr.js";
import { shopifyReportUrl } from "../../lib/urls.js";
import { TabState } from "../../components/ui.jsx";
import ExportButton from "../../components/ExportButton.jsx";
import { ShopifyGlyph } from "../../components/icons.jsx";

const eur = (v) => "€ " + (Number(v) || 0).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (v) => (Number(v) || 0).toLocaleString("nl-NL");
const pct = (v) => (v === null || v === undefined ? null : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);

// Shopify-tabblad: KPI-kaarten, topproducten en recente orders uit de
// Admin-API-koppeling. Bewust een eigen, compacte weergave (geen widget-editor);
// de dagreeks en vergelijking komen uit de gedeelde periodekiezer.
export default function Shopify() {
  const { orgId } = useActiveOrg();
  const { start, end, compare, label } = useDateRange();
  const { data, loading, error } = useCachedApi(shopifyReportUrl(start, end, compare, orgId));
  const k = data?.kpis;
  const d = data?.deltas || {};

  const kpis = k ? [
    { label: "Omzet", value: eur(k.revenue), delta: d.revenue },
    { label: "Bestellingen", value: num(k.orders), delta: d.orders },
    { label: "Gem. orderwaarde", value: eur(k.avgOrderValue), delta: d.avgOrderValue },
    { label: "Artikelen verkocht", value: num(k.itemsSold), delta: d.itemsSold },
    { label: "Klanten", value: num(k.customers), delta: d.customers },
    { label: "Terugbetaald", value: eur(k.refunded) },
  ] : [];

  const sections = () => k ? [
    { title: "Shopify · " + label },
    { columns: ["Metric", "Waarde"], rows: [
      ["Omzet", (k.revenue || 0).toFixed(2)], ["Bestellingen", k.orders],
      ["Gem. orderwaarde", (k.avgOrderValue || 0).toFixed(2)],
      ["Artikelen", k.itemsSold], ["Klanten", k.customers], ["Terugbetaald", (k.refunded || 0).toFixed(2)],
    ] },
    { title: "Topproducten", columns: ["Product", "Aantal", "Omzet"], rows: (data.top_products || []).map((p) => [p.name, p.qty, (p.revenue || 0).toFixed(2)]) },
  ] : [];

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: "#EAF5E1", display: "flex", alignItems: "center", justifyContent: "center" }}><ShopifyGlyph s={20} /></div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.1 }}>Shopify</div>
            <div style={{ fontSize: 11.5, color: "var(--c-muted)" }}>{data?.shop || "Webshop: omzet, bestellingen en producten"}</div>
          </div>
        </div>
        <div style={{ flex: 1 }} />
        {data && k && <ExportButton filename="shopify" sections={sections} />}
      </div>

      <div className="display" style={{ fontSize: 28, marginBottom: 4 }}>shopify</div>
      <div style={{ fontSize: 13, color: "var(--c-muted)", marginBottom: 18 }}>{label} · live via je Shopify-koppeling</div>

      <TabState loading={loading && !data} error={error} onConnect />
      {!error && data && k && (
        <>
          <div className="split-3" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 20 }}>
            {kpis.map((kpi) => (
              <div key={kpi.label} className="card" style={{ padding: 18 }}>
                <div style={{ fontSize: 12.5, color: "var(--c-muted)", fontWeight: 600 }}>{kpi.label}</div>
                <div className="display" style={{ fontSize: 26, marginTop: 6 }}>{kpi.value}</div>
                {pct(kpi.delta) && (
                  <div style={{ fontSize: 12, fontWeight: 700, marginTop: 4, color: kpi.delta >= 0 ? "var(--c-pos)" : "var(--c-neg)" }}>
                    {pct(kpi.delta)} t.o.v. vorige periode
                  </div>
                )}
              </div>
            ))}
          </div>

          {(data.top_products || []).length > 0 && (
            <div className="card" style={{ overflow: "hidden", marginBottom: 20 }}>
              <div style={rowHead}><span>Topproduct</span><span style={{ textAlign: "right" }}>Aantal</span><span style={{ textAlign: "right" }}>Omzet</span></div>
              {data.top_products.map((p, i) => (
                <div key={i} style={row}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 }}>{p.name}</span>
                  <span style={{ textAlign: "right" }}>{num(p.qty)}</span>
                  <span style={{ textAlign: "right" }}>{eur(p.revenue)}</span>
                </div>
              ))}
            </div>
          )}

          {(data.recent_orders || []).length > 0 && (
            <div className="card" style={{ overflow: "hidden" }}>
              <div style={{ ...rowHead, gridTemplateColumns: "1fr 1.2fr 1fr" }}><span>Recente order</span><span>Status</span><span style={{ textAlign: "right" }}>Totaal</span></div>
              {data.recent_orders.map((o) => (
                <div key={o.id} style={{ ...row, gridTemplateColumns: "1fr 1.2fr 1fr" }}>
                  <span style={{ color: "var(--c-muted)" }}>{o.date}</span>
                  <span>{o.status || "—"}</span>
                  <span style={{ textAlign: "right", fontWeight: 600 }}>{eur(o.total)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const rowHead = { display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 12, padding: "12px 18px", fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--c-muted)", borderBottom: "1px solid var(--c-border)", background: "var(--c-surface-2)" };
const row = { display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 12, padding: "11px 18px", borderBottom: "1px solid var(--c-border-soft)", fontSize: 13.5, alignItems: "center" };
