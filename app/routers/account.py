"""Account en toegang: inloggen, OAuth, eigen organisatie en profiel."""
import json
import logging
import time
import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse, StreamingResponse
from google.auth.exceptions import RefreshError
from pydantic import BaseModel

from .. import (
    analytics, assistant, auth, cache, config, demo, email as mailer, google_ads,
    insights, meta, meta_oauth, models, oauth, ratelimit, search_console, woocommerce,
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


# --------------------------------------- uitnodigingen + wachtwoord vergeten
#
# Nieuwe accounts met wachtwoord ontstaan via een uitnodiging: de admin maakt
# er een aan, de klant stelt via een eenmalige, tijdgebonden link zelf een
# wachtwoord in. Wachtwoord vergeten werkt met dezelfde token-infrastructuur.
# Alleen de hash van de token staat in de database (zie models.create_access_token).

INVITE_TTL = timedelta(days=7)
RESET_TTL = timedelta(hours=1)


def _base_url(request: Request) -> str:
    """Publieke basis-URL voor de links (config wint, anders uit het verzoek)."""
    return config.APP_BASE_URL or str(request.base_url).rstrip("/")


class InviteIn(BaseModel):
    email: str
    org_id: str
    role: str = "client"


@router.post("/api/admin/invitations")
def create_invitation(request: Request, payload: InviteIn):
    """Nodig iemand uit voor een organisatie (alleen agency admin).

    Geeft de uitnodigingslink terug (om te delen) en of hij per e-mail is
    verstuurd. E-mail gaat alleen als SMTP geconfigureerd is; anders deelt de
    admin de link zelf.
    """
    admin = auth.require_admin(request)
    email = payload.email.strip().lower()
    if "@" not in email or "." not in email.split("@")[-1]:
        raise HTTPException(status_code=400, detail="Voer een geldig e-mailadres in.")
    if payload.role not in ("client", "agency_admin"):
        raise HTTPException(status_code=400, detail="Onbekende rol.")
    org = models.get_organization(payload.org_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organisatie niet gevonden.")
    raw, token_hash = auth.generate_token()
    models.create_access_token(
        "invite", email, token_hash,
        datetime.now(timezone.utc) + INVITE_TTL,
        organization_id=payload.org_id, role=payload.role, created_by=admin["email"],
    )
    link = f"{_base_url(request)}/invite/{raw}"
    emailed = mailer.send_invite(email, link, org["name"]) if mailer.is_configured() else False
    return {"email": email, "invite_url": link, "emailed": emailed}


@router.get("/api/invitations/{token}")
def invitation_info(token: str):
    """Toon voor welk e-mailadres/organisatie de uitnodiging geldt (publiek)."""
    data = models.get_access_token(auth.hash_token(token), "invite")
    if not data:
        raise HTTPException(status_code=404, detail="Deze uitnodiging is verlopen of al gebruikt.")
    org = models.get_organization(data["organization_id"]) if data["organization_id"] else None
    return {"email": data["email"], "organization_name": org["name"] if org else None}


class SetPasswordIn(BaseModel):
    password: str


@router.post("/api/invitations/{token}/accept")
def accept_invitation(request: Request, token: str, payload: SetPasswordIn):
    """Wachtwoord instellen via een uitnodiging en meteen inloggen (publiek)."""
    if not ratelimit.allow("invite-accept", limit=30, window_s=60):
        raise HTTPException(status_code=429, detail="Te veel pogingen - probeer het zo weer.")
    token_hash = auth.hash_token(token)
    data = models.get_access_token(token_hash, "invite")
    if not data:
        raise HTTPException(status_code=404, detail="Deze uitnodiging is verlopen of al gebruikt.")
    problem = auth.password_problem(payload.password)
    if problem:
        raise HTTPException(status_code=400, detail=problem)
    user = models.upsert_user(data["email"], data["organization_id"], data["role"] or "client")
    models.set_user_password(data["email"], auth.hash_password(payload.password))
    models.use_access_token(token_hash)
    request.session["user_id"] = user["id"]
    return {"email": user["email"], "role": user["role"]}


class ForgotIn(BaseModel):
    email: str


@router.post("/api/auth/forgot")
def forgot_password(request: Request, payload: ForgotIn):
    """Stuur een wachtwoord-resetlink (publiek).

    Antwoordt altijd hetzelfde, of het account nu bestaat of niet, zodat je via
    deze route niet kunt achterhalen welke e-mailadressen een account hebben.
    """
    email = payload.email.strip().lower()
    per_email = ratelimit.allow(f"forgot|{email}", limit=3, window_s=900)
    globally = ratelimit.allow("forgot", limit=60, window_s=60)
    if email and per_email and globally:
        user = models.get_user_by_email(email)
        if user:
            raw, token_hash = auth.generate_token()
            models.create_access_token(
                "reset", email, token_hash, datetime.now(timezone.utc) + RESET_TTL,
            )
            mailer.send_reset(email, f"{_base_url(request)}/reset/{raw}")
    return {"ok": True}


@router.get("/api/auth/reset/{token}")
def reset_info(token: str):
    """Controleer een resetlink en geef het bijbehorende e-mailadres (publiek)."""
    data = models.get_access_token(auth.hash_token(token), "reset")
    if not data:
        raise HTTPException(status_code=404, detail="Deze resetlink is verlopen of al gebruikt.")
    return {"email": data["email"]}


@router.post("/api/auth/reset/{token}")
def reset_password(request: Request, token: str, payload: SetPasswordIn):
    """Stel een nieuw wachtwoord in via een resetlink en log in (publiek)."""
    if not ratelimit.allow("reset", limit=30, window_s=60):
        raise HTTPException(status_code=429, detail="Te veel pogingen - probeer het zo weer.")
    token_hash = auth.hash_token(token)
    data = models.get_access_token(token_hash, "reset")
    if not data:
        raise HTTPException(status_code=404, detail="Deze resetlink is verlopen of al gebruikt.")
    problem = auth.password_problem(payload.password)
    if problem:
        raise HTTPException(status_code=400, detail=problem)
    models.set_user_password(data["email"], auth.hash_password(payload.password))
    models.use_access_token(token_hash)
    user = models.get_user_by_email(data["email"])
    if user:
        request.session["user_id"] = user["id"]
    return {"ok": True}



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

