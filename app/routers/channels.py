"""Kanaaldata en koppelingen: Analytics, Search Console, META, Google Ads en WooCommerce."""
import json
import logging
import time
import uuid
from datetime import date, timedelta

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse, StreamingResponse
from google.auth.exceptions import RefreshError
from pydantic import BaseModel

from .. import (
    analytics, assistant, auth, cache, config, demo, google_ads, insights, meta,
    meta_oauth, models, oauth, ratelimit, search_console, woocommerce,
)
from ..org_access import (
    _compact, _connected, _google_data, _GOOGLE_TRANSIENT_MSG, _is_grant_revoked,
    _meta_token, _org_credentials, _previous_period, _require_period,
    _resolve_org_id, _safe_return, _wc_creds,
)

log = logging.getLogger("dashboard")
router = APIRouter()

@router.get("/api/analytics/properties")
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


@router.get("/api/analytics/report")
def report(request: Request, property_id: str, org_id: str | None = None):
    user = auth.current_user(request)
    target_org = _resolve_org_id(user, org_id)
    if models.is_demo_org(target_org):
        return {"org_id": target_org, "property_id": property_id, "rows": demo.basic_report()}
    creds = _org_credentials(target_org)
    rows = _google_data(target_org, "google_analytics", lambda: analytics.run_basic_report(creds, property_id))
    return {"org_id": target_org, "property_id": property_id, "rows": rows}


@router.get("/api/analytics/overview")
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


@router.get("/api/analytics/realtime")
def analytics_realtime(request: Request, property_id: str, org_id: str | None = None):
    user = auth.current_user(request)
    target_org = _resolve_org_id(user, org_id)
    if models.is_demo_org(target_org):
        return {"property_id": property_id, **demo.realtime()}
    creds = _org_credentials(target_org)
    rt = _google_data(target_org, "google_analytics", lambda: analytics.run_realtime(creds, property_id))
    return {"property_id": property_id, **rt}



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


@router.get("/api/connections")
def connections(request: Request, org_id: str | None = None):
    """Per-provider connection status for the onboarding + sidebar progress."""
    user = auth.current_user(request)
    return _connections_payload(_resolve_org_id(user, org_id))


@router.post("/api/connections/{provider}/disconnect")
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


@router.get("/api/search-console/sites")
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


@router.get("/api/search-console/report")
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


@router.get("/api/auth/meta/login")
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


@router.get("/api/auth/meta/callback")
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


@router.get("/api/meta/accounts")
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


@router.get("/api/meta/ads-report")
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


@router.get("/api/meta/organic-report")
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


@router.get("/api/google-ads/accounts")
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


@router.get("/api/google-ads/report")
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


@router.post("/api/woocommerce/connect")
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


@router.post("/api/woocommerce/connect-demo")
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


@router.get("/api/woocommerce/report")
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

