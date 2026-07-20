// Gecombineerde "Overzicht"-catalogus: alle kanaal-catalogi samengevoegd zodat
// één dashboard widgets uit verschillende kanalen kan mixen (bijv. sessies uit
// Analytics naast kosten uit Google Ads en omzet uit WooCommerce).
//
// Werking: elke bron krijgt een namespaced id ("<kanaal>:<bron>") en een
// wrapper om de accessors die de kanaalpayload uit de gecombineerde payload
// pakt: data = { analytics: {...}, "google-ads": {...}, ... }. De ctx werkt
// hetzelfde (ctx["meta-ads"] draagt bijv. de valuta). Omdat de datums per
// kanaal kunnen verschillen, krijgt elke bron een eigen seriesDates die tegen
// de eigen kanaalpayload leest (WidgetRenderer geeft die voorrang).

import { analyticsCatalog } from "./analytics.js";
import { searchConsoleCatalog } from "./searchConsole.js";
import { googleAdsCatalog } from "./googleAds.js";
import { metaAdsCatalog } from "./metaAds.js";
import { metaOrganicCatalog } from "./metaOrganic.js";
import { woocommerceCatalog } from "./woocommerce.js";

// key = sleutel in de gecombineerde payload; provider = koppelingsnaam waarop
// gefilterd wordt (alleen gekoppelde kanalen doen mee).
const CHANNEL_DEFS = [
  { key: "analytics", provider: "google_analytics", label: "Analytics", catalog: analyticsCatalog },
  { key: "search-console", provider: "search_console", label: "Search Console", catalog: searchConsoleCatalog },
  { key: "google-ads", provider: "google_ads", label: "Google Ads", catalog: googleAdsCatalog },
  { key: "meta-ads", provider: "meta_ads", label: "META Ads", catalog: metaAdsCatalog },
  { key: "meta-organic", provider: "meta_ads", label: "META Organisch", catalog: metaOrganicCatalog },
  { key: "woocommerce", provider: "woocommerce", label: "WooCommerce", catalog: woocommerceCatalog },
];

const ACCESSORS = ["scalar", "spark", "series", "breakdown", "table"];

function wrapSource(src, chKey, chCatalog) {
  const wrapped = { ...src };
  for (const fn of ACCESSORS) {
    if (typeof src[fn] === "function") {
      wrapped[fn] = (d, cfg, ctx) => src[fn](d?.[chKey], cfg, ctx?.[chKey]);
    }
  }
  // Eigen datums per bron: de kanalen delen de periode, maar niet per se
  // dezelfde reeksindeling; lees dus tegen de eigen kanaalpayload.
  wrapped.seriesDates = (d) => (chCatalog.seriesDates ? chCatalog.seriesDates(d?.[chKey]) : []);
  return wrapped;
}

// Kant-en-klare cross-kanaal templates. Widgets van niet-gekoppelde kanalen
// worden er bij het bouwen uitgefilterd, zodat een template altijd rendert.
const TEMPLATES = [
  {
    id: "mix-marketing", name: "Marketing-overzicht", audience: "Directie", profile: "both",
    description: "Het complete plaatje in één oogopslag: bezoekers en verkeer naast advertentie-uitgaven, SEO-klikken en omzet, uit al je kanalen samen.",
    widgets: [
      { source: "analytics:sessions", kind: "kpi", size: 3 },
      { source: "analytics:users", kind: "kpi", size: 3 },
      { source: "search-console:clicks", kind: "kpi", size: 3 },
      { source: "google-ads:cost", kind: "kpi", size: 3 },
      { source: "meta-ads:spend", kind: "kpi", size: 3 },
      { source: "woocommerce:revenue", kind: "kpi", size: 3 },
      { source: "analytics:conversions_total", kind: "kpi", size: 3 },
      { source: "google-ads:conversions", kind: "kpi", size: 3 },
      { source: "analytics:sessions_by_date", kind: "area", size: 12 },
      { source: "analytics:channels", kind: "donut", size: 4 },
      { source: "google-ads:spend_share", kind: "donut", size: 4 },
      { source: "search-console:top_queries", kind: "table", size: 4 },
    ],
  },
  {
    id: "mix-ecommerce", name: "Omzet & rendement", audience: "Directie", profile: "ecommerce",
    description: "Omzet, bestellingen en advertentierendement uit al je kanalen: wat kost het en wat levert het op.",
    widgets: [
      { source: "woocommerce:revenue", kind: "kpi", size: 3 },
      { source: "woocommerce:orders", kind: "kpi", size: 3 },
      { source: "google-ads:roas", kind: "kpi", size: 3 },
      { source: "google-ads:cost", kind: "kpi", size: 3 },
      { source: "meta-ads:spend", kind: "kpi", size: 3 },
      { source: "analytics:revenue", kind: "kpi", size: 3 },
      { source: "analytics:sessions", kind: "kpi", size: 3 },
      { source: "search-console:clicks", kind: "kpi", size: 3 },
      { source: "woocommerce:revenue_by_date", kind: "area", size: 12 },
      { source: "woocommerce:top_products", kind: "table", size: 6 },
      { source: "google-ads:spend_share", kind: "donut", size: 6 },
    ],
  },
  {
    id: "mix-leadgen", name: "Leads & kosten", audience: "Directie", profile: "leadgen",
    description: "Leads en conversies naast de advertentiekosten en het organische verkeer dat ze aanlevert.",
    widgets: [
      { source: "analytics:conversions_total", kind: "kpi", size: 3 },
      { source: "google-ads:conversions", kind: "kpi", size: 3 },
      { source: "google-ads:cpa", kind: "kpi", size: 3 },
      { source: "google-ads:cost", kind: "kpi", size: 3 },
      { source: "meta-ads:results", kind: "kpi", size: 3 },
      { source: "search-console:clicks", kind: "kpi", size: 3 },
      { source: "analytics:sessions", kind: "kpi", size: 3 },
      { source: "meta-ads:spend", kind: "kpi", size: 3 },
      { source: "google-ads:cost_by_date", kind: "area", size: 12 },
      { source: "analytics:channels", kind: "donut", size: 6 },
      { source: "google-ads:campaigns", kind: "table", size: 6 },
    ],
  },
];

// Bouw de gecombineerde catalogus, beperkt tot de gekoppelde kanalen.
// `connected` is een Set met provider-keys, of null zolang die onbekend is
// (dan doen alle kanalen mee, zodat er nooit een leeg scherm flitst).
export function buildOverviewCatalog(connected) {
  const defs = CHANNEL_DEFS.filter((c) => !connected || connected.has(c.provider));
  const SOURCES = {};
  const GROUPS = [];
  for (const ch of defs) {
    for (const [id, src] of Object.entries(ch.catalog.SOURCES)) {
      SOURCES[`${ch.key}:${id}`] = wrapSource(src, ch.key, ch.catalog);
    }
    for (const g of ch.catalog.GROUPS) {
      const ids = g.ids.map((id) => `${ch.key}:${id}`).filter((id) => SOURCES[id]);
      if (ids.length) GROUPS.push({ label: `${ch.label} · ${g.label}`, ids });
    }
  }
  const templates = TEMPLATES.map((t) => ({
    ...t,
    widgets: t.widgets.filter((w) => SOURCES[w.source]),
  })).filter((t) => t.widgets.length);
  return {
    SOURCES,
    GROUPS,
    TEMPLATES: templates,
    // Vangnet voor bronnen zonder eigen seriesDates (komt niet voor, maar de
    // renderer verwacht de functie op catalogusniveau te kunnen aanroepen).
    seriesDates: (d) => analyticsCatalog.seriesDates?.(d?.analytics) ?? [],
  };
}
