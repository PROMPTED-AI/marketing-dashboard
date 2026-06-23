"""FastAPI app: Google Analytics OAuth + a small dashboard frontend.

Routes
------
GET  /                              -> dashboard page (static HTML)
GET  /healthz                       -> health check
GET  /api/auth/status               -> {connected: bool}
GET  /api/auth/google/login         -> redirect to Google's consent screen
GET  /api/auth/google/callback      -> exchange code, store tokens, back to /
GET  /api/analytics/properties      -> GA4 properties the user can access
GET  /api/analytics/report          -> sample GA4 report for a property
"""
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from google.oauth2.credentials import Credentials
from starlette.middleware.sessions import SessionMiddleware

from . import analytics, config, db, oauth, token_store

STATIC_DIR = Path(__file__).resolve().parent / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ensure the tokens table exists before serving requests.
    db.init_schema()
    yield


app = FastAPI(title="Marketing Dashboard - GA4 OAuth", lifespan=lifespan)
app.add_middleware(SessionMiddleware, secret_key=config.SESSION_SECRET)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


def _load_creds(request: Request) -> Credentials:
    """Return refreshed Credentials for the logged-in session, or raise 401."""
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not connected")
    stored = token_store.load(user_id)
    if not stored:
        raise HTTPException(status_code=401, detail="No stored credentials")
    creds = oauth.credentials_from_dict(stored)
    # Persist any refreshed access token.
    token_store.save(user_id, oauth.credentials_to_dict(creds))
    return creds


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/healthz")
def healthz():
    return {"status": "ok"}


@app.get("/api/auth/status")
def auth_status(request: Request):
    user_id = request.session.get("user_id")
    connected = bool(user_id and token_store.load(user_id))
    return {"connected": connected}


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

    # Back to the dashboard, which will now load the user's properties.
    return RedirectResponse("/")


@app.get("/api/analytics/properties")
def properties(request: Request):
    creds = _load_creds(request)
    return {"properties": analytics.list_properties(creds)}


@app.get("/api/analytics/report")
def report(request: Request, property_id: str):
    creds = _load_creds(request)
    rows = analytics.run_basic_report(creds, property_id)
    return {"property_id": property_id, "rows": rows}
