// Catalogus voor het Google Ads-kanaal (betaald zoeken).

import { num, pct1 } from "../format.js";
import { seriesDatesFrom, toBreakdown } from "./kit.js";

const eur = (v) => "€ " + new Intl.NumberFormat("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v || 0);
const roasStr = (v) => (v || 0).toFixed(2).replace(".", ",") + "×";
const cpm = (k) => (k?.impressions ? (k.cost / k.impressions) * 1000 : 0);
const cpa = (cost, conv) => (conv ? cost / conv : 0);

const seriesOf = (d, key) => (d?.by_date ?? []).map((r) => r[key] ?? 0);

export const SOURCES = {
  // --- kerncijfers ---
  cost: {
    label: "Kosten", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.kpis?.cost ?? 0, display: eur(d?.kpis?.cost), delta: d?.deltas?.cost, higherBetter: false }),
    spark: (d) => seriesOf(d, "cost"),
  },
  clicks: {
    label: "Klikken", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.kpis?.clicks ?? 0, fmt: "int", delta: d?.deltas?.clicks, higherBetter: true }),
    spark: (d) => seriesOf(d, "clicks"),
  },
  impressions: {
    label: "Vertoningen", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.kpis?.impressions ?? 0, fmt: "int", delta: d?.deltas?.impressions, higherBetter: true }),
    spark: (d) => seriesOf(d, "impressions"),
  },
  conversions: {
    label: "Conversies", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.kpis?.conversions ?? 0, fmt: "int", delta: d?.deltas?.conversions, higherBetter: true }),
    spark: (d) => seriesOf(d, "conversions"),
  },
  conversionsValue: {
    label: "Conversiewaarde", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.kpis?.conversionsValue ?? 0, display: eur(d?.kpis?.conversionsValue), delta: d?.deltas?.conversionsValue, higherBetter: true }),
  },
  ctr: {
    label: "CTR", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.kpis?.ctr ?? 0, fmt: "percent", delta: d?.deltas?.ctr, higherBetter: true }),
  },
  cpc: {
    label: "CPC", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.kpis?.cpc ?? 0, display: eur(d?.kpis?.cpc), delta: d?.deltas?.cpc, higherBetter: false }),
  },
  cpm: {
    label: "CPM", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: cpm(d?.kpis), display: eur(cpm(d?.kpis)), delta: d?.deltas?.cpm, higherBetter: false }),
  },
  cpa: {
    label: "CPA (kosten/conversie)", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: cpa(d?.kpis?.cost, d?.kpis?.conversions), display: eur(cpa(d?.kpis?.cost, d?.kpis?.conversions)), higherBetter: false }),
  },
  roas: {
    label: "ROAS", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.kpis?.roas ?? 0, display: roasStr(d?.kpis?.roas), delta: d?.deltas?.roas, higherBetter: true }),
  },

  // --- over tijd ---
  cost_by_date: {
    label: "Kosten over tijd", group: "timeseries", kinds: ["area"], unit: "kosten",
    series: (d) => ({ values: seriesOf(d, "cost"), unit: "kosten" }),
  },
  clicks_by_date: {
    label: "Klikken over tijd", group: "timeseries", kinds: ["area"], unit: "klikken",
    series: (d) => ({ values: seriesOf(d, "clicks"), unit: "klikken" }),
  },
  impressions_by_date: {
    label: "Vertoningen over tijd", group: "timeseries", kinds: ["area"], unit: "vertoningen",
    series: (d) => ({ values: seriesOf(d, "impressions"), unit: "vertoningen" }),
  },
  conversions_by_date: {
    label: "Conversies over tijd", group: "timeseries", kinds: ["area"], unit: "conversies",
    series: (d) => ({ values: seriesOf(d, "conversions"), unit: "conversies" }),
  },

  // --- verdelingen ---
  spend_share: {
    label: "Aandeel uitgaven (campagnes)", group: "breakdown", kinds: ["donut", "bars", "table"], unit: "kosten",
    breakdown: (d) => toBreakdown((d?.campaigns ?? []).slice(0, 8), { label: (c) => c.name, value: (c) => c.cost }),
  },

  // --- tabellen ---
  campaigns: {
    label: "Campagnes", group: "table", kinds: ["table"],
    table: (d) => ({
      columns: ["Campagne", "Kosten", "Klikken", "CTR", "Conversies", "ROAS"],
      rows: (d?.campaigns ?? []).map((c) => [c.name, eur(c.cost), num(c.clicks), pct1(c.ctr), num(c.conversions), roasStr(c.roas)]),
    }),
  },
  campaigns_efficiency: {
    label: "Efficiëntie per campagne", group: "table", kinds: ["table"],
    table: (d) => ({
      columns: ["Campagne", "Kosten", "Conversies", "CPA", "CTR"],
      rows: [...(d?.campaigns ?? [])].sort((a, b) => (b.cost || 0) - (a.cost || 0))
        .map((c) => [c.name, eur(c.cost), num(c.conversions), eur(cpa(c.cost, c.conversions)), pct1(c.ctr)]),
    }),
  },
};

export const GROUPS = [
  { label: "Kerncijfers", ids: ["cost", "clicks", "impressions", "conversions", "conversionsValue", "ctr", "cpc", "cpm", "cpa", "roas"] },
  { label: "Over tijd", ids: ["cost_by_date", "clicks_by_date", "impressions_by_date", "conversions_by_date"] },
  { label: "Verdelingen", ids: ["spend_share"] },
  { label: "Tabellen", ids: ["campaigns", "campaigns_efficiency"] },
];

export const TEMPLATES = [
  {
    id: "ads-overview", name: "Ads-overzicht", audience: "Directie",
    description: "Kosten, klikken, conversies en ROAS met de kostentrend en campagnes.",
    widgets: [
      { source: "cost", kind: "kpi", size: 3 },
      { source: "clicks", kind: "kpi", size: 3 },
      { source: "conversions", kind: "kpi", size: 3 },
      { source: "roas", kind: "kpi", size: 3 },
      { source: "cost_by_date", kind: "area", size: 12 },
      { source: "spend_share", kind: "donut", size: 4 },
      { source: "campaigns", kind: "table", size: 8 },
    ],
  },
  {
    id: "ads-efficiency", name: "Efficiëntie & budget", audience: "Marketeer",
    description: "Waar het budget naartoe gaat: CTR, CPC, CPM, CPA en campagne-efficiëntie.",
    widgets: [
      { source: "ctr", kind: "kpi", size: 3 },
      { source: "cpc", kind: "kpi", size: 3 },
      { source: "cpm", kind: "kpi", size: 3 },
      { source: "cpa", kind: "kpi", size: 3 },
      { source: "cost_by_date", kind: "area", size: 12 },
      { source: "campaigns_efficiency", kind: "table", size: 12 },
    ],
  },
  {
    id: "ads-conversion", name: "Conversie & ROAS", audience: "Marketeer",
    description: "Sturen op rendement: conversies, conversiewaarde en ROAS per campagne.",
    widgets: [
      { source: "conversions", kind: "kpi", size: 4 },
      { source: "conversionsValue", kind: "kpi", size: 4 },
      { source: "roas", kind: "kpi", size: 4 },
      { source: "conversions_by_date", kind: "area", size: 12 },
      { source: "campaigns", kind: "table", size: 12 },
    ],
  },
];

export const googleAdsCatalog = {
  key: "google-ads",
  label: "Google Ads",
  SOURCES, GROUPS, TEMPLATES,
  seriesDates: (d) => seriesDatesFrom(d?.by_date ?? []),
};
