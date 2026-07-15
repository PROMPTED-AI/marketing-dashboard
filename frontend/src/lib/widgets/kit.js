// Gedeeld gereedschap voor het samenstelbare-dashboardsysteem.
//
// Een *catalogus* beschrijft één kanaal (Analytics, Search Console, Google Ads,
// META Ads, META Organisch). Elke catalogus levert:
//   - SOURCES : de beschikbare metrics ("bronnen"), elk met de visualisaties
//               (kinds) die ervoor mogelijk zijn en accessor-functies die tegen
//               de payload van dat kanaal werken.
//   - GROUPS  : bronnen gecategoriseerd voor de "widget toevoegen"-keuze.
//   - TEMPLATES: kant-en-klare startindelingen.
//   - seriesDates(payload): de x-as-labels (korte datums) voor sparklines/area.
//
// De visualisaties (KINDS) en groottes (SIZES) zijn kanaal-onafhankelijk en
// staan daarom hier. De renderer en editor zijn generiek en krijgen de juiste
// catalogus als prop mee.

import { shortDate } from "../format.js";

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

// Zet een rij payload-punten om naar korte x-as-datums. Accepteert zowel
// "YYYY-MM-DD" (Search Console / META) als "YYYYMMDD" (Analytics).
export function seriesDatesFrom(rows, key = "date") {
  return (rows ?? []).map((r) => shortDate(String(r?.[key] ?? "").replaceAll("-", "")));
}

// --- bedrijfstype-profiel (leadgen | ecommerce) ---------------------------
// Een template hoort bij het profiel als het geen profiel declareert (legacy),
// "both" is, of exact matcht. Zo blijft alles backward-compatible.
export function templateMatchesProfile(tpl, businessType) {
  const p = tpl?.profile ?? "both";
  return p === "both" || p === businessType;
}

// Templates gesorteerd voor een profiel: passende eerst (in oorspronkelijke
// volgorde), de andere-profiel-templates daarna. Niets wordt verwijderd (soft).
export function templatesForProfile(catalog, businessType) {
  const all = catalog?.TEMPLATES ?? [];
  const match = all.filter((t) => templateMatchesProfile(t, businessType));
  const rest = all.filter((t) => !templateMatchesProfile(t, businessType));
  return { match, rest, ordered: [...match, ...rest] };
}

// De default-template voor een profiel: de eerste passende, met de allereerste
// template als laatste vangnet.
export function defaultTemplateFor(catalog, businessType) {
  const all = catalog?.TEMPLATES ?? [];
  return all.find((t) => templateMatchesProfile(t, businessType)) || all[0];
}

let _seq = 0;
export function newId() {
  return "w" + Date.now().toString(36) + (_seq++).toString(36);
}

// Standaard-config voor een bron (alleen als die een filter heeft).
export function defaultConfig(src) {
  return src?.config ? { [src.config.key]: src.config.default } : undefined;
}

// Maak een nieuwe widget voor een bron in deze catalogus.
export function newWidget(catalog, sourceId, kind) {
  const src = catalog.SOURCES[sourceId];
  const k = kind && src.kinds.includes(kind) ? kind : src.kinds[0];
  const w = { id: newId(), source: sourceId, kind: k, title: src.label, size: KINDS[k].defaultSize };
  const cfg = defaultConfig(src);
  if (cfg) w.config = cfg;
  return w;
}

// Maak een verse layout (met eigen widget-id's) uit een template.
export function instantiateTemplate(catalog, tpl) {
  return {
    widgets: (tpl.widgets || []).map((w) => {
      const src = catalog.SOURCES[w.source];
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
export function sanitizeLayout(catalog, layout) {
  const widgets = Array.isArray(layout?.widgets) ? layout.widgets : [];
  return {
    widgets: widgets
      .filter((w) => w && catalog.SOURCES[w.source] && catalog.SOURCES[w.source].kinds.includes(w.kind))
      .map((w) => {
        const src = catalog.SOURCES[w.source];
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

// Bouw een {label, value, pct} verdeling uit ruwe rijen. `pct` = aandeel van de
// som (afgerond). Gebruikt door donut/bars/tabel-verdelingen.
export function toBreakdown(rows, { label, value }) {
  const list = (rows ?? []).map((r) => ({ label: label(r), value: value(r) || 0 }));
  const total = list.reduce((a, x) => a + x.value, 0) || 1;
  return list.map((x) => ({ ...x, pct: Math.round((x.value / total) * 100) }));
}
