import { Navigate, Route, Routes } from "react-router-dom";
import { useMe } from "./lib/useMe.jsx";
import { useConnections } from "./lib/useConnections.jsx";
import Login from "./screens/Login.jsx";
import Onboarding from "./screens/Onboarding.jsx";
import Dashboard from "./screens/dashboard/Layout.jsx";
import Placeholder from "./screens/dashboard/Placeholder.jsx";

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
  if (data && data.connected === 0) return <Navigate to="/onboarding" replace />;
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
        <Route path="overview" element={<Placeholder title="overzicht" note="prestaties van je marketingkanalen" />} />
        <Route path="analytics" element={<Placeholder title="analytics — gedrag & verkeer" note="automatisch ingeladen via je GA4-koppeling" />} />
        <Route path="search-console" element={<Placeholder title="search console" note="organisch verkeer, posities & zoekwoorden" />} />
        <Route path="google-ads" element={<Placeholder title="google ads" comingSoon />} />
        <Route path="meta" element={<Placeholder title="meta / social" comingSoon />} />
        <Route path="reports" element={<Placeholder title="rapporten" />} />
        <Route path="integrations" element={<Placeholder title="integraties" note="beheer je gekoppelde bronnen" />} />
        <Route path="settings" element={<Placeholder title="instellingen" />} />
      </Route>

      <Route path="/" element={<Navigate to={me ? "/app" : "/login"} replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
