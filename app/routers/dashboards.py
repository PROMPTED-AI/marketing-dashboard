"""Zelf samengestelde dashboards: opslaan, delen en beheren per pagina."""
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


@router.get("/api/dashboards")
def list_dashboards(request: Request, page: str = "overview", org_id: str | None = None):
    """Dashboards the user may see (their own + shared ones), names only."""
    user = auth.current_user(request)
    target_org = _resolve_org_id(user, org_id)
    return {
        "org_id": target_org,
        "dashboards": models.list_dashboards(target_org, user["email"], page),
    }


@router.get("/api/dashboards/{dashboard_id}")
def get_dashboard(request: Request, dashboard_id: str, org_id: str | None = None):
    """One dashboard with its full widget layout (owner or shared only)."""
    user = auth.current_user(request)
    target_org = _resolve_org_id(user, org_id)
    dash = models.get_dashboard(target_org, dashboard_id, user["email"])
    if not dash:
        raise HTTPException(status_code=404, detail="Dashboard niet gevonden")
    return dash


@router.post("/api/dashboards")
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


@router.put("/api/dashboards/{dashboard_id}")
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


@router.delete("/api/dashboards/{dashboard_id}")
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
