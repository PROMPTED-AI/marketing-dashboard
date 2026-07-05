// Catalogus voor het WooCommerce-kanaal (webshop: omzet, bestellingen, producten).

import { num } from "../format.js";
import { seriesDatesFrom } from "./kit.js";

const eur = (v) => "€ " + new Intl.NumberFormat("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v || 0);

const STATUS_LABELS = {
  completed: "Afgerond", processing: "In behandeling", refunded: "Terugbetaald",
  cancelled: "Geannuleerd", pending: "In afwachting", failed: "Mislukt", "on-hold": "On hold",
};
const statusLabel = (s) => STATUS_LABELS[s] || s;

const seriesOf = (d, key) => (d?.by_date ?? []).map((r) => r[key] ?? 0);

export const SOURCES = {
  // --- kerncijfers ---
  revenue: {
    label: "Omzet", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.kpis?.revenue ?? 0, display: eur(d?.kpis?.revenue), delta: d?.deltas?.revenue, higherBetter: true }),
    spark: (d) => seriesOf(d, "revenue"),
  },
  orders: {
    label: "Bestellingen", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.kpis?.orders ?? 0, fmt: "int", delta: d?.deltas?.orders, higherBetter: true }),
    spark: (d) => seriesOf(d, "orders"),
  },
  avgOrderValue: {
    label: "Gem. orderwaarde", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.kpis?.avgOrderValue ?? 0, display: eur(d?.kpis?.avgOrderValue), delta: d?.deltas?.avgOrderValue, higherBetter: true }),
  },
  itemsSold: {
    label: "Artikelen verkocht", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.kpis?.itemsSold ?? 0, fmt: "int", delta: d?.deltas?.itemsSold, higherBetter: true }),
  },
  customers: {
    label: "Klanten", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.kpis?.customers ?? 0, fmt: "int", delta: d?.deltas?.customers, higherBetter: true }),
  },
  refunded: {
    label: "Terugbetaald", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.kpis?.refunded ?? 0, display: eur(d?.kpis?.refunded), higherBetter: false }),
  },

  // --- over tijd ---
  revenue_by_date: {
    label: "Omzet over tijd", group: "timeseries", kinds: ["area"], unit: "omzet",
    series: (d) => ({ values: seriesOf(d, "revenue"), unit: "omzet" }),
  },
  orders_by_date: {
    label: "Bestellingen over tijd", group: "timeseries", kinds: ["area"], unit: "bestellingen",
    series: (d) => ({ values: seriesOf(d, "orders"), unit: "bestellingen" }),
  },

  // --- verdelingen ---
  statuses: {
    label: "Orderstatussen", group: "breakdown", kinds: ["donut", "bars", "table"], unit: "orders",
    breakdown: (d) => (d?.statuses ?? []).map((r) => ({ ...r, label: statusLabel(r.label) })),
  },
  payment_methods: {
    label: "Betaalmethoden", group: "breakdown", kinds: ["donut", "bars", "table"], unit: "orders",
    breakdown: (d) => d?.payment_methods ?? [],
  },

  // --- tabellen ---
  top_products: {
    label: "Bestverkochte producten", group: "table", kinds: ["table"],
    table: (d) => ({
      columns: ["Product", "Aantal", "Omzet"],
      rows: (d?.top_products ?? []).map((p) => [p.name, num(p.qty), eur(p.revenue)]),
    }),
  },
  recent_orders: {
    label: "Recente bestellingen", group: "table", kinds: ["table"],
    table: (d) => ({
      columns: ["Order", "Datum", "Status", "Betaling", "Bedrag"],
      rows: (d?.recent_orders ?? []).map((o) => [`#${o.id}`, o.date, statusLabel(o.status), o.payment, eur(o.total)]),
    }),
  },
};

export const GROUPS = [
  { label: "Kerncijfers", ids: ["revenue", "orders", "avgOrderValue", "itemsSold", "customers", "refunded"] },
  { label: "Over tijd", ids: ["revenue_by_date", "orders_by_date"] },
  { label: "Verdelingen", ids: ["statuses", "payment_methods"] },
  { label: "Tabellen", ids: ["top_products", "recent_orders"] },
];

export const TEMPLATES = [
  {
    id: "shop-overview", name: "Winkel-overzicht", audience: "Directie",
    description: "Omzet, bestellingen, orderwaarde en klanten met de omzettrend en topproducten.",
    widgets: [
      { source: "revenue", kind: "kpi", size: 3 },
      { source: "orders", kind: "kpi", size: 3 },
      { source: "avgOrderValue", kind: "kpi", size: 3 },
      { source: "customers", kind: "kpi", size: 3 },
      { source: "revenue_by_date", kind: "area", size: 12 },
      { source: "top_products", kind: "table", size: 8 },
      { source: "statuses", kind: "donut", size: 4 },
    ],
  },
  {
    id: "shop-products", name: "Producten & betalingen", audience: "Marketeer",
    description: "Wat er verkocht wordt en hoe er betaald wordt: producten, betaalmethoden en recente orders.",
    widgets: [
      { source: "itemsSold", kind: "kpi", size: 4 },
      { source: "orders", kind: "kpi", size: 4 },
      { source: "refunded", kind: "kpi", size: 4 },
      { source: "top_products", kind: "table", size: 6 },
      { source: "payment_methods", kind: "donut", size: 6 },
      { source: "orders_by_date", kind: "area", size: 12 },
      { source: "recent_orders", kind: "table", size: 12 },
    ],
  },
  {
    id: "shop-full", name: "Alles (volledig)", audience: "Specialist",
    description: "Alle beschikbare webshopblokken.",
    widgets: [
      { source: "revenue", kind: "kpi", size: 3 },
      { source: "orders", kind: "kpi", size: 3 },
      { source: "avgOrderValue", kind: "kpi", size: 3 },
      { source: "itemsSold", kind: "kpi", size: 3 },
      { source: "customers", kind: "kpi", size: 3 },
      { source: "refunded", kind: "kpi", size: 3 },
      { source: "revenue_by_date", kind: "area", size: 6 },
      { source: "orders_by_date", kind: "area", size: 6 },
      { source: "statuses", kind: "donut", size: 4 },
      { source: "payment_methods", kind: "bars", size: 8 },
      { source: "top_products", kind: "table", size: 6 },
      { source: "recent_orders", kind: "table", size: 6 },
    ],
  },
];

export const woocommerceCatalog = {
  key: "woocommerce",
  label: "WooCommerce",
  SOURCES, GROUPS, TEMPLATES,
  seriesDates: (d) => seriesDatesFrom(d?.by_date ?? []),
};
