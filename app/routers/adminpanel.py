"""Beheeromgeving: organisaties, trials, gebruikers, activiteit, diagnose, pakketten en facturatie."""
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

@router.get("/api/admin/organizations")
def admin_organizations(request: Request):
    """De klantomgevingen van het eigen bureau (platform-admin: alle)."""
    admin = auth.require_admin(request)
    return {"organizations": models.list_organizations_with_connections(auth.admin_agency_id(admin))}


class OrgIn(BaseModel):
    name: str
    domain: str
    features: dict[str, bool] | None = None


@router.post("/api/admin/organizations")
def admin_add_organization(request: Request, payload: OrgIn):
    """Zet een klantaccount klaar onder het eigen bureau.

    Het bureau van de admin wordt meteen vastgelegd op de nieuwe organisatie,
    zodat alleen dat bureau deze omgeving beheert. Optioneel gaan de functies
    (signalen, assistent, integraties, raamwerk, dashboards) direct mee.
    """
    admin = auth.require_admin(request)
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
    agency_id = admin["organization_id"]
    # Het bureau van de admin is vanaf nu expliciet een bureau-organisatie.
    models.set_org_is_agency(agency_id, True)
    org = models.create_or_rename_organization(name, domain, agency_id=agency_id)
    if payload.features:
        models.set_org_features(org["id"], payload.features)
    org["features"] = models.get_org_features(org["id"])
    return {"organization": org}


@router.delete("/api/admin/organizations/{org_id}")
def admin_delete_organization(request: Request, org_id: str):
    """Verwijder een organisatie en alles wat eraan hangt (alleen agency admin).

    Vangrails: niet het demo-account en niet je eigen organisatie. Bedoeld om
    een per ongeluk aangemaakte of overbodige organisatie (zoals een verkeerd
    toegevoegd publiek domein) op te ruimen.
    """
    admin = auth.require_admin_org(request, org_id)
    org = models.get_organization(org_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organisatie niet gevonden.")
    if org.get("is_demo"):
        raise HTTPException(status_code=400, detail="Het demo-account kan niet verwijderd worden.")
    if org_id == admin["organization_id"]:
        raise HTTPException(status_code=400, detail="Je kunt je eigen organisatie niet verwijderen.")
    cache.invalidate_org(org_id)
    models.delete_organization(org_id)
    return {"ok": True}


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
    auth.require_admin_org(request, org_id)
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
    admin = auth.require_admin(request)
    return {"users": models.list_users(auth.admin_agency_id(admin))}


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
    if not auth.can_admin_org(admin_user, target["organization_id"]):
        raise HTTPException(status_code=403, detail="Deze gebruiker hoort niet bij jouw bureau.")
    # Beheerdersrechten horen bij het bureau zelf: een bureau-admin maakt alleen
    # collega's in de eigen bureau-organisatie admin, niet iemand bij een klant.
    agency_id = auth.admin_agency_id(admin_user)
    if (payload.role == "agency_admin" and agency_id is not None
            and target["organization_id"] != agency_id):
        raise HTTPException(
            status_code=400,
            detail="Beheerdersrechten kun je alleen geven aan iemand in je eigen bureau-organisatie.",
        )
    if target["id"] == admin_user["id"] and payload.role != "agency_admin":
        raise HTTPException(status_code=400, detail="Je kunt je eigen beheerdersrol niet afnemen.")
    models.set_user_role(user_id, payload.role)
    return {"ok": True}


@router.post("/api/admin/users/{user_id}/reset-link")
def admin_reset_link(request: Request, user_id: str):
    """Genereer een wachtwoord-resetlink voor een gebruiker (alleen agency admin).

    Handig als e-mail niet geconfigureerd is: de admin deelt de link zelf. Is
    SMTP wel ingesteld, dan wordt de link ook direct gemaild.
    """
    admin = auth.require_admin(request)
    target = models.get_user(user_id)
    if not target:
        raise HTTPException(status_code=404, detail="Gebruiker niet gevonden.")
    if not auth.can_admin_org(admin, target["organization_id"]):
        raise HTTPException(status_code=403, detail="Deze gebruiker hoort niet bij jouw bureau.")
    raw, token_hash = auth.generate_token()
    models.create_access_token(
        "reset", target["email"], token_hash,
        datetime.now(timezone.utc) + timedelta(hours=1),
    )
    base = config.APP_BASE_URL or str(request.base_url).rstrip("/")
    link = f"{base}/reset/{raw}"
    emailed = mailer.send_reset(target["email"], link) if mailer.is_configured() else False
    return {"email": target["email"], "reset_url": link, "emailed": emailed}


@router.get("/api/admin/activity")
def admin_activity(request: Request):
    admin = auth.require_admin(request)
    return {"activity": models.activity_feed(agency_id=auth.admin_agency_id(admin))}


# ------------------------------------------------ bureau-model: omgeving inrichten
#
# Een bureau logt in met één manageraccount en richt per bedrijf een omgeving
# in: de bureau-koppeling (het manager-token) wordt naar het bedrijf gekopieerd
# en de admin wijst toe welke property/site/Ads-klant erbij hoort. De data wordt
# server-side op die toewijzing vastgezet, zodat een klant alleen zijn eigen
# bedrijf ziet.


@router.post("/api/admin/organizations/{org_id}/link-agency")
def admin_link_agency(request: Request, org_id: str):
    """Hergebruik de Google-koppeling van het bureau-account voor dit bedrijf."""
    admin = auth.require_admin_org(request, org_id)
    if not models.get_organization(org_id):
        raise HTTPException(status_code=404, detail="Organisatie niet gevonden.")
    copied = models.copy_google_connections(admin["organization_id"], org_id)
    if not copied:
        raise HTTPException(
            status_code=409,
            detail="Koppel eerst Google op je eigen bureau-account (via Integraties); die koppeling hergebruik je hier.",
        )
    models.set_org_managed(org_id, True)
    cache.invalidate_org(org_id)
    return {"ok": True, "copied": copied}


@router.get("/api/admin/organizations/{org_id}/available-assets")
def admin_available_assets(request: Request, org_id: str):
    """De property's, sites en Ads-klanten die via de koppeling van dit bedrijf
    beschikbaar zijn, voor de toewijzing (alleen admin, ongefilterd)."""
    auth.require_admin_org(request, org_id)
    if models.is_demo_org(org_id):
        return {"properties": demo.DEMO_PROPERTIES, "sites": demo.DEMO_SITES, "ads_accounts": demo.DEMO_ADS_ACCOUNTS}
    # Welk Google-account de lijsten voedt: de lijsten tonen precies waar dít
    # account toegang toe heeft, dus de UI laat het zien om verwarring te
    # voorkomen ("waarom zie ik mijn klanten niet?").
    conn = models.get_connection(org_id, provider="google_analytics") or \
        models.get_connection(org_id, provider="search_console") or \
        models.get_connection(org_id, provider="google_ads")
    out = {"properties": [], "sites": [], "ads_accounts": [],
           "google_email": (conn or {}).get("google_email")}
    try:
        creds = _org_credentials(org_id)
        out["properties"] = _google_data(org_id, "google_analytics", lambda: analytics.list_properties(creds))
    except Exception as e:  # noqa: BLE001 - degradeer per kanaal
        log.info("available-assets properties org=%s err=%r", org_id, e)
    try:
        creds = _org_credentials(org_id, provider="search_console")
        out["sites"] = _google_data(org_id, "search_console", lambda: search_console.list_sites(creds))
    except Exception as e:  # noqa: BLE001
        log.info("available-assets sites org=%s err=%r", org_id, e)
    try:
        creds = _org_credentials(org_id, provider="google_ads")
        out["ads_accounts"] = google_ads.list_accounts(creds)
    except Exception as e:  # noqa: BLE001
        log.info("available-assets ads org=%s err=%r", org_id, e)
    return out


class AssetsIn(BaseModel):
    ga_property_id: str | None = None
    gsc_site_url: str | None = None
    ads_customer_id: str | None = None


@router.get("/api/admin/organizations/{org_id}/assets")
def admin_get_assets(request: Request, org_id: str):
    auth.require_admin_org(request, org_id)
    org = models.get_organization(org_id) or {}
    return {"assets": models.get_org_assets(org_id), "managed": bool(org.get("managed"))}


@router.put("/api/admin/organizations/{org_id}/assets")
def admin_set_assets(request: Request, org_id: str, payload: AssetsIn):
    auth.require_admin_org(request, org_id)
    if not models.get_organization(org_id):
        raise HTTPException(status_code=404, detail="Organisatie niet gevonden.")
    assets = models.set_org_assets(org_id, payload.model_dump())
    cache.invalidate_org(org_id)
    return {"assets": assets}


# ------------------------------------------------ functies per klantomgeving
#
# Het bureau bepaalt per account welke onderdelen de klant krijgt: signalen,
# AI-assistent, integraties, raamwerk en mijn dashboards. De stand wordt hier
# beheerd en server-side afgedwongen op de bijbehorende endpoints.


class FeaturesIn(BaseModel):
    features: dict[str, bool] | None = None
    channels: dict[str, bool] | None = None


@router.get("/api/admin/features")
def admin_feature_catalog(request: Request):
    """De beschikbare functies met hun label, voor de beheerschermen."""
    auth.require_admin(request)
    return {"features": [{"key": k, "label": v} for k, v in models.FEATURES.items()]}


@router.get("/api/admin/organizations/{org_id}/features")
def admin_get_features(request: Request, org_id: str):
    auth.require_admin_org(request, org_id)
    if not models.get_organization(org_id):
        raise HTTPException(status_code=404, detail="Organisatie niet gevonden.")
    return {"features": models.get_org_features(org_id),
            "channels": models.get_org_channels(org_id),
            "catalog": [{"key": k, "label": v} for k, v in models.FEATURES.items()],
            "channel_catalog": [{"key": k, "label": v} for k, v in models.CHANNELS.items()]}


@router.put("/api/admin/organizations/{org_id}/features")
def admin_set_features(request: Request, org_id: str, payload: FeaturesIn):
    """Zet functies en/of kanalen aan of uit voor één klantomgeving."""
    auth.require_admin_org(request, org_id)
    if not models.get_organization(org_id):
        raise HTTPException(status_code=404, detail="Organisatie niet gevonden.")
    unknown = [k for k in (payload.features or {}) if k not in models.FEATURES]
    if unknown:
        raise HTTPException(status_code=400, detail=f"Onbekende functie: {unknown[0]}")
    unknown = [k for k in (payload.channels or {}) if k not in models.CHANNELS]
    if unknown:
        raise HTTPException(status_code=400, detail=f"Onbekend kanaal: {unknown[0]}")
    if payload.features:
        models.set_org_features(org_id, payload.features)
    if payload.channels:
        models.set_org_channels(org_id, payload.channels)
    return {"features": models.get_org_features(org_id),
            "channels": models.get_org_channels(org_id)}


# ------------------------------------------------------- bureaus (platform-admin)


@router.get("/api/admin/agencies")
def admin_agencies(request: Request):
    """Bureaus plus álle organisaties met hun bureau (alleen de platform-admin).

    De volledige lijst, niet alleen de niet-toegewezen organisaties: na de
    migratie hoort elke organisatie al bij een bureau, en dan valt er zonder
    volledige lijst niets meer te promoveren of te verhangen.
    """
    admin = auth.require_admin(request)
    if auth.admin_agency_id(admin) is not None:
        raise HTTPException(status_code=403, detail="Alleen de platform-beheerder.")
    return {
        "agencies": models.list_agencies(),
        "organizations": [
            {"id": o["id"], "name": o["name"], "domain": o["domain"],
             "agency_id": o.get("agency_id"), "is_agency": o.get("is_agency")}
            for o in models.list_organizations_with_connections()
        ],
    }


class AgencyIn(BaseModel):
    is_agency: bool | None = None
    agency_id: str | None = None


@router.patch("/api/admin/organizations/{org_id}/agency")
def admin_set_agency(request: Request, org_id: str, payload: AgencyIn):
    """Maak een organisatie een bureau en/of hang hem onder een bureau.

    Voorbehouden aan de platform-admin: hiermee verschuift wie een omgeving
    mag beheren, en dat moet geen bureau over zijn eigen grenzen heen kunnen.
    """
    admin = auth.require_admin(request)
    if auth.admin_agency_id(admin) is not None:
        raise HTTPException(status_code=403, detail="Alleen de platform-beheerder.")
    if not models.get_organization(org_id):
        raise HTTPException(status_code=404, detail="Organisatie niet gevonden.")
    if payload.is_agency is False and models.count_agency_clients(org_id):
        raise HTTPException(
            status_code=400,
            detail="Dit bureau heeft nog klantomgevingen. Verhang die eerst naar een ander bureau.",
        )
    if payload.is_agency is not None:
        models.set_org_is_agency(org_id, payload.is_agency)
    if payload.agency_id is not None:
        agency = models.get_organization(payload.agency_id) if payload.agency_id else None
        if payload.agency_id and not (agency and agency.get("is_agency")):
            raise HTTPException(status_code=400, detail="Onbekend bureau.")
        if payload.agency_id == org_id:
            raise HTTPException(status_code=400, detail="Een bureau kan niet zijn eigen klant zijn.")
        models.set_org_agency(org_id, payload.agency_id or None)
    return {"organization": models.get_organization(org_id)}


@router.get("/api/admin/diagnose/google")
def admin_diagnose_google(request: Request, org_id: str, provider: str = "google_analytics"):
    """Test een Google-koppeling en geef de exacte foutreden terug (admin).

    Probeert het token te verversen en daarna een minimale API-call. Zo is in
    productie direct te zien waaróm een koppeling faalt (ingetrokken grant,
    ontbrekende scope, tijdelijke storing) in plaats van alleen een generieke
    melding. De respons bevat geen tokens, alleen de foutomschrijving.
    """
    auth.require_admin_org(request, org_id)
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
    auth.require_admin_org(request, org_id)
    if payload.package is not None and payload.package not in models.PACKAGES:
        raise HTTPException(status_code=400, detail="Onbekend pakket.")
    if not models.get_organization(org_id):
        raise HTTPException(status_code=404, detail="Organisatie niet gevonden.")
    models.set_package(org_id, payload.package)
    return {"ok": True, "package": payload.package}


@router.get("/api/admin/organizations/{org_id}/billing")
def admin_get_billing(request: Request, org_id: str):
    auth.require_admin_org(request, org_id)
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
    auth.require_admin_org(request, org_id)
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

