"""Beheeromgeving: organisaties, trials, gebruikers, activiteit, diagnose, pakketten en facturatie."""
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

@router.get("/api/admin/organizations")
def admin_organizations(request: Request):
    auth.require_admin(request)
    return {"organizations": models.list_organizations_with_connections()}


class OrgIn(BaseModel):
    name: str
    domain: str


@router.post("/api/admin/organizations")
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


@router.post("/api/admin/organizations/{org_id}/trial")
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


@router.get("/api/admin/users")
def admin_users(request: Request):
    auth.require_admin(request)
    return {"users": models.list_users()}


class RoleIn(BaseModel):
    role: str


@router.patch("/api/admin/users/{user_id}")
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


@router.get("/api/admin/activity")
def admin_activity(request: Request):
    auth.require_admin(request)
    return {"activity": models.activity_feed()}


@router.get("/api/admin/diagnose/google")
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


@router.post("/api/admin/organizations/{org_id}/package")
def admin_set_package(request: Request, org_id: str, payload: PackageIn):
    auth.require_admin(request)
    if payload.package is not None and payload.package not in models.PACKAGES:
        raise HTTPException(status_code=400, detail="Onbekend pakket.")
    if not models.get_organization(org_id):
        raise HTTPException(status_code=404, detail="Organisatie niet gevonden.")
    models.set_package(org_id, payload.package)
    return {"ok": True, "package": payload.package}


@router.get("/api/admin/organizations/{org_id}/billing")
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


@router.put("/api/admin/organizations/{org_id}/billing")
def admin_save_billing(request: Request, org_id: str, payload: BillingIn):
    auth.require_admin(request)
    if not models.get_organization(org_id):
        raise HTTPException(status_code=404, detail="Organisatie niet gevonden.")
    return {"billing": models.save_billing_details(org_id, payload.model_dump())}




@router.get("/api/admin/assistant/models")
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


@router.post("/api/admin/assistant/models/probe")
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

