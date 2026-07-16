import { createContext, useContext, useEffect, useState } from "react";
import { api } from "./api";
import { useMe } from "./useMe.jsx";

const Ctx = createContext(null);

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
  return <Ctx.Provider value={{ orgId, orgName, orgs, setOrg, reload, businessType }}>{children}</Ctx.Provider>;
}

export const useActiveOrg = () => useContext(Ctx);
