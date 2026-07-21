// Catalogus voor het Google Analytics-kanaal (GA4-overzichtspayload).
//
// Doel: dezelfde bouwstenen als de GA4-interface zelf — de headline-metrics,
// elke metric als trend over tijd, en de standaard acquisitie-/techniek-/
// geografie-/demografie-/gedragsdimensies, elk als kaart/grafiek/tabel.

import { num, pct1 } from "../format.js";
import { seriesDatesFrom } from "./kit.js";

const sumConversions = (d) => (d?.conversions ?? []).reduce((a, c) => a + (c.count || 0), 0);
const seriesOf = (d, key) => (d?.series_by_date ?? []).map((r) => r[key] ?? 0);
const pctSeriesOf = (d, key) => (d?.series_by_date ?? []).map((r) => (r[key] ?? 0) * 100);

const dec1 = (v) => (v || 0).toFixed(1).replace(".", ",");
const eur = (v) => "€ " + new Intl.NumberFormat("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v || 0);

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

// Fabriek voor een "over tijd"-bron die tegen series_by_date leest.
function area(label, key, unit, { pct = false, compare = false } = {}) {
  return {
    label, group: "timeseries", kinds: ["area"], unit,
    series: (d) => ({
      values: pct ? pctSeriesOf(d, key) : seriesOf(d, key),
      compareValues: compare ? (d?.compare_series ?? null) : null,
      unit,
    }),
  };
}

// Fabriek voor een verdeling die een payload-array [{label,value,pct}] leest.
function dist(label, field, kinds, unit) {
  return { label, group: "breakdown", kinds, unit, breakdown: (d) => d?.[field] ?? [] };
}

export const SOURCES = {
  // --- kerncijfers (KPI) ---
  users: {
    label: "Bezoekers", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.kpis?.users ?? 0, fmt: "int", delta: d?.deltas?.users, higherBetter: true }),
    spark: (d) => seriesOf(d, "users"),
  },
  activeUsers: {
    label: "Actieve gebruikers", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.kpis?.activeUsers ?? 0, fmt: "int", delta: d?.deltas?.activeUsers, higherBetter: true }),
    spark: (d) => seriesOf(d, "activeUsers"),
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
  engagedSessions: {
    label: "Betrokken sessies", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.kpis?.engagedSessions ?? 0, fmt: "int", delta: d?.deltas?.engagedSessions, higherBetter: true }),
    spark: (d) => seriesOf(d, "engagedSessions"),
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
  engagementRate: {
    label: "Betrokkenheid", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: (d?.kpis?.engagementRate ?? 0) * 100, fmt: "percent", delta: d?.deltas?.engagementRate, higherBetter: true }),
    spark: (d) => pctSeriesOf(d, "engagementRate"),
  },
  avgEngagementTime: {
    label: "Gem. betrokkenheidstijd", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.kpis?.avgEngagementTime ?? 0, fmt: "duration", delta: null, higherBetter: true }),
  },
  avgSessionDuration: {
    label: "Gem. sessieduur", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.kpis?.avgSessionDuration ?? 0, fmt: "duration", delta: d?.deltas?.avgSessionDuration, higherBetter: true }),
    spark: (d) => seriesOf(d, "avgSessionDuration"),
  },
  bounceRate: {
    label: "Bouncepercentage", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: (d?.kpis?.bounceRate ?? 0) * 100, fmt: "percent", delta: d?.deltas?.bounceRate, higherBetter: false }),
    spark: (d) => pctSeriesOf(d, "bounceRate"),
  },
  pageViews: {
    label: "Paginaweergaven", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.kpis?.pageViews ?? 0, fmt: "int", delta: d?.deltas?.pageViews, higherBetter: true }),
    spark: (d) => seriesOf(d, "pageViews"),
  },
  viewsPerSession: {
    label: "Weergaven per sessie", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.kpis?.viewsPerSession ?? 0, display: dec1(d?.kpis?.viewsPerSession), delta: d?.deltas?.viewsPerSession, higherBetter: true }),
  },
  sessionsPerUser: {
    label: "Sessies per gebruiker", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.kpis?.sessionsPerUser ?? 0, display: dec1(d?.kpis?.sessionsPerUser), delta: d?.deltas?.sessionsPerUser, higherBetter: true }),
  },
  eventCount: {
    label: "Gebeurtenissen", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.kpis?.eventCount ?? 0, fmt: "int", delta: d?.deltas?.eventCount, higherBetter: true }),
    spark: (d) => seriesOf(d, "eventCount"),
  },
  revenue: {
    label: "Opbrengst", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.kpis?.revenue ?? 0, display: eur(d?.kpis?.revenue), delta: d?.deltas?.revenue, higherBetter: true }),
    spark: (d) => seriesOf(d, "revenue"),
  },

  // --- e-commerce (GA4 monetization) ---
  transactions: {
    label: "Bestellingen", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.kpis?.transactions ?? 0, fmt: "int", delta: d?.deltas?.transactions, higherBetter: true }),
    spark: (d) => seriesOf(d, "transactions"),
  },
  avgOrderValue: {
    label: "Gem. orderwaarde", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.kpis?.avgOrderValue ?? 0, display: eur(d?.kpis?.avgOrderValue), delta: d?.deltas?.avgOrderValue, higherBetter: true }),
  },
  addToCarts: {
    label: "In winkelwagen", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.kpis?.addToCarts ?? 0, fmt: "int", delta: d?.deltas?.addToCarts, higherBetter: true }),
    spark: (d) => seriesOf(d, "addToCarts"),
  },
  checkouts: {
    label: "Checkouts gestart", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.kpis?.checkouts ?? 0, fmt: "int", delta: d?.deltas?.checkouts, higherBetter: true }),
    spark: (d) => seriesOf(d, "checkouts"),
  },
  firstTimePurchasers: {
    label: "Nieuwe kopers", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.kpis?.firstTimePurchasers ?? 0, fmt: "int", delta: d?.deltas?.firstTimePurchasers, higherBetter: true }),
  },
  shop_funnel: {
    label: "Winkelfunnel", group: "breakdown", kinds: ["bars", "table"], unit: "sessies",
    // Funnel: percentages t.o.v. sessies (niet t.o.v. de som), zodat de balken
    // de doorval van sessie naar bestelling tonen.
    breakdown: (d) => {
      const k = d?.kpis ?? {};
      const base = k.sessions || 1;
      const step = (label, value) => ({ label, value: value ?? 0, pct: Math.min(100, Math.round(((value ?? 0) / base) * 100)) });
      return [
        step("Sessies", k.sessions),
        step("In winkelwagen", k.addToCarts),
        step("Checkout gestart", k.checkouts),
        step("Bestellingen", k.transactions),
      ];
    },
  },
  top_items: {
    label: "Top verkochte producten", group: "table", kinds: ["table"],
    table: (d) => ({
      columns: ["Product", "Aantal", "Omzet"],
      rows: (d?.top_items ?? []).map((p) => [p.name, num(p.qty), eur(p.revenue)]),
    }),
  },

  // --- over tijd ---
  sessions_by_date: area("Sessies over tijd", "sessions", "sessies", { compare: true }),
  users_by_date: area("Bezoekers over tijd", "users", "bezoekers"),
  activeUsers_by_date: area("Actieve gebruikers over tijd", "activeUsers", "gebruikers"),
  newUsers_by_date: area("Nieuwe bezoekers over tijd", "newUsers", "bezoekers"),
  engagedSessions_by_date: area("Betrokken sessies over tijd", "engagedSessions", "sessies"),
  pageViews_by_date: area("Paginaweergaven over tijd", "pageViews", "weergaven"),
  conversions_by_date: area("Conversies over tijd", "conversions", "conversies"),
  eventCount_by_date: area("Gebeurtenissen over tijd", "eventCount", "gebeurtenissen"),
  engagementRate_by_date: area("Betrokkenheid over tijd", "engagementRate", "%", { pct: true }),
  bounceRate_by_date: area("Bouncepercentage over tijd", "bounceRate", "%", { pct: true }),
  revenue_by_date: area("Opbrengst over tijd", "revenue", "opbrengst"),
  transactions_by_date: area("Bestellingen over tijd", "transactions", "bestellingen"),

  // --- acquisitie (verdelingen) ---
  channels: dist("Verkeersbronnen", "channels", ["donut", "bars", "table"], "sessies"),
  source_medium: dist("Bron / medium", "source_medium", ["bars", "table", "donut"], "sessies"),
  conversions_by_source: dist("Conversies per bron / medium", "conversions_by_source", ["bars", "table", "donut"], "conversies"),
  session_campaigns: dist("Campagnes (sessie)", "session_campaigns", ["bars", "table", "donut"], "sessies"),
  first_user_channels: dist("Eerste kanaal", "first_user_channels", ["donut", "bars", "table"], "sessies"),
  first_user_source_medium: dist("Eerste bron / medium", "first_user_source_medium", ["bars", "table", "donut"], "sessies"),

  // --- gebruikers & techniek (verdelingen) ---
  devices: dist("Apparaten", "devices", ["donut", "bars", "table"], "sessies"),
  operating_systems: dist("Besturingssystemen", "operating_systems", ["bars", "table", "donut"], "sessies"),
  browsers: dist("Browsers", "browsers", ["donut", "bars", "table"], "sessies"),
  platforms: dist("Platform", "platforms", ["donut", "bars", "table"], "sessies"),
  screen_resolutions: dist("Schermresolutie", "screen_resolutions", ["bars", "table"], "sessies"),

  // --- geografie & demografie (verdelingen) ---
  geography: dist("Landen", "geography", ["bars", "donut", "table"], "sessies"),
  cities: dist("Steden", "cities", ["bars", "table"], "sessies"),
  languages: dist("Talen", "languages", ["bars", "table", "donut"], "sessies"),
  age: dist("Leeftijd", "age", ["bars", "table", "donut"], "gebruikers"),
  gender: dist("Geslacht", "gender", ["donut", "bars"], "gebruikers"),

  // --- gedrag (verdelingen) ---
  new_vs_returning: dist("Nieuw vs terugkerend", "new_vs_returning", ["donut", "bars"], "sessies"),
  events: dist("Gebeurtenissen (top)", "events", ["bars", "table", "donut"], "gebeurtenissen"),

  // --- pagina's & conversies (tabellen) ---
  top_pages: {
    label: "Toppagina's", group: "table", kinds: ["table"],
    table: (d) => ({
      columns: ["Pagina", "Weergaven", "Bounce"],
      rows: (d?.top_pages ?? []).map((p) => [p.path, num(p.views), pct1((p.bounceRate || 0) * 100)]),
    }),
  },
  page_titles: {
    label: "Toppagina's (titel)", group: "table", kinds: ["table"],
    table: (d) => ({
      columns: ["Paginatitel", "Weergaven", "Bounce"],
      rows: (d?.page_titles ?? []).map((p) => [p.path, num(p.views), pct1((p.bounceRate || 0) * 100)]),
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
  { label: "Kerncijfers", ids: ["users", "activeUsers", "newUsers", "sessions", "engagedSessions", "conversions_total", "conversion_rate", "engagementRate", "avgEngagementTime", "avgSessionDuration", "bounceRate", "pageViews", "viewsPerSession", "sessionsPerUser", "eventCount", "revenue"] },
  { label: "Over tijd", ids: ["sessions_by_date", "users_by_date", "activeUsers_by_date", "newUsers_by_date", "engagedSessions_by_date", "pageViews_by_date", "conversions_by_date", "eventCount_by_date", "engagementRate_by_date", "bounceRate_by_date", "revenue_by_date", "transactions_by_date"] },
  { label: "E-commerce", ids: ["transactions", "avgOrderValue", "addToCarts", "checkouts", "firstTimePurchasers", "shop_funnel", "top_items"] },
  { label: "Acquisitie", ids: ["channels", "source_medium", "conversions_by_source", "session_campaigns", "first_user_channels", "first_user_source_medium"] },
  { label: "Gebruikers & techniek", ids: ["devices", "operating_systems", "browsers", "platforms", "screen_resolutions"] },
  { label: "Geografie & demografie", ids: ["geography", "cities", "languages", "age", "gender"] },
  { label: "Gedrag", ids: ["new_vs_returning", "events"] },
  { label: "Pagina's & conversies", ids: ["top_pages", "page_titles", "landing_pages", "conversions"] },
];

export const TEMPLATES = [
  {
    id: "executive", name: "Directie-overzicht", audience: "Directie", profile: "both",
    description: "De headline-cijfers, trend en herkomst in één compleet directiebeeld.",
    widgets: [
      { source: "users", kind: "kpi", size: 3 },
      { source: "sessions", kind: "kpi", size: 3 },
      { source: "engagedSessions", kind: "kpi", size: 3 },
      { source: "conversions_total", kind: "kpi", size: 3 },
      { source: "avgEngagementTime", kind: "kpi", size: 3 },
      { source: "engagementRate", kind: "kpi", size: 3 },
      { source: "conversion_rate", kind: "kpi", size: 3 },
      { source: "revenue", kind: "kpi", size: 3 },
      { source: "sessions_by_date", kind: "area", size: 8 },
      { source: "channels", kind: "donut", size: 4 },
      { source: "devices", kind: "donut", size: 4 },
      { source: "top_pages", kind: "table", size: 8 },
    ],
  },
  {
    id: "acquisition", name: "Acquisitie & verkeer", audience: "Marketeer", profile: "both",
    description: "Waar bezoekers vandaan komen: sessie- én eerste-gebruiker-kanalen, bron/medium, campagnes en landen.",
    widgets: [
      { source: "sessions", kind: "kpi", size: 3 },
      { source: "users", kind: "kpi", size: 3 },
      { source: "newUsers", kind: "kpi", size: 3 },
      { source: "engagementRate", kind: "kpi", size: 3 },
      { source: "sessions_by_date", kind: "area", size: 12 },
      { source: "channels", kind: "donut", size: 4 },
      { source: "source_medium", kind: "bars", size: 8 },
      { source: "first_user_channels", kind: "donut", size: 4 },
      { source: "first_user_source_medium", kind: "bars", size: 8 },
      { source: "session_campaigns", kind: "table", size: 6 },
      { source: "geography", kind: "bars", size: 6 },
    ],
  },
  {
    id: "behavior", name: "Gedrag & content", audience: "Marketeer", profile: "both",
    description: "Welke content werkt en waar bezoekers afhaken: toppagina's, titels, instappagina's en gebeurtenissen.",
    widgets: [
      { source: "pageViews", kind: "kpi", size: 3 },
      { source: "viewsPerSession", kind: "kpi", size: 3 },
      { source: "avgEngagementTime", kind: "kpi", size: 3 },
      { source: "eventCount", kind: "kpi", size: 3 },
      { source: "pageViews_by_date", kind: "area", size: 12 },
      { source: "top_pages", kind: "table", size: 6 },
      { source: "page_titles", kind: "table", size: 6 },
      { source: "landing_pages", kind: "table", size: 6 },
      { source: "events", kind: "bars", size: 6 },
    ],
  },
  {
    id: "conversion", name: "Conversie & verkoop", audience: "Marketeer", profile: "ecommerce",
    description: "Sturen op verkoop: omzet, bestellingen, gemiddelde orderwaarde, de winkelfunnel en de producten en bronnen die het opleveren.",
    widgets: [
      { source: "revenue", kind: "kpi", size: 3 },
      { source: "transactions", kind: "kpi", size: 3 },
      { source: "avgOrderValue", kind: "kpi", size: 3 },
      { source: "conversion_rate", kind: "kpi", size: 3 },
      { source: "addToCarts", kind: "kpi", size: 3 },
      { source: "checkouts", kind: "kpi", size: 3 },
      { source: "firstTimePurchasers", kind: "kpi", size: 3 },
      { source: "sessions", kind: "kpi", size: 3 },
      { source: "revenue_by_date", kind: "area", size: 12 },
      { source: "shop_funnel", kind: "bars", size: 6 },
      { source: "top_items", kind: "table", size: 6 },
      { source: "conversions_by_source", kind: "bars", size: 6 },
      { source: "channels", kind: "donut", size: 6 },
      { source: "conversions", kind: "table", size: 6 },
      { source: "source_medium", kind: "bars", size: 6 },
    ],
  },
  {
    id: "leadgen", name: "Leadgeneratie", audience: "Marketeer", profile: "leadgen",
    description: "Aanvragen sturen: conversies (formulieren, offertes, telefoon), ratio, herkomst en de pagina's die leads opleveren.",
    widgets: [
      { source: "conversions_total", kind: "kpi", size: 3 },
      { source: "conversion_rate", kind: "kpi", size: 3 },
      { source: "sessions", kind: "kpi", size: 3 },
      { source: "users", kind: "kpi", size: 3 },
      { source: "conversions_by_date", kind: "area", size: 12 },
      { source: "conversions", kind: "table", size: 6 },
      { source: "conversions_by_source", kind: "bars", size: 6 },
      { source: "channels", kind: "donut", size: 6 },
      { source: "source_medium", kind: "bars", size: 6 },
      { source: "landing_pages", kind: "table", size: 6 },
    ],
  },
  {
    id: "audience", name: "Publiek & techniek", audience: "Specialist", profile: "both",
    description: "Wie de bezoekers zijn en waarmee ze komen: apparaten, browsers, OS, platform, landen, steden, taal, leeftijd en geslacht.",
    widgets: [
      { source: "activeUsers", kind: "kpi", size: 3 },
      { source: "newUsers", kind: "kpi", size: 3 },
      { source: "sessionsPerUser", kind: "kpi", size: 3 },
      { source: "engagementRate", kind: "kpi", size: 3 },
      { source: "devices", kind: "donut", size: 4 },
      { source: "operating_systems", kind: "bars", size: 4 },
      { source: "browsers", kind: "donut", size: 4 },
      { source: "geography", kind: "bars", size: 6 },
      { source: "cities", kind: "bars", size: 6 },
      { source: "languages", kind: "bars", size: 4 },
      { source: "age", kind: "bars", size: 4 },
      { source: "gender", kind: "donut", size: 4 },
    ],
  },
  {
    id: "full", name: "Alles (volledig)", audience: "Specialist", profile: "both",
    description: "Het complete overzicht met alle beschikbare blokken.",
    widgets: [
      { source: "users", kind: "kpi", size: 3 },
      { source: "sessions", kind: "kpi", size: 3 },
      { source: "conversions_total", kind: "kpi", size: 3 },
      { source: "revenue", kind: "kpi", size: 3 },
      { source: "sessions_by_date", kind: "area", size: 12 },
      { source: "channels", kind: "donut", size: 6 },
      { source: "source_medium", kind: "bars", size: 6 },
      { source: "devices", kind: "bars", size: 6 },
      { source: "geography", kind: "bars", size: 6 },
      { source: "events", kind: "bars", size: 6 },
      { source: "new_vs_returning", kind: "donut", size: 6 },
      { source: "top_pages", kind: "table", size: 6 },
      { source: "page_titles", kind: "table", size: 6 },
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
