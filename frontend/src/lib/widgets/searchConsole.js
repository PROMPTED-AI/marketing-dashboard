// Catalogus voor het Search Console-kanaal (SEO / organisch zoekverkeer).

import { num, pct1 } from "../format.js";
import { seriesDatesFrom, toBreakdown } from "./kit.js";

const posStr = (v) => (v || 0).toFixed(1).replace(".", ",");

const DEVICE_LABELS = { DESKTOP: "Desktop", MOBILE: "Mobiel", TABLET: "Tablet" };
const deviceLabel = (d) => DEVICE_LABELS[d] || (d ? d[0] + d.slice(1).toLowerCase() : "—");

const COUNTRY_LABELS = {
  nld: "Nederland", bel: "België", deu: "Duitsland", usa: "Verenigde Staten", gbr: "Verenigd Koninkrijk",
  fra: "Frankrijk", esp: "Spanje", ita: "Italië", pol: "Polen", tur: "Turkije", mar: "Marokko",
  bra: "Brazilië", ind: "India", che: "Zwitserland", aut: "Oostenrijk", swe: "Zweden", nor: "Noorwegen",
  dnk: "Denemarken", irl: "Ierland", prt: "Portugal", can: "Canada", aus: "Australië",
};
const countryLabel = (c) => COUNTRY_LABELS[c] || (c || "—").toUpperCase();

const seriesOf = (d, key) => (d?.by_date ?? []).map((r) => (key === "ctr" ? (r.ctr || 0) * 100 : r[key] ?? 0));

const queryRows = (rows) => ({
  columns: ["Zoekopdracht", "Klikken", "Vertoningen", "CTR", "Positie"],
  rows: (rows ?? []).map((r) => [r.query, num(r.clicks), num(r.impressions), pct1((r.ctr || 0) * 100), posStr(r.position)]),
});

export const SOURCES = {
  // --- kerncijfers ---
  clicks: {
    label: "Klikken", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.totals?.clicks ?? 0, fmt: "int", delta: d?.deltas?.clicks, higherBetter: true }),
    spark: (d) => seriesOf(d, "clicks"),
  },
  impressions: {
    label: "Vertoningen", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.totals?.impressions ?? 0, fmt: "int", delta: d?.deltas?.impressions, higherBetter: true }),
    spark: (d) => seriesOf(d, "impressions"),
  },
  ctr: {
    label: "Gem. CTR", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: (d?.totals?.ctr ?? 0) * 100, fmt: "percent", delta: d?.deltas?.ctr, higherBetter: true }),
    spark: (d) => seriesOf(d, "ctr"),
  },
  position: {
    label: "Gem. positie", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.totals?.position ?? 0, display: posStr(d?.totals?.position), delta: d?.deltas?.position, higherBetter: false }),
    spark: (d) => seriesOf(d, "position"),
  },

  // --- over tijd ---
  clicks_by_date: {
    label: "Klikken over tijd", group: "timeseries", kinds: ["area"], unit: "klikken",
    series: (d) => ({ values: seriesOf(d, "clicks"), unit: "klikken" }),
  },
  impressions_by_date: {
    label: "Vertoningen over tijd", group: "timeseries", kinds: ["area"], unit: "vertoningen",
    series: (d) => ({ values: seriesOf(d, "impressions"), unit: "vertoningen" }),
  },
  ctr_by_date: {
    label: "CTR over tijd", group: "timeseries", kinds: ["area"], unit: "%",
    series: (d) => ({ values: seriesOf(d, "ctr"), unit: "%" }),
  },
  position_by_date: {
    label: "Positie over tijd", group: "timeseries", kinds: ["area"], unit: "positie",
    series: (d) => ({ values: seriesOf(d, "position"), unit: "positie" }),
  },

  // --- verdelingen ---
  devices: {
    label: "Apparaten", group: "breakdown", kinds: ["donut", "bars", "table"], unit: "klikken",
    breakdown: (d) => toBreakdown(d?.devices, { label: (r) => deviceLabel(r.device), value: (r) => r.clicks }),
  },
  countries: {
    label: "Landen", group: "breakdown", kinds: ["bars", "donut", "table"], unit: "klikken",
    breakdown: (d) => toBreakdown(d?.countries, { label: (r) => countryLabel(r.country), value: (r) => r.clicks }),
  },

  // --- tabellen ---
  top_queries: {
    label: "Top zoekopdrachten", group: "table", kinds: ["table"],
    table: (d) => queryRows(d?.top_queries),
  },
  top_pages: {
    label: "Top pagina's", group: "table", kinds: ["table"],
    table: (d) => ({
      columns: ["Pagina", "Klikken", "Vertoningen", "CTR", "Positie"],
      rows: (d?.top_pages ?? []).map((r) => [r.page, num(r.clicks), num(r.impressions), pct1((r.ctr || 0) * 100), posStr(r.position)]),
    }),
  },
  opportunities: {
    label: "Kansen (positie 11–20)", group: "table", kinds: ["table"],
    table: (d) => ({
      columns: ["Zoekopdracht", "Vertoningen", "Positie", "CTR"],
      rows: (d?.opportunities ?? []).map((r) => [r.query, num(r.impressions), posStr(r.position), pct1((r.ctr || 0) * 100)]),
    }),
  },
  by_impressions: {
    label: "Veel vertoningen, lage CTR", group: "table", kinds: ["table"],
    table: (d) => queryRows(d?.by_impressions),
  },
};

export const GROUPS = [
  { label: "Kerncijfers", ids: ["clicks", "impressions", "ctr", "position"] },
  { label: "Over tijd", ids: ["clicks_by_date", "impressions_by_date", "ctr_by_date", "position_by_date"] },
  { label: "Verdelingen", ids: ["devices", "countries"] },
  { label: "Tabellen", ids: ["top_queries", "top_pages", "opportunities", "by_impressions"] },
];

export const TEMPLATES = [
  {
    id: "seo-overview", name: "SEO-overzicht", audience: "Directie",
    description: "Klikken, vertoningen, CTR en positie met trend, apparaten en landen.",
    widgets: [
      { source: "clicks", kind: "kpi", size: 3 },
      { source: "impressions", kind: "kpi", size: 3 },
      { source: "ctr", kind: "kpi", size: 3 },
      { source: "position", kind: "kpi", size: 3 },
      { source: "clicks_by_date", kind: "area", size: 12 },
      { source: "devices", kind: "donut", size: 4 },
      { source: "countries", kind: "bars", size: 8 },
      { source: "top_queries", kind: "table", size: 12 },
    ],
  },
  {
    id: "seo-queries", name: "Zoekopdrachten & kansen", audience: "Marketeer",
    description: "Top-zoekopdrachten, kansen net buiten pagina 1 en veel-vertoonde queries met lage CTR.",
    widgets: [
      { source: "clicks", kind: "kpi", size: 4 },
      { source: "ctr", kind: "kpi", size: 4 },
      { source: "position", kind: "kpi", size: 4 },
      { source: "top_queries", kind: "table", size: 12 },
      { source: "opportunities", kind: "table", size: 6 },
      { source: "by_impressions", kind: "table", size: 6 },
    ],
  },
  {
    id: "seo-full", name: "Alles (volledig)", audience: "Specialist",
    description: "Alle beschikbare SEO-blokken.",
    widgets: [
      { source: "clicks", kind: "kpi", size: 3 },
      { source: "impressions", kind: "kpi", size: 3 },
      { source: "ctr", kind: "kpi", size: 3 },
      { source: "position", kind: "kpi", size: 3 },
      { source: "clicks_by_date", kind: "area", size: 6 },
      { source: "impressions_by_date", kind: "area", size: 6 },
      { source: "devices", kind: "donut", size: 4 },
      { source: "countries", kind: "bars", size: 8 },
      { source: "top_queries", kind: "table", size: 6 },
      { source: "top_pages", kind: "table", size: 6 },
      { source: "opportunities", kind: "table", size: 6 },
      { source: "by_impressions", kind: "table", size: 6 },
    ],
  },
];

export const searchConsoleCatalog = {
  key: "search-console",
  label: "Search Console",
  SOURCES, GROUPS, TEMPLATES,
  seriesDates: (d) => seriesDatesFrom(d?.by_date ?? []),
};
