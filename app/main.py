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
    """Sign in: request only the user's identity (email), no data scopes."""
    authorization_url, state, code_verifier = oauth.build_authorization_url(
        config.LOGIN_SCOPES, access_type="online", prompt="select_account"
    )
    request.session["oauth_state"] = state
    request.session["code_verifier"] = code_verifier
    request.session["oauth_mode"] = "login"
    return RedirectResponse(authorization_url)


@app.get("/api/auth/google/connect")
def connect(request: Request, providers: str, return_to: str = "/app/integrations"):
    """Incremental authorization: connect one or more tools for the signed-in user."""
    if not request.session.get("user_id"):
        return RedirectResponse("/login")
    requested = [p for p in providers.split(",") if p in config.GOOGLE_PROVIDERS]
    if not requested:
        raise HTTPException(status_code=400, detail="No valid providers")

    scopes = list(config.LOGIN_SCOPES)
    for p in requested:
        scopes += config.PROVIDER_SCOPES[p]

    authorization_url, state, code_verifier = oauth.build_authorization_url(
        scopes, access_type="offline", prompt="consent"
    )
    request.session["oauth_state"] = state
    request.session["code_verifier"] = code_verifier
    request.session["oauth_mode"] = "connect"
    request.session["oauth_providers"] = requested
    request.session["oauth_return"] = return_to if return_to.startswith("/") else "/app"
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
    org = models.get_or_create_org_by_domain(domain)
    user = models.upsert_user(email, org["id"], auth.role_for(email))
    request.session["user_id"] = user["id"]

    # On a "connect" flow, store the tool connection(s) that were just granted.
    if request.session.pop("oauth_mode", "login") == "connect":
        providers = request.session.pop("oauth_providers", [])
        return_to = request.session.pop("oauth_return", "/app")
        creds_dict = oauth.credentials_to_dict(creds)
        for provider in providers:
            models.save_connection(org["id"], email, creds_dict, provider=provider)
        return RedirectResponse(return_to)

    return RedirectResponse("/")


@app.get("/api/auth/logout")
def logout(request: Request):
    request.session.clear()
    return RedirectResponse("/")


@app.get("/api/admin/organizations")
def admin_organizations(request: Request):
    auth.require_admin(request)
    return {"organizations": models.list_organizations_with_connections()}


@app.get("/api/organizations")
def organizations(request: Request):
    """Organizations the user may view/switch to (admins: all; clients: own)."""
    user = auth.current_user(request)
    if user["role"] == "agency_admin":
        orgs = models.list_organizations_with_connections()
        return {"organizations": [{"id": o["id"], "name": o["name"], "domain": o["domain"]} for o in orgs]}
    org = models.get_organization(user["organization_id"])
    return {"organizations": [{"id": org["id"], "name": org["name"], "domain": org["domain"]}] if org else []}


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


@app.get("/api/analytics/overview")
def analytics_overview(
    request: Request,
    property_id: str,
    start: str,
    end: str,
    compare_start: str | None = None,
    compare_end: str | None = None,
    org_id: str | None = None,
):
    user = auth.current_user(request)
    target_org = _resolve_org_id(user, org_id)
    creds = _org_credentials(target_org)
    compare = (compare_start, compare_end) if compare_start and compare_end else None
    data = analytics.run_ga_overview(creds, property_id, start, end, compare)
    return {"org_id": target_org, "property_id": property_id, **data}


@app.get("/api/analytics/realtime")
def analytics_realtime(request: Request, property_id: str, org_id: str | None = None):
    user = auth.current_user(request)
    target_org = _resolve_org_id(user, org_id)
    creds = _org_credentials(target_org)
    return {"property_id": property_id, **analytics.run_realtime(creds, property_id)}


def _connections_payload(target_org: str) -> dict:
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


@app.get("/api/connections")
def connections(request: Request, org_id: str | None = None):
    """Per-provider connection status for the onboarding + sidebar progress."""
    user = auth.current_user(request)
    return _connections_payload(_resolve_org_id(user, org_id))


@app.post("/api/connections/{provider}/disconnect")
def disconnect(request: Request, provider: str, org_id: str | None = None):
    """Remove a source. Revoke the Google grant once the last Google source goes."""
    user = auth.current_user(request)
    target_org = _resolve_org_id(user, org_id)
    if provider not in config.GOOGLE_PROVIDERS:
        raise HTTPException(status_code=400, detail="Unknown provider")

    conn = models.get_connection(target_org, provider=provider)
    models.delete_connection(target_org, provider)
    # If this was the last Google connection, revoke the shared grant at Google.
    if conn and models.count_google_connections(target_org) == 0:
        try:
            oauth.revoke(oauth.credentials_from_dict(conn["creds"]))
        except Exception:
            pass
    return _connections_payload(target_org)


@app.get("/api/search-console/sites")
def gsc_sites(request: Request, org_id: str | None = None):
    user = auth.current_user(request)
    target_org = _resolve_org_id(user, org_id)
    creds = _org_credentials(target_org, provider="search_console")
    return {"org_id": target_org, "sites": search_console.list_sites(creds)}


@app.get("/api/search-console/report")
def gsc_report(
    request: Request,
    site: str,
    start: str,
    end: str,
    compare_start: str | None = None,
    compare_end: str | None = None,
    org_id: str | None = None,
):
    user = auth.current_user(request)
    target_org = _resolve_org_id(user, org_id)
    creds = _org_credentials(target_org, provider="search_console")
    compare = (compare_start, compare_end) if compare_start and compare_end else None
    data = search_console.run_search_analytics(creds, site, start, end, compare)
    return {"org_id": target_org, "site": site, **data}


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
