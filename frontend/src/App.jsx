import { Navigate, Route, Routes } from "react-router-dom";
import { useMe } from "./lib/useMe.jsx";
import { useConnections, connectedProviders } from "./lib/useConnections.jsx";
import Login from "./screens/Login.jsx";
import Onboarding from "./screens/Onboarding.jsx";
import Dashboard from "./screens/dashboard/Layout.jsx";
import Assistant from "./screens/dashboard/Assistant.jsx";
import Analytics from "./screens/dashboard/Analytics.jsx";
import SearchConsole from "./screens/dashboard/SearchConsole.jsx";
import GoogleAds from "./screens/dashboard/GoogleAds.jsx";
import MetaAds from "./screens/dashboard/MetaAds.jsx";
import MetaOrganic from "./screens/dashboard/MetaOrganic.jsx";
import WooCommerce from "./screens/dashboard/WooCommerce.jsx";
import MyDashboards from "./screens/dashboard/MyDashboards.jsx";
import Integrations from "./screens/dashboard/Integrations.jsx";
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

// First stop inside /app: send brand-new orgs (nothing connected) to onboarding,
// and land existing users on their first *connected* channel (the sidebar only
// shows connected channels, so never redirect into a hidden one).
const CHANNEL_ROUTES = [
  ["google_analytics", "/app/analytics"],
  ["search_console", "/app/search-console"],
  ["google_ads", "/app/google-ads"],
  ["meta_ads", "/app/meta-ads"],
  ["woocommerce", "/app/woocommerce"],
];

function DashIndex() {
  const { data, loading } = useConnections();
  if (loading) return <FullLoader />;
  const skipped = localStorage.getItem("kompas-onboarded");
  if (data && data.connected === 0 && !skipped) return <Navigate to="/onboarding" replace />;
  const active = connectedProviders(data);
  const first = active && CHANNEL_ROUTES.find(([p]) => active.has(p));
  if (first) return <Navigate to={first[1]} replace />;
  // Niets gekoppeld (of status onbekend): naar Integraties om te koppelen.
  return <Navigate to={active ? "/app/integrations" : "/app/analytics"} replace />;
}

export default function App() {
  const { me, loading } = useMe();
  return (
    <Routes>
      <Route path="/login" element={loading ? <FullLoader /> : me ? <Navigate to="/app" replace /> : <Login />} />
      <Route path="/onboarding" element={<RequireAuth><Onboarding /></RequireAuth>} />

      <Route path="/app" element={<RequireAuth><Dashboard /></RequireAuth>}>
        <Route index element={<DashIndex />} />
        <Route path="assistant" element={<Assistant />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="search-console" element={<SearchConsole />} />
        <Route path="google-ads" element={<GoogleAds />} />
        <Route path="meta-ads" element={<MetaAds />} />
        <Route path="meta-organic" element={<MetaOrganic />} />
        <Route path="meta" element={<Navigate to="/app/meta-ads" replace />} />
        <Route path="woocommerce" element={<WooCommerce />} />
        <Route path="dashboards" element={<MyDashboards />} />
        <Route path="integrations" element={<Integrations />} />
        <Route path="settings" element={<Settings />} />
      </Route>

      <Route path="/admin" element={<RequireAuth><Admin /></RequireAuth>} />
      <Route path="/" element={<Navigate to={me ? "/app" : "/login"} replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
