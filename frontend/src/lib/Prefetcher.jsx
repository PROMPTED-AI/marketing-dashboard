import { useEffect } from "react";
import { prefetch } from "./swr.js";
import { useActiveOrg } from "./ActiveOrgProvider.jsx";
import { useDateRange } from "./PeriodProvider.jsx";
import { useConnections, connectedProviders } from "./useConnections.jsx";
import {
  overviewUrl, propertiesUrl, sitesUrl, gscReportUrl,
  adsAccountsUrl, metaAccountsUrl, wcReportUrl,
} from "./urls.js";

// Voorlader: warmt na het inloggen de cache voor de gekoppelde kanalen, zodat
// het eerste bezoek aan een tabblad direct rendert. Laadt de keuzelijsten
// (properties, sites, accounts) plus de rapporten waarvoor de keuze al bekend
// is uit localStorage. Best effort: fouten worden stil genegeerd en alles wat
// al in de cache zit wordt overgeslagen.
export default function Prefetcher() {
  const { orgId } = useActiveOrg();
  const { start, end, compare } = useDateRange();
  const { data: connData } = useConnections();

  useEffect(() => {
    const active = connectedProviders(connData);
    if (!active || !start || !end) return;
    // Even ademruimte zodat de pagina die de gebruiker echt bekijkt voorgaat.
    const t = setTimeout(() => {
      if (active.has("google_analytics")) {
        prefetch(propertiesUrl(orgId));
        const prop = localStorage.getItem("kompas-property");
        if (prop) prefetch(overviewUrl(prop, start, end, compare, orgId));
      }
      if (active.has("search_console")) {
        prefetch(sitesUrl(orgId));
        const site = localStorage.getItem("kompas-gsc-site");
        if (site) prefetch(gscReportUrl(site, start, end, compare, orgId));
      }
      if (active.has("google_ads")) prefetch(adsAccountsUrl(orgId));
      if (active.has("meta_ads")) prefetch(metaAccountsUrl(orgId));
      if (active.has("woocommerce")) prefetch(wcReportUrl(start, end, compare, orgId));
    }, 1200);
    return () => clearTimeout(t);
  }, [connData, orgId, start, end, compare]);

  return null;
}
