import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { useActiveOrg } from "./ActiveOrgProvider.jsx";
import { cachedGet, cachedSet } from "./swr.js";
import { connectionsUrl } from "./urls.js";

// Loads per-provider connection status for the active org. Seeds from cache and
// always revalidates; `reload()` forces a fresh fetch (after connect/disconnect).
export function useConnections() {
  const { orgId } = useActiveOrg();
  const url = connectionsUrl(orgId);
  const [data, setData] = useState(() => cachedGet(url) ?? null);
  const [loading, setLoading] = useState(() => cachedGet(url) === undefined);

  const reload = useCallback(() => {
    return api(url)
      .then((d) => { cachedSet(url, d); setData(d); })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [url]);

  useEffect(() => {
    const cached = cachedGet(url);
    if (cached) { setData(cached); setLoading(false); }
    else setLoading(true);
    reload();
  }, [reload, url]);

  return { data, loading, reload };
}
