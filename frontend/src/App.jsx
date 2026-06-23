import { Navigate, Route, Routes } from "react-router-dom";
import { useMe } from "./lib/useMe.jsx";
import Login from "./screens/Login.jsx";
import Dashboard from "./screens/dashboard/Layout.jsx";

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

export default function App() {
  const { me, loading } = useMe();
  return (
    <Routes>
      <Route
        path="/login"
        element={loading ? <FullLoader /> : me ? <Navigate to="/app" replace /> : <Login />}
      />
      <Route
        path="/app/*"
        element={
          <RequireAuth>
            <Dashboard />
          </RequireAuth>
        }
      />
      <Route path="/" element={<Navigate to={me ? "/app" : "/login"} replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
