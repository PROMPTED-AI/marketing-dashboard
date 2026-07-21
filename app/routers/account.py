"""Account en toegang: inloggen, OAuth, eigen organisatie en profiel."""
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
    _resolve_org_id, _wc_creds,
)

log = logging.getLogger("dashboard")
router = APIRouter()

def _safe_return(path: str | None, default: str) -> str:
    """Allow only same-site absolute paths as a post-OAuth redirect target.

    Blocks protocol-relative (`//host`) and backslash (`/\\host`) forms that
    browsers resolve to an external origin — otherwise an open redirect.
    """
    if path and path.startswith("/") and not path.startswith(("//", "/\\")):
        return path
    return default



@router.get("/api/me")
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


class PasswordLoginIn(BaseModel):
    email: str
    password: str


@router.post("/api/auth/login")
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


@router.get("/api/auth/google/login")
def login(request: Request):
    """Sign in: request only the user's identity (email), no data scopes."""
    authorization_url, state, code_verifier = oauth.build_authorization_url(
        config.LOGIN_SCOPES, access_type="online", prompt="select_account"
    )
    request.session["oauth_state"] = state
    request.session["code_verifier"] = code_verifier
    request.session["oauth_mode"] = "login"
    return RedirectResponse(authorization_url)


@router.get("/api/auth/google/connect")
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


@router.get("/api/auth/google/callback")
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


@router.get("/api/auth/logout")
def logout(request: Request):
    request.session.clear()
    return RedirectResponse("/")



class OrgRename(BaseModel):
    name: str
    business_type: str | None = None


@router.patch("/api/organizations/{org_id}")
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


@router.patch("/api/organizations/me/business-type")
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




@router.get("/api/organizations")
def organizations(request: Request):
    """Organizations the user may view/switch to (admins: all; clients: own)."""
    user = auth.current_user(request)
    if user["role"] == "agency_admin":
        orgs = models.list_organizations_with_connections()
        # subscription gaat mee zodat de app bij het wisselen naar een klant
        # met een verlopen proefperiode hetzelfde verloopscherm kan tonen dat
        # de klant zelf ziet.
        return {"organizations": [
            {"id": o["id"], "name": o["name"], "domain": o["domain"],
             "business_type": o.get("business_type"), "subscription": o.get("subscription")}
            for o in orgs
        ]}
    org = models.get_organization(user["organization_id"])
    return {"organizations": [
        {"id": org["id"], "name": org["name"], "domain": org["domain"],
         "business_type": org.get("business_type"), "subscription": models.subscription_info(org)}
    ] if org else []}

