// Stale-while-revalidate cache for GET responses.
//
// Keeps a per-tab in-memory map plus a sessionStorage mirror so that revisiting
// a tab, period or client you've already seen paints instantly while a fresh
// copy is fetched in the background. Keyed by the full request URL (which
// already encodes property/site, dates, compare and org_id).

import { useEffect, useState } from "react";
import { api } from "./api.js";

const TTL = 5 * 60 * 1000; // entries older than this are ignored (still revalidated)
const mem = new Map(); // url -> { ts, data }

function fresh(entry) {
  return entry && Date.now() - entry.ts < TTL;
}

export function cachedGet(url) {
  if (!url) return undefined;
  let e = mem.get(url);
  if (fresh(e)) return e.data;
  try {
    const raw = sessionStorage.getItem("swr:" + url);
    if (raw) {
      e = JSON.parse(raw);
      if (fresh(e)) {
        mem.set(url, e);
        return e.data;
      }
    }
  } catch {
    /* sessionStorage unavailable / quota */
  }
  return undefined;
}

export function cachedSet(url, data) {
  if (!url) return;
  const e = { ts: Date.now(), data };
  mem.set(url, e);
  try {
    sessionStorage.setItem("swr:" + url, JSON.stringify(e));
  } catch {
    /* ignore quota errors */
  }
}

// Drop every cached data response for one org (after connect/disconnect).
export function invalidateOrg(orgId) {
  const needle = orgId ? "org_id=" + encodeURIComponent(orgId) : null;
  invalidate((url) => url.startsWith("/api/") && (!needle || url.includes(needle)));
}

// Drop everything we've cached for one org (after connect/disconnect/switch).
export function invalidate(predicate) {
  for (const k of [...mem.keys()]) if (predicate(k)) mem.delete(k);
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith("swr:") && predicate(k.slice(4))) sessionStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
}

// Hook: returns { data, loading, error }. Shows cached data immediately (no
// spinner) and revalidates in the background. Pass url=null to stay idle.
export function useCachedApi(url) {
  const [data, setData] = useState(() => cachedGet(url));
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(() => !!url && cachedGet(url) === undefined);

  useEffect(() => {
    if (!url) {
      setData(undefined);
      setLoading(false);
      return;
    }
    const cached = cachedGet(url);
    setData(cached);
    setError(null);
    setLoading(cached === undefined);

    let alive = true;
    api(url)
      .then((d) => {
        if (!alive) return;
        cachedSet(url, d);
        setData(d);
      })
      .catch((e) => {
        if (alive) setError(e);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [url]);

  return { data, loading, error };
}
