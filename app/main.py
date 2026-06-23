"""FastAPI app: multi-tenant Google Analytics dashboard (hybrid model).

Identity + data access both run through Google OAuth: signing in identifies
the user (by email) AND connects their organization's GA data.

Roles
-----
client        : sees only their own organization's data
agency_admin  : sees every organization + its connection status, and can view
                any organization's data (set via AGENCY_ADMIN_EMAILS)

Routes
------
GET  /                              -> dashboard page (static HTML)
GET  /healthz                       -> health check
GET  /api/me                        -> current user + organization + role
GET  /api/auth/google/login         -> sign in / connect with Google
GET  /api/auth/google/callback      -> identify user, store connection
GET  /api/auth/logout               -> clear session
GET  /api/admin/organizations       -> (admin) all orgs + connection status
GET  /api/analytics/properties      -> GA4 properties for an organization
GET  /api/analytics/report          -> sample GA4 report for a property
"""
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from google.auth.exceptions import RefreshError
from google.oauth2.credentials import Credentials
from starlette.middleware.sessions import SessionMiddleware

from . import analytics, auth, config, db, models, oauth, search_console

# The React/Vite build is copied here by the Dockerfile (stage 1 -> stage 2).
SPA_DIR = Path(__file__).resolve().parent / "static_spa"
SPA_INDEX = SPA_DIR / "index.html"


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_schema()
    yield


app = FastAPI(title="Marketing Dashboard - GA4 (multi-tenant)", lifespan=lifespan)
app.add_middleware(SessionMiddleware, secret_key=config.SESSION_SECRET)

# Serve the built SPA's static assets (present in production / after a build).
if (SPA_DIR / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=SPA_DIR / "assets"), name="assets")
if (SPA_DIR / "fonts").is_dir():
    app.mount("/fonts", StaticFiles(directory=SPA_DIR / "fonts"), name="fonts")


def _resolve_org_id(user: dict, requested_org_id: str | None) -> str:
    """Clients are pinned to their own org; admins may target any org."""
    if requested_org_id and user["role"] == "agency_admin":
        return requested_org_id
    return user["organization_id"]


def _org_credentials(org_id: str, provider: str = "google_analytics") -> Credentials:
    """Load + refresh an org's credentials, flipping status to revoked on failure."""
    conn = models.get_connection(org_id, provider=provider)
    if not conn or conn["status"] != "connected":
        raise HTTPException(status_code=409, detail="No active connection for this organization")
    try:
        creds = oauth.credentials_from_dict(conn["creds"])
    except RefreshError:
        models.set_connection_status(org_id, "revoked", provider=provider)
        raise HTTPException(status_code=409, detail="Connection expired - please reconnect")
    # Persist any refreshed access token.
    models.save_connection(org_id, conn["google_email"], oauth.credentials_to_dict(creds), provider=provider)
    return creds


@app.get("/healthz")
def healthz():
    return {"status": "ok"}


@app.get("/api/me")
def me(request: Request):
    user = auth.current_user(request)
    org = models.get_organization(user["organization_id"])
    conn = models.get_connection(user["organization_id"])
    return {
        "email": user["email"],
        "role": user["role"],
        "organization": org,
        "connection_status": conn["status"] if conn else "not_connected",
    }


@app.get("/api/auth/google/login")
def login(request: Request):
    authorization_url, state, code_verifier = oauth.build_authorization_url()
    request.session["oauth_state"] = state
    request.session["code_verifier"] = code_verifier
    return RedirectResponse(authorization_url)


@app.get("/api/auth/google/callback")
def callback(request: Request):
    stored_state = request.session.get("oauth_state")
    returned_state = request.query_params.get("state")
    if not stored_state or stored_state != returned_state:
        raise HTTPException(status_code=400, detail="Invalid OAuth state")

    creds = oauth.exchange_code(
        state=stored_state,
        authorization_response_url=str(request.url),
        code_verifier=request.session.get("code_verifier"),
    )

    # Identify the user and place them in an organization (by email domain).
    email = oauth.fetch_user_email(creds).lower()
    domain = email.split("@")[-1]
    role = auth.role_for(email)
    org = models.get_or_create_org_by_domain(domain)
    user = models.upsert_user(email, org["id"], role)

    request.session["user_id"] = user["id"]
    # One Google consent grants both Analytics + Search Console scopes; record a
    # connection for each Google provider under the user's organization.
    creds_dict = oauth.credentials_to_dict(creds)
    for provider in config.GOOGLE_PROVIDERS:
        models.save_connection(org["id"], email, creds_dict, provider=provider)

    return RedirectResponse("/")


@app.get("/api/auth/logout")
def logout(request: Request):
    request.session.clear()
    return RedirectResponse("/")


@app.get("/api/admin/organizations")
def admin_organizations(request: Request):
    auth.require_admin(request)
    return {"organizations": models.list_organizations_with_status()}


@app.get("/api/analytics/properties")
def properties(request: Request, org_id: str | None = None):
    user = auth.current_user(request)
    target_org = _resolve_org_id(user, org_id)
    creds = _org_credentials(target_org)
    return {"org_id": target_org, "properties": analytics.list_properties(creds)}


@app.get("/api/analytics/report")
def report(request: Request, property_id: str, org_id: str | None = None):
    user = auth.current_user(request)
    target_org = _resolve_org_id(user, org_id)
    creds = _org_credentials(target_org)
    rows = analytics.run_basic_report(creds, property_id)
    return {"org_id": target_org, "property_id": property_id, "rows": rows}


@app.get("/api/connections")
def connections(request: Request, org_id: str | None = None):
    """Per-provider connection status for the onboarding + sidebar progress."""
    user = auth.current_user(request)
    target_org = _resolve_org_id(user, org_id)
    items = []
    for provider in config.GOOGLE_PROVIDERS:
        conn = models.get_connection(target_org, provider=provider)
        items.append(
            {
                "provider": provider,
                "status": conn["status"] if conn else "not_connected",
                "google_email": conn["google_email"] if conn else None,
            }
        )
    for provider in config.PLACEHOLDER_PROVIDERS:
        items.append({"provider": provider, "status": "coming_soon", "google_email": None})
    connected = sum(1 for i in items if i["status"] == "connected")
    return {"org_id": target_org, "connected": connected, "total": len(items), "connections": items}


@app.get("/api/search-console/sites")
def gsc_sites(request: Request, org_id: str | None = None):
    user = auth.current_user(request)
    target_org = _resolve_org_id(user, org_id)
    creds = _org_credentials(target_org, provider="search_console")
    return {"org_id": target_org, "sites": search_console.list_sites(creds)}


@app.get("/api/search-console/report")
def gsc_report(request: Request, site: str, org_id: str | None = None):
    user = auth.current_user(request)
    target_org = _resolve_org_id(user, org_id)
    creds = _org_credentials(target_org, provider="search_console")
    return {"org_id": target_org, "site": site, **search_console.run_search_analytics(creds, site)}


# Catch-all: serve the SPA's index.html for any non-API route so the client-side
# router can handle deep links. Declared last so it never shadows /api or mounts.
@app.get("/{full_path:path}")
def spa(full_path: str):
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="Not found")
    if SPA_INDEX.exists():
        return FileResponse(SPA_INDEX)
    return JSONResponse(
        {"detail": "Frontend not built. Run `npm run build` in frontend/."},
        status_code=503,
    )
