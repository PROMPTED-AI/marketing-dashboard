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
    _meta_token, _org_credentials, _previous_period, _require_channel,
    _require_feature, _require_period, _resolve_org_id, _safe_return, _wc_creds,
)

log = logging.getLogger("dashboard")
router = APIRouter()


@router.get("/api/me")
def me(request: Request):
    user = auth.current_user(request)
    org = models.get_organization(user["organization_id"])
    subscription = models.subscription_info(org)
    # `features` is de functiestand van de eigen omgeving (het bureau zet ze per
    # account aan of uit); `is_platform_admin` onderscheidt de platformbeheerder
    # van een bureau-admin, die alleen zijn eigen klanten beheert.
    base = {
        "email": user["email"],
        "role": user["role"],
        "is_platform_admin": auth.is_platform_admin(user["email"]),
        "organization": org,
        "features": models.get_org_features(user["organization_id"]),
        "channels": models.get_org_channels(user["organization_id"]),
        "subscription": subscription,
    }
    if org and org.get("is_demo"):
        return {**base, "connection_status": "connected"}
    conn = models.get_connection(user["organization_id"])
    return {**base, "connection_status": conn["status"] if conn else "not_connected"}


def _client_ip(request: Request) -> str:
    """Beste schatting van het client-IP achter de Cloud Run-proxy.

    De load balancer zet het echte client-IP als één-na-laatste entry in
    X-Forwarded-For; wat een client zelf meestuurt komt daarvóór en is dus niet
    te vertrouwen. Zonder header valt dit terug op de socket. Het IP is een
    aanvullende sleutel: de rem per account is de harde grens, want een IP is
    te roteren.
    """
    xff = [p.strip() for p in (request.headers.get("x-forwarded-for") or "").split(",") if p.strip()]
    if len(xff) >= 2:
        return xff[-2]
    if xff:
        return xff[0]
    return request.client.host if request.client else "onbekend"


def _throttle(*buckets: tuple[str, int, int], message: str) -> None:
    """Pas alle meegegeven vensters toe; één vol venster geeft 429.

    Elke gevoelige flow krijgt een sleutel per account en per IP naast een
    globale backstop. Zonder de eerste twee zou één globale teller zowel een
    slappe brute-force-rem zijn als een manier om ándermans login te blokkeren.
    """
    for key, limit, window_s in buckets:
        if not ratelimit.allow(key, limit=limit, window_s=window_s):
            raise HTTPException(status_code=429, detail=message)


class PasswordLoginIn(BaseModel):
    email: str
    password: str


_LOGIN_FAILS_PER_ACCOUNT = (10, 900)   # 10 mislukte pogingen per 15 minuten
_LOGIN_FAILS_PER_IP = (50, 900)


@router.post("/api/auth/login")
def password_login(request: Request, payload: PasswordLoginIn):
    """Sign in with email + password (next to the Google flow).

    De rem telt alleen mislukte pogingen, per account en per IP: brute force
    loopt vast terwijl iemand die zijn wachtwoord gewoon goed heeft nooit tegen
    een limiet aanloopt. Er wordt geteld op het ingevoerde adres, ook als dat
    account niet bestaat — anders zou een 429 verraden welke adressen bestaan.
    """
    email = payload.email.strip().lower()
    ip = _client_ip(request)
    account_key, ip_key = f"login-fail|{email}", f"login-fail-ip|{ip}"
    too_many = (
        not ratelimit.peek(account_key, *_LOGIN_FAILS_PER_ACCOUNT)
        or not ratelimit.peek(ip_key, *_LOGIN_FAILS_PER_IP)
        # Globale backstop tegen een gedistribueerde poging; ruim genoeg om
        # normaal gebruik nooit te raken.
        or not ratelimit.allow("login", limit=300, window_s=60)
    )
    if too_many:
        raise HTTPException(
            status_code=429,
            detail="Te veel mislukte inlogpogingen - probeer het over een kwartier weer.",
        )
    user = models.get_user_by_email(email) if email else None
    if (
        not user
        or not user.get("password_hash")
        or not auth.verify_password(payload.password, user["password_hash"])
    ):
        ratelimit.allow(account_key, *_LOGIN_FAILS_PER_ACCOUNT)
        ratelimit.allow(ip_key, *_LOGIN_FAILS_PER_IP)
        raise HTTPException(
            status_code=401,
            detail="Onjuiste combinatie van e-mailadres en wachtwoord",
        )
    auth.start_session(request, user)
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
    # De koppeling landt op de eigen organisatie, dus daar geldt de functiestand:
    # heeft het bureau Integraties uitgezet, dan koppelt deze omgeving niet zelf,
    # en per kanaal geldt de allowlist die het bureau heeft ingesteld.
    user = auth.current_user(request)
    _require_feature(user["organization_id"], "integrations")
    requested = [p for p in providers.split(",") if p in config.GOOGLE_PROVIDERS]
    for p in requested:
        _require_channel(user["organization_id"], p, user)
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

    # Lees de flow-gegevens vóórdat de sessie wordt vernieuwd: start_session
    # leegt de sessie (geen resten van een vorige login), dus daarna zijn deze
    # waarden weg.
    mode = request.session.pop("oauth_mode", "login")
    providers = request.session.pop("oauth_providers", [])
    return_to = request.session.pop("oauth_return", "/app")

    # Identify the user and place them in an organization. Invite-only: a user
    # only joins a shared org when an admin pre-provisioned their company domain;
    # public/shared domains and unknown domains get an isolated personal org.
    #
    # Bestaat de gebruiker al in een echte (niet-persoonlijke) organisatie, dan
    # blijft die staan, inclusief de rol. Anders zou een bureau-admin die via een
    # uitnodiging is aangemaakt bij elke Google-login terugvallen naar 'client'
    # en naar de organisatie van zijn e-maildomein. Wie nog in een persoonlijke
    # org zit, wordt wél opnieuw opgehaald: zo landt hij alsnog in de klant-org
    # zodra het bureau zijn bedrijfsdomein heeft klaargezet.
    email = oauth.fetch_user_email(creds).lower()
    existing = models.get_user_by_email(email)
    current = models.get_organization(existing["organization_id"]) if existing else None
    if current and not current.get("is_personal"):
        org, role = current, existing["role"]
    else:
        org, role = models.org_for_login(email), (existing or {}).get("role", "client")
    if auth.is_platform_admin(email):
        role = "agency_admin"
    user = models.upsert_user(email, org["id"], role)
    auth.start_session(request, user)

    # On a "connect" flow, store the tool connection(s) that were just granted.
    if mode == "connect":
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
    admin = auth.require_admin_org(request, payload.org_id)
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
    _throttle(
        (f"invite-accept-ip|{_client_ip(request)}", 20, 600),
        ("invite-accept", 120, 60),
        message="Te veel pogingen - probeer het zo weer.",
    )
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
    auth.start_session(request, user)
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
    per_ip = ratelimit.allow(f"forgot-ip|{_client_ip(request)}", limit=10, window_s=900)
    globally = ratelimit.allow("forgot", limit=120, window_s=60)
    if email and per_email and per_ip and globally:
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
    _throttle(
        (f"reset-ip|{_client_ip(request)}", 20, 600),
        ("reset", 120, 60),
        message="Te veel pogingen - probeer het zo weer.",
    )
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
        auth.start_session(request, user)
    return {"ok": True}



class OrgRename(BaseModel):
    name: str
    business_type: str | None = None
    website: str | None = None
    industry: str | None = None


@router.patch("/api/organizations/{org_id}")
def rename_organization(request: Request, org_id: str, payload: OrgRename):
    """Rename an organization and/or set its profile (agency admins only)."""
    auth.require_admin_org(request, org_id)
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Naam is vereist")
    org = models.rename_organization(org_id, name)
    if not org:
        raise HTTPException(status_code=404, detail="Organisatie niet gevonden")
    if payload.business_type is not None:
        if payload.business_type not in models.BUSINESS_TYPES:
            raise HTTPException(status_code=400, detail="Ongeldig bedrijfstype")
        models.set_business_type(org_id, payload.business_type)
    if payload.website is not None or payload.industry is not None:
        models.set_org_profile(org_id, website=payload.website, industry=payload.industry)
    cache.invalidate_org(org_id)
    return {"organization": models.get_organization(org_id)}


class OrgProfileIn(BaseModel):
    name: str | None = None
    website: str | None = None
    industry: str | None = None
    business_type: str | None = None


@router.patch("/api/organizations/me/profile")
def set_own_profile(request: Request, payload: OrgProfileIn):
    """Bedrijfsprofiel van de eigen organisatie instellen (elke ingelogde gebruiker).

    Least-privilege: de organisatie komt uit de sessie, nooit uit de request.
    Zo legt ook een gebruiker op een publiek e-maildomein (gmail) een echte
    bedrijfsnaam vast in plaats van de van het e-mailadres afgeleide naam.
    """
    user = auth.current_user(request)
    org_id = user["organization_id"]
    if payload.business_type is not None:
        if payload.business_type not in models.BUSINESS_TYPES:
            raise HTTPException(status_code=400, detail="Ongeldig bedrijfstype")
        models.set_business_type(org_id, payload.business_type)
    org = models.set_org_profile(org_id, name=payload.name, website=payload.website, industry=payload.industry)
    if not org:
        raise HTTPException(status_code=404, detail="Organisatie niet gevonden")
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
    """Organisaties waartussen de gebruiker mag wisselen.

    Een bureau-admin ziet de omgevingen van het eigen bureau (de platform-admin
    alle), een klant alleen zijn eigen organisatie. `features` gaat mee zodat de
    app bij het wisselen meteen de juiste onderdelen toont, en `subscription`
    zodat een verlopen proefperiode hetzelfde verloopscherm geeft dat de klant
    zelf ziet.
    """
    user = auth.current_user(request)
    if user["role"] == "agency_admin":
        orgs = models.list_organizations_with_connections(auth.admin_agency_id(user))
        return {"organizations": [
            {"id": o["id"], "name": o["name"], "domain": o["domain"],
             "business_type": o.get("business_type"), "website": o.get("website"),
             "industry": o.get("industry"), "subscription": o.get("subscription"),
             "features": o.get("features"), "channels": o.get("channels"),
             "is_agency": o.get("is_agency")}
            for o in orgs
        ]}
    org = models.get_organization(user["organization_id"])
    return {"organizations": [
        {"id": org["id"], "name": org["name"], "domain": org["domain"],
         "business_type": org.get("business_type"), "website": org.get("website"),
         "industry": org.get("industry"), "subscription": models.subscription_info(org),
         "features": models.get_org_features(org["id"]),
         "channels": models.get_org_channels(org["id"]), "is_agency": org.get("is_agency")}
    ] if org else []}

