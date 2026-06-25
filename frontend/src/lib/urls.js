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

export function connectionsUrl(orgId) {
  return "/api/connections" + (orgId ? "?org_id=" + encodeURIComponent(orgId) : "");
}
