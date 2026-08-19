import { useMemo, useState } from "react";
import { useActiveOrg } from "../../lib/ActiveOrgProvider.jsx";
import { useDateRange } from "../../lib/PeriodProvider.jsx";
import { useCachedApi } from "../../lib/swr.js";
import { wcReportUrl } from "../../lib/urls.js";
import { TabState } from "../../components/ui.jsx";
import WidgetRenderer from "../../components/WidgetRenderer.jsx";
import WidgetErrorBoundary from "../../components/WidgetErrorBoundary.jsx";
import ExportButton from "../../components/ExportButton.jsx";
import { WooGlyph } from "../../components/icons.jsx";
import { woocommerceCatalog } from "../../lib/widgets/index.js";
import { instantiateTemplate } from "../../lib/widgets/kit.js";

// De vaste views op het WooCommerce-tabblad = de kant-en-klare templates uit de
// catalogus, gerenderd tegen de rapportpayload. Voor een eigen indeling is er
// het WooCommerce-kanaal onder "Mijn dashboards".
const VIEWS = woocommerceCatalog.TEMPLATES.map((t) => ({ id: t.id, name: t.name, tpl: t }));

export default function WooCommerce() {
  const { orgId } = useActiveOrg();
  const { start, end, compare, label } = useDateRange();
  const { data, loading, error } = useCachedApi(wcReportUrl(start, end, compare, orgId));
  const [view, setView] = useState(() => localStorage.getItem("kompas-woo-view") || VIEWS[0].id);
  const pickView = (id) => { setView(id); localStorage.setItem("kompas-woo-view", id); };

  const activeView = VIEWS.find((v) => v.id === view) || VIEWS[0];
  const widgets = useMemo(() => instantiateTemplate(woocommerceCatalog, activeView.tpl).widgets, [activeView.id]);

  const sections = () => data?.kpis ? [
    { title: "WooCommerce · " + label },
    { columns: ["Metric", "Waarde"], rows: [
      ["Omzet", (data.kpis.revenue || 0).toFixed(2)],
      ["Bestellingen", data.kpis.orders],
      ["Gem. orderwaarde", (data.kpis.avgOrderValue || 0).toFixed(2)],
      ["Artikelen", data.kpis.itemsSold],
      ["Klanten", data.kpis.customers],
    ] },
    { title: "Topproducten", columns: ["Product", "Aantal", "Omzet"], rows: (data.top_products || []).map((p) => [p.name, p.qty, (p.revenue || 0).toFixed(2)]) },
  ] : [];

  return (
    <div>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: "#F3EDFA", display: "flex", alignItems: "center", justifyContent: "center" }}><WooGlyph s={20} /></div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.1 }}>WooCommerce</div>
            <div style={{ fontSize: 11.5, color: "var(--c-muted)" }}>Webshop: omzet, bestellingen en producten</div>
          </div>
        </div>
        <div style={{ flex: 1 }} />
        {data?.is_demo && (
          <span className="pill accent" style={{ padding: "7px 13px", fontSize: 12.5 }}>demowinkel</span>
        )}
        {data && <ExportButton filename="woocommerce" sections={sections} />}
      </div>

      <div className="display" style={{ fontSize: 28, marginBottom: 4 }}>woocommerce</div>
      <div style={{ fontSize: 13, color: "var(--c-muted)", marginBottom: 16 }}>{label} · live via je WooCommerce-koppeling</div>

      {/* view-switcher */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
        {VIEWS.map((v) => {
          const on = v.id === view;
          return (
            <button
              key={v.id}
              className="pill-btn"
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

      <TabState loading={loading && !data} error={error} onConnect />
      {!error && data && (
        <div className="widget-grid" style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 16 }}>
          {widgets.map((w) => (
            <div key={w.id} className="widget-cell" style={{ gridColumn: `span ${w.size}`, minWidth: 0 }}>
              <WidgetErrorBoundary title={w.title} resetKey={w.kind + "|" + w.source}>
                <WidgetRenderer widget={w} data={data} catalog={woocommerceCatalog} />
              </WidgetErrorBoundary>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
