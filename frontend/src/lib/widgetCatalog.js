// Widget catalogus voor het samenstelbare GA-overzicht.
//
// Splitst "welke data" (SOURCES) van "hoe getoond" (KINDS). Een dashboard is een
// lijst widgets; elke widget verwijst naar een bron + een visualisatie + grootte.
// Alle widgets renderen tegen één overview-payload (zie WidgetRenderer), dus er
// zijn geen extra API-calls per widget.

import { num, pct1 } from "./format.js";

const sumConversions = (d) => (d?.conversions ?? []).reduce((a, c) => a + (c.count || 0), 0);

// group bepaalt hoe de renderer de bron leest en tekent:
//   scalar     -> één getal (KPI-kaart)
//   timeseries -> reeks over tijd (lijn-/vlakgrafiek)
//   breakdown  -> verdeling [{label, sessions, pct}] (donut / balken / tabel)
//   table      -> kant-en-klare kolommen + rijen
// kinds = visualisaties die de gebruiker voor deze bron mag kiezen.
export const SOURCES = {
  // --- kerncijfers (KPI) ---
  users: {
    label: "Bezoekers", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.kpis?.users ?? 0, fmt: "int", delta: d?.deltas?.users, higherBetter: true }),
  },
  sessions: {
    label: "Sessies", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.kpis?.sessions ?? 0, fmt: "int", delta: d?.deltas?.sessions, higherBetter: true }),
  },
  conversions_total: {
    label: "Conversies", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: sumConversions(d), fmt: "int", delta: null, higherBetter: true }),
  },
  bounceRate: {
    label: "Bouncepercentage", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: (d?.kpis?.bounceRate ?? 0) * 100, fmt: "percent", delta: d?.deltas?.bounceRate, higherBetter: false }),
  },
  avgSessionDuration: {
    label: "Gem. sessieduur", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.kpis?.avgSessionDuration ?? 0, fmt: "duration", delta: d?.deltas?.avgSessionDuration, higherBetter: true }),
  },

  // --- over tijd ---
  sessions_by_date: {
    label: "Sessies over tijd", group: "timeseries", kinds: ["area"],
    series: (d) => ({
      values: (d?.sessions_by_date ?? []).map((p) => p.sessions),
      labels: (d?.sessions_by_date ?? []).map((p) => p.date),
      compareValues: d?.compare_series ?? null,
    }),
  },

  // --- verdelingen ---
  channels: {
    label: "Verkeersbronnen", group: "breakdown", kinds: ["donut", "bars", "table"],
    breakdown: (d) => d?.channels ?? [],
  },
  devices: {
    label: "Apparaten", group: "breakdown", kinds: ["donut", "bars", "table"],
    breakdown: (d) => d?.devices ?? [],
  },
  geography: {
    label: "Landen", group: "breakdown", kinds: ["donut", "bars", "table"],
    breakdown: (d) => d?.geography ?? [],
  },

  // --- tabellen ---
  top_pages: {
    label: "Toppagina's", group: "table", kinds: ["table"],
    table: (d) => ({
      columns: ["Pagina", "Weergaven", "Bounce"],
      rows: (d?.top_pages ?? []).map((p) => [p.path, num(p.views), pct1((p.bounceRate || 0) * 100)]),
    }),
  },
  conversions: {
    label: "Conversies (lijst)", group: "table", kinds: ["table"],
    table: (d) => ({
      columns: ["Conversie", "Aantal"],
      rows: (d?.conversions ?? []).map((c) => [c.name, num(c.count)]),
    }),
  },
};

// Visualisaties + hun standaardgrootte (kolommen in een 12-koloms raster).
export const KINDS = {
  kpi: { label: "KPI-kaart", defaultSize: 3 },
  area: { label: "Lijngrafiek", defaultSize: 12 },
  donut: { label: "Cirkeldiagram", defaultSize: 4 },
  bars: { label: "Balkenlijst", defaultSize: 6 },
  table: { label: "Tabel", defaultSize: 6 },
};

// Groottes die de gebruiker per widget kan kiezen (breedte in kolommen).
export const SIZES = [
  { value: 3, label: "1/4" },
  { value: 4, label: "1/3" },
  { value: 6, label: "1/2" },
  { value: 12, label: "Vol" },
];

// Bronnen gegroepeerd voor de "widget toevoegen"-keuze.
export const SOURCE_GROUPS = [
  { label: "Kerncijfers", ids: ["users", "sessions", "conversions_total", "bounceRate", "avgSessionDuration"] },
  { label: "Over tijd", ids: ["sessions_by_date"] },
  { label: "Verdelingen", ids: ["channels", "devices", "geography"] },
  { label: "Tabellen", ids: ["top_pages", "conversions"] },
];

let _seq = 0;
export function newId() {
  return "w" + Date.now().toString(36) + (_seq++).toString(36);
}

export function newWidget(sourceId, kind) {
  const src = SOURCES[sourceId];
  const k = kind && src.kinds.includes(kind) ? kind : src.kinds[0];
  return { id: newId(), source: sourceId, kind: k, title: src.label, size: KINDS[k].defaultSize };
}

// Kant-en-klare start-templates. De gebruiker kiest er één en past daarna aan.
export const TEMPLATES = [
  {
    id: "compact",
    name: "Compact overzicht",
    description: "Kerncijfers in één oogopslag plus één grote trendgrafiek.",
    widgets: [
      { source: "users", kind: "kpi", size: 3 },
      { source: "sessions", kind: "kpi", size: 3 },
      { source: "conversions_total", kind: "kpi", size: 3 },
      { source: "bounceRate", kind: "kpi", size: 3 },
      { source: "sessions_by_date", kind: "area", size: 12 },
    ],
  },
  {
    id: "traffic",
    name: "Verkeer & bronnen",
    description: "Waar bezoekers vandaan komen: kanalen, apparaten en landen.",
    widgets: [
      { source: "sessions", kind: "kpi", size: 3 },
      { source: "users", kind: "kpi", size: 3 },
      { source: "channels", kind: "donut", size: 6 },
      { source: "devices", kind: "bars", size: 6 },
      { source: "geography", kind: "bars", size: 6 },
      { source: "sessions_by_date", kind: "area", size: 12 },
    ],
  },
  {
    id: "content",
    name: "Inhoud & conversie",
    description: "Best presterende pagina's en de conversies die ze opleveren.",
    widgets: [
      { source: "conversions_total", kind: "kpi", size: 3 },
      { source: "bounceRate", kind: "kpi", size: 3 },
      { source: "top_pages", kind: "table", size: 6 },
      { source: "conversions", kind: "table", size: 6 },
      { source: "channels", kind: "donut", size: 6 },
    ],
  },
  {
    id: "full",
    name: "Alles (volledig)",
    description: "Het complete overzicht met alle beschikbare blokken.",
    widgets: [
      { source: "users", kind: "kpi", size: 3 },
      { source: "sessions", kind: "kpi", size: 3 },
      { source: "conversions_total", kind: "kpi", size: 3 },
      { source: "bounceRate", kind: "kpi", size: 3 },
      { source: "sessions_by_date", kind: "area", size: 12 },
      { source: "channels", kind: "donut", size: 6 },
      { source: "devices", kind: "bars", size: 6 },
      { source: "geography", kind: "bars", size: 6 },
      { source: "top_pages", kind: "table", size: 6 },
      { source: "conversions", kind: "table", size: 6 },
    ],
  },
];

// Maak een verse layout (met eigen widget-id's) uit een template.
export function instantiateTemplate(tpl) {
  return {
    widgets: (tpl.widgets || []).map((w) => ({
      id: newId(),
      source: w.source,
      kind: w.kind,
      size: w.size,
      title: w.title || SOURCES[w.source]?.label || w.source,
    })),
  };
}

// Verwijder onbekende bronnen/typen (robuust tegen oude opgeslagen layouts).
export function sanitizeLayout(layout) {
  const widgets = Array.isArray(layout?.widgets) ? layout.widgets : [];
  return {
    widgets: widgets
      .filter((w) => w && SOURCES[w.source] && SOURCES[w.source].kinds.includes(w.kind))
      .map((w) => ({
        id: w.id || newId(),
        source: w.source,
        kind: w.kind,
        size: SIZES.some((s) => s.value === w.size) ? w.size : KINDS[w.kind].defaultSize,
        title: w.title || SOURCES[w.source].label,
      })),
  };
}
