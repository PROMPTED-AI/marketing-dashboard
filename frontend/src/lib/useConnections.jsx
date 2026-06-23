import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { useActiveOrg } from "./ActiveOrgProvider.jsx";

// Loads per-provider connection status for the active org.
export function useConnections() {
  const { orgId } = useActiveOrg();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    setLoading(true);
    const q = orgId ? "?org_id=" + encodeURIComponent(orgId) : "";
    return api("/api/connections" + q)
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [orgId]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, loading, reload };
}
