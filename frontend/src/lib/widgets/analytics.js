// Catalogus voor het Google Analytics-kanaal (GA4-overzichtspayload).

import { num, pct1 } from "../format.js";
import { seriesDatesFrom } from "./kit.js";

const sumConversions = (d) => (d?.conversions ?? []).reduce((a, c) => a + (c.count || 0), 0);
const seriesOf = (d, key) => (d?.series_by_date ?? []).map((r) => r[key] ?? 0);

// Normaliseer de gekozen key events naar een lijst namen (leeg = alle).
function selectedEvents(value) {
  if (Array.isArray(value)) return value.filter((v) => v && v !== "__all__");
  return value && value !== "__all__" ? [value] : [];
}

const eventConfig = {
  key: "event",
  label: "Gebeurtenis",
  allLabel: "Alle key events",
  multi: true,
  default: [],
  options: (d) => (d?.conversions ?? []).map((c) => ({ value: c.name, label: c.name })),
};

export const SOURCES = {
  // --- kerncijfers (KPI) ---
  users: {
    label: "Bezoekers", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.kpis?.users ?? 0, fmt: "int", delta: d?.deltas?.users, higherBetter: true }),
    spark: (d) => seriesOf(d, "users"),
  },
  newUsers: {
    label: "Nieuwe bezoekers", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.kpis?.newUsers ?? 0, fmt: "int", delta: d?.deltas?.newUsers, higherBetter: true }),
    spark: (d) => seriesOf(d, "newUsers"),
  },
  sessions: {
    label: "Sessies", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.kpis?.sessions ?? 0, fmt: "int", delta: d?.deltas?.sessions, higherBetter: true }),
    spark: (d) => seriesOf(d, "sessions"),
  },
  pageViews: {
    label: "Paginaweergaven", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.kpis?.pageViews ?? 0, fmt: "int", delta: d?.deltas?.pageViews, higherBetter: true }),
    spark: (d) => seriesOf(d, "pageViews"),
  },
  eventCount: {
    label: "Gebeurtenissen", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.kpis?.eventCount ?? 0, fmt: "int", delta: d?.deltas?.eventCount, higherBetter: true }),
    spark: (d) => seriesOf(d, "eventCount"),
  },
  conversions_total: {
    label: "Conversies", group: "scalar", kinds: ["kpi"], unit: "conversies",
    config: eventConfig,
    scalar: (d, cfg) => {
      const names = selectedEvents(cfg?.event);
      if (names.length) {
        const total = (d?.conversions ?? [])
          .filter((c) => names.includes(c.name))
          .reduce((a, c) => a + (c.count || 0), 0);
        return { value: total, fmt: "int", delta: null, higherBetter: true };
      }
      return { value: sumConversions(d), fmt: "int", delta: d?.deltas?.conversions, higherBetter: true };
    },
    spark: (d) => seriesOf(d, "conversions"),
  },
  conversion_rate: {
    label: "Conversieratio", group: "scalar", kinds: ["kpi"],
    scalar: (d) => {
      const s = d?.kpis?.sessions ?? 0;
      const c = d?.kpis?.conversions ?? 0;
      return { value: s ? (c / s) * 100 : 0, fmt: "percent", delta: null, higherBetter: true };
    },
    spark: (d) => (d?.series_by_date ?? []).map((r) => (r.sessions ? (r.conversions / r.sessions) * 100 : 0)),
  },
  bounceRate: {
    label: "Bouncepercentage", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: (d?.kpis?.bounceRate ?? 0) * 100, fmt: "percent", delta: d?.deltas?.bounceRate, higherBetter: false }),
    spark: (d) => seriesOf(d, "bounceRate"),
  },
  engagementRate: {
    label: "Betrokkenheid", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: (d?.kpis?.engagementRate ?? 0) * 100, fmt: "percent", delta: d?.deltas?.engagementRate, higherBetter: true }),
    spark: (d) => seriesOf(d, "engagementRate"),
  },
  avgSessionDuration: {
    label: "Gem. sessieduur", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.kpis?.avgSessionDuration ?? 0, fmt: "duration", delta: d?.deltas?.avgSessionDuration, higherBetter: true }),
    spark: (d) => seriesOf(d, "avgSessionDuration"),
  },

  // --- over tijd ---
  sessions_by_date: {
    label: "Sessies over tijd", group: "timeseries", kinds: ["area"], unit: "sessies",
    series: (d) => ({
      values: (d?.sessions_by_date ?? []).map((p) => p.sessions),
      labels: (d?.sessions_by_date ?? []).map((p) => p.date),
      compareValues: d?.compare_series ?? null,
    }),
  },

  // --- verdelingen ---
  channels: {
    label: "Verkeersbronnen", group: "breakdown", kinds: ["donut", "bars", "table"], unit: "sessies",
    breakdown: (d) => d?.channels ?? [],
  },
  source_medium: {
    label: "Bron / medium", group: "breakdown", kinds: ["bars", "table", "donut"], unit: "sessies",
    breakdown: (d) => d?.source_medium ?? [],
  },
  devices: {
    label: "Apparaten", group: "breakdown", kinds: ["donut", "bars", "table"], unit: "sessies",
    breakdown: (d) => d?.devices ?? [],
  },
  browsers: {
    label: "Browsers", group: "breakdown", kinds: ["donut", "bars", "table"], unit: "sessies",
    breakdown: (d) => d?.browsers ?? [],
  },
  new_vs_returning: {
    label: "Nieuw vs terugkerend", group: "breakdown", kinds: ["donut", "bars"], unit: "sessies",
    breakdown: (d) => d?.new_vs_returning ?? [],
  },
  geography: {
    label: "Landen", group: "breakdown", kinds: ["donut", "bars", "table"], unit: "sessies",
    breakdown: (d) => d?.geography ?? [],
  },
  events: {
    label: "Gebeurtenissen (top)", group: "breakdown", kinds: ["bars", "table", "donut"], unit: "gebeurtenissen",
    breakdown: (d) => d?.events ?? [],
  },

  // --- tabellen ---
  top_pages: {
    label: "Toppagina's", group: "table", kinds: ["table"],
    table: (d) => ({
      columns: ["Pagina", "Weergaven", "Bounce"],
      rows: (d?.top_pages ?? []).map((p) => [p.path, num(p.views), pct1((p.bounceRate || 0) * 100)]),
    }),
  },
  landing_pages: {
    label: "Instappagina's", group: "table", kinds: ["table"],
    table: (d) => ({
      columns: ["Instappagina", "Sessies", "Bounce"],
      rows: (d?.landing_pages ?? []).map((p) => [p.path, num(p.views), pct1((p.bounceRate || 0) * 100)]),
    }),
  },
  conversions: {
    label: "Conversies (lijst)", group: "table", kinds: ["table"],
    config: eventConfig,
    table: (d, cfg) => {
      const names = selectedEvents(cfg?.event);
      const list = (d?.conversions ?? []).filter((c) => !names.length || names.includes(c.name));
      return { columns: ["Conversie", "Aantal"], rows: list.map((c) => [c.name, num(c.count)]) };
    },
  },
};

export const GROUPS = [
  { label: "Kerncijfers", ids: ["users", "newUsers", "sessions", "pageViews", "eventCount", "conversions_total", "conversion_rate", "bounceRate", "engagementRate", "avgSessionDuration"] },
  { label: "Over tijd", ids: ["sessions_by_date"] },
  { label: "Verdelingen", ids: ["channels", "source_medium", "devices", "browsers", "new_vs_returning", "geography", "events"] },
  { label: "Tabellen", ids: ["top_pages", "landing_pages", "conversions"] },
];

export const TEMPLATES = [
  {
    id: "executive", name: "Directie-overzicht", audience: "Directie",
    description: "De kerncijfers, trend en herkomst in één compleet directiebeeld.",
    widgets: [
      { source: "users", kind: "kpi", size: 3 },
      { source: "sessions", kind: "kpi", size: 3 },
      { source: "conversions_total", kind: "kpi", size: 3 },
      { source: "conversion_rate", kind: "kpi", size: 3 },
      { source: "newUsers", kind: "kpi", size: 3 },
      { source: "engagementRate", kind: "kpi", size: 3 },
      { source: "bounceRate", kind: "kpi", size: 3 },
      { source: "avgSessionDuration", kind: "kpi", size: 3 },
      { source: "sessions_by_date", kind: "area", size: 8 },
      { source: "channels", kind: "donut", size: 4 },
      { source: "devices", kind: "donut", size: 4 },
      { source: "top_pages", kind: "table", size: 8 },
    ],
  },
  {
    id: "acquisition", name: "Acquisitie & verkeer", audience: "Marketeer",
    description: "Waar bezoekers vandaan komen: kanalen, bron/medium, apparaten, browsers, landen en nieuw vs. terugkerend.",
    widgets: [
      { source: "sessions", kind: "kpi", size: 3 },
      { source: "users", kind: "kpi", size: 3 },
      { source: "newUsers", kind: "kpi", size: 3 },
      { source: "bounceRate", kind: "kpi", size: 3 },
      { source: "sessions_by_date", kind: "area", size: 12 },
      { source: "channels", kind: "donut", size: 4 },
      { source: "source_medium", kind: "bars", size: 8 },
      { source: "devices", kind: "bars", size: 6 },
      { source: "geography", kind: "bars", size: 6 },
      { source: "new_vs_returning", kind: "donut", size: 4 },
      { source: "browsers", kind: "bars", size: 8 },
    ],
  },
  {
    id: "behavior", name: "Gedrag & content", audience: "Marketeer",
    description: "Welke content werkt en waar bezoekers afhaken: toppagina's, instappagina's, gebeurtenissen en betrokkenheid.",
    widgets: [
      { source: "pageViews", kind: "kpi", size: 3 },
      { source: "avgSessionDuration", kind: "kpi", size: 3 },
      { source: "bounceRate", kind: "kpi", size: 3 },
      { source: "engagementRate", kind: "kpi", size: 3 },
      { source: "eventCount", kind: "kpi", size: 3 },
      { source: "sessions_by_date", kind: "area", size: 12 },
      { source: "top_pages", kind: "table", size: 6 },
      { source: "landing_pages", kind: "table", size: 6 },
      { source: "events", kind: "bars", size: 6 },
      { source: "new_vs_returning", kind: "donut", size: 6 },
    ],
  },
  {
    id: "conversion", name: "Conversie & doelen", audience: "Marketeer",
    description: "Sturen op resultaat: conversies, conversieratio, de doelen en de bronnen die ze opleveren.",
    widgets: [
      { source: "conversions_total", kind: "kpi", size: 3 },
      { source: "conversion_rate", kind: "kpi", size: 3 },
      { source: "sessions", kind: "kpi", size: 3 },
      { source: "users", kind: "kpi", size: 3 },
      { source: "conversions", kind: "table", size: 6 },
      { source: "channels", kind: "donut", size: 6 },
      { source: "source_medium", kind: "bars", size: 6 },
      { source: "top_pages", kind: "table", size: 6 },
      { source: "sessions_by_date", kind: "area", size: 12 },
    ],
  },
  {
    id: "full", name: "Alles (volledig)", audience: "Specialist",
    description: "Het complete overzicht met alle beschikbare blokken.",
    widgets: [
      { source: "users", kind: "kpi", size: 3 },
      { source: "sessions", kind: "kpi", size: 3 },
      { source: "conversions_total", kind: "kpi", size: 3 },
      { source: "conversion_rate", kind: "kpi", size: 3 },
      { source: "sessions_by_date", kind: "area", size: 12 },
      { source: "channels", kind: "donut", size: 6 },
      { source: "source_medium", kind: "bars", size: 6 },
      { source: "devices", kind: "bars", size: 6 },
      { source: "geography", kind: "bars", size: 6 },
      { source: "events", kind: "bars", size: 6 },
      { source: "new_vs_returning", kind: "donut", size: 6 },
      { source: "top_pages", kind: "table", size: 6 },
      { source: "landing_pages", kind: "table", size: 6 },
      { source: "conversions", kind: "table", size: 6 },
    ],
  },
];

export const analyticsCatalog = {
  key: "analytics",
  label: "Analytics",
  SOURCES, GROUPS, TEMPLATES,
  seriesDates: (d) => seriesDatesFrom(d?.series_by_date ?? d?.sessions_by_date ?? []),
};
