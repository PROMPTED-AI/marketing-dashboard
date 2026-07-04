// Register van de kanaal-catalogi. Elk kanaal koppelt een catalogus (welke
// metrics + visualisaties) aan de manier waarop de data geladen wordt. De
// data-ophaling zelf gebeurt in de per-kanaal wrappers (zie MyDashboards),
// omdat React-hooks niet voorwaardelijk aangeroepen mogen worden.

import { analyticsCatalog } from "./analytics.js";
import { searchConsoleCatalog } from "./searchConsole.js";
import { googleAdsCatalog } from "./googleAds.js";
import { metaAdsCatalog } from "./metaAds.js";
import { metaOrganicCatalog } from "./metaOrganic.js";

// Volgorde = volgorde van de kanaaltabs in "Mijn dashboards".
export const CHANNELS = [
  { key: "analytics", label: "Analytics", catalog: analyticsCatalog },
  { key: "search-console", label: "Search Console", catalog: searchConsoleCatalog },
  { key: "google-ads", label: "Google Ads", catalog: googleAdsCatalog },
  { key: "meta-ads", label: "META Ads", catalog: metaAdsCatalog },
  { key: "meta-organic", label: "META Organisch", catalog: metaOrganicCatalog },
];

export const CATALOGS = Object.fromEntries(CHANNELS.map((c) => [c.key, c.catalog]));

export {
  analyticsCatalog,
  searchConsoleCatalog,
  googleAdsCatalog,
  metaAdsCatalog,
  metaOrganicCatalog,
};
