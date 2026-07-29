import { createContext, useContext, useEffect, useState } from "react";
import { api } from "./api";
import { useMe } from "./useMe.jsx";

const Ctx = createContext(null);

// Functies die een bureau per klantaccount aan of uit kan zetten. Zolang de
// server nog niets heeft teruggegeven gaan we uit van "aan": de API is de
// harde grens, de UI verbergt alleen wat toch niet werkt.
export const ALL_FEATURES_ON = {
  signalen: true, assistant: true, integrations: true, framework: true, dashboards: true,
};

// Kanalen die het bureau per klantaccount aan of uit kan zetten. Zelfde
// principe: zolang de server niets zegt, geldt "aan".
export const ALL_CHANNELS_ON = {
  google_analytics: true, search_console: true, google_ads: true,
  meta_ads: true, woocommerce: true, shopify: true,
};

// Holds the organization the dashboard is currently scoped to. Agency admins
// can switch between all client orgs; clients only have their own.
export function ActiveOrgProvider({ children }) {
  const { me } = useMe();
  const [orgs, setOrgs] = useState([]);
  const [orgId, setOrgId] = useState(() => localStorage.getItem("kompas-active-org") || "");

  const reload = () =>
    api("/api/organizations")
      .then((d) => setOrgs(d.organizations || []))
      .catch(() => setOrgs([]));

  useEffect(() => {
    if (!me) return;
    reload();
  }, [me?.email]);

  // Default to (and fall back to) the user's own org.
  useEffect(() => {
    const own = me?.organization?.id;
    if (!own) return;
    const valid = orgs.length === 0 || orgs.some((o) => o.id === orgId);
    if (!orgId || !valid) setOrgId(own);
  }, [me?.organization?.id, orgs, orgId]);

  const setOrg = (id) => {
    setOrgId(id);
    localStorage.setItem("kompas-active-org", id);
    // a different client has different properties/sites — let them auto-reselect
    localStorage.removeItem("kompas-property");
    localStorage.removeItem("kompas-gsc-site");
  };

  const activeOrg = orgs.find((o) => o.id === orgId);
  const orgName = activeOrg?.name || me?.organization?.name || "—";
  // Company profile of the active org, drives which dashboard views/KPIs default.
  const businessType =
    activeOrg?.business_type || me?.organization?.business_type || "leadgen";
  // Welke onderdelen het bureau voor déze omgeving heeft geactiveerd. Bij het
  // wisselen van klant wisselt de stand mee; valt de lijst nog niet terug, dan
  // gelden de functies van de eigen organisatie.
  const features = {
    ...ALL_FEATURES_ON,
    ...(activeOrg?.features || (!orgId || orgId === me?.organization?.id ? me?.features : null) || {}),
  };
  // Welke kanalen deze omgeving mag zien/koppelen (naast de functie Integraties).
  const channels = {
    ...ALL_CHANNELS_ON,
    ...(activeOrg?.channels || (!orgId || orgId === me?.organization?.id ? me?.channels : null) || {}),
  };
  return (
    <Ctx.Provider value={{ orgId, orgName, orgs, setOrg, reload, businessType, features, channels }}>
      {children}
    </Ctx.Provider>
  );
}

export const useActiveOrg = () => useContext(Ctx);
