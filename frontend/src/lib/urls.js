// Builders for the data API URLs. Centralised so the SWR cache keys (which are
// just these URLs) stay consistent across tabs.

function orgQ(orgId) {
  return orgId ? "&org_id=" + encodeURIComponent(orgId) : "";
}

function compareQ(compare) {
  return compare ? "&compare_start=" + compare.start + "&compare_end=" + compare.end : "";
}

export function overviewUrl(propertyId, start, end, compare, orgId) {
  if (!propertyId) return null;
  return (
    "/api/analytics/overview?property_id=" + encodeURIComponent(propertyId) +
    "&start=" + start + "&end=" + end + compareQ(compare) + orgQ(orgId)
  );
}

export function gscReportUrl(site, start, end, compare, orgId) {
  if (!site) return null;
  return (
    "/api/search-console/report?site=" + encodeURIComponent(site) +
    "&start=" + start + "&end=" + end + compareQ(compare) + orgQ(orgId)
  );
}

export function propertiesUrl(orgId) {
  return "/api/analytics/properties" + (orgId ? "?org_id=" + encodeURIComponent(orgId) : "");
}

export function sitesUrl(orgId) {
  return "/api/search-console/sites" + (orgId ? "?org_id=" + encodeURIComponent(orgId) : "");
}

export function adsAccountsUrl(orgId) {
  return "/api/google-ads/accounts" + (orgId ? "?org_id=" + encodeURIComponent(orgId) : "");
}

export function adsReportUrl(customerId, start, end, compare, orgId) {
  if (!customerId) return null;
  return (
    "/api/google-ads/report?customer_id=" + encodeURIComponent(customerId) +
    "&start=" + start + "&end=" + end + compareQ(compare) + orgQ(orgId)
  );
}

export function metaAccountsUrl(orgId) {
  return "/api/meta/accounts" + (orgId ? "?org_id=" + encodeURIComponent(orgId) : "");
}

export function metaAdsReportUrl(adAccountId, start, end, compare, orgId) {
  if (!adAccountId) return null;
  return (
    "/api/meta/ads-report?ad_account_id=" + encodeURIComponent(adAccountId) +
    "&start=" + start + "&end=" + end + compareQ(compare) + orgQ(orgId)
  );
}

export function metaOrganicReportUrl(pageId, igId, start, end, orgId) {
  if (!pageId) return null;
  return (
    "/api/meta/organic-report?page_id=" + encodeURIComponent(pageId) +
    (igId ? "&ig_id=" + encodeURIComponent(igId) : "") +
    "&start=" + start + "&end=" + end + orgQ(orgId)
  );
}

export function connectionsUrl(orgId) {
  return "/api/connections" + (orgId ? "?org_id=" + encodeURIComponent(orgId) : "");
}
