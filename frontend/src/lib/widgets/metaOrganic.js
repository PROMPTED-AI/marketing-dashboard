// Catalogus voor het META Organisch-kanaal (Facebook-pagina + Instagram).
//
// De payload bevat twee entiteiten: `facebook` en `instagram`. Bronnen lezen
// gericht uit de juiste entiteit; ontbreekt die, dan is de waarde 0/leeg.

import { num } from "../format.js";
import { seriesDatesFrom } from "./kit.js";

const growth = (v) => ((v || 0) >= 0 ? "+" : "") + num(v);
const seriesOf = (d, entity, key) => (d?.[entity]?.by_date ?? []).map((r) => r[key] ?? 0);
const datesOf = (d, entity) => seriesDatesFrom(d?.[entity]?.by_date ?? []);

const postRows = (posts) => ({
  columns: ["Post", "Datum", "Betrokkenheid"],
  rows: (posts ?? []).map((p) => [p.text || "(zonder tekst)", p.date || "—", num(p.engagement)]),
});

export const SOURCES = {
  // --- Facebook ---
  fb_followers: {
    label: "FB volgers", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.facebook?.followers ?? 0, fmt: "int", higherBetter: true }),
  },
  fb_followers_growth: {
    label: "FB volgersgroei", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.facebook?.followers_growth ?? 0, display: growth(d?.facebook?.followers_growth), higherBetter: true }),
  },
  fb_reach: {
    label: "FB bereik", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.facebook?.reach ?? 0, fmt: "int", higherBetter: true }),
    spark: (d) => seriesOf(d, "facebook", "reach"),
  },
  fb_impressions: {
    label: "FB vertoningen", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.facebook?.impressions ?? 0, fmt: "int", higherBetter: true }),
    spark: (d) => seriesOf(d, "facebook", "impressions"),
  },
  fb_engagement: {
    label: "FB betrokkenheid", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.facebook?.engagement ?? 0, fmt: "int", higherBetter: true }),
    spark: (d) => seriesOf(d, "facebook", "engagement"),
  },

  // --- Instagram ---
  ig_followers: {
    label: "IG volgers", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.instagram?.followers ?? 0, fmt: "int", higherBetter: true }),
  },
  ig_followers_growth: {
    label: "IG volgersgroei", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.instagram?.followers_growth ?? 0, display: growth(d?.instagram?.followers_growth), higherBetter: true }),
  },
  ig_reach: {
    label: "IG bereik", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.instagram?.reach ?? 0, fmt: "int", higherBetter: true }),
    spark: (d) => seriesOf(d, "instagram", "reach"),
  },
  ig_impressions: {
    label: "IG vertoningen", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.instagram?.impressions ?? 0, fmt: "int", higherBetter: true }),
    spark: (d) => seriesOf(d, "instagram", "impressions"),
  },
  ig_profile_views: {
    label: "IG profielbezoeken", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.instagram?.profile_views ?? 0, fmt: "int", higherBetter: true }),
  },

  // --- over tijd ---
  fb_reach_by_date: {
    label: "FB bereik over tijd", group: "timeseries", kinds: ["area"], unit: "bereik",
    series: (d) => ({ values: seriesOf(d, "facebook", "reach"), labels: datesOf(d, "facebook"), unit: "bereik" }),
  },
  fb_engagement_by_date: {
    label: "FB betrokkenheid over tijd", group: "timeseries", kinds: ["area"], unit: "betrokkenheid",
    series: (d) => ({ values: seriesOf(d, "facebook", "engagement"), labels: datesOf(d, "facebook"), unit: "betrokkenheid" }),
  },
  ig_reach_by_date: {
    label: "IG bereik over tijd", group: "timeseries", kinds: ["area"], unit: "bereik",
    series: (d) => ({ values: seriesOf(d, "instagram", "reach"), labels: datesOf(d, "instagram"), unit: "bereik" }),
  },
  ig_impressions_by_date: {
    label: "IG vertoningen over tijd", group: "timeseries", kinds: ["area"], unit: "vertoningen",
    series: (d) => ({ values: seriesOf(d, "instagram", "impressions"), labels: datesOf(d, "instagram"), unit: "vertoningen" }),
  },

  // --- tabellen ---
  fb_top_posts: {
    label: "FB top-posts", group: "table", kinds: ["table"],
    table: (d) => postRows(d?.facebook?.top_posts),
  },
  ig_top_posts: {
    label: "IG top-posts", group: "table", kinds: ["table"],
    table: (d) => postRows(d?.instagram?.top_posts),
  },
};

export const GROUPS = [
  { label: "Facebook", ids: ["fb_followers", "fb_followers_growth", "fb_reach", "fb_impressions", "fb_engagement"] },
  { label: "Instagram", ids: ["ig_followers", "ig_followers_growth", "ig_reach", "ig_impressions", "ig_profile_views"] },
  { label: "Over tijd", ids: ["fb_reach_by_date", "fb_engagement_by_date", "ig_reach_by_date", "ig_impressions_by_date"] },
  { label: "Tabellen", ids: ["fb_top_posts", "ig_top_posts"] },
];

export const TEMPLATES = [
  {
    id: "organic-overview", name: "Organisch-overzicht", audience: "Directie",
    description: "Volgers, groei, bereik en betrokkenheid voor Facebook en Instagram.",
    widgets: [
      { source: "fb_followers", kind: "kpi", size: 3 },
      { source: "fb_reach", kind: "kpi", size: 3 },
      { source: "ig_followers", kind: "kpi", size: 3 },
      { source: "ig_reach", kind: "kpi", size: 3 },
      { source: "fb_reach_by_date", kind: "area", size: 6 },
      { source: "ig_reach_by_date", kind: "area", size: 6 },
      { source: "fb_top_posts", kind: "table", size: 6 },
      { source: "ig_top_posts", kind: "table", size: 6 },
    ],
  },
  {
    id: "organic-facebook", name: "Facebook", audience: "Marketeer",
    description: "Facebook-pagina: volgers, groei, bereik, vertoningen, betrokkenheid en top-posts.",
    widgets: [
      { source: "fb_followers", kind: "kpi", size: 3 },
      { source: "fb_followers_growth", kind: "kpi", size: 3 },
      { source: "fb_reach", kind: "kpi", size: 3 },
      { source: "fb_engagement", kind: "kpi", size: 3 },
      { source: "fb_reach_by_date", kind: "area", size: 6 },
      { source: "fb_engagement_by_date", kind: "area", size: 6 },
      { source: "fb_top_posts", kind: "table", size: 12 },
    ],
  },
  {
    id: "organic-instagram", name: "Instagram", audience: "Marketeer",
    description: "Instagram: volgers, groei, bereik, vertoningen, profielbezoeken en top-posts.",
    widgets: [
      { source: "ig_followers", kind: "kpi", size: 3 },
      { source: "ig_followers_growth", kind: "kpi", size: 3 },
      { source: "ig_reach", kind: "kpi", size: 3 },
      { source: "ig_profile_views", kind: "kpi", size: 3 },
      { source: "ig_reach_by_date", kind: "area", size: 6 },
      { source: "ig_impressions_by_date", kind: "area", size: 6 },
      { source: "ig_top_posts", kind: "table", size: 12 },
    ],
  },
];

export const metaOrganicCatalog = {
  key: "meta-organic",
  label: "META Organisch",
  SOURCES, GROUPS, TEMPLATES,
  seriesDates: (d) => {
    const fb = d?.facebook?.by_date ?? [];
    return seriesDatesFrom(fb.length ? fb : (d?.instagram?.by_date ?? []));
  },
};
