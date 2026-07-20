import { createContext, useContext, useEffect, useState } from "react";
import { api } from "./api";

const MeCtx = createContext({ me: null, loading: true, reload: () => {} });

export function MeProvider({ children }) {
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);

  // Stille her-load: ververst `me` zonder de globale loading-vlag te raken.
  // Belangrijk: RequireAuth vervangt de hele boom door een spinner zolang
  // loading waar is. Zou reload() die vlag zetten, dan unmount bijvoorbeeld de
  // onboarding midden in de flow en start die terug op stap 1.
  const reload = () =>
    api("/api/me")
      .then((data) => setMe(data))
      .catch(() => setMe(null));

  // Alleen de allereerste load toont de app-brede loader.
  useEffect(() => {
    reload().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <MeCtx.Provider value={{ me, loading, reload }}>{children}</MeCtx.Provider>;
}

export const useMe = () => useContext(MeCtx);
