// Catalogus voor het META Ads-kanaal (Facebook/Instagram betaalde advertenties).
//
// Bedragen staan in de valuta van het advertentieaccount; die komt via de
// render-context (`ctx.currency`) binnen, omdat hij per account verschilt.

import { num, pct1 } from "../format.js";
import { seriesDatesFrom, toBreakdown } from "./kit.js";

const money = (v, ctx) =>
  new Intl.NumberFormat("nl-NL", ctx?.currency
    ? { style: "currency", currency: ctx.currency }
    : { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v || 0);
const dec2 = (v) => (v || 0).toFixed(2).replace(".", ",");
const roasStr = (v) => (v || 0).toFixed(2).replace(".", ",") + "×";

const STATUS = { ACTIVE: "actief", PAUSED: "gepauzeerd", ARCHIVED: "gearchiveerd", DELETED: "verwijderd" };
const statusLabel = (s) => (s ? STATUS[s] || s.toLowerCase() : "—");

const seriesOf = (d, key) => (d?.by_date ?? []).map((r) => r[key] ?? 0);

export const SOURCES = {
  // --- kerncijfers ---
  spend: {
    label: "Uitgaven", group: "scalar", kinds: ["kpi"],
    scalar: (d, _c, ctx) => ({ value: d?.kpis?.spend ?? 0, display: money(d?.kpis?.spend, ctx), delta: d?.deltas?.spend, higherBetter: false }),
    spark: (d) => seriesOf(d, "spend"),
  },
  reach: {
    label: "Bereik", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.kpis?.reach ?? 0, fmt: "int", delta: d?.deltas?.reach, higherBetter: true }),
    spark: (d) => seriesOf(d, "reach"),
  },
  impressions: {
    label: "Vertoningen", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.kpis?.impressions ?? 0, fmt: "int", delta: d?.deltas?.impressions, higherBetter: true }),
    spark: (d) => seriesOf(d, "impressions"),
  },
  frequency: {
    label: "Frequentie", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.kpis?.frequency ?? 0, display: dec2(d?.kpis?.frequency), higherBetter: false }),
  },
  clicks: {
    label: "Klikken", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.kpis?.clicks ?? 0, fmt: "int", delta: d?.deltas?.clicks, higherBetter: true }),
    spark: (d) => seriesOf(d, "clicks"),
  },
  linkClicks: {
    label: "Linkkliks", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.kpis?.linkClicks ?? 0, fmt: "int", higherBetter: true }),
  },
  ctr: {
    label: "CTR", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.kpis?.ctr ?? 0, fmt: "percent", delta: d?.deltas?.ctr, higherBetter: true }),
  },
  cpc: {
    label: "CPC", group: "scalar", kinds: ["kpi"],
    scalar: (d, _c, ctx) => ({ value: d?.kpis?.cpc ?? 0, display: money(d?.kpis?.cpc, ctx), delta: d?.deltas?.cpc, higherBetter: false }),
  },
  cpm: {
    label: "CPM", group: "scalar", kinds: ["kpi"],
    scalar: (d, _c, ctx) => ({ value: d?.kpis?.cpm ?? 0, display: money(d?.kpis?.cpm, ctx), delta: d?.deltas?.cpm, higherBetter: false }),
  },

  // --- over tijd ---
  spend_by_date: {
    label: "Uitgaven over tijd", group: "timeseries", kinds: ["area"], unit: "uitgaven",
    series: (d) => ({ values: seriesOf(d, "spend"), unit: "uitgaven" }),
  },
  reach_by_date: {
    label: "Bereik over tijd", group: "timeseries", kinds: ["area"], unit: "bereik",
    series: (d) => ({ values: seriesOf(d, "reach"), unit: "bereik" }),
  },
  impressions_by_date: {
    label: "Vertoningen over tijd", group: "timeseries", kinds: ["area"], unit: "vertoningen",
    series: (d) => ({ values: seriesOf(d, "impressions"), unit: "vertoningen" }),
  },
  clicks_by_date: {
    label: "Klikken over tijd", group: "timeseries", kinds: ["area"], unit: "klikken",
    series: (d) => ({ values: seriesOf(d, "clicks"), unit: "klikken" }),
  },

  // --- verdelingen ---
  spend_share: {
    label: "Aandeel uitgaven (campagnes)", group: "breakdown", kinds: ["donut", "bars", "table"], unit: "uitgaven",
    breakdown: (d) => toBreakdown((d?.campaigns ?? []).slice(0, 8), { label: (c) => c.name, value: (c) => c.spend }),
  },
  results_by_goal: {
    label: "Resultaten per doel", group: "breakdown", kinds: ["donut", "bars", "table"], unit: "resultaten",
    breakdown: (d) => toBreakdown(d?.results, { label: (r) => r.goal, value: (r) => r.count }),
  },

  // --- tabellen ---
  results: {
    label: "Resultaten per conversiedoel", group: "table", kinds: ["table"],
    table: (d, _c, ctx) => ({
      columns: ["Doel", "Aantal", "Waarde", "ROAS", "CPA"],
      rows: (d?.results ?? []).map((r) => [r.goal, num(r.count), money(r.value, ctx), roasStr(r.roas), money(r.cpa, ctx)]),
    }),
  },
  campaigns: {
    label: "Campagnes", group: "table", kinds: ["table"],
    table: (d, _c, ctx) => ({
      columns: ["Campagne", "Doelstelling", "Status", "Uitgaven", "Klikken", "CTR", "Resultaten"],
      rows: (d?.campaigns ?? []).map((c) => [c.name, c.objective || "—", statusLabel(c.status), money(c.spend, ctx), num(c.clicks), pct1(c.ctr), num(c.results)]),
    }),
  },
};

export const GROUPS = [
  { label: "Kerncijfers", ids: ["spend", "reach", "impressions", "frequency", "clicks", "linkClicks", "ctr", "cpc", "cpm"] },
  { label: "Over tijd", ids: ["spend_by_date", "reach_by_date", "impressions_by_date", "clicks_by_date"] },
  { label: "Verdelingen", ids: ["spend_share", "results_by_goal"] },
  { label: "Tabellen", ids: ["results", "campaigns"] },
];

export const TEMPLATES = [
  {
    id: "meta-ads-overview", name: "Betaald-overzicht", audience: "Directie",
    description: "Uitgaven, bereik, klikken en CTR met de uitgaventrend en resultaten per doel.",
    widgets: [
      { source: "spend", kind: "kpi", size: 3 },
      { source: "reach", kind: "kpi", size: 3 },
      { source: "clicks", kind: "kpi", size: 3 },
      { source: "ctr", kind: "kpi", size: 3 },
      { source: "spend_by_date", kind: "area", size: 12 },
      { source: "results", kind: "table", size: 8 },
      { source: "spend_share", kind: "donut", size: 4 },
    ],
  },
  {
    id: "meta-ads-campaigns", name: "Campagnes", audience: "Marketeer",
    description: "Alle campagnes met uitgaven, klikken, CTR en resultaten, plus het uitgaven-aandeel.",
    widgets: [
      { source: "spend", kind: "kpi", size: 3 },
      { source: "cpc", kind: "kpi", size: 3 },
      { source: "cpm", kind: "kpi", size: 3 },
      { source: "frequency", kind: "kpi", size: 3 },
      { source: "campaigns", kind: "table", size: 12 },
      { source: "spend_share", kind: "bars", size: 12 },
    ],
  },
  {
    id: "meta-ads-conversion", name: "Conversie & ROAS", audience: "Marketeer",
    description: "Rendement per conversiedoel met ROAS en CPA.",
    widgets: [
      { source: "spend", kind: "kpi", size: 4 },
      { source: "reach", kind: "kpi", size: 4 },
      { source: "ctr", kind: "kpi", size: 4 },
      { source: "results", kind: "table", size: 8 },
      { source: "results_by_goal", kind: "donut", size: 4 },
    ],
  },
];

export const metaAdsCatalog = {
  key: "meta-ads",
  label: "META Ads",
  SOURCES, GROUPS, TEMPLATES,
  seriesDates: (d) => seriesDatesFrom(d?.by_date ?? []),
};
