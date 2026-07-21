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
import json
import random
import threading
import time
import uuid
import logging
from datetime import date, timedelta
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from google.api_core.exceptions import Unauthenticated
from google.auth.exceptions import RefreshError, TransportError
from google.oauth2.credentials import Credentials
from pydantic import BaseModel
from starlette.middleware.sessions import SessionMiddleware

from . import (
    analytics, assistant, auth, cache, config, db, demo, google_ads, insights, meta,
    meta_oauth, models, oauth, ratelimit, search_console, woocommerce,
)

# Zonder basisconfiguratie hebben de app-loggers geen handler onder uvicorn en
# verdwijnen INFO-regels (zoals de assistent-telemetrie) stilletjes. Uvicorns
# eigen loggers hebben al handlers en propagate=False; die raakt dit niet.
logging.basicConfig(level=logging.INFO, format="%(levelname)s:%(name)s:%(message)s")
log = logging.getLogger("dashboard")

# The React/Vite build is copied here by the Dockerfile (stage 1 -> stage 2).
SPA_DIR = Path(__file__).resolve().parent / "static_spa"
SPA_INDEX = SPA_DIR / "index.html"


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_schema()
    cache.init_schema()
    try:
        demo.seed()
    except Exception:
        log.exception("demo seed failed")  # never block startup on the demo account
    yield


app = FastAPI(title="Marketing Dashboard - GA4 (multi-tenant)", lifespan=lifespan)
app.add_middleware(
    SessionMiddleware,
    secret_key=config.SESSION_SECRET,
    https_only=config.SESSION_COOKIE_SECURE,
    same_site="lax",
)

# Serve the built SPA's static assets (present in production / after a build).
if (SPA_DIR / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=SPA_DIR / "assets"), name="assets")
if (SPA_DIR / "fonts").is_dir():
    app.mount("/fonts", StaticFiles(directory=SPA_DIR / "fonts"), name="fonts")


def _safe_return(path: str | None, default: str) -> str:
    """Allow only same-site absolute paths as a post-OAuth redirect target.

    Blocks protocol-relative (`//host`) and backslash (`/\\host`) forms that
    browsers resolve to an external origin — otherwise an open redirect.
    """
    if path and path.startswith("/") and not path.startswith(("//", "/\\")):
        return path
    return default


def _resolve_org_id(user: dict, requested_org_id: str | None) -> str:
    """Clients are pinned to their own org; admins may target any org.

    Dit is het centrale punt waar alle org-gebonden data-endpoints langskomen,
    dus hier dwingen we ook de proefperiode af: is de trial van de eigen
    organisatie verlopen, dan krijgt de gebruiker een 402 en toont de app het
    verloopscherm. De agency admin behoudt altijd toegang (die beheert de
    trials en moet mee kunnen kijken).
    """
    if user["role"] == "agency_admin":
        return requested_org_id or user["organization_id"]
    org_id = user["organization_id"]
    if models.trial_expired(org_id):
        raise HTTPException(
            status_code=402,
            detail="De proefperiode is verlopen. Neem contact op voor een betaalde verlenging.",
        )
    return org_id


def _require_period(*dates: str | None) -> None:
    """Reject non-ISO dates before they reach any downstream query.

    Google Ads reports interpolate dates into GAQL, so validating the format
    here (plus in google_ads) closes that injection path; the other channels
    just get a clean 400 instead of a raw API error on malformed input.
    """
    for v in dates:
        if v is None:
            continue
        try:
            date.fromisoformat(v)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="Ongeldige datum (verwacht JJJJ-MM-DD)")


def _is_grant_revoked(e: Exception) -> bool:
    """Alleen een definitief ingetrokken of verlopen grant telt als 'revoked'.

    Google's token-endpoint gooit óók een RefreshError bij tijdelijke storingen
    (5xx, internal_failure, temporarily_unavailable). Wie dáárop de koppeling
    ontkoppelt, verliest bij elke hapering een werkende koppeling; dat was
    zichtbaar als "alles ontkoppeld" vlak na deploys en koude starts.
    """
    txt = " ".join(str(a) for a in (getattr(e, "args", None) or [])).lower()
    return (
        "invalid_grant" in txt
        or "expired or revoked" in txt
        or "invalid_rapt" in txt
        or "deleted_client" in txt
    )


_GOOGLE_TRANSIENT_MSG = "Google is tijdelijk niet bereikbaar. Probeer het zo opnieuw."


# Alle Google-providers van één organisatie delen hetzelfde refresh-token (het
# wordt bij het koppelen drie keer opgeslagen: Analytics, Search Console en
# Google Ads). Na een deploy is de cache leeg en zijn de access-tokens
# verlopen, waardoor een pagina-load een burst gelijktijdige verversingen van
# hetzélfde token afvuurt; daar reageert Google's token-endpoint geregeld met
# fouten op. Eén lock per organisatie serialiseert het verversen: de winnaar
# haalt een vers token op en slaat het op, de wachters lezen dat verse token
# uit de database en hoeven zelf niet meer naar Google.
_refresh_locks: dict[str, threading.Lock] = {}
_refresh_locks_guard = threading.Lock()


def _org_refresh_lock(org_id: str) -> threading.Lock:
    with _refresh_locks_guard:
        return _refresh_locks.setdefault(org_id, threading.Lock())


def _org_credentials(org_id: str, provider: str = "google_analytics") -> Credentials:
    """Load + refresh an org's credentials.

    Alleen een écht ingetrokken grant zet de status op revoked; een tijdelijke
    storing bij het verversen wordt een 503 zonder de koppeling aan te raken.
    """
    with _org_refresh_lock(org_id):
        # Binnen de lock (opnieuw) laden: als een andere request net ververst
        # heeft, staat hier al een geldig access-token en is verversen klaar.
        conn = models.get_connection(org_id, provider=provider)
        if not conn or conn["status"] != "connected":
            raise HTTPException(status_code=409, detail="No active connection for this organization")
        # Eén stille herkansing met spreiding: haperingen bij Google's
        # token-endpoint (5xx, drukte na een koude start) zijn meestal direct
        # voorbij. De jitter voorkomt dat gelijktijdige verliezers in
        # verschillende instanties synchroon opnieuw botsen.
        creds = None
        for attempt in (1, 2):
            try:
                creds = oauth.credentials_from_dict(conn["creds"])
                break
            except RefreshError as e:
                if _is_grant_revoked(e):
                    log.warning(
                        "REVOKE org=%s provider=%s at=refresh email=%s err=%r",
                        org_id, provider, conn.get("google_email"), e,
                    )
                    models.set_connection_status(org_id, "revoked", provider=provider)
                    raise HTTPException(status_code=409, detail="Connection expired - please reconnect")
                log.warning("refresh tijdelijk mislukt (poging %d) org=%s provider=%s err=%r", attempt, org_id, provider, e)
                if attempt == 2:
                    raise HTTPException(status_code=503, detail=_GOOGLE_TRANSIENT_MSG)
            except TransportError as e:
                log.warning("refresh netwerkfout (poging %d) org=%s provider=%s err=%r", attempt, org_id, provider, e)
                if attempt == 2:
                    raise HTTPException(status_code=503, detail=_GOOGLE_TRANSIENT_MSG)
            time.sleep(0.5 + random.random())
        # Persist any refreshed access token.
        models.save_connection(org_id, conn["google_email"], oauth.credentials_to_dict(creds), provider=provider)
        return creds


def _google_data(org_id: str, provider: str, fn):
    """Run a Google data call; turn an auth failure into a clean 'reconnect' 409.

    Tokens can be revoked or rejected at call time (HTTP 401 UNAUTHENTICATED),
    not just at refresh time. Without this, that 401 surfaces as a raw 500 and
    takes down Overzicht/Analytics. Alleen definitieve auth-fouten zetten de
    status op revoked; tijdelijke storingen worden een 503 zonder statuswissel.
    """
    try:
        return fn()
    except (RefreshError, Unauthenticated) as e:
        if isinstance(e, RefreshError) and not _is_grant_revoked(e):
            log.warning("google-call tijdelijk mislukt org=%s provider=%s err=%r", org_id, provider, e)
            raise HTTPException(status_code=503, detail=_GOOGLE_TRANSIENT_MSG)
        log.warning("REVOKE org=%s provider=%s at=api-call err=%r", org_id, provider, e)
        models.set_connection_status(org_id, "revoked", provider=provider)
        raise HTTPException(status_code=409, detail="Connection expired - please reconnect")
    except TransportError as e:
        log.warning("google-call netwerkfout org=%s provider=%s err=%r", org_id, provider, e)
        raise HTTPException(status_code=503, detail=_GOOGLE_TRANSIENT_MSG)


def _meta_token(org_id: str) -> str:
    """Load an org's Meta token, flipping status to revoked when expired."""
    conn = models.get_connection(org_id, provider="meta_ads")
    if not conn or conn["status"] != "connected":
        raise HTTPException(status_code=409, detail="No active Meta connection for this organization")
    creds = conn["creds"]
    if meta_oauth.is_expired(creds):
        log.warning("REVOKE org=%s provider=meta_ads at=expiry-check", org_id)
        models.set_connection_status(org_id, "revoked", provider="meta_ads")
        raise HTTPException(status_code=409, detail="Meta-koppeling verlopen - opnieuw koppelen")
    token = creds.get("access_token")
    if not token:
        raise HTTPException(status_code=409, detail="Meta-koppeling ongeldig - opnieuw koppelen")
    return token


def _wc_creds(org_id: str) -> tuple[str, str, str]:
    """Load an org's WooCommerce store credentials (store_url, key, secret)."""
    conn = models.get_connection(org_id, provider="woocommerce")
    if not conn or conn["status"] != "connected":
        raise HTTPException(status_code=409, detail="Geen actieve WooCommerce-koppeling voor deze organisatie")
    c = conn["creds"]
    return c.get("store_url", ""), c.get("consumer_key", ""), c.get("consumer_secret", "")


@app.get("/healthz")
def healthz():
    return {"status": "ok"}


@app.get("/api/me")
def me(request: Request):
    user = auth.current_user(request)
    org = models.get_organization(user["organization_id"])
    subscription = models.subscription_info(org)
    if org and org.get("is_demo"):
        return {
            "email": user["email"],
            "role": user["role"],
            "organization": org,
            "subscription": subscription,
            "connection_status": "connected",
        }
    conn = models.get_connection(user["organization_id"])
    return {
        "email": user["email"],
        "role": user["role"],
        "organization": org,
        "subscription": subscription,
        "connection_status": conn["status"] if conn else "not_connected",
    }


@app.post("/api/subscription/stop-trial")
def stop_own_trial(request: Request):
    """De gebruiker trekt de proefperiode van de eigen organisatie per direct in.

    Daarna toont de app het verloopscherm; heractiveren kan alleen via de
    agency admin. Werkt alleen zolang er echt een lopende proefperiode is.
    """
    user = auth.current_user(request)
    org = models.get_organization(user["organization_id"])
    sub = models.subscription_info(org)
    if sub["plan"] != "trial":
        raise HTTPException(status_code=400, detail="Deze organisatie heeft geen lopende proefperiode.")
    if sub["expired"]:
        raise HTTPException(status_code=400, detail="De proefperiode is al verlopen.")
    models.stop_trial(org["id"])
    return {"subscription": models.subscription_info(models.get_organization(org["id"]))}


class PasswordLoginIn(BaseModel):
    email: str
    password: str


@app.post("/api/auth/login")
def password_login(request: Request, payload: PasswordLoginIn):
    """Sign in with email + password (next to the Google flow)."""
    if not ratelimit.allow("password-login", limit=60, window_s=60):
        raise HTTPException(status_code=429, detail="Te veel inlogpogingen - probeer het zo weer.")
    email = payload.email.strip().lower()
    user = models.get_user_by_email(email) if email else None
    if (
        not user
        or not user.get("password_hash")
        or not auth.verify_password(payload.password, user["password_hash"])
    ):
        raise HTTPException(
            status_code=401,
            detail="Onjuiste combinatie van e-mailadres en wachtwoord",
        )
    request.session["user_id"] = user["id"]
    return {"email": user["email"], "role": user["role"]}


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
    request.session["oauth_return"] = _safe_return(return_to, "/app")
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

    # Identify the user and place them in an organization. Invite-only: a user
    # only joins a shared org when an admin pre-provisioned their company domain;
    # public/shared domains and unknown domains get an isolated personal org.
    email = oauth.fetch_user_email(creds).lower()
    org = models.org_for_login(email)
    user = models.upsert_user(email, org["id"], auth.role_for(email))
    request.session["user_id"] = user["id"]

    # On a "connect" flow, store the tool connection(s) that were just granted.
    if request.session.pop("oauth_mode", "login") == "connect":
        providers = request.session.pop("oauth_providers", [])
        return_to = request.session.pop("oauth_return", "/app")
        creds_dict = oauth.credentials_to_dict(creds)
        for provider in providers:
            models.save_connection(org["id"], email, creds_dict, provider=provider)
        cache.invalidate_org(org["id"])  # new source -> drop stale property/report cache
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


class OrgIn(BaseModel):
    name: str
    domain: str


@app.post("/api/admin/organizations")
def admin_add_organization(request: Request, payload: OrgIn):
    auth.require_admin(request)
    name = payload.name.strip()
    domain = (
        payload.domain.strip().lower()
        .removeprefix("https://").removeprefix("http://").strip("/").split("/")[0]
    )
    if not name or "." not in domain:
        raise HTTPException(status_code=400, detail="Naam en een geldig domein zijn vereist")
    if config.is_public_email_domain(domain):
        raise HTTPException(
            status_code=400,
            detail="Publieke e-maildomeinen (zoals gmail.com) kunnen niet als klant worden toegevoegd",
        )
    org = models.create_or_rename_organization(name, domain)
    return {"organization": org}


class TrialIn(BaseModel):
    action: str  # extend | stop | activate | restart
    days: int = models.TRIAL_DAYS


@app.post("/api/admin/organizations/{org_id}/trial")
def admin_manage_trial(request: Request, org_id: str, payload: TrialIn):
    """Beheer de proefperiode van een organisatie (alleen agency admin).

    extend: verleng met `days` dagen bovenop nu of de huidige einddatum.
    stop: beëindig de proefperiode per direct (verloopscherm).
    activate: zet de organisatie op betaald/onbeperkt.
    restart: nieuwe proefperiode van `days` dagen vanaf nu.
    """
    auth.require_admin(request)
    org = models.get_organization(org_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organisatie niet gevonden.")
    days = max(1, min(int(payload.days or models.TRIAL_DAYS), 365))
    if payload.action == "extend":
        models.extend_trial(org_id, days)
    elif payload.action == "stop":
        models.stop_trial(org_id)
    elif payload.action == "activate":
        models.activate_org(org_id)
    elif payload.action == "restart":
        models.start_trial(org_id, days)
    else:
        raise HTTPException(status_code=400, detail="Onbekende actie.")
    updated = models.get_organization(org_id)
    return {"organization": updated, "subscription": models.subscription_info(updated)}


@app.get("/api/admin/users")
def admin_users(request: Request):
    auth.require_admin(request)
    return {"users": models.list_users()}


class RoleIn(BaseModel):
    role: str


@app.patch("/api/admin/users/{user_id}")
def admin_set_role(request: Request, user_id: str, payload: RoleIn):
    """Wijzig de rol van een gebruiker (client of agency_admin)."""
    admin_user = auth.require_admin(request)
    if payload.role not in ("client", "agency_admin"):
        raise HTTPException(status_code=400, detail="Onbekende rol.")
    target = models.get_user(user_id)
    if not target:
        raise HTTPException(status_code=404, detail="Gebruiker niet gevonden.")
    if target["id"] == admin_user["id"] and payload.role != "agency_admin":
        raise HTTPException(status_code=400, detail="Je kunt je eigen beheerdersrol niet afnemen.")
    models.set_user_role(user_id, payload.role)
    return {"ok": True}


@app.get("/api/admin/activity")
def admin_activity(request: Request):
    auth.require_admin(request)
    return {"activity": models.activity_feed()}


@app.get("/api/admin/diagnose/google")
def admin_diagnose_google(request: Request, org_id: str, provider: str = "google_analytics"):
    """Test een Google-koppeling en geef de exacte foutreden terug (admin).

    Probeert het token te verversen en daarna een minimale API-call. Zo is in
    productie direct te zien waaróm een koppeling faalt (ingetrokken grant,
    ontbrekende scope, tijdelijke storing) in plaats van alleen een generieke
    melding. De respons bevat geen tokens, alleen de foutomschrijving.
    """
    auth.require_admin(request)
    if provider not in config.GOOGLE_PROVIDERS:
        raise HTTPException(status_code=400, detail="Onbekende provider.")
    conn = models.get_connection(org_id, provider=provider)
    if not conn:
        return {"ok": False, "step": "load", "error": "Geen koppeling opgeslagen voor deze organisatie."}
    stored_scopes = (conn.get("creds") or {}).get("scopes")
    try:
        creds = oauth.credentials_from_dict(conn["creds"])
    except Exception as e:  # noqa: BLE001 - de fout zelf is hier het antwoord
        return {
            "ok": False, "step": "refresh", "status": conn["status"],
            "error": f"{type(e).__name__}: {str(e)[:400]}",
            "als_ingetrokken_herkend": isinstance(e, RefreshError) and _is_grant_revoked(e),
            "stored_scopes": stored_scopes,
        }
    try:
        if provider == "google_analytics":
            analytics.list_properties(creds)
        elif provider == "search_console":
            search_console.list_sites(creds)
        # google_ads: alleen het verversen testen, een API-call vergt accountkeuze.
        return {"ok": True, "step": "api", "status": conn["status"], "scopes": creds.scopes}
    except Exception as e:  # noqa: BLE001
        return {
            "ok": False, "step": "api", "status": conn["status"],
            "error": f"{type(e).__name__}: {str(e)[:400]}",
            "scopes": creds.scopes,
        }


class PackageIn(BaseModel):
    package: str | None = None


@app.post("/api/admin/organizations/{org_id}/package")
def admin_set_package(request: Request, org_id: str, payload: PackageIn):
    auth.require_admin(request)
    if payload.package is not None and payload.package not in models.PACKAGES:
        raise HTTPException(status_code=400, detail="Onbekend pakket.")
    if not models.get_organization(org_id):
        raise HTTPException(status_code=404, detail="Organisatie niet gevonden.")
    models.set_package(org_id, payload.package)
    return {"ok": True, "package": payload.package}


@app.get("/api/admin/organizations/{org_id}/billing")
def admin_get_billing(request: Request, org_id: str):
    auth.require_admin(request)
    if not models.get_organization(org_id):
        raise HTTPException(status_code=404, detail="Organisatie niet gevonden.")
    return {"billing": models.get_billing_details(org_id)}


class BillingIn(BaseModel):
    company_name: str = ""
    billing_email: str = ""
    address: str = ""
    postal_city: str = ""
    kvk: str = ""
    btw: str = ""
    reference: str = ""


@app.put("/api/admin/organizations/{org_id}/billing")
def admin_save_billing(request: Request, org_id: str, payload: BillingIn):
    auth.require_admin(request)
    if not models.get_organization(org_id):
        raise HTTPException(status_code=404, detail="Organisatie niet gevonden.")
    return {"billing": models.save_billing_details(org_id, payload.model_dump())}


class OrgRename(BaseModel):
    name: str
    business_type: str | None = None


@app.patch("/api/organizations/{org_id}")
def rename_organization(request: Request, org_id: str, payload: OrgRename):
    """Rename an organization and/or set its business type (agency admins only)."""
    auth.require_admin(request)
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Naam is vereist")
    org = models.rename_organization(org_id, name)
    if not org:
        raise HTTPException(status_code=404, detail="Organisatie niet gevonden")
    if payload.business_type is not None:
        if payload.business_type not in models.BUSINESS_TYPES:
            raise HTTPException(status_code=400, detail="Ongeldig bedrijfstype")
        org = models.set_business_type(org_id, payload.business_type)
    cache.invalidate_org(org_id)
    return {"organization": org}


class BusinessTypeIn(BaseModel):
    business_type: str


@app.patch("/api/organizations/me/business-type")
def set_own_business_type(request: Request, payload: BusinessTypeIn):
    """Set the signed-in user's own organization profile (leadgen | ecommerce).

    Least-privilege: any signed-in user may set it, but only for their own org —
    the org id comes from the session, never from the request body.
    """
    user = auth.current_user(request)
    if payload.business_type not in models.BUSINESS_TYPES:
        raise HTTPException(status_code=400, detail="Ongeldig bedrijfstype")
    org = models.set_business_type(user["organization_id"], payload.business_type)
    if not org:
        raise HTTPException(status_code=404, detail="Organisatie niet gevonden")
    cache.invalidate_org(user["organization_id"])
    return {"organization": org}


@app.get("/api/admin/assistant/models")
def assistant_models(request: Request):
    """Agency-admin diagnostiek: welke EuRouter-modellen ondersteunen tool-calling.

    Lijst de beschikbare modellen; tool-support komt uit de in-process cache
    (None = nog niet geprobed). Probe je een model via het probe-endpoint, dan
    verschijnt het resultaat hier."""
    auth.require_admin(request)
    if not config.EUROUTER_API_KEY:
        raise HTTPException(status_code=503, detail="Assistent is niet geconfigureerd.")
    try:
        models = assistant.list_models(config.EUROUTER_API_KEY, config.EUROUTER_BASE_URL)
    except Exception:
        log.exception("assistant: modellenlijst ophalen faalde")
        raise HTTPException(status_code=502, detail="Kan de modellenlijst niet ophalen bij EuRouter.")
    return {
        "current": config.EUROUTER_MODEL,
        "models": [
            {
                "id": m["id"],
                "declares_tools": m["declares_tools"],  # uit de EuRouter-catalogus
                "supports_tools": assistant.cached_tool_support(m["id"]),  # None tot geprobed
                "context": m.get("context"),
            }
            for m in models
        ],
    }


class ProbeIn(BaseModel):
    model: str


@app.post("/api/admin/assistant/models/probe")
def assistant_probe(request: Request, payload: ProbeIn):
    """Probe één model op tool-calling (kost een mini API-call); cachet het."""
    auth.require_admin(request)
    if not config.EUROUTER_API_KEY:
        raise HTTPException(status_code=503, detail="Assistent is niet geconfigureerd.")
    model = payload.model.strip()
    if not model:
        raise HTTPException(status_code=400, detail="model is vereist")
    if not ratelimit.allow("assistant-probe", limit=60, window_s=60):
        raise HTTPException(status_code=429, detail="Te veel probes - probeer het zo weer.")
    return assistant.probe_tool_support(config.EUROUTER_API_KEY, config.EUROUTER_BASE_URL, model)


@app.get("/api/organizations")
def organizations(request: Request):
    """Organizations the user may view/switch to (admins: all; clients: own)."""
    user = auth.current_user(request)
    if user["role"] == "agency_admin":
        orgs = models.list_organizations_with_connections()
        return {"organizations": [{"id": o["id"], "name": o["name"], "domain": o["domain"], "business_type": o.get("business_type")} for o in orgs]}
    org = models.get_organization(user["organization_id"])
    return {"organizations": [{"id": org["id"], "name": org["name"], "domain": org["domain"], "business_type": org.get("business_type")}] if org else []}


@app.get("/api/analytics/properties")
def properties(request: Request, org_id: str | None = None):
    user = auth.current_user(request)
    target_org = _resolve_org_id(user, org_id)
    if models.is_demo_org(target_org):
        return {"org_id": target_org, "properties": demo.DEMO_PROPERTIES}
    key = f"{target_org}|props"
    cached = cache.get(key)
    if cached is not None:
        return cached
    creds = _org_credentials(target_org)
    properties_list = _google_data(target_org, "google_analytics", lambda: analytics.list_properties(creds))
    payload = {"org_id": target_org, "properties": properties_list}
    cache.set(key, payload, cache.LIST_TTL)
    return payload


@app.get("/api/analytics/report")
def report(request: Request, property_id: str, org_id: str | None = None):
    user = auth.current_user(request)
    target_org = _resolve_org_id(user, org_id)
    if models.is_demo_org(target_org):
        return {"org_id": target_org, "property_id": property_id, "rows": demo.basic_report()}
    creds = _org_credentials(target_org)
    rows = _google_data(target_org, "google_analytics", lambda: analytics.run_basic_report(creds, property_id))
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
    _require_period(start, end, compare_start, compare_end)
    target_org = _resolve_org_id(user, org_id)
    compare = (compare_start, compare_end) if compare_start and compare_end else None
    if models.is_demo_org(target_org):
        data = demo.overview(start, end, compare)
        return {"org_id": target_org, "property_id": property_id, **data}
    key = f"{target_org}|overview|{property_id}|{start}|{end}|{compare_start}|{compare_end}"
    cached = cache.get(key)
    if cached is not None:
        return cached
    creds = _org_credentials(target_org)
    data = _google_data(target_org, "google_analytics", lambda: analytics.run_ga_overview(creds, property_id, start, end, compare))
    payload = {"org_id": target_org, "property_id": property_id, **data}
    cache.set(key, payload, cache.ttl_for_range(end))
    return payload


@app.get("/api/analytics/realtime")
def analytics_realtime(request: Request, property_id: str, org_id: str | None = None):
    user = auth.current_user(request)
    target_org = _resolve_org_id(user, org_id)
    if models.is_demo_org(target_org):
        return {"property_id": property_id, **demo.realtime()}
    creds = _org_credentials(target_org)
    rt = _google_data(target_org, "google_analytics", lambda: analytics.run_realtime(creds, property_id))
    return {"property_id": property_id, **rt}


def _compact(value, cap: int = 12):
    """Shrink a data payload for the LLM: cap lists, keep it token-cheap."""
    if isinstance(value, dict):
        return {k: _compact(v, cap) for k, v in value.items()}
    if isinstance(value, list):
        return [_compact(v, cap) for v in value[:cap]]
    return value


class ChatBody(BaseModel):
    messages: list
    org_id: str | None = None
    start: str
    end: str
    property_id: str | None = None
    site: str | None = None


@app.post("/api/assistant/chat")
def assistant_chat(request: Request, body: ChatBody):
    """Stream the AI assistant's answer (SSE). Tools read the active org's data."""
    user = auth.current_user(request)
    target_org = _resolve_org_id(user, body.org_id)
    if not config.EUROUTER_API_KEY:
        raise HTTPException(status_code=503, detail="Assistent is niet geconfigureerd.")
    if not ratelimit.allow(f"assistant|{target_org}", limit=20, window_s=60):
        raise HTTPException(status_code=429, detail="Te veel vragen achter elkaar - probeer het zo weer.")

    # Only trust user/assistant text turns from the client — never a client-supplied
    # "system"/"tool" role (the server owns the system prompt and tool results).
    safe_messages = [
        {"role": m["role"], "content": m["content"]}
        for m in body.messages
        if isinstance(m, dict) and m.get("role") in ("user", "assistant") and isinstance(m.get("content"), str)
    ]
    if not safe_messages:
        raise HTTPException(status_code=400, detail="Geen geldige vraag.")
    if len(safe_messages) > 40 or sum(len(m["content"]) for m in safe_messages) > 20000:
        raise HTTPException(status_code=413, detail="Gesprek te lang - begin een nieuw gesprek.")

    def _tool_period(tool_input: dict) -> tuple[str, str]:
        """Model-supplied start/end (validated) win over the dashboard period."""
        s, e = tool_input.get("start"), tool_input.get("end")
        try:
            if s and e and date.fromisoformat(s) <= date.fromisoformat(e):
                return s, e
        except (TypeError, ValueError):
            pass
        return body.start, body.end

    # --- per-channel fetchers (raise HTTPException 409 when not connected) ---
    # Reused by both the single-channel tools and the cross-channel overview, so
    # the org-scoping and property/site/account selection live in one place. Demo
    # orgs serve generated sample data, mirroring the dashboard endpoints.
    demo_org = models.is_demo_org(target_org)

    def _fetch_analytics(start, end, compare):
        if demo_org:
            return demo.overview(start, end, compare)
        creds = _org_credentials(target_org)
        prop = body.property_id
        if not prop:
            props = _google_data(target_org, "google_analytics", lambda: analytics.list_properties(creds))
            if not props:
                raise HTTPException(status_code=409, detail="Geen Analytics-property gekoppeld.")
            prop = props[0]["property_id"]
        return _google_data(target_org, "google_analytics",
                            lambda: analytics.run_ga_overview(creds, prop, start, end, compare))

    def _fetch_gsc(start, end, compare):
        if demo_org:
            return demo.gsc_report(start, end, compare)
        creds = _org_credentials(target_org, provider="search_console")
        site = body.site
        if not site:
            sites = _google_data(target_org, "search_console", lambda: search_console.list_sites(creds))
            if not sites:
                raise HTTPException(status_code=409, detail="Geen Search Console-site gekoppeld.")
            site = sites[0]["site_url"]
        return _google_data(target_org, "search_console",
                            lambda: search_console.run_search_analytics(creds, site, start, end, compare))

    def _fetch_google_ads(start, end, compare):
        if demo_org:
            return demo.ads_overview(start, end, compare)
        creds = _org_credentials(target_org, provider="google_ads")
        accounts = google_ads.list_accounts(creds)
        if not accounts:
            raise HTTPException(status_code=409, detail="Geen Google Ads-account gekoppeld.")
        return google_ads.run_overview(creds, accounts[0]["customer_id"], start, end, compare)

    def _fetch_meta_ads(start, end, compare):
        if demo_org:
            return demo.meta_ads_overview(start, end, compare)
        token = _meta_token(target_org)
        accounts = (meta.list_assets(token).get("ad_accounts") or [])
        if not accounts:
            raise HTTPException(status_code=409, detail="Geen Meta-advertentieaccount gekoppeld.")
        return meta.ads_overview(token, accounts[0]["id"], start, end, compare)

    def _fetch_meta_organic(start, end):
        if demo_org:
            return demo.meta_organic_overview(start, end)
        token = _meta_token(target_org)
        pages = (meta.list_assets(token).get("pages") or [])
        if not pages:
            raise HTTPException(status_code=409, detail="Geen Facebook-pagina gekoppeld.")
        page = pages[0]
        ig_id = (page.get("instagram") or {}).get("id")
        return meta.organic_overview(token, page["id"], ig_id, start, end)

    def _fetch_woo(start, end, compare):
        store, ck, cs = _wc_creds(target_org)
        return woocommerce.run_overview(store, ck, cs, start, end, compare)

    def _marketing_overview(start, end, compare) -> dict:
        """Cross-channel figures with the relationships computed server-side, so the
        assistant states facts (blended ROAS, total spend, paid vs organic) instead
        of deriving them from separate blocks. Missing channels are simply skipped."""
        def safe(fn):
            try:
                return fn()
            except Exception:  # not connected / no data / API error -> skip channel
                return None

        ga = safe(lambda: _fetch_analytics(start, end, compare))
        gsc = safe(lambda: _fetch_gsc(start, end, compare))
        ads = safe(lambda: _fetch_google_ads(start, end, compare))
        mads = safe(lambda: _fetch_meta_ads(start, end, compare))
        woo = safe(lambda: _fetch_woo(start, end, compare))

        connected = []
        if ga: connected.append("google_analytics")
        if gsc: connected.append("search_console")
        if ads: connected.append("google_ads")
        if mads: connected.append("meta_ads")
        if woo: connected.append("woocommerce")

        def r2(v):
            return round(v, 2) if isinstance(v, (int, float)) else v

        ads_cost = (ads or {}).get("kpis", {}).get("cost")
        meta_spend = (mads or {}).get("kpis", {}).get("spend")
        spend_parts = {k: v for k, v in (("google_ads", ads_cost), ("meta_ads", meta_spend)) if v}
        ad_spend_total = round(sum(spend_parts.values()), 2) if spend_parts else None

        woo_revenue = (woo or {}).get("kpis", {}).get("revenue")
        ga_revenue = (ga or {}).get("kpis", {}).get("revenue")
        if woo_revenue:
            revenue_total, revenue_source = round(woo_revenue, 2), "woocommerce"
        elif ga_revenue:
            revenue_total, revenue_source = round(ga_revenue, 2), "google_analytics"
        else:
            revenue_total, revenue_source = None, None

        blended_roas = (
            round(revenue_total / ad_spend_total, 2)
            if revenue_total and ad_spend_total else None
        )
        ads_conv = (ads or {}).get("kpis", {}).get("conversions") or 0
        meta_results = sum((r.get("count") or 0) for r in (mads or {}).get("results", []) or [])
        paid_conversions = round(ads_conv + meta_results, 1) or None
        blended_cpa = (
            round(ad_spend_total / paid_conversions, 2)
            if ad_spend_total and paid_conversions else None
        )

        # Traffic mix from GA channel groups (share of sessions).
        traffic_mix = None
        if ga and ga.get("channels"):
            buckets = {"organisch": 0, "betaald": 0, "direct": 0, "social": 0, "overig": 0}
            for c in ga["channels"]:
                label = (c.get("label") or "").lower()
                v = c.get("value") or c.get("sessions") or 0
                if "paid" in label or "cpc" in label:
                    buckets["betaald"] += v
                elif "organic search" in label:
                    buckets["organisch"] += v
                elif "social" in label:
                    buckets["social"] += v
                elif "direct" in label:
                    buckets["direct"] += v
                else:
                    buckets["overig"] += v
            tot = sum(buckets.values()) or 1
            traffic_mix = {k: round(v * 100 / tot) for k, v in buckets.items() if v}

        combined = {
            "advertentie_uitgaven_totaal": ad_spend_total,
            "advertentie_uitgaven_per_kanaal": {k: r2(v) for k, v in spend_parts.items()} or None,
            "omzet_totaal": revenue_total,
            "omzet_bron": revenue_source,
            "blended_roas": blended_roas,  # omzet / advertentie-uitgaven
            "betaalde_conversies": paid_conversions,
            "kosten_per_conversie": blended_cpa,
            "verkeersverdeling_pct": traffic_mix,
            "organische_zoekklikken": (gsc or {}).get("totals", {}).get("clicks"),
        }
        per_channel = {}
        if ga: per_channel["google_analytics"] = {"kpis": ga.get("kpis"), "deltas": ga.get("deltas"), "channels": _compact(ga.get("channels", []), 6)}
        if gsc: per_channel["search_console"] = {"totals": gsc.get("totals"), "deltas": gsc.get("deltas")}
        if ads: per_channel["google_ads"] = {"kpis": ads.get("kpis"), "deltas": ads.get("deltas")}
        if mads: per_channel["meta_ads"] = {"kpis": mads.get("kpis"), "deltas": mads.get("deltas"), "results": _compact(mads.get("results", []), 6)}
        if woo: per_channel["woocommerce"] = {"kpis": woo.get("kpis")}

        return {
            "periode": {"start": start, "end": end, "vergelijking": {"start": compare[0], "end": compare[1]} if compare else None},
            "gekoppelde_kanalen": connected,
            "combinatie": combined,
            "per_kanaal": per_channel,
            "let_op": "De combinatiecijfers zijn server-side berekend en kloppend; gebruik ze zoals ze zijn.",
        }

    def execute(name: str, tool_input: dict) -> str:
        """Run one tool, org-scoped. Returns a JSON string; never raises."""
        start, end = _tool_period(tool_input or {})
        compare = _previous_period(start, end)  # deltas so the model states real trends
        try:
            if name == "list_connections":
                return json.dumps(_connections_payload(target_org), ensure_ascii=False, default=str)
            if name == "get_marketing_overview":
                return json.dumps(_marketing_overview(start, end, compare), ensure_ascii=False, default=str)
            if name == "get_insights":
                return json.dumps(
                    _compute_insights(target_org, start, end, body.property_id, body.site),
                    ensure_ascii=False, default=str,
                )
            if name == "get_analytics_overview":
                return json.dumps(_compact(_fetch_analytics(start, end, compare)), ensure_ascii=False, default=str)
            if name == "get_search_console":
                return json.dumps(_compact(_fetch_gsc(start, end, compare)), ensure_ascii=False, default=str)
            if name == "get_google_ads":
                try:
                    data = _fetch_google_ads(start, end, compare)
                except google_ads.AdsNotConfigured:
                    return json.dumps({"error": "Google Ads is nog niet geconfigureerd op de server."})
                return json.dumps(_compact(data), ensure_ascii=False, default=str)
            if name == "get_meta_ads":
                return json.dumps(_compact(_fetch_meta_ads(start, end, compare)), ensure_ascii=False, default=str)
            if name == "get_meta_organic":
                return json.dumps(_compact(_fetch_meta_organic(start, end)), ensure_ascii=False, default=str)
            if name == "get_woocommerce":
                return json.dumps(_compact(_fetch_woo(start, end, compare)), ensure_ascii=False, default=str)
            return json.dumps({"error": f"Onbekende tool: {name}"})
        except HTTPException as e:
            return json.dumps({"error": str(e.detail)}, ensure_ascii=False)
        except Exception:  # noqa: BLE001 - surface a generic tool error, log detail server-side
            log.exception("assistant tool failed name=%s org=%s", name, target_org)
            return json.dumps({"error": "Kon deze gegevens niet ophalen."}, ensure_ascii=False)

    def gather_context() -> str:
        """Data van alle gekoppelde kanalen als context voor modellen zonder
        tool-calling. Begint met het cross-kanaal overzicht (berekende verbanden),
        gevolgd door de losse kanalen; niet gekoppelde kanalen worden overgeslagen."""
        blocks = [f"## Cross-kanaal overzicht (verbanden)\n{execute('get_marketing_overview', {})}"]
        for name, label in (
            ("get_analytics_overview", "Google Analytics"),
            ("get_search_console", "Search Console"),
            ("get_google_ads", "Google Ads"),
            ("get_meta_ads", "META Ads"),
            ("get_meta_organic", "META Organisch"),
            ("get_woocommerce", "WooCommerce"),
        ):
            out = execute(name, {})
            try:
                parsed = json.loads(out)
            except (TypeError, ValueError):
                parsed = None
            if isinstance(parsed, dict) and parsed.get("error"):
                continue
            blocks.append(f"## {label}\n{out}")
        return "\n\n".join(blocks)

    stream = assistant.stream_chat(
        safe_messages, execute, gather_context,
        api_key=config.EUROUTER_API_KEY, base_url=config.EUROUTER_BASE_URL,
        model=config.EUROUTER_MODEL, period=(body.start, body.end),
    )
    return StreamingResponse(
        stream,
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _previous_period(start: str, end: str) -> tuple[str, str]:
    """The equal-length period immediately before [start, end]."""
    s, e = date.fromisoformat(start), date.fromisoformat(end)
    length = (e - s).days + 1
    prev_end = s - timedelta(days=1)
    prev_start = prev_end - timedelta(days=length - 1)
    return prev_start.isoformat(), prev_end.isoformat()


def _connected(target_org: str, provider: str) -> bool:
    conn = models.get_connection(target_org, provider=provider)
    return bool(conn and conn["status"] == "connected")


def _compute_insights(
    target_org: str, start: str, end: str,
    property_id: str | None = None, site: str | None = None,
) -> dict:
    """Rule-based signalen (opvallende periode-op-periode-veranderingen per
    kanaal), gecachet. Gedeeld door het insights-endpoint (bel + zijpaneel) en
    de `get_insights`-tool van de assistent, zodat alle drie hetzelfde tonen."""
    key = f"{target_org}|insights|{start}|{end}|{property_id}|{site}"
    cached = cache.get(key)
    if cached is not None:
        return cached

    try:
        compare = _previous_period(start, end)
    except ValueError:
        raise HTTPException(status_code=400, detail="Ongeldige periode")

    found: list[dict] = []

    # Demo-organisatie: bereken de signalen op de gegenereerde voorbeelddata,
    # zodat bel, zijpaneel en assistent ook in de demo iets laten zien.
    if models.is_demo_org(target_org):
        data = demo.overview(start, end, compare)
        found += insights.from_channel("analytics", data.get("kpis", {}), data.get("deltas"))
        g = demo.gsc_report(start, end, compare)
        found += insights.from_channel("search_console", g.get("totals", {}), g.get("deltas"))
        found += insights.search_opportunities(g)
        a = demo.ads_overview(start, end, compare)
        found += insights.from_channel("google_ads", a.get("kpis", {}), a.get("deltas"))
        m = demo.meta_ads_overview(start, end, compare)
        found += insights.from_channel("meta_ads", m.get("kpis", {}), m.get("deltas"))
        payload = {"org_id": target_org, "insights": insights.rank(found)}
        cache.set(key, payload, cache.ttl_for_range(end))
        return payload

    if _connected(target_org, "google_analytics"):
        try:
            creds = _org_credentials(target_org)
            prop = property_id
            if not prop:
                props = analytics.list_properties(creds)
                prop = props[0]["property_id"] if props else None
            if prop:
                data = analytics.run_ga_overview(creds, prop, start, end, compare)
                found += insights.from_channel("analytics", data.get("kpis", {}), data.get("deltas"))
        except Exception:
            log.exception("insights: analytics failed org=%s", target_org)

    if _connected(target_org, "search_console"):
        try:
            creds = _org_credentials(target_org, provider="search_console")
            s = site
            if not s:
                sites = search_console.list_sites(creds)
                s = sites[0]["site_url"] if sites else None
            if s:
                data = search_console.run_search_analytics(creds, s, start, end, compare)
                found += insights.from_channel("search_console", data.get("totals", {}), data.get("deltas"))
                found += insights.search_opportunities(data)
        except Exception:
            log.exception("insights: search console failed org=%s", target_org)

    if _connected(target_org, "google_ads"):
        try:
            creds = _org_credentials(target_org, provider="google_ads")
            accounts = google_ads.list_accounts(creds)
            if accounts:
                data = google_ads.run_overview(creds, accounts[0]["customer_id"], start, end, compare)
                found += insights.from_channel("google_ads", data.get("kpis", {}), data.get("deltas"))
        except google_ads.AdsNotConfigured:
            pass
        except Exception:
            log.exception("insights: google ads failed org=%s", target_org)

    if _connected(target_org, "meta_ads"):
        try:
            token = _meta_token(target_org)
            accounts = meta.list_assets(token).get("ad_accounts") or []
            if accounts:
                data = meta.ads_overview(token, accounts[0]["id"], start, end, compare)
                found += insights.from_channel("meta_ads", data.get("kpis", {}), data.get("deltas"))
        except Exception:
            log.exception("insights: meta failed org=%s", target_org)

    payload = {"org_id": target_org, "insights": insights.rank(found)}
    cache.set(key, payload, cache.ttl_for_range(end))
    return payload


@app.get("/api/insights")
def insights_endpoint(
    request: Request, start: str, end: str,
    org_id: str | None = None, property_id: str | None = None, site: str | None = None,
):
    """Proactive, rule-based insights: notable period-over-period changes per channel."""
    user = auth.current_user(request)
    target_org = _resolve_org_id(user, org_id)
    return _compute_insights(target_org, start, end, property_id, site)


# ------------------------------------------------------------------- feedback

FEEDBACK_CATEGORIES = {"bug", "idee", "vraag", "compliment", "anders"}
FEEDBACK_STATUSES = {"requests", "in_progress", "done", "rejected"}


class FeedbackIn(BaseModel):
    category: str
    message: str
    page: str | None = None
    severity: str | None = None
    org_id: str | None = None


@app.post("/api/feedback")
def submit_feedback(request: Request, body: FeedbackIn):
    """Feedback vanuit het uitklappaneel; komt in de kanban-kolom Requests."""
    user = auth.current_user(request)
    if not ratelimit.allow(f"feedback|{user['email']}", limit=10, window_s=300):
        raise HTTPException(status_code=429, detail="Te veel feedback achter elkaar. Probeer het straks nog eens.")
    category = (body.category or "").strip().lower()
    if category not in FEEDBACK_CATEGORIES:
        raise HTTPException(status_code=400, detail="Onbekende categorie.")
    message = (body.message or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="Een toelichting is verplicht.")
    if len(message) > 4000:
        raise HTTPException(status_code=413, detail="Toelichting is te lang.")
    org = None
    try:
        org = _resolve_org_id(user, body.org_id)
    except HTTPException:
        pass  # feedback mag ook zonder herleidbare organisatie
    created = models.create_feedback(
        org, user["email"], category, message,
        page=(body.page or "")[:200] or None,
        severity=(body.severity or "")[:40] or None,
    )
    return {"ok": True, "id": created["id"]}


@app.get("/api/admin/feedback")
def admin_feedback(request: Request):
    auth.require_admin(request)
    return {"feedback": models.list_feedback()}


class FeedbackStatusIn(BaseModel):
    status: str


@app.patch("/api/admin/feedback/{feedback_id}")
def admin_feedback_status(request: Request, feedback_id: str, body: FeedbackStatusIn):
    auth.require_admin(request)
    if body.status not in FEEDBACK_STATUSES:
        raise HTTPException(status_code=400, detail="Onbekende status.")
    if not models.get_feedback(feedback_id):
        raise HTTPException(status_code=404, detail="Feedback niet gevonden.")
    models.set_feedback_status(feedback_id, body.status)
    return {"ok": True}


@app.post("/api/admin/feedback/{feedback_id}/analyze")
def admin_feedback_analyze(request: Request, feedback_id: str):
    """Laat AI (EuRouter) de feedback uitwerken plus verwerkingsadvies geven.

    Streamt de uitwerking als SSE (thinking/text/done/error), zodat de
    beheerder ziet dat de AI bezig is en de tekst live verschijnt. Fouten na
    de start van de stream komen als "error"-event; alleen configuratie- en
    invoerfouten geven nog een HTTP-status.
    """
    auth.require_admin(request)
    if not config.EUROUTER_API_KEY:
        raise HTTPException(status_code=503, detail="De AI-uitwerking is niet geconfigureerd (EUROUTER_API_KEY ontbreekt).")
    item = models.get_feedback(feedback_id)
    if not item:
        raise HTTPException(status_code=404, detail="Feedback niet gevonden.")
    stream = assistant.stream_feedback_analysis(
        item, api_key=config.EUROUTER_API_KEY,
        base_url=config.EUROUTER_BASE_URL, model=config.EUROUTER_MODEL,
        on_done=lambda text: models.set_feedback_analysis(feedback_id, text),
    )
    return StreamingResponse(
        stream,
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _connections_payload(target_org: str) -> dict:
    demo_org = models.is_demo_org(target_org)
    items = []
    for provider in config.GOOGLE_PROVIDERS + config.META_PROVIDERS + config.SHOP_PROVIDERS:
        conn = models.get_connection(target_org, provider=provider)
        # The demo org has no real grants, but GA, Search Console, Google Ads and
        # Meta all serve generated sample data, so present them as connected.
        if demo_org and provider in ("google_analytics", "search_console", "google_ads", "meta_ads"):
            items.append({"provider": provider, "status": "connected", "google_email": demo.DEMO_EMAIL})
            continue
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
    if provider not in config.GOOGLE_PROVIDERS + config.META_PROVIDERS + config.SHOP_PROVIDERS:
        raise HTTPException(status_code=400, detail="Unknown provider")

    conn = models.get_connection(target_org, provider=provider)
    models.delete_connection(target_org, provider)
    cache.invalidate_org(target_org)  # drop cached property/report data for this org
    # If this was the last Google connection, revoke the shared grant at Google.
    # (Meta has its own grant and is simply removed, no Google revoke.)
    if provider in config.GOOGLE_PROVIDERS and conn and models.count_google_connections(target_org) == 0:
        try:
            oauth.revoke(oauth.credentials_from_dict(conn["creds"]))
        except Exception:
            pass
    return _connections_payload(target_org)


@app.get("/api/search-console/sites")
def gsc_sites(request: Request, org_id: str | None = None):
    user = auth.current_user(request)
    target_org = _resolve_org_id(user, org_id)
    if models.is_demo_org(target_org):
        return {"org_id": target_org, "sites": demo.DEMO_SITES}
    key = f"{target_org}|gscsites"
    cached = cache.get(key)
    if cached is not None:
        return cached
    creds = _org_credentials(target_org, provider="search_console")
    sites = _google_data(target_org, "search_console", lambda: search_console.list_sites(creds))
    payload = {"org_id": target_org, "sites": sites}
    cache.set(key, payload, cache.LIST_TTL)
    return payload


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
    _require_period(start, end, compare_start, compare_end)
    target_org = _resolve_org_id(user, org_id)
    compare = (compare_start, compare_end) if compare_start and compare_end else None
    if models.is_demo_org(target_org):
        data = demo.gsc_report(start, end, compare)
        return {"org_id": target_org, "site": site, **data}
    key = f"{target_org}|gsc|{site}|{start}|{end}|{compare_start}|{compare_end}"
    cached = cache.get(key)
    if cached is not None:
        return cached
    creds = _org_credentials(target_org, provider="search_console")
    data = _google_data(target_org, "search_console", lambda: search_console.run_search_analytics(creds, site, start, end, compare))
    payload = {"org_id": target_org, "site": site, **data}
    cache.set(key, payload, cache.ttl_for_range(end))
    return payload


# ---------------------------------------------------------------------- meta
#
# Meta (Facebook + Instagram) uses its own Facebook Login flow, separate from the
# Google OAuth. The long-lived token is stored (encrypted) per org under the
# 'meta_ads' provider, like the other connections.


@app.get("/api/auth/meta/login")
def meta_login(request: Request, org_id: str | None = None, return_to: str = "/app/integrations"):
    if not request.session.get("user_id"):
        return RedirectResponse("/login")
    if not config.META_APP_ID or not config.META_REDIRECT_URI:
        raise HTTPException(status_code=503, detail="Meta is nog niet geconfigureerd op de server")
    user = auth.current_user(request)
    target_org = _resolve_org_id(user, org_id)
    state = uuid.uuid4().hex
    request.session["meta_oauth_state"] = state
    request.session["meta_oauth_org"] = target_org
    request.session["meta_oauth_return"] = _safe_return(return_to, "/app/integrations")
    return RedirectResponse(meta_oauth.build_login_url(state))


@app.get("/api/auth/meta/callback")
def meta_callback(request: Request):
    stored_state = request.session.get("meta_oauth_state")
    returned_state = request.query_params.get("state")
    if not stored_state or stored_state != returned_state:
        raise HTTPException(status_code=400, detail="Invalid Meta OAuth state")
    org_id = request.session.pop("meta_oauth_org", None)
    return_to = request.session.pop("meta_oauth_return", "/app/integrations")
    request.session.pop("meta_oauth_state", None)

    code = request.query_params.get("code")
    if not code or not org_id:  # user denied or session lost
        return RedirectResponse(return_to)

    creds = meta_oauth.exchange_code(code)
    try:
        name = meta_oauth.fetch_identity(creds["access_token"])
    except Exception:
        name = "Meta-account"
    models.save_connection(org_id, name, creds, provider="meta_ads")
    cache.invalidate_org(org_id)
    return RedirectResponse(return_to)


@app.get("/api/meta/accounts")
def meta_accounts(request: Request, org_id: str | None = None):
    user = auth.current_user(request)
    target_org = _resolve_org_id(user, org_id)
    if models.is_demo_org(target_org):
        return {"org_id": target_org, **demo.DEMO_META_ASSETS}
    key = f"{target_org}|metaassets"
    cached = cache.get(key)
    if cached is not None:
        return cached
    token = _meta_token(target_org)
    payload = {"org_id": target_org, **meta.list_assets(token)}
    cache.set(key, payload, cache.LIST_TTL)
    return payload


@app.get("/api/meta/ads-report")
def meta_ads_report(
    request: Request,
    ad_account_id: str,
    start: str,
    end: str,
    compare_start: str | None = None,
    compare_end: str | None = None,
    org_id: str | None = None,
):
    user = auth.current_user(request)
    _require_period(start, end, compare_start, compare_end)
    target_org = _resolve_org_id(user, org_id)
    compare = (compare_start, compare_end) if compare_start and compare_end else None
    if models.is_demo_org(target_org):
        data = demo.meta_ads_overview(start, end, compare)
        return {"org_id": target_org, "ad_account_id": ad_account_id, **data}
    key = f"{target_org}|metaads|{ad_account_id}|{start}|{end}|{compare_start}|{compare_end}"
    cached = cache.get(key)
    if cached is not None:
        return cached
    token = _meta_token(target_org)
    data = meta.ads_overview(token, ad_account_id, start, end, compare)
    payload = {"org_id": target_org, "ad_account_id": ad_account_id, **data}
    cache.set(key, payload, cache.ttl_for_range(end))
    return payload


@app.get("/api/meta/organic-report")
def meta_organic_report(
    request: Request,
    page_id: str,
    start: str,
    end: str,
    ig_id: str | None = None,
    org_id: str | None = None,
):
    user = auth.current_user(request)
    _require_period(start, end)
    target_org = _resolve_org_id(user, org_id)
    if models.is_demo_org(target_org):
        data = demo.meta_organic_overview(start, end)
        return {"org_id": target_org, "page_id": page_id, **data}
    key = f"{target_org}|metaorg|{page_id}|{ig_id}|{start}|{end}"
    cached = cache.get(key)
    if cached is not None:
        return cached
    token = _meta_token(target_org)
    data = meta.organic_overview(token, page_id, ig_id, start, end)
    payload = {"org_id": target_org, "page_id": page_id, **data}
    cache.set(key, payload, cache.ttl_for_range(end))
    return payload


# --------------------------------------------------------------- google ads


@app.get("/api/google-ads/accounts")
def ads_accounts(request: Request, org_id: str | None = None):
    user = auth.current_user(request)
    target_org = _resolve_org_id(user, org_id)
    if models.is_demo_org(target_org):
        return {"org_id": target_org, "accounts": demo.DEMO_ADS_ACCOUNTS}
    key = f"{target_org}|adsaccounts"
    cached = cache.get(key)
    if cached is not None:
        return cached
    creds = _org_credentials(target_org, provider="google_ads")
    try:
        accounts = google_ads.list_accounts(creds)
    except google_ads.AdsNotConfigured:
        raise HTTPException(status_code=409, detail="Google Ads is nog niet geconfigureerd op de server")
    payload = {"org_id": target_org, "accounts": accounts}
    cache.set(key, payload, cache.LIST_TTL)
    return payload


@app.get("/api/google-ads/report")
def ads_report(
    request: Request,
    customer_id: str,
    start: str,
    end: str,
    compare_start: str | None = None,
    compare_end: str | None = None,
    org_id: str | None = None,
):
    user = auth.current_user(request)
    _require_period(start, end, compare_start, compare_end)
    target_org = _resolve_org_id(user, org_id)
    compare = (compare_start, compare_end) if compare_start and compare_end else None
    if models.is_demo_org(target_org):
        data = demo.ads_overview(start, end, compare)
        return {"org_id": target_org, "customer_id": customer_id, **data}
    key = f"{target_org}|ads|{customer_id}|{start}|{end}|{compare_start}|{compare_end}"
    cached = cache.get(key)
    if cached is not None:
        return cached
    creds = _org_credentials(target_org, provider="google_ads")
    try:
        data = google_ads.run_overview(creds, customer_id, start, end, compare)
    except google_ads.AdsNotConfigured:
        raise HTTPException(status_code=409, detail="Google Ads is nog niet geconfigureerd op de server")
    payload = {"org_id": target_org, "customer_id": customer_id, **data}
    cache.set(key, payload, cache.ttl_for_range(end))
    return payload


# -------------------------------------------------------------- woocommerce
#
# WooCommerce koppelt met een read-only consumer key/secret (geen OAuth). De
# gegevens worden versleuteld per org opgeslagen onder provider 'woocommerce'.
# De ingebouwde demowinkel (store_url = woocommerce.DEMO_STORE) genereert
# deterministische demodata door hetzelfde rapportpad, zodat het kanaal
# end-to-end getest kan worden zonder externe winkel.


class WooConnectIn(BaseModel):
    store_url: str
    consumer_key: str
    consumer_secret: str


@app.post("/api/woocommerce/connect")
def wc_connect(request: Request, payload: WooConnectIn, org_id: str | None = None):
    """Koppel een echte WooCommerce-winkel (valideert URL + sleutel)."""
    user = auth.current_user(request)
    target_org = _resolve_org_id(user, org_id)
    # Throttle: deze endpoint doet een uitgaande request, dus beperk het aantal
    # pogingen (dempt misbruik als blinde SSRF-probe).
    if not ratelimit.allow(f"woo-connect|{target_org}", limit=10, window_s=60):
        raise HTTPException(status_code=429, detail="Te veel koppelpogingen - probeer het zo weer.")
    ck, cs = payload.consumer_key.strip(), payload.consumer_secret.strip()
    if not ck or not cs:
        raise HTTPException(status_code=400, detail="Consumer key en secret zijn vereist")
    try:
        store = woocommerce.validate_store_url(payload.store_url)
        woocommerce.test_connection(store, ck, cs)
    except woocommerce.WooError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        log.exception("woocommerce connect test failed org=%s", target_org)
        raise HTTPException(status_code=400, detail="Kan de winkel niet bereiken - controleer de URL.")
    host = store.split("//", 1)[-1].split("/", 1)[0]
    models.save_connection(
        target_org, host,
        {"store_url": store, "consumer_key": ck, "consumer_secret": cs},
        provider="woocommerce",
    )
    cache.invalidate_org(target_org)
    return _connections_payload(target_org)


@app.post("/api/woocommerce/connect-demo")
def wc_connect_demo(request: Request, org_id: str | None = None):
    """Koppel de ingebouwde demowinkel (voor testen zonder echte shop)."""
    user = auth.current_user(request)
    target_org = _resolve_org_id(user, org_id)
    if not ratelimit.allow(f"woo-connect|{target_org}", limit=10, window_s=60):
        raise HTTPException(status_code=429, detail="Te veel koppelpogingen - probeer het zo weer.")
    models.save_connection(
        target_org, "Demowinkel (voorbeelddata)",
        {"store_url": woocommerce.DEMO_STORE, "consumer_key": "", "consumer_secret": ""},
        provider="woocommerce",
    )
    cache.invalidate_org(target_org)
    return _connections_payload(target_org)


@app.get("/api/woocommerce/report")
def wc_report(
    request: Request,
    start: str,
    end: str,
    compare_start: str | None = None,
    compare_end: str | None = None,
    org_id: str | None = None,
):
    user = auth.current_user(request)
    _require_period(start, end, compare_start, compare_end)
    target_org = _resolve_org_id(user, org_id)
    key = f"{target_org}|woo|{start}|{end}|{compare_start}|{compare_end}"
    cached = cache.get(key)
    if cached is not None:
        return cached
    store, ck, cs = _wc_creds(target_org)
    compare = (compare_start, compare_end) if compare_start and compare_end else None
    try:
        data = woocommerce.run_overview(store, ck, cs, start, end, compare)
    except woocommerce.WooError as e:
        # Alleen een geweigerde sleutel (401/403) is een echte 'revoked'; een
        # onbereikbare of trage winkel is tijdelijk en mag de koppeling niet
        # ontkoppelen (dat oogde als "alles los" na elke deploy).
        if getattr(e, "auth", False):
            log.warning("REVOKE org=%s provider=woocommerce at=report err=%r", target_org, e)
            models.set_connection_status(target_org, "revoked", provider="woocommerce")
            raise HTTPException(status_code=409, detail="WooCommerce-koppeling werkt niet meer - opnieuw koppelen")
        log.warning("woocommerce tijdelijk niet bereikbaar org=%s err=%r", target_org, e)
        raise HTTPException(status_code=503, detail=f"De winkel is tijdelijk niet bereikbaar: {e}")
    payload = {"org_id": target_org, **data}
    cache.set(key, payload, cache.ttl_for_range(end))
    return payload


# ---------------------------------------------------------------- dashboards
#
# User-composed widget layouts. Private to their owner by default; the owner may
# share a dashboard with the rest of the organization (visibility='shared').
# Editing/renaming/deleting/default are owner-only. Agency admins may target any
# org via ?org_id= (ownership is still keyed on their own email).

# Pagina's (kanaalsleutels) waaraan een dashboard mag hangen. Sluit willekeurige
# waarden uit; de frontend gebruikt exact deze sleutels + 'overview' (legacy).
_DASHBOARD_PAGES = {
    "overview", "analytics", "search-console", "google-ads",
    "meta-ads", "meta-organic", "woocommerce",
}
# Een widgetlayout is klein (hooguit enkele tientallen widgets). Begrens de
# opgeslagen JSON zodat niemand willekeurig grote/diepe blobs kan wegschrijven.
_MAX_LAYOUT_BYTES = 64_000


def _validate_layout(layout: dict) -> None:
    widgets = layout.get("widgets") if isinstance(layout, dict) else None
    if not isinstance(layout, dict) or not isinstance(widgets, list):
        raise HTTPException(status_code=400, detail="Ongeldige indeling")
    if len(widgets) > 200:
        raise HTTPException(status_code=400, detail="Te veel widgets in deze indeling")
    try:
        size = len(json.dumps(layout))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Ongeldige indeling")
    if size > _MAX_LAYOUT_BYTES:
        raise HTTPException(status_code=413, detail="Indeling is te groot")


class DashboardIn(BaseModel):
    name: str
    layout: dict
    page: str = "overview"
    visibility: str = "private"
    is_default: bool = False


class DashboardPatch(BaseModel):
    name: str | None = None
    layout: dict | None = None
    visibility: str | None = None
    is_default: bool | None = None


@app.get("/api/dashboards")
def list_dashboards(request: Request, page: str = "overview", org_id: str | None = None):
    """Dashboards the user may see (their own + shared ones), names only."""
    user = auth.current_user(request)
    target_org = _resolve_org_id(user, org_id)
    return {
        "org_id": target_org,
        "dashboards": models.list_dashboards(target_org, user["email"], page),
    }


@app.get("/api/dashboards/{dashboard_id}")
def get_dashboard(request: Request, dashboard_id: str, org_id: str | None = None):
    """One dashboard with its full widget layout (owner or shared only)."""
    user = auth.current_user(request)
    target_org = _resolve_org_id(user, org_id)
    dash = models.get_dashboard(target_org, dashboard_id, user["email"])
    if not dash:
        raise HTTPException(status_code=404, detail="Dashboard niet gevonden")
    return dash


@app.post("/api/dashboards")
def create_dashboard(request: Request, payload: DashboardIn, org_id: str | None = None):
    """Create a new dashboard owned by the signed-in user."""
    user = auth.current_user(request)
    target_org = _resolve_org_id(user, org_id)
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Naam is vereist")
    if payload.page not in _DASHBOARD_PAGES:
        raise HTTPException(status_code=400, detail="Onbekende pagina")
    _validate_layout(payload.layout)
    return models.create_dashboard(
        target_org,
        name,
        payload.layout,
        page=payload.page,
        created_by=user["email"],
        visibility=payload.visibility,
        is_default=payload.is_default,
    )


@app.put("/api/dashboards/{dashboard_id}")
def update_dashboard(
    request: Request, dashboard_id: str, payload: DashboardPatch, org_id: str | None = None
):
    """Update an owned dashboard's name, layout, visibility, and/or default flag."""
    user = auth.current_user(request)
    target_org = _resolve_org_id(user, org_id)
    name = payload.name.strip() if payload.name is not None else None
    if name == "":
        raise HTTPException(status_code=400, detail="Naam mag niet leeg zijn")
    if payload.layout is not None:
        _validate_layout(payload.layout)
    # Distinguish "not found / not visible" (404) from "not the owner" (403).
    existing = models.get_dashboard(target_org, dashboard_id, user["email"])
    if not existing:
        raise HTTPException(status_code=404, detail="Dashboard niet gevonden")
    if not existing["is_owner"]:
        raise HTTPException(status_code=403, detail="Alleen de eigenaar kan dit dashboard wijzigen")
    dash = models.update_dashboard(
        target_org,
        dashboard_id,
        user["email"],
        name=name,
        layout=payload.layout,
        visibility=payload.visibility,
        is_default=payload.is_default,
    )
    if not dash:
        raise HTTPException(status_code=404, detail="Dashboard niet gevonden")
    return dash


@app.delete("/api/dashboards/{dashboard_id}")
def delete_dashboard(request: Request, dashboard_id: str, org_id: str | None = None):
    """Delete an owned dashboard."""
    user = auth.current_user(request)
    target_org = _resolve_org_id(user, org_id)
    existing = models.get_dashboard(target_org, dashboard_id, user["email"])
    if not existing:
        raise HTTPException(status_code=404, detail="Dashboard niet gevonden")
    if not existing["is_owner"]:
        raise HTTPException(status_code=403, detail="Alleen de eigenaar kan dit dashboard verwijderen")
    models.delete_dashboard(target_org, dashboard_id, user["email"])
    return {"ok": True}


# Catch-all: serve the SPA's index.html for any non-API route so the client-side
# router can handle deep links. Declared last so it never shadows /api or mounts.
#
# index.html MUST NOT be cached by the browser: de gehashte JS/CSS-assets krijgen
# bij elke build een nieuwe naam, dus een oude (gecachte) index.html verwijst na
# een deploy naar een verdwenen bundle -> die laadt niet en je krijgt een wit
# scherm. `no-cache` dwingt de browser de index elke keer te revalideren, zodat
# hij altijd de actuele asset-hashes ophaalt. De assets zelf (onder /assets,
# immutable per hash) mogen wél gewoon gecachet blijven.
@app.get("/{full_path:path}")
def spa(full_path: str):
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="Not found")
    if SPA_INDEX.exists():
        return FileResponse(SPA_INDEX, headers={"Cache-Control": "no-cache"})
    return JSONResponse(
        {"detail": "Frontend not built. Run `npm run build` in frontend/."},
        status_code=503,
    )
