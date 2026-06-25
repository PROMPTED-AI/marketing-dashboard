// Widget catalogus voor het samenstelbare GA-overzicht.
//
// Splitst "welke data" (SOURCES) van "hoe getoond" (KINDS). Een dashboard is een
// lijst widgets; elke widget verwijst naar een bron + een visualisatie + grootte
// + optionele config (bv. een filter op gebeurtenis). Alle widgets renderen tegen
// één overview-payload (zie WidgetRenderer), dus er zijn geen extra API-calls per
// widget — ook niet voor de filters (die werken op data die al binnen is).

import { num, pct1 } from "./format.js";

const sumConversions = (d) => (d?.conversions ?? []).reduce((a, c) => a + (c.count || 0), 0);

// Normaliseer de gekozen key events naar een lijst namen. Accepteert de nieuwe
// array-vorm én oude opgeslagen waarden (losse string of "__all__"); een lege
// lijst betekent "alle key events".
function selectedEvents(value) {
  if (Array.isArray(value)) return value.filter((v) => v && v !== "__all__");
  return value && value !== "__all__" ? [value] : [];
}

// group bepaalt hoe de renderer de bron leest en tekent:
//   scalar     -> één getal (KPI-kaart)
//   timeseries -> reeks over tijd (lijn-/vlakgrafiek)
//   breakdown  -> verdeling [{label, value, pct}] (donut / balken / tabel)
//   table      -> kant-en-klare kolommen + rijen
// kinds = visualisaties die de gebruiker voor deze bron mag kiezen.
// unit  = eenheid die de donut in het midden toont (default "sessies").
// config = optioneel filter dat de gebruiker per widget instelt; `options(d)`
//          levert de keuzes uit de data, `scalar`/`breakdown`/`table` krijgen de
//          gekozen config als tweede argument.
export const SOURCES = {
  // --- kerncijfers (KPI) ---
  users: {
    label: "Bezoekers", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.kpis?.users ?? 0, fmt: "int", delta: d?.deltas?.users, higherBetter: true }),
  },
  newUsers: {
    label: "Nieuwe bezoekers", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.kpis?.newUsers ?? 0, fmt: "int", delta: d?.deltas?.newUsers, higherBetter: true }),
  },
  sessions: {
    label: "Sessies", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.kpis?.sessions ?? 0, fmt: "int", delta: d?.deltas?.sessions, higherBetter: true }),
  },
  pageViews: {
    label: "Paginaweergaven", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.kpis?.pageViews ?? 0, fmt: "int", delta: d?.deltas?.pageViews, higherBetter: true }),
  },
  eventCount: {
    label: "Gebeurtenissen", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: d?.kpis?.eventCount ?? 0, fmt: "int", delta: d?.deltas?.eventCount, higherBetter: true }),
  },
  conversions_total: {
    label: "Conversies", group: "scalar", kinds: ["kpi"], unit: "conversies",
    // Filter op één of meer key events; leeg = alle key events bij elkaar opgeteld.
    config: {
      key: "event",
      label: "Gebeurtenis",
      multi: true,
      default: [],
      options: (d) => (d?.conversions ?? []).map((c) => ({ value: c.name, label: c.name })),
    },
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
  },
  bounceRate: {
    label: "Bouncepercentage", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: (d?.kpis?.bounceRate ?? 0) * 100, fmt: "percent", delta: d?.deltas?.bounceRate, higherBetter: false }),
  },
  engagementRate: {
    label: "Betrokkenheid", group: "scalar", kinds: ["kpi"],
    scalar: (d) => ({ value: (d?.kpis?.engagementRate ?? 0) * 100, fmt: "percent", delta: d?.deltas?.engagementRate, higherBetter: true }),
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
  source_medium: {
    label: "Bron / medium", group: "breakdown", kinds: ["bars", "table", "donut"],
    breakdown: (d) => d?.source_medium ?? [],
  },
  devices: {
    label: "Apparaten", group: "breakdown", kinds: ["donut", "bars", "table"],
    breakdown: (d) => d?.devices ?? [],
  },
  browsers: {
    label: "Browsers", group: "breakdown", kinds: ["donut", "bars", "table"],
    breakdown: (d) => d?.browsers ?? [],
  },
  new_vs_returning: {
    label: "Nieuw vs terugkerend", group: "breakdown", kinds: ["donut", "bars"],
    breakdown: (d) => d?.new_vs_returning ?? [],
  },
  geography: {
    label: "Landen", group: "breakdown", kinds: ["donut", "bars", "table"],
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
    // Filter op één of meer key events; leeg = alle key events.
    config: {
      key: "event",
      label: "Gebeurtenis",
      multi: true,
      default: [],
      options: (d) => (d?.conversions ?? []).map((c) => ({ value: c.name, label: c.name })),
    },
    table: (d, cfg) => {
      const names = selectedEvents(cfg?.event);
      const list = (d?.conversions ?? []).filter((c) => !names.length || names.includes(c.name));
      return {
        columns: ["Conversie", "Aantal"],
        rows: list.map((c) => [c.name, num(c.count)]),
      };
    },
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
  { label: "Kerncijfers", ids: ["users", "newUsers", "sessions", "pageViews", "eventCount", "conversions_total", "bounceRate", "engagementRate", "avgSessionDuration"] },
  { label: "Over tijd", ids: ["sessions_by_date"] },
  { label: "Verdelingen", ids: ["channels", "source_medium", "devices", "browsers", "new_vs_returning", "geography", "events"] },
  { label: "Tabellen", ids: ["top_pages", "landing_pages", "conversions"] },
];

let _seq = 0;
export function newId() {
  return "w" + Date.now().toString(36) + (_seq++).toString(36);
}

// Standaard-config voor een bron (alleen als die een filter heeft).
function defaultConfig(src) {
  return src.config ? { [src.config.key]: src.config.default } : undefined;
}

export function newWidget(sourceId, kind) {
  const src = SOURCES[sourceId];
  const k = kind && src.kinds.includes(kind) ? kind : src.kinds[0];
  const w = { id: newId(), source: sourceId, kind: k, title: src.label, size: KINDS[k].defaultSize };
  const cfg = defaultConfig(src);
  if (cfg) w.config = cfg;
  return w;
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
    description: "Waar bezoekers vandaan komen: kanalen, bron/medium, apparaten en landen.",
    widgets: [
      { source: "sessions", kind: "kpi", size: 3 },
      { source: "users", kind: "kpi", size: 3 },
      { source: "channels", kind: "donut", size: 6 },
      { source: "source_medium", kind: "bars", size: 6 },
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
      { source: "landing_pages", kind: "table", size: 6 },
      { source: "conversions", kind: "table", size: 6 },
      { source: "channels", kind: "donut", size: 6 },
    ],
  },
  {
    id: "engagement",
    name: "Betrokkenheid & gebeurtenissen",
    description: "Hoe actief bezoekers zijn: betrokkenheid, gebeurtenissen en key events.",
    widgets: [
      { source: "engagementRate", kind: "kpi", size: 3 },
      { source: "avgSessionDuration", kind: "kpi", size: 3 },
      { source: "eventCount", kind: "kpi", size: 3 },
      { source: "conversions_total", kind: "kpi", size: 3 },
      { source: "events", kind: "bars", size: 6 },
      { source: "conversions", kind: "table", size: 6 },
      { source: "new_vs_returning", kind: "donut", size: 4 },
      { source: "sessions_by_date", kind: "area", size: 8 },
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
      { source: "engagementRate", kind: "kpi", size: 3 },
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

// Maak een verse layout (met eigen widget-id's) uit een template.
export function instantiateTemplate(tpl) {
  return {
    widgets: (tpl.widgets || []).map((w) => {
      const src = SOURCES[w.source];
      const out = {
        id: newId(),
        source: w.source,
        kind: w.kind,
        size: w.size,
        title: w.title || src?.label || w.source,
      };
      const cfg = w.config || (src && defaultConfig(src));
      if (cfg) out.config = cfg;
      return out;
    }),
  };
}

// Verwijder onbekende bronnen/typen (robuust tegen oude opgeslagen layouts).
export function sanitizeLayout(layout) {
  const widgets = Array.isArray(layout?.widgets) ? layout.widgets : [];
  return {
    widgets: widgets
      .filter((w) => w && SOURCES[w.source] && SOURCES[w.source].kinds.includes(w.kind))
      .map((w) => {
        const src = SOURCES[w.source];
        const out = {
          id: w.id || newId(),
          source: w.source,
          kind: w.kind,
          size: SIZES.some((s) => s.value === w.size) ? w.size : KINDS[w.kind].defaultSize,
          title: w.title || src.label,
        };
        if (w.config && typeof w.config === "object") out.config = w.config;
        else {
          const cfg = defaultConfig(src);
          if (cfg) out.config = cfg;
        }
        return out;
      }),
  };
}
