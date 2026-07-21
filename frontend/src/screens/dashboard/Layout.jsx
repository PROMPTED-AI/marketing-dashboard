import { useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useEffect } from "react";
import Sidebar from "../../components/Sidebar.jsx";
import Topbar from "../../components/Topbar.jsx";
import FeedbackButton from "../../components/FeedbackButton.jsx";
import TrialExpired from "../../components/TrialExpired.jsx";
import { useMe } from "../../lib/useMe.jsx";
import { useConnections } from "../../lib/useConnections.jsx";

// Dashboard shell: sidebar + (topbar over a scrolling content area).
// On mobile the sidebar collapses into a slide-in drawer toggled from the topbar.
export default function Layout() {
  const { me } = useMe();
  const { data } = useConnections();
  const [drawer, setDrawer] = useState(false);
  const { pathname } = useLocation();

  // Close the drawer whenever the route changes (e.g. after tapping a nav item).
  useEffect(() => { setDrawer(false); }, [pathname]);

  // Verlopen proefperiode: vervang het hele dashboard door het verloopscherm.
  // De agency admin behoudt toegang (die beheert de proefperiodes).
  if (me?.subscription?.expired && me?.role !== "agency_admin") {
    return <TrialExpired me={me} />;
  }

  return (
    <div style={{ height: "100vh", display: "flex", background: "var(--c-page)", color: "var(--c-ink)" }}>
      <div className={`app-scrim no-print${drawer ? " show" : ""}`} onClick={() => setDrawer(false)} />
      <Sidebar
        user={me}
        connected={data?.connected ?? 0}
        total={data?.total ?? 5}
        open={drawer}
        onNavigate={() => setDrawer(false)}
      />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <Topbar onMenu={() => setDrawer(true)} />
        <div className="dash-content" style={{ flex: 1, overflow: "auto", padding: "26px 28px" }}>
          <Outlet />
        </div>
      </div>
      <FeedbackButton />
    </div>
  );
}
