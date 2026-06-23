import { useEffect, useState } from "react";
import { api } from "./api";

// Loads per-provider connection status for the current org.
export function useConnections() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    api("/api/connections")
      .then((d) => alive && setData(d))
      .catch(() => alive && setData(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  return { data, loading };
}
