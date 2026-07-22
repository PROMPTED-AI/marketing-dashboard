"""Gedeelde org- en data-toegang: org-resolutie, Google-credentials en
kanaal-helpers, gebruikt door meerdere routers."""
import json
import logging
import random
import threading
import time
from datetime import date, timedelta

from fastapi import HTTPException
from google.api_core.exceptions import PermissionDenied, Unauthenticated
from google.auth.exceptions import RefreshError, TransportError
from google.oauth2.credentials import Credentials

from . import config, meta_oauth, models, oauth

log = logging.getLogger("dashboard")

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


def _safe_return(path: str | None, default: str) -> str:
    """Allow only same-site absolute paths as a post-OAuth redirect target.

    Blocks protocol-relative (`//host`) and backslash (`/\\host`) forms that
    browsers resolve to an external origin — otherwise an open redirect.
    """
    if path and path.startswith("/") and not path.startswith(("//", "/\\")):
        return path
    return default


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
        or "invalid_scope" in txt
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
        # Persist any refreshed access token; de scopes blijven puur ter
        # informatie bewaard (het Credentials-object draagt ze niet meer).
        refreshed = oauth.credentials_to_dict(creds)
        refreshed["scopes"] = refreshed.get("scopes") or (conn["creds"] or {}).get("scopes")
        models.save_connection(org_id, conn["google_email"], refreshed, provider=provider)
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
    except (RefreshError, Unauthenticated, PermissionDenied) as e:
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



def _compact(value, cap: int = 12):
    """Shrink a data payload for the LLM: cap lists, keep it token-cheap."""
    if isinstance(value, dict):
        return {k: _compact(v, cap) for k, v in value.items()}
    if isinstance(value, list):
        return [_compact(v, cap) for v in value[:cap]]
    return value



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

