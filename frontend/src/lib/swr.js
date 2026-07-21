// Stale-while-revalidate cache for GET responses.
//
// Keeps a per-tab in-memory map plus a localStorage mirror, so that a next
// visit (also after a browser restart) paints instantly with the last known
// data while a fresh copy is fetched in the background. Keyed by the full
// request URL (which already encodes property/site, dates, compare and
// org_id).
//
// Entries older than MAX_AGE are dropped; anything younger is shown
// immediately, regardless of age, and always revalidated. On quota errors the
// whole mirror is cleared (cache is best effort).

import { useEffect, useState } from "react";
import { api } from "./api.js";

const MAX_AGE = 7 * 24 * 60 * 60 * 1000; // ouder dan een week negeren
const PREFIX = "swr:";
const mem = new Map(); // url -> { ts, data }

function usable(entry) {
  return entry && Date.now() - entry.ts < MAX_AGE;
}

export function cachedGet(url) {
  if (!url) return undefined;
  let e = mem.get(url);
  if (usable(e)) return e.data;
  try {
    const raw = localStorage.getItem(PREFIX + url);
    if (raw) {
      e = JSON.parse(raw);
      if (usable(e)) {
        mem.set(url, e);
        return e.data;
      }
      localStorage.removeItem(PREFIX + url);
    }
  } catch {
    /* localStorage unavailable / corrupt entry */
  }
  return undefined;
}

export function cachedSet(url, data) {
  if (!url) return;
  const e = { ts: Date.now(), data };
  mem.set(url, e);
  try {
    localStorage.setItem(PREFIX + url, JSON.stringify(e));
  } catch {
    // Quota vol: hele spiegel leegmaken en één keer opnieuw proberen.
    try {
      clearMirror();
      localStorage.setItem(PREFIX + url, JSON.stringify(e));
    } catch {
      /* dan alleen in-memory */
    }
  }
}

function clearMirror() {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k && k.startsWith(PREFIX)) localStorage.removeItem(k);
  }
}

// Drop every cached data response for one org (after connect/disconnect).
export function invalidateOrg(orgId) {
  const needle = orgId ? "org_id=" + encodeURIComponent(orgId) : null;
  invalidate((url) => url.startsWith("/api/") && (!needle || url.includes(needle)));
}

// Alles wissen (bij uitloggen: geen klantdata achterlaten in de browser).
export function invalidateAll() {
  mem.clear();
  try {
    clearMirror();
  } catch {
    /* ignore */
  }
}

// Drop everything we've cached matching a predicate (after connect/disconnect/switch).
export function invalidate(predicate) {
  for (const k of [...mem.keys()]) if (predicate(k)) mem.delete(k);
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX) && predicate(k.slice(PREFIX.length))) localStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
}

// Warm the cache in the background without a component asking for the data
// yet (used to preload reports right after login).
export function prefetch(url) {
  if (!url || cachedGet(url) !== undefined) return;
  api(url)
    .then((d) => cachedSet(url, d))
    .catch(() => {
      /* voorladen is best effort */
    });
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
