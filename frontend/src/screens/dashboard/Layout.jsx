import { Outlet } from "react-router-dom";
import Sidebar from "../../components/Sidebar.jsx";
import Topbar from "../../components/Topbar.jsx";
import { useMe } from "../../lib/useMe.jsx";
import { useConnections } from "../../lib/useConnections.jsx";

// Dashboard shell: fixed sidebar + (topbar over a scrolling content area).
export default function Layout() {
  const { me } = useMe();
  const { data } = useConnections();
  return (
    <div style={{ height: "100vh", display: "flex", background: "var(--c-page)", color: "var(--c-ink)" }}>
      <Sidebar
        org={me?.organization}
        user={me}
        connected={data?.connected ?? 0}
        total={data?.total ?? 4}
      />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <Topbar />
        <div style={{ flex: 1, overflow: "auto", padding: "26px 28px" }}>
          <Outlet />
        </div>
      </div>
    </div>
  );
}
