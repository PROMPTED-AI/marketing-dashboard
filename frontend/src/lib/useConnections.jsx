import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { useActiveOrg } from "./ActiveOrgProvider.jsx";
import { useMe } from "./useMe.jsx";
import { cachedGet, cachedSet } from "./swr.js";
import { connectionsUrl } from "./urls.js";

// Per-provider connection status for the active org, shared app-wide via
// context: the sidebar, Integraties and the index-redirect all read the same
// state, so connecting/disconnecting a channel updates the menu immediately.
// Seeds from the SWR cache and always revalidates; `reload()` forces a fresh
// fetch (called by Integraties after connect/disconnect).
const Ctx = createContext(null);

export function ConnectionsProvider({ children }) {
  const { me } = useMe();
  const { orgId } = useActiveOrg();
  const url = connectionsUrl(orgId);
  const [data, setData] = useState(() => cachedGet(url) ?? null);
  const [loading, setLoading] = useState(() => cachedGet(url) === undefined);

  const reload = useCallback(() => {
    if (!me) return Promise.resolve(); // not signed in yet: nothing to fetch
    return api(url)
      .then((d) => { cachedSet(url, d); setData(d); })
      // Transient fetch failure (deploy restart, network blip): keep the last
      // known state instead of dropping to "nothing connected".
      .catch(() => setData((prev) => prev ?? null))
      .finally(() => setLoading(false));
  }, [url, me]);

  useEffect(() => {
    if (!me) return; // wait for sign-in; avoids a guaranteed 401 on /login
    const cached = cachedGet(url);
    if (cached) { setData(cached); setLoading(false); }
    else setLoading(true);
    reload();
  }, [reload, url, me]);

  const value = useMemo(() => ({ data, loading, reload }), [data, loading, reload]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useConnections() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useConnections vereist een ConnectionsProvider");
  return ctx;
}

// Set of provider-keys with an active koppeling, or null while unknown.
// Only "connected" counts: a revoked koppeling moet eerst opnieuw gekoppeld
// worden via Integraties en hoort dus niet als actief kanaal in het menu.
export function connectedProviders(data) {
  if (!data?.connections) return null;
  return new Set(data.connections.filter((c) => c.status === "connected").map((c) => c.provider));
}
