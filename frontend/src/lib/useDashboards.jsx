// Laadt en bewaart dashboards voor de actieve organisatie (gedeeld in de org).
// De lijst (namen + standaard-vlag) komt hiervandaan; de Overview-screen houdt
// de bewerkbare layout zelf vast.

import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";

function query(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? "?" + s : "";
}

const jsonOpts = (method, body) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export function useDashboards(orgId, page = "overview") {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const reload = useCallback(() => {
    if (!orgId) {
      setList([]);
      setLoading(false);
      return Promise.resolve([]);
    }
    setLoading(true);
    return api("/api/dashboards" + query({ page, org_id: orgId }))
      .then((d) => {
        setList(d.dashboards || []);
        setError(null);
        return d.dashboards || [];
      })
      .catch((e) => {
        setError(e);
        return [];
      })
      .finally(() => setLoading(false));
  }, [orgId, page]);

  useEffect(() => {
    reload();
  }, [reload]);

  const fetchOne = useCallback(
    (id) => api("/api/dashboards/" + encodeURIComponent(id) + query({ org_id: orgId })),
    [orgId],
  );

  const create = useCallback(
    (body) =>
      api("/api/dashboards" + query({ org_id: orgId }), jsonOpts("POST", { page, ...body }))
        .then((d) => reload().then(() => d)),
    [orgId, page, reload],
  );

  const update = useCallback(
    (id, body) =>
      api("/api/dashboards/" + encodeURIComponent(id) + query({ org_id: orgId }), jsonOpts("PUT", body))
        .then((d) => reload().then(() => d)),
    [orgId, reload],
  );

  const remove = useCallback(
    (id) =>
      api("/api/dashboards/" + encodeURIComponent(id) + query({ org_id: orgId }), { method: "DELETE" })
        .then((d) => reload().then(() => d)),
    [orgId, reload],
  );

  return { list, loading, error, reload, fetchOne, create, update, remove };
}
