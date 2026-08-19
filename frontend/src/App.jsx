import { Navigate, Route, Routes } from "react-router-dom";
import { useMe } from "./lib/useMe.jsx";
import { useConnections, connectedProviders } from "./lib/useConnections.jsx";
import Login from "./screens/Login.jsx";
import { Invite, ResetPassword } from "./screens/PasswordFlow.jsx";
import Onboarding from "./screens/Onboarding.jsx";
import Dashboard from "./screens/dashboard/Layout.jsx";
import Assistant from "./screens/dashboard/Assistant.jsx";
import Signalen from "./screens/dashboard/Signalen.jsx";
import Analytics from "./screens/dashboard/Analytics.jsx";
import SearchConsole from "./screens/dashboard/SearchConsole.jsx";
import GoogleAds from "./screens/dashboard/GoogleAds.jsx";
import MetaAds from "./screens/dashboard/MetaAds.jsx";
import MetaOrganic from "./screens/dashboard/MetaOrganic.jsx";
import WooCommerce from "./screens/dashboard/WooCommerce.jsx";
import Shopify from "./screens/dashboard/Shopify.jsx";
import MyDashboards from "./screens/dashboard/MyDashboards.jsx";
import Framework from "./screens/dashboard/Framework.jsx";
import Integrations from "./screens/dashboard/Integrations.jsx";
import Settings from "./screens/dashboard/Settings.jsx";
import Placeholder from "./screens/dashboard/Placeholder.jsx";
import Admin from "./screens/Admin.jsx";
import FeatureGate, { ChannelGate } from "./components/FeatureGate.jsx";
import { useActiveOrg } from "./lib/ActiveOrgProvider.jsx";

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
  const { features, channels } = useActiveOrg();
  if (loading) return <FullLoader />;
  const skipped = localStorage.getItem("kompas-onboarded");
  // Staat Integraties uit, dan zijn kanalen onzichtbaar en richt het bureau de
  // omgeving in; onboarding (zelf koppelen) heeft dan geen zin.
  const channelsVisible = features.integrations !== false;
  if (data && data.connected === 0 && !skipped && channelsVisible) {
    return <Navigate to="/onboarding" replace />;
  }
  const active = connectedProviders(data);
  const first = channelsVisible && active &&
    CHANNEL_ROUTES.find(([p]) => active.has(p) && channels[p] !== false);
  if (first) return <Navigate to={first[1]} replace />;
  // Geen zichtbaar kanaal: naar het eerste onderdeel dat wél beschikbaar is,
  // of naar Integraties om te koppelen als dat mag.
  if (active || !channelsVisible) {
    if (channelsVisible) return <Navigate to="/app/integrations" replace />;
    if (features.signalen !== false) return <Navigate to="/app/signalen" replace />;
    if (features.dashboards !== false) return <Navigate to="/app/dashboards" replace />;
    if (features.framework !== false) return <Navigate to="/app/framework" replace />;
    return <Navigate to="/app/settings" replace />;
  }
  return <Navigate to="/app/analytics" replace />;
}

export default function App() {
  const { me, loading } = useMe();
  return (
    <Routes>
      <Route path="/login" element={loading ? <FullLoader /> : me ? <Navigate to="/app" replace /> : <Login />} />
      <Route path="/invite/:token" element={<Invite />} />
      <Route path="/reset/:token" element={<ResetPassword />} />
      <Route path="/onboarding" element={<RequireAuth><Onboarding /></RequireAuth>} />

      <Route path="/app" element={<RequireAuth><Dashboard /></RequireAuth>}>
        <Route index element={<DashIndex />} />
        <Route path="assistant" element={<FeatureGate feature="assistant"><Assistant /></FeatureGate>} />
        <Route path="signalen" element={<FeatureGate feature="signalen"><Signalen /></FeatureGate>} />
        <Route path="analytics" element={<ChannelGate provider="google_analytics"><Analytics /></ChannelGate>} />
        <Route path="search-console" element={<ChannelGate provider="search_console"><SearchConsole /></ChannelGate>} />
        <Route path="google-ads" element={<ChannelGate provider="google_ads"><GoogleAds /></ChannelGate>} />
        <Route path="meta-ads" element={<ChannelGate provider="meta_ads"><MetaAds /></ChannelGate>} />
        <Route path="meta-organic" element={<ChannelGate provider="meta_ads"><MetaOrganic /></ChannelGate>} />
        <Route path="meta" element={<Navigate to="/app/meta-ads" replace />} />
        <Route path="woocommerce" element={<ChannelGate provider="woocommerce"><WooCommerce /></ChannelGate>} />
        <Route path="shopify" element={<ChannelGate provider="shopify"><Shopify /></ChannelGate>} />
        <Route path="dashboards" element={<FeatureGate feature="dashboards"><MyDashboards /></FeatureGate>} />
        <Route path="framework" element={<FeatureGate feature="framework"><Framework /></FeatureGate>} />
        <Route path="integrations" element={<FeatureGate feature="integrations"><Integrations /></FeatureGate>} />
        <Route path="settings" element={<Settings />} />
      </Route>

      <Route path="/admin" element={<RequireAuth><Admin /></RequireAuth>} />
      <Route path="/" element={<Navigate to={me ? "/app" : "/login"} replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
