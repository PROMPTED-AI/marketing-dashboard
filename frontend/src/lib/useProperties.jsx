import { useEffect, useState } from "react";
import { api } from "./api";
import { useActiveOrg } from "./ActiveOrgProvider.jsx";
import { cachedGet, cachedSet } from "./swr.js";
import { propertiesUrl } from "./urls.js";

// Loads the active org's GA4 properties and remembers the selected one.
// Seeds from the SWR cache so a returning visit paints instantly, then
// revalidates in the background.
export function useProperties() {
  const { orgId } = useActiveOrg();
  const url = propertiesUrl(orgId);
  const [props, setProps] = useState(() => cachedGet(url)?.properties ?? null);
  const [selected, setSelected] = useState(() => localStorage.getItem("kompas-property") || "");
  const [loading, setLoading] = useState(() => cachedGet(url) === undefined);
  const [error, setError] = useState(null);

  useEffect(() => {
    const apply = (d) => {
      const list = d.properties || [];
      setProps(list);
      setSelected((cur) => (cur && list.some((p) => p.property_id === cur) ? cur : list[0]?.property_id || ""));
    };
    const cached = cachedGet(url);
    if (cached) { apply(cached); setLoading(false); }
    else setLoading(true);
    setError(null);

    let alive = true;
    api(url)
      .then((d) => { if (!alive) return; cachedSet(url, d); apply(d); })
      .catch((e) => alive && setError(e))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [url]);

  const choose = (id) => {
    setSelected(id);
    localStorage.setItem("kompas-property", id);
  };

  return { props, selected, choose, loading, error };
}
