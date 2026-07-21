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
    // FastAPI stuurt fouten als {"detail": "..."}; toon de leesbare boodschap
    // in plaats van de rauwe JSON.
    let msg = text || `HTTP ${res.status}`;
    try { msg = JSON.parse(msg).detail || msg; } catch { /* platte tekst */ }
    const err = new Error(msg);
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

// --- accountflow: uitnodigingen + wachtwoord vergeten ---

// Admin: nodig iemand uit voor een organisatie. Geeft {invite_url, emailed}.
export function createInvitation(email, orgId, role = "client") {
  return api("/api/admin/invitations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, org_id: orgId, role }),
  });
}

// Admin: genereer een wachtwoord-resetlink voor een bestaande gebruiker.
export function createResetLink(userId) {
  return api(`/api/admin/users/${userId}/reset-link`, { method: "POST" });
}

// Publiek: gegevens van een uitnodiging (voor het instelscherm).
export function invitationInfo(token) {
  return api(`/api/invitations/${encodeURIComponent(token)}`);
}

// Publiek: wachtwoord instellen via een uitnodiging (logt meteen in).
export function acceptInvitation(token, password) {
  return api(`/api/invitations/${encodeURIComponent(token)}/accept`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
}

// Publiek: vraag een wachtwoord-resetlink aan (antwoordt altijd hetzelfde).
export function forgotPassword(email) {
  return api("/api/auth/forgot", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
}

// Publiek: controleer een resetlink (geeft het e-mailadres).
export function resetInfo(token) {
  return api(`/api/auth/reset/${encodeURIComponent(token)}`);
}

// Publiek: stel een nieuw wachtwoord in via een resetlink.
export function resetPassword(token, password) {
  return api(`/api/auth/reset/${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
}

// Set the signed-in user's own organization profile (leadgen | ecommerce).
export function setBusinessType(businessType) {
  return api("/api/organizations/me/business-type", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ business_type: businessType }),
  });
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
