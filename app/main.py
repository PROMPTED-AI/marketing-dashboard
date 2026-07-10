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
import uuid
import logging
from datetime import date, timedelta
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from google.api_core.exceptions import Unauthenticated
from google.auth.exceptions import RefreshError
from google.oauth2.credentials import Credentials
from pydantic import BaseModel
from starlette.middleware.sessions import SessionMiddleware

from . import (
    analytics, assistant, auth, cache, config, db, google_ads, insights, meta,
    meta_oauth, models, oauth, ratelimit, search_console, woocommerce,
)

log = logging.getLogger("dashboard")

# The React/Vite build is copied here by the Dockerfile (stage 1 -> stage 2).
SPA_DIR = Path(__file__).resolve().parent / "static_spa"
SPA_INDEX = SPA_DIR / "index.html"


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_schema()
    cache.init_schema()
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
    """Clients are pinned to their own org; admins may target any org."""
    if requested_org_id and user["role"] == "agency_admin":
        return requested_org_id
    return user["organization_id"]


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


def _org_credentials(org_id: str, provider: str = "google_analytics") -> Credentials:
    """Load + refresh an org's credentials, flipping status to revoked on failure."""
    conn = models.get_connection(org_id, provider=provider)
    if not conn or conn["status"] != "connected":
        raise HTTPException(status_code=409, detail="No active connection for this organization")
    try:
        creds = oauth.credentials_from_dict(conn["creds"])
    except RefreshError as e:
        log.warning(
            "REVOKE org=%s provider=%s at=refresh email=%s err=%r",
            org_id, provider, conn.get("google_email"), e,
        )
        models.set_connection_status(org_id, "revoked", provider=provider)
        raise HTTPException(status_code=409, detail="Connection expired - please reconnect")
    # Persist any refreshed access token.
    models.save_connection(org_id, conn["google_email"], oauth.credentials_to_dict(creds), provider=provider)
    return creds


def _google_data(org_id: str, provider: str, fn):
    """Run a Google data call; turn an auth failure into a clean 'reconnect' 409.

    Tokens can be revoked or rejected at call time (HTTP 401 UNAUTHENTICATED),
    not just at refresh time. Without this, that 401 surfaces as a raw 500 and
    takes down Overzicht/Analytics. Here we flip the connection to 'revoked' so
    the UI shows a reconnect prompt instead.
    """
    try:
        return fn()
    except (RefreshError, Unauthenticated) as e:
        log.warning("REVOKE org=%s provider=%s at=api-call err=%r", org_id, provider, e)
        models.set_connection_status(org_id, "revoked", provider=provider)
        raise HTTPException(status_code=409, detail="Connection expired - please reconnect")


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


class OrgRename(BaseModel):
    name: str


@app.patch("/api/organizations/{org_id}")
def rename_organization(request: Request, org_id: str, payload: OrgRename):
    """Rename an organization (agency admins only)."""
    auth.require_admin(request)
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Naam is vereist")
    org = models.rename_organization(org_id, name)
    if not org:
        raise HTTPException(status_code=404, detail="Organisatie niet gevonden")
    cache.invalidate_org(org_id)
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
        return {"organizations": [{"id": o["id"], "name": o["name"], "domain": o["domain"]} for o in orgs]}
    org = models.get_organization(user["organization_id"])
    return {"organizations": [{"id": org["id"], "name": org["name"], "domain": org["domain"]}] if org else []}


@app.get("/api/analytics/properties")
def properties(request: Request, org_id: str | None = None):
    user = auth.current_user(request)
    target_org = _resolve_org_id(user, org_id)
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
    key = f"{target_org}|overview|{property_id}|{start}|{end}|{compare_start}|{compare_end}"
    cached = cache.get(key)
    if cached is not None:
        return cached
    creds = _org_credentials(target_org)
    compare = (compare_start, compare_end) if compare_start and compare_end else None
    data = _google_data(target_org, "google_analytics", lambda: analytics.run_ga_overview(creds, property_id, start, end, compare))
    payload = {"org_id": target_org, "property_id": property_id, **data}
    cache.set(key, payload, cache.ttl_for_range(end))
    return payload


@app.get("/api/analytics/realtime")
def analytics_realtime(request: Request, property_id: str, org_id: str | None = None):
    user = auth.current_user(request)
    target_org = _resolve_org_id(user, org_id)
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

    def execute(name: str, tool_input: dict) -> str:
        """Run one tool, org-scoped. Returns a JSON string; never raises."""
        start, end = _tool_period(tool_input or {})
        try:
            if name == "list_connections":
                return json.dumps(_connections_payload(target_org), ensure_ascii=False, default=str)
            if name == "get_analytics_overview":
                creds = _org_credentials(target_org)
                prop = body.property_id
                if not prop:
                    props = _google_data(target_org, "google_analytics", lambda: analytics.list_properties(creds))
                    if not props:
                        return json.dumps({"error": "Geen Analytics-property gekoppeld."})
                    prop = props[0]["property_id"]
                data = _google_data(target_org, "google_analytics",
                                    lambda: analytics.run_ga_overview(creds, prop, start, end, None))
                return json.dumps(_compact(data), ensure_ascii=False, default=str)
            if name == "get_search_console":
                creds = _org_credentials(target_org, provider="search_console")
                site = body.site
                if not site:
                    sites = _google_data(target_org, "search_console", lambda: search_console.list_sites(creds))
                    if not sites:
                        return json.dumps({"error": "Geen Search Console-site gekoppeld."})
                    site = sites[0]["site_url"]
                data = _google_data(target_org, "search_console",
                                    lambda: search_console.run_search_analytics(creds, site, start, end, None))
                return json.dumps(_compact(data), ensure_ascii=False, default=str)
            if name == "get_google_ads":
                creds = _org_credentials(target_org, provider="google_ads")
                try:
                    accounts = google_ads.list_accounts(creds)
                    if not accounts:
                        return json.dumps({"error": "Geen Google Ads-account gekoppeld."})
                    data = google_ads.run_overview(creds, accounts[0]["customer_id"], start, end, None)
                except google_ads.AdsNotConfigured:
                    return json.dumps({"error": "Google Ads is nog niet geconfigureerd op de server."})
                return json.dumps(_compact(data), ensure_ascii=False, default=str)
            if name == "get_meta_ads":
                token = _meta_token(target_org)
                accounts = (meta.list_assets(token).get("ad_accounts") or [])
                if not accounts:
                    return json.dumps({"error": "Geen Meta-advertentieaccount gekoppeld."})
                data = meta.ads_overview(token, accounts[0]["id"], start, end, None)
                return json.dumps(_compact(data), ensure_ascii=False, default=str)
            if name == "get_meta_organic":
                token = _meta_token(target_org)
                pages = (meta.list_assets(token).get("pages") or [])
                if not pages:
                    return json.dumps({"error": "Geen Facebook-pagina gekoppeld."})
                page = pages[0]
                ig_id = (page.get("instagram") or {}).get("id")
                data = meta.organic_overview(token, page["id"], ig_id, start, end)
                return json.dumps(_compact(data), ensure_ascii=False, default=str)
            if name == "get_woocommerce":
                store, ck, cs = _wc_creds(target_org)
                data = woocommerce.run_overview(store, ck, cs, start, end, None)
                return json.dumps(_compact(data), ensure_ascii=False, default=str)
            return json.dumps({"error": f"Onbekende tool: {name}"})
        except HTTPException as e:
            return json.dumps({"error": str(e.detail)}, ensure_ascii=False)
        except Exception:  # noqa: BLE001 - surface a generic tool error, log detail server-side
            log.exception("assistant tool failed name=%s org=%s", name, target_org)
            return json.dumps({"error": "Kon deze gegevens niet ophalen."}, ensure_ascii=False)

    def gather_context() -> str:
        """Compacte data van alle gekoppelde kanalen, als context voor modellen
        zonder tool-calling. Hergebruikt `execute` (org-scoped, gecachet); niet
        gekoppelde kanalen leveren een fout en worden overgeslagen."""
        blocks = []
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
        return "\n\n".join(blocks) if blocks else "(geen gekoppelde kanalen met data voor deze periode)"

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


@app.get("/api/insights")
def insights_endpoint(
    request: Request, start: str, end: str,
    org_id: str | None = None, property_id: str | None = None, site: str | None = None,
):
    """Proactive, rule-based insights: notable period-over-period changes per channel."""
    user = auth.current_user(request)
    target_org = _resolve_org_id(user, org_id)
    key = f"{target_org}|insights|{start}|{end}|{property_id}|{site}"
    cached = cache.get(key)
    if cached is not None:
        return cached

    try:
        compare = _previous_period(start, end)
    except ValueError:
        raise HTTPException(status_code=400, detail="Ongeldige periode")

    found: list[dict] = []

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


def _connections_payload(target_org: str) -> dict:
    items = []
    for provider in config.GOOGLE_PROVIDERS + config.META_PROVIDERS + config.SHOP_PROVIDERS:
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
    key = f"{target_org}|gsc|{site}|{start}|{end}|{compare_start}|{compare_end}"
    cached = cache.get(key)
    if cached is not None:
        return cached
    creds = _org_credentials(target_org, provider="search_console")
    compare = (compare_start, compare_end) if compare_start and compare_end else None
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
    key = f"{target_org}|metaads|{ad_account_id}|{start}|{end}|{compare_start}|{compare_end}"
    cached = cache.get(key)
    if cached is not None:
        return cached
    token = _meta_token(target_org)
    compare = (compare_start, compare_end) if compare_start and compare_end else None
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
    key = f"{target_org}|ads|{customer_id}|{start}|{end}|{compare_start}|{compare_end}"
    cached = cache.get(key)
    if cached is not None:
        return cached
    creds = _org_credentials(target_org, provider="google_ads")
    compare = (compare_start, compare_end) if compare_start and compare_end else None
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
        log.warning("REVOKE org=%s provider=woocommerce at=report err=%r", target_org, e)
        models.set_connection_status(target_org, "revoked", provider="woocommerce")
        raise HTTPException(status_code=409, detail="WooCommerce-koppeling werkt niet meer - opnieuw koppelen")
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
