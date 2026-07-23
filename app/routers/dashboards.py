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
# waarden uit. De frontend gebruikt deze kanaalsleutels; het cross-kanaal
# "Overzicht"-tabblad gebruikt 'overview-mix' (en 'overview' bestaat als legacy).
_DASHBOARD_PAGES = {
    "overview", "overview-mix", "analytics", "search-console", "google-ads",
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


# ------------------------------------------------- dashboard genereren met AI
#
# De gebruiker beschrijft in een prompt wat hij wil zien; het model stelt een
# indeling voor uit de meegestuurde catalogus (de frontend is de grondwaarheid
# van welke widgets bestaan). De AI-output wordt server-side gevalideerd tegen
# diezelfde catalogus voordat we hem teruggeven; de frontend draait daarna nog
# `sanitizeLayout` als laatste vangnet en laat de gebruiker het concept eerst
# bekijken en bijschaven voor hij opslaat.

_VALID_SIZES = {3, 4, 6, 12}
_KIND_DEFAULT_SIZE = {"kpi": 3, "area": 12, "donut": 4, "bars": 6, "table": 6}
_CUSTOM_OPS = {"ratio", "sum", "diff", "product", "identity"}
_CUSTOM_FMTS = {"int", "euro", "ratio", "decimal", "percent"}
_MAX_GEN_WIDGETS = 24


class DashboardGenerateIn(BaseModel):
    prompt: str
    page: str = "overview"
    manifest: dict


def _clean_custom_spec(spec: dict, sources: dict) -> dict | None:
    """Valideer een custom-KPI-spec tegen de catalogus. refs moeten bestaande
    bronnen met een scalar zijn; ratio/diff vereisen minstens twee refs."""
    if not isinstance(spec, dict) or spec.get("op") not in _CUSTOM_OPS:
        return None
    raw_refs = spec.get("refs")
    if not isinstance(raw_refs, list):
        return None
    refs = [r for r in raw_refs if r in sources and sources[r].get("scalar")][:4]
    if not refs or (spec["op"] in ("ratio", "diff") and len(refs) < 2):
        return None
    out = {"op": spec["op"], "refs": refs}
    if spec.get("fmt") in _CUSTOM_FMTS:
        out["fmt"] = spec["fmt"]
    if isinstance(spec.get("higherBetter"), bool):
        out["higherBetter"] = spec["higherBetter"]
    return out


def _sanitize_generated(items, sources: dict) -> tuple[list, int]:
    """Houd alleen widgets over die naar bestaande bronnen/kinds verwijzen. Een
    ongeldige `kind` valt terug op de eerste toegestane in plaats van te droppen."""
    out, dropped = [], 0
    if not isinstance(items, list):
        return out, 0
    for w in items:
        if len(out) >= _MAX_GEN_WIDGETS:
            break
        if not isinstance(w, dict):
            dropped += 1
            continue
        src = w.get("source")
        title = str(w.get("title") or "").strip()[:80]
        size = w.get("size")
        if src == "custom":
            spec = _clean_custom_spec(w.get("spec"), sources)
            if not spec:
                dropped += 1
                continue
            out.append({
                "source": "custom", "kind": "kpi",
                "size": size if size in _VALID_SIZES else 3,
                "title": title or "Custom", "spec": spec,
            })
            continue
        meta_src = sources.get(src)
        if not meta_src:
            dropped += 1
            continue
        kinds = meta_src.get("kinds") or []
        kind = w.get("kind") if w.get("kind") in kinds else (kinds[0] if kinds else None)
        if not kind:
            dropped += 1
            continue
        out.append({
            "source": src, "kind": kind,
            "size": size if size in _VALID_SIZES else _KIND_DEFAULT_SIZE.get(kind, 3),
            "title": title or meta_src.get("label") or src,
        })
    return out, dropped


@router.post("/api/dashboards/generate")
def generate_dashboard_endpoint(request: Request, payload: DashboardGenerateIn, org_id: str | None = None):
    """Stel met AI een dashboard-indeling samen uit de meegestuurde catalogus."""
    user = auth.current_user(request)
    target_org = _resolve_org_id(user, org_id)
    if not config.EUROUTER_API_KEY:
        raise HTTPException(status_code=503, detail="De AI-assistent is niet geconfigureerd.")
    if not ratelimit.allow(f"dashgen|{target_org}", limit=10, window_s=60):
        raise HTTPException(status_code=429, detail="Te veel AI-verzoeken achter elkaar. Probeer het zo weer.")
    prompt = (payload.prompt or "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Beschrijf wat je op je dashboard wilt zien.")
    if len(prompt) > 2000:
        raise HTTPException(status_code=400, detail="Beschrijving is te lang.")
    if payload.page not in _DASHBOARD_PAGES:
        raise HTTPException(status_code=400, detail="Onbekende pagina")
    manifest = payload.manifest if isinstance(payload.manifest, dict) else {}
    sources = {s.get("key"): s for s in manifest.get("sources", []) if isinstance(s, dict) and s.get("key")}
    if not sources:
        raise HTTPException(status_code=400, detail="Lege catalogus")

    # Compacte catalogus voor het model: alleen sleutels, labels en toegestane kinds.
    catalog_json = json.dumps(
        {"sources": [
            {"key": k, "label": s.get("label"), "kinds": s.get("kinds", []), "scalar": bool(s.get("scalar"))}
            for k, s in sources.items()
        ]},
        ensure_ascii=False,
    )
    try:
        raw = assistant.generate_dashboard(
            prompt, catalog_json,
            api_key=config.EUROUTER_API_KEY, base_url=config.EUROUTER_BASE_URL, model=config.EUROUTER_MODEL,
        )
    except ValueError:
        # Het model gaf geen bruikbare JSON terug (ook niet na de herkansing).
        log.warning("dashboard genereren: geen geldige JSON van het model org=%s", target_org)
        raise HTTPException(status_code=502, detail="De AI gaf geen bruikbare indeling terug. Probeer je vraag iets concreter te formuleren.")
    except Exception:  # noqa: BLE001 - gateway-/verbindingsfout
        log.exception("dashboard genereren faalde org=%s", target_org)
        raise HTTPException(status_code=502, detail="Het samenstellen met AI is niet gelukt. Probeer het opnieuw.")

    widgets, dropped = _sanitize_generated(raw.get("widgets"), sources)
    layout = {"widgets": widgets}
    _validate_layout(layout)
    notes = raw.get("notes") if isinstance(raw.get("notes"), str) else ""
    reqs = raw.get("requests")
    requests_list = [str(r)[:200] for r in reqs if r][:8] if isinstance(reqs, list) else []
    return {"layout": layout, "notes": notes[:400], "requests": requests_list, "dropped": dropped}


# Catch-all: serve the SPA's index.html for any non-API route so the client-side
# router can handle deep links. Declared last so it never shadows /api or mounts.
#
# index.html MUST NOT be cached by the browser: de gehashte JS/CSS-assets krijgen
# bij elke build een nieuwe naam, dus een oude (gecachte) index.html verwijst na
# een deploy naar een verdwenen bundle -> die laadt niet en je krijgt een wit
# scherm. `no-cache` dwingt de browser de index elke keer te revalideren, zodat
# hij altijd de actuele asset-hashes ophaalt. De assets zelf (onder /assets,
