"""Feedback: indienen door gebruikers en beheren plus AI-uitwerking door de admin."""
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

# ------------------------------------------------------------------- feedback

FEEDBACK_CATEGORIES = {"bug", "idee", "vraag", "compliment", "anders"}
FEEDBACK_STATUSES = {"requests", "in_progress", "done", "rejected"}


class FeedbackIn(BaseModel):
    category: str
    message: str
    page: str | None = None
    severity: str | None = None
    org_id: str | None = None


@router.post("/api/feedback")
def submit_feedback(request: Request, body: FeedbackIn):
    """Feedback vanuit het uitklappaneel; komt in de kanban-kolom Requests."""
    user = auth.current_user(request)
    if not ratelimit.allow(f"feedback|{user['email']}", limit=10, window_s=300):
        raise HTTPException(status_code=429, detail="Te veel feedback achter elkaar. Probeer het straks nog eens.")
    category = (body.category or "").strip().lower()
    if category not in FEEDBACK_CATEGORIES:
        raise HTTPException(status_code=400, detail="Onbekende categorie.")
    message = (body.message or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="Een toelichting is verplicht.")
    if len(message) > 4000:
        raise HTTPException(status_code=413, detail="Toelichting is te lang.")
    org = None
    try:
        org = _resolve_org_id(user, body.org_id)
    except HTTPException:
        pass  # feedback mag ook zonder herleidbare organisatie
    created = models.create_feedback(
        org, user["email"], category, message,
        page=(body.page or "")[:200] or None,
        severity=(body.severity or "")[:40] or None,
    )
    return {"ok": True, "id": created["id"]}


@router.get("/api/admin/feedback")
def admin_feedback(request: Request):
    auth.require_admin(request)
    return {"feedback": models.list_feedback()}


class FeedbackStatusIn(BaseModel):
    status: str


@router.patch("/api/admin/feedback/{feedback_id}")
def admin_feedback_status(request: Request, feedback_id: str, body: FeedbackStatusIn):
    auth.require_admin(request)
    if body.status not in FEEDBACK_STATUSES:
        raise HTTPException(status_code=400, detail="Onbekende status.")
    if not models.get_feedback(feedback_id):
        raise HTTPException(status_code=404, detail="Feedback niet gevonden.")
    models.set_feedback_status(feedback_id, body.status)
    return {"ok": True}


@router.post("/api/admin/feedback/{feedback_id}/analyze")
def admin_feedback_analyze(request: Request, feedback_id: str):
    """Laat AI (EuRouter) de feedback uitwerken plus verwerkingsadvies geven.

    Streamt de uitwerking als SSE (thinking/text/done/error), zodat de
    beheerder ziet dat de AI bezig is en de tekst live verschijnt. Fouten na
    de start van de stream komen als "error"-event; alleen configuratie- en
    invoerfouten geven nog een HTTP-status.
    """
    auth.require_admin(request)
    if not config.EUROUTER_API_KEY:
        raise HTTPException(status_code=503, detail="De AI-uitwerking is niet geconfigureerd (EUROUTER_API_KEY ontbreekt).")
    item = models.get_feedback(feedback_id)
    if not item:
        raise HTTPException(status_code=404, detail="Feedback niet gevonden.")
    stream = assistant.stream_feedback_analysis(
        item, api_key=config.EUROUTER_API_KEY,
        base_url=config.EUROUTER_BASE_URL, model=config.EUROUTER_MODEL,
        on_done=lambda text: models.set_feedback_analysis(feedback_id, text),
    )
    return StreamingResponse(
        stream,
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

