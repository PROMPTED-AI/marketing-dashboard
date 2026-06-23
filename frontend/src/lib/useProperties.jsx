import { useEffect, useState } from "react";
import { api } from "./api";
import { useActiveOrg } from "./ActiveOrgProvider.jsx";

// Loads the active org's GA4 properties and remembers the selected one.
export function useProperties() {
  const { orgId } = useActiveOrg();
  const [props, setProps] = useState(null);
  const [selected, setSelected] = useState(() => localStorage.getItem("kompas-property") || "");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const q = orgId ? "?org_id=" + encodeURIComponent(orgId) : "";
    api("/api/analytics/properties" + q)
      .then((d) => {
        const list = d.properties || [];
        setProps(list);
        setSelected((cur) => (cur && list.some((p) => p.property_id === cur) ? cur : list[0]?.property_id || ""));
      })
      .catch(setError)
      .finally(() => setLoading(false));
  }, [orgId]);

  const choose = (id) => {
    setSelected(id);
    localStorage.setItem("kompas-property", id);
  };

  return { props, selected, choose, loading, error };
}
