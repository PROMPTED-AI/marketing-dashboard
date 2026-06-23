import { createContext, useContext, useEffect, useState } from "react";
import { api } from "./api";

const MeCtx = createContext({ me: null, loading: true, reload: () => {} });

export function MeProvider({ children }) {
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);

  const reload = () => {
    setLoading(true);
    api("/api/me")
      .then((data) => setMe(data))
      .catch(() => setMe(null))
      .finally(() => setLoading(false));
  };

  useEffect(reload, []);

  return <MeCtx.Provider value={{ me, loading, reload }}>{children}</MeCtx.Provider>;
}

export const useMe = () => useContext(MeCtx);
