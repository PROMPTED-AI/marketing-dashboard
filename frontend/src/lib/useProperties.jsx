import { useEffect, useState } from "react";
import { api } from "./api";

// Loads the org's GA4 properties and remembers the selected one.
export function useProperties() {
  const [props, setProps] = useState(null);
  const [selected, setSelected] = useState(() => localStorage.getItem("kompas-property") || "");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api("/api/analytics/properties")
      .then((d) => {
        const list = d.properties || [];
        setProps(list);
        setSelected((cur) => {
          if (cur && list.some((p) => p.property_id === cur)) return cur;
          return list[0]?.property_id || "";
        });
      })
      .catch(setError)
      .finally(() => setLoading(false));
  }, []);

  const choose = (id) => {
    setSelected(id);
    localStorage.setItem("kompas-property", id);
  };

  return { props, selected, choose, loading, error };
}
