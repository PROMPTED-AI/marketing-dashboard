import { Navigate, Route, Routes } from "react-router-dom";
import { useMe } from "./lib/useMe.jsx";
import { useConnections } from "./lib/useConnections.jsx";
import Login from "./screens/Login.jsx";
import Onboarding from "./screens/Onboarding.jsx";
import Dashboard from "./screens/dashboard/Layout.jsx";
import Overview from "./screens/dashboard/Overview.jsx";
import Analytics from "./screens/dashboard/Analytics.jsx";
import SearchConsole from "./screens/dashboard/SearchConsole.jsx";
import GoogleAds from "./screens/dashboard/GoogleAds.jsx";
import Meta from "./screens/dashboard/Meta.jsx";
import Integrations from "./screens/dashboard/Integrations.jsx";
import Reports from "./screens/dashboard/Reports.jsx";
import Settings from "./screens/dashboard/Settings.jsx";
import Placeholder from "./screens/dashboard/Placeholder.jsx";
import Admin from "./screens/Admin.jsx";

function FullLoader() {
  return (
    <div style={{ height: "100vh", display: "grid", placeItems: "center" }}>
      <div className="spin" />
    </div>
  );
}

function RequireAuth({ children }) {
  const { me, loading } = useMe();
  if (loading) return <FullLoader />;
  if (!me) return <Navigate to="/login" replace />;
  return children;
}

// First stop inside /app: send brand-new orgs (nothing connected) to onboarding.
function DashIndex() {
  const { data, loading } = useConnections();
  if (loading) return <FullLoader />;
  const skipped = localStorage.getItem("kompas-onboarded");
  if (data && data.connected === 0 && !skipped) return <Navigate to="/onboarding" replace />;
  return <Navigate to="/app/overview" replace />;
}

export default function App() {
  const { me, loading } = useMe();
  return (
    <Routes>
      <Route path="/login" element={loading ? <FullLoader /> : me ? <Navigate to="/app" replace /> : <Login />} />
      <Route path="/onboarding" element={<RequireAuth><Onboarding /></RequireAuth>} />

      <Route path="/app" element={<RequireAuth><Dashboard /></RequireAuth>}>
        <Route index element={<DashIndex />} />
        <Route path="overview" element={<Overview />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="search-console" element={<SearchConsole />} />
        <Route path="google-ads" element={<GoogleAds />} />
        <Route path="meta" element={<Meta />} />
        <Route path="reports" element={<Reports />} />
        <Route path="integrations" element={<Integrations />} />
        <Route path="settings" element={<Settings />} />
      </Route>

      <Route path="/admin" element={<RequireAuth><Admin /></RequireAuth>} />
      <Route path="/" element={<Navigate to={me ? "/app" : "/login"} replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
