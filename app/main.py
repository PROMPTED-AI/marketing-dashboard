"""FastAPI app exposing the Google Analytics OAuth flow for external users.

Routes
------
GET /                              -> simple status / instructions
GET /api/auth/google/login         -> redirect user to Google's consent screen
GET /api/auth/google/callback      -> exchange code, store tokens, log user in
GET /api/analytics/report          -> sample GA4 report for the logged-in user

This is a minimal, single-user-per-session skeleton meant as a starting
point. See token_store.py for the production notes on token storage.
"""
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse
from starlette.middleware.sessions import SessionMiddleware

from . import analytics, config, db, oauth, token_store


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ensure the tokens table exists before serving requests.
    db.init_schema()
    yield


app = FastAPI(title="Marketing Dashboard - GA4 OAuth", lifespan=lifespan)
app.add_middleware(SessionMiddleware, secret_key=config.SESSION_SECRET)


@app.get("/")
def index():
    return {
        "status": "ok",
        "next_step": "Open /api/auth/google/login to connect a Google Analytics account.",
    }


@app.get("/healthz")
def healthz():
    return {"status": "ok"}


@app.get("/api/auth/google/login")
def login(request: Request):
    authorization_url, state, code_verifier = oauth.build_authorization_url()
    # Store state (CSRF protection) and the PKCE verifier for the callback.
    request.session["oauth_state"] = state
    request.session["code_verifier"] = code_verifier
    return RedirectResponse(authorization_url)


@app.get("/api/auth/google/callback")
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

    # In a real app, map this to YOUR authenticated user id.
    user_id = request.session.get("user_id") or str(uuid.uuid4())
    request.session["user_id"] = user_id
    token_store.save(user_id, oauth.credentials_to_dict(creds))

    return JSONResponse(
        {
            "status": "connected",
            "user_id": user_id,
            "next_step": "Call /api/analytics/report?property_id=YOUR_GA4_PROPERTY_ID",
        }
    )


@app.get("/api/analytics/report")
def report(request: Request, property_id: str):
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not connected - visit /api/auth/google/login")

    stored = token_store.load(user_id)
    if not stored:
        raise HTTPException(status_code=401, detail="No stored credentials for this session")

    creds = oauth.credentials_from_dict(stored)
    # Persist any refreshed access token.
    token_store.save(user_id, oauth.credentials_to_dict(creds))

    rows = analytics.run_basic_report(creds, property_id)
    return {"property_id": property_id, "rows": rows}
