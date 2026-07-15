// Small fetch wrapper. All calls share the session cookie.
export async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: "include", ...opts });
  if (res.status === 401) {
    const err = new Error("unauthorized");
    err.status = 401;
    throw err;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(text || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : res.text();
}

export const LOGIN_URL = "/api/auth/google/login";
export const LOGOUT_URL = "/api/auth/logout";

// Sign in with email + password. Resolves on success; on failure throws an
// Error whose message is the server's detail (e.g. wrong combination). Uses a
// raw fetch so the 401 body is read (the shared api() wrapper hides it).
export async function passwordLogin(email, password) {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    let detail = "Inloggen mislukt. Probeer het opnieuw.";
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
    } catch { /* non-JSON error body */ }
    const err = new Error(detail);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// Disconnect a source (revokes the Google grant when it's the last one).
export function disconnectProvider(provider, orgId) {
  const q = orgId ? "?org_id=" + encodeURIComponent(orgId) : "";
  return api("/api/connections/" + encodeURIComponent(provider) + "/disconnect" + q, { method: "POST" });
}

// Meta uses its own Facebook Login flow (not the Google connect).
export function metaLoginUrl(orgId, returnTo = "/app/integrations") {
  const q = orgId ? "&org_id=" + encodeURIComponent(orgId) : "";
  return "/api/auth/meta/login?return_to=" + encodeURIComponent(returnTo) + q;
}

// Incremental authorization: connect specific tools for the signed-in user.
export function connectUrl(providers, returnTo = "/app/integrations") {
  const list = Array.isArray(providers) ? providers : [providers];
  return (
    "/api/auth/google/connect?providers=" +
    encodeURIComponent(list.join(",")) +
    "&return_to=" +
    encodeURIComponent(returnTo)
  );
}
